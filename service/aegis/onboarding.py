"""Tenant onboarding (docs/MULTI-TENANT.md, Onboarding): config, faucet drip, resumable status, activation.

The visitor's browser sends every Safe and registry transaction itself. The server only drips gas, mints test
USDC once per Safe, and starts serving a Safe after checking on-chain that it is configured as AEGIS expects.
"""

from __future__ import annotations

import hashlib
import threading
import time

from eth_utils import is_address, to_checksum_address

from aegis.chain.base import ChainClient
from aegis.config import has_key, load_key
from aegis.core.reserve import ReserveResult, required_reserve
from aegis.services import Services
from aegis.sessions import SessionManager, verify_signed_message
from aegis.tenants import present
from aegis.workflow import WorkflowError

FUND_SIG_MAX_AGE = 300
RECEIPT_TIMEOUT = 60.0
DAY = 86400
STATUS_PER_MINUTE = 60


def onboarding_message(owner: str, bank: str, chain_id: int, issued_at: str) -> str:
    return f"AEGIS onboarding\nowner: {owner}\nbank: {bank}\nchainId: {chain_id}\nissuedAt: {issued_at}"


def _address(value, field: str) -> str:
    if not isinstance(value, str) or not is_address(value):
        raise WorkflowError(400, "BadAddress", f"{field} is not an address")
    return to_checksum_address(value)


def utc_day(ts: float | None = None) -> int:
    return int((ts if ts is not None else time.time()) // DAY)


class Onboarding:
    def __init__(self, services: Services, sessions: SessionManager | None = None):
        self.s = services
        self.settings = services.settings
        self.sessions = sessions or SessionManager(services)
        self._faucet_lock = threading.Lock()

    @property
    def chain(self) -> ChainClient:
        return self.s.chain

    def ip_hash(self, ip: str) -> str:
        return hashlib.sha256(f"{self.settings.ip_salt}:{ip}".encode()).hexdigest()[:32]

    def operator(self) -> dict:
        roles = self.settings.addresses.roles
        return {k: roles.get(k) for k in ("authorizer", "exitKey", "executor", "keeper")}

    def is_open(self) -> bool:
        return (self.settings.onboarding_open and has_key("faucet", self.settings.chain_id)
                and self.s.tenants.activated_count() < self.settings.limits.max_tenants)

    def initial_reserve(self) -> ReserveResult:
        """The reserve of an empty schedule (the buffer floor B_min). Onboarding writes it as the first floor, so a
        new treasury starts in sync instead of holding every deposit with FloorOutOfSync."""
        return required_reserve([], 0, self.settings.params)

    def config(self) -> dict:
        st, a, t = self.settings, self.settings.addresses, self.settings.tenant
        reference = [r["safe"] for r in self.s.tenants.served() if r["reference"]]
        floor = self.initial_reserve()
        return {
            "chainId": st.chain_id, "rpcUrl": st.public_rpc_url, "explorer": st.explorer,
            "safeSingleton": a.safe_singleton, "safeProxyFactory": a.safe_proxy_factory,
            "fallbackHandler": a.fallback_handler, "registry": a.registry, "module": a.module, "usdc": a.usdc,
            "priceFeed": a.price_feed,
            "vaults": [{"address": v.address, "name": v.label} for v in a.vaults],
            "operator": self.operator(),
            "params": {"autoCap": str(t.auto_cap), "dailyCap": str(t.daily_cap), "bankLimit": str(t.bank_limit),
                       "maxBandWidth": str(t.max_band_width), "maxOracleAge": t.max_oracle_age,
                       "reserveFloor": str(floor.required), "scheduleHash": floor.schedule_hash},
            "paramBounds": {"autoCapMax": str(t.auto_cap_max), "dailyCapMax": str(t.daily_cap_max),
                            "bankLimitMax": str(t.bank_limit_max), "maxBandWidthMax": str(t.max_band_width_max),
                            "maxOracleAgeMax": t.max_oracle_age_max},
            "ethOwner": str(t.eth_owner), "ethBank": str(t.eth_bank), "testUsdc": str(t.test_usdc),
            "referenceSafe": reference[0] if reference else None,
            "onboardingOpen": self.is_open(),
        }

    def fund(self, owner: str, bank: str, issued_at: str | None, signature: str | None, ip: str) -> dict:
        owner, bank = _address(owner, "owner"), _address(bank, "bank")
        if owner == bank:
            raise WorkflowError(400, "BadOnboardingState", "owner and bank must be different keys")
        verify_signed_message(onboarding_message(owner, bank, self.settings.chain_id, issued_at or ""),
                              owner, signature, issued_at, FUND_SIG_MAX_AGE, chain=self.chain)
        if not self.s.tenants.by_owner(owner) and not self.is_open():
            raise WorkflowError(403, "OnboardingClosed", "this demo is not accepting new treasuries right now")
        t = self.settings.tenant
        needs, waiting = [], []
        for address, target in ((owner, t.eth_owner), (bank, t.eth_bank)):
            balance = self.chain.eth_balance(address)
            if balance >= target // 2:
                continue
            drip = self._drip_row(address)
            state = self._drip_state(drip) if drip else None
            if state is None:
                needs.append((address, target - balance))
            elif state == "pending":
                waiting.append({"address": address, "hash": drip["tx_hash"], "amountWei": drip["amount"]})
        if not needs and not waiting:
            return {"txs": [], "pending": False}
        return self._await(waiting + (self._drip(needs, self.ip_hash(ip)) if needs else []))

    def _drip_row(self, address: str) -> dict | None:
        return self.s.db.one("SELECT * FROM faucet_drips WHERE address=?", (address.lower(),))

    def _dripped(self, address: str) -> bool:
        return self._drip_row(address) is not None

    def _drip_state(self, drip: dict) -> str | None:
        """'confirmed', 'pending', or None once a drip that reverted is forgotten, so the address may get another."""
        rec = self.chain.receipt(drip["tx_hash"]) if drip.get("tx_hash") else None
        if rec is None:
            return "pending" if drip.get("tx_hash") else None
        if rec.status == 1:
            return "confirmed"
        self._forget_drip(drip["address"], drip["tx_hash"])
        return None

    def _forget_drip(self, address: str, tx_hash: str) -> None:
        self.s.db.execute("DELETE FROM faucet_drips WHERE address=? AND tx_hash=?", (address.lower(), tx_hash))

    def _funded(self, address: str, target: int) -> bool:
        """Enough test ETH now, or a faucet drip that was mined (gas spent since then does not undo the step)."""
        if self.chain.eth_balance(address) >= target // 2:
            return True
        drip = self._drip_row(address)
        return drip is not None and self._drip_state(drip) == "confirmed"

    def _drip(self, needs: list[tuple[str, int]], ip_hash: str) -> list[dict]:
        key = self._faucet_key()
        with self._faucet_lock:
            today = utc_day()
            row = self.s.db.one("SELECT COALESCE(SUM(CAST(amount AS INTEGER)), 0) AS total FROM faucet_drips "
                                "WHERE day=?", (today,))
            spent = int(row["total"]) if row else 0
            if spent + sum(a for _, a in needs) > self.settings.limits.faucet_wei_per_day:
                raise WorkflowError(503, "FaucetEmpty", "the daily test ETH budget is used up; try again tomorrow")
            if not self.s.limiter.hit("onboard_fund_ip", ip_hash, self.settings.limits.onboard_per_ip_day, DAY):
                raise WorkflowError(429, "RateLimited", "onboarding limit per IP address reached; try again tomorrow")
            txs = []
            for address, amount_wei in needs:
                if self._dripped(address):
                    continue
                try:
                    tx = self.chain.send_value(key, address, amount_wei)
                except Exception as e:
                    raise WorkflowError(503, "FaucetTransferFailed",
                                        f"the faucet could not send test ETH to {address} ({type(e).__name__}); "
                                        "nothing was recorded, retry in a moment", {"sent": txs}) from None
                self.s.db.execute("INSERT INTO faucet_drips(address, amount, tx_hash, at, day) VALUES (?, ?, ?, ?, ?)",
                                  (address.lower(), str(amount_wei), tx, time.time(), today))
                txs.append({"address": address, "hash": tx, "amountWei": str(amount_wei)})
            return txs

    def _await(self, txs: list[dict]) -> dict:
        deadline = time.time() + RECEIPT_TIMEOUT
        pending = False
        reverted = []
        for tx in txs:
            rec = self.chain.wait_receipt(tx["hash"], timeout=max(0.0, deadline - time.time()))
            tx["pending"] = rec is None
            pending = pending or rec is None
            if rec is not None and rec.status != 1:
                self._forget_drip(tx["address"], tx["hash"])
                reverted.append(tx["address"])
        if reverted:
            raise WorkflowError(503, "FaucetTransferFailed",
                                f"the faucet transfer to {', '.join(reverted)} reverted; nothing was recorded, retry",
                                {"sent": [t for t in txs if t["address"] not in reverted]})
        return {"txs": txs, "pending": pending}

    def _faucet_key(self) -> str:
        try:
            return load_key("faucet", self.settings.chain_id)
        except RuntimeError:
            raise WorkflowError(503, "FaucetEmpty", "the faucet is not configured on this server") from None

    def status(self, owner: str, ip: str) -> dict:
        owner = _address(owner, "owner")
        if not self.s.limiter.hit("onboard_status_ip", self.ip_hash(ip), STATUS_PER_MINUTE, 60):
            raise WorkflowError(429, "RateLimited", "too many status requests; poll at most once a second")
        chain, a, t = self.chain, self.settings.addresses, self.settings.tenant
        safe = chain.predict_safe(owner)
        deployed = chain.code_size(safe) > 0
        pol = chain.policy(safe, [v.address for v in a.vaults])
        registered = pol.owner.lower() == owner.lower()
        op = self.operator()
        row = self.s.tenants.get(safe)
        steps = {
            "funded": self._funded(owner, t.eth_owner),
            "safeDeployed": deployed,
            "moduleEnabled": deployed and chain.safe_module_enabled(safe, a.module),
            "registered": registered,
            "vaults": registered and all(pol.is_allowed(v.address) for v in a.vaults),
            "authorizer": registered and _same(pol.authorizer, op["authorizer"]),
            "exitKey": registered and _same(pol.exit_key, op["exitKey"]),
            "caps": registered and not self._cap_failures(pol, include_bank=False),
            "reserveFloor": registered and pol.reserve_floor >= self.initial_reserve().required,
            "bankLimit": registered and 0 < pol.bank_limit <= t.bank_limit_max,
            "activated": bool(row and row["activated_at"]),
        }
        return {"safe": safe, "owner": owner, "bank": pol.bank if registered else None, "steps": steps,
                "tenant": present(row) if steps["activated"] else None}

    def _cap_failures(self, pol, include_bank: bool = True) -> list[str]:
        t = self.settings.tenant
        bounds = [("AutoCap", pol.auto_cap, t.auto_cap_max), ("DailyCap", pol.daily_cap, t.daily_cap_max),
                  ("MaxBandWidth", pol.max_band_width, t.max_band_width_max),
                  ("MaxOracleAge", pol.max_oracle_age, t.max_oracle_age_max)]
        if include_bank:
            bounds.append(("BankLimit", pol.bank_limit, t.bank_limit_max))
        return [f"{name}OutOfBounds" for name, value, high in bounds if not 0 < value <= high]

    def verify(self, safe: str, owner: str) -> list[str]:
        """Every on-chain condition activation requires (docs/MULTI-TENANT.md step 7). Empty list = ready."""
        chain, a = self.chain, self.settings.addresses
        if chain.code_size(safe) == 0:
            return ["SafeNotDeployed"]
        failed = []
        if chain.safe_threshold(safe) != 1:
            failed.append("ThresholdNotOne")
        if owner.lower() not in {o.lower() for o in chain.safe_owners(safe)}:
            failed.append("OwnerNotOnSafe")
        if not chain.safe_module_enabled(safe, a.module):
            failed.append("ModuleNotEnabled")
        pol = chain.policy(safe, [v.address for v in a.vaults])
        if pol.owner.lower() != owner.lower():
            failed.append("RegistryOwnerMismatch")
            return failed
        if int(pol.bank, 16) == 0 or pol.bank.lower() == owner.lower():
            failed.append("BadBank")
        op = self.operator()
        if not _same(pol.authorizer, op["authorizer"]):
            failed.append("WrongAuthorizer")
        if not _same(pol.exit_key, op["exitKey"]):
            failed.append("WrongExitKey")
        failed += [f"VaultMissing:{v.label}" for v in a.vaults if not pol.is_allowed(v.address)]
        failed += self._cap_failures(pol)
        if pol.reserve_floor < self.initial_reserve().required:
            failed.append("ReserveFloorNotSet")
        return failed

    def activate(self, safe: str, owner: str, message: str | None, signature: str | None, ip: str,
                 legacy_issued_at: str | None = None) -> dict:
        """The owner signs a SIWE message naming this Safe; a valid one also opens the owner session."""
        safe, owner = _address(safe, "safe"), _address(owner, "owner")
        if message is None:
            code = "SiweRequired" if legacy_issued_at or signature else "SignatureRequired"
            raise WorkflowError(400 if code == "SiweRequired" else 401, code,
                                "sign the SIWE activation message: GET /api/auth/nonce, then send message and "
                                "signature")
        signed = self.sessions.siwe.verify(message, signature, purpose="activate", safe=safe)
        if signed.address.lower() != owner.lower():
            raise WorkflowError(401, "BadSignature", "the signed message is not from this owner")
        result = self._activate(safe, owner, ip)
        result["session"] = self.sessions.open("owner", owner, auth=signed.method)
        return result

    def _activate(self, safe: str, owner: str, ip: str) -> dict:
        if self.chain.predict_safe(owner).lower() != safe.lower():
            raise WorkflowError(409, "BadOnboardingState", "safe is not the AEGIS Safe address for this owner",
                                {"failed": ["UnexpectedSafeAddress"]})
        row = self.s.tenants.get(safe)
        if row and row["activated_at"]:
            return self._result(row)
        if any(r["safe"].lower() != safe.lower() for r in self.s.tenants.by_owner(owner)):
            raise WorkflowError(409, "BadOnboardingState", "this owner already has a treasury",
                                {"failed": ["OwnerHasTreasury"]})
        if row is None and not self.is_open():
            raise WorkflowError(403, "OnboardingClosed", "this demo is not accepting new treasuries right now")
        failed = self.verify(safe, owner)
        if failed:
            raise WorkflowError(409, "BadOnboardingState", "; ".join(failed), {"failed": failed})
        ip_hash = self.ip_hash(ip)
        if row is None:
            if not self.s.limiter.hit("onboard_activate_ip", ip_hash, self.settings.limits.onboard_per_ip_day, DAY):
                raise WorkflowError(429, "RateLimited", "onboarding limit per IP address reached; try again tomorrow")
            bank = self.chain.policy(safe, []).bank
            self.s.db.execute("INSERT OR IGNORE INTO tenants(safe, owner, bank, created_at, ip_hash) "
                              "VALUES (?, ?, ?, ?, ?)", (safe, owner, to_checksum_address(bank), time.time(), ip_hash))
        mint_tx = self._mint_once(safe)
        self.s.db.execute("UPDATE tenants SET activated_at=? WHERE safe=? AND activated_at IS NULL",
                          (time.time(), safe))
        self.s.tenants.invalidate()
        row = self.s.tenants.get(safe)
        self.s.ledger.append("TENANT_ACTIVATED", safe, {"owner": owner, "bank": row["bank"],
                                                        "testUsdc": str(self.settings.tenant.test_usdc)},
                             tx_hash=mint_tx)
        self.s.bus.publish({"type": "tenant", "safe": safe, "activated": True})
        return self._result(row)

    def _mint_once(self, safe: str) -> str | None:
        """The UPDATE claims the mint atomically across concurrent calls; a recorded mint is never repeated."""
        claimed = self.s.db.execute("UPDATE tenants SET mint_tx='pending' WHERE safe=? AND mint_tx IS NULL",
                                    (safe,)).rowcount == 1
        if not claimed:
            current = self.s.tenants.get(safe)["mint_tx"]
            if current == "pending":
                raise WorkflowError(409, "BadOnboardingState", "activation already in progress",
                                    {"failed": ["ActivationInProgress"]})
            return current
        key = self._faucet_key_or_release(safe)
        try:
            tx = self.chain.mint_usdc(key, safe, self.settings.tenant.test_usdc)
        except Exception as e:
            self.s.db.execute("UPDATE tenants SET mint_tx=NULL WHERE safe=?", (safe,))
            raise WorkflowError(503, "FaucetEmpty", f"test USDC mint failed: {type(e).__name__}") from None
        rec = self.chain.wait_receipt(tx, timeout=RECEIPT_TIMEOUT)
        if rec is not None and rec.status != 1:
            self.s.db.execute("UPDATE tenants SET mint_tx=NULL WHERE safe=?", (safe,))
            raise WorkflowError(503, "FaucetEmpty", f"test USDC mint reverted: {rec.revert_reason}")
        # A mint still pending after the timeout is kept as recorded: retrying could mint twice.
        self.s.db.execute("UPDATE tenants SET mint_tx=? WHERE safe=?", (tx, safe))
        return tx

    def _faucet_key_or_release(self, safe: str) -> str:
        try:
            return self._faucet_key()
        except WorkflowError:
            self.s.db.execute("UPDATE tenants SET mint_tx=NULL WHERE safe=?", (safe,))
            raise

    def _result(self, row: dict) -> dict:
        tenant = present(row)
        return {"safe": row["safe"], "mintTx": tenant["mintTx"], "tenant": tenant}


def _same(a: str | None, b: str | None) -> bool:
    return bool(a and b) and a.lower() == b.lower()
