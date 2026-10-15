"""Exit Agent: watches exit triggers, quarantines, and signs redeem-only DARs with its own key
(TECHNICAL-DOCUMENT 03, algorithm 5)."""

from __future__ import annotations

import json
import time

from eth_account import Account

from aegis.config import Settings
from aegis.core.actions import evidence_hash, min_out
from aegis.core.risk import assess
from aegis.core.state import load_state
from aegis.eip712 import DAR, OP_REDEEM, Approval, ZERO32, dar_digest, hex32, random_nonce, sign_digest
from aegis.procs.executor import claim, record_receipt, update
from aegis.services import Services
from aegis.workflow import enqueue_submission

INFLIGHT = ("pending", "claimed", "sent")


class ExitAgent:
    def __init__(self, services: Services, key: str, notify=None, block_time: float = 2.0):
        self.s = services
        self._key = key
        self.address = Account.from_key(key).address
        self.notify = notify
        self.block_time = block_time
        self.last_block: int | None = None
        self.last_run = 0.0
        self.blocked_alerted: set[tuple[str, str]] = set()

    @property
    def settings(self) -> Settings:
        return self.s.settings

    def tick(self, force: bool = False) -> dict:
        chain = self.s.chain
        block = chain.block_number()
        window = self.settings.params.exit_window_blocks
        due = (force or self.last_block is None or block - self.last_block >= window
               or time.time() - self.last_run >= window * self.block_time * 3)
        report = {"window": False, "fallback": 0, "actions": []}
        if due:
            self.last_block = block
            self.last_run = time.time()
            report["window"] = True
            deposited = {r["safe"] for r in self.s.db.query(
                "SELECT DISTINCT safe FROM submissions WHERE op=0 AND status='confirmed'")}
            for safe in self.s.safes:
                if (safe.lower() in deposited or self.s.tenants.is_reference(safe)) and self._holds_position(safe):
                    report["actions"].extend(self.run_window(safe))
        report["fallback"] = self.fallback(block)
        self.track()
        return report

    def _holds_position(self, safe: str) -> bool:
        """A Safe with no vault shares has nothing to exit, and its deposits are already held by the planner and
        the module's oracle checks. Skipping it keeps a market event from costing two exit-key transactions per
        tenant. Tenants reach vaults only through module deposits, which the submissions table records, so only
        those (and the reference Safe, whose history may predate this database) are read from chain."""
        return any(self.s.chain.shares_of(v.address, safe) for v in self.settings.addresses.vaults)

    def run_window(self, safe: str) -> list[dict]:
        chain, params = self.s.chain, self.settings.params
        state = load_state(chain, self.settings, safe)
        risk = assess(state, params, self.s.last_triggers(safe))
        self.s.record_triggers(safe, risk, at=state.timestamp)
        actions = []
        for vr in risk.vaults:
            v = state.vault(vr.address)
            exiting = vr.triggered or (v.quarantined and v.shares > 0)
            if not exiting:
                self.blocked_alerted.discard((safe.lower(), v.address.lower()))
                continue
            codes = [t.code for t in vr.triggers]
            if vr.triggered and not v.quarantined:
                actions.append(self._quarantine(safe, v.address, v.label, codes))
            if v.shares == 0 or not v.ever_deposited:
                continue
            if self._inflight(safe, v.address):
                continue
            shares = min(v.shares, v.max_redeem_shares)
            if shares == 0:
                key = (safe.lower(), v.address.lower())
                if key not in self.blocked_alerted:
                    self.blocked_alerted.add(key)
                    msg = f"{v.label}: exit blocked, maxRedeem is zero with {v.shares} shares still held"
                    self.s.alert("critical", "ExitBlocked", msg, safe, v.address)
                    self.s.ledger.append("EXIT_BLOCKED", safe, {"vault": v.address, "shares": str(v.shares),
                                                                "triggers": codes})
                actions.append({"vault": v.address, "action": "blocked"})
                continue
            self.blocked_alerted.discard((safe.lower(), v.address.lower()))
            actions.append(self._exit(state, v, shares, codes))
        return actions

    def _quarantine(self, safe: str, vault: str, label: str, codes: list[str]) -> dict:
        chain = self.s.chain
        try:
            tx = chain.quarantine(self._key, safe, vault)
        except Exception as e:
            self.s.alert("critical", "QuarantineFailed", f"{label}: {getattr(e, 'reason', e)}", safe, vault)
            return {"vault": vault, "action": "quarantine_failed"}
        rec = _wait(chain, tx)
        ok = rec is not None and rec.status == 1
        self.s.ledger.append("QUARANTINED" if ok else "QUARANTINE_FAILED", safe,
                             {"vault": vault, "label": label, "triggers": codes, "by": "exitKey"}, tx_hash=tx,
                             revert_reason=None if ok else (rec.revert_reason if rec else "no receipt"))
        self.s.bus.publish({"type": "risk", "safe": safe, "vault": vault, "quarantined": ok, "triggers": codes})
        if ok and self.notify:
            try:
                self.notify(safe, vault)
            except Exception as e:
                self.s.alert("warning", "NotifyFailed", f"could not tell the service to drop deposits: {e}", safe)
        return {"vault": vault, "action": "quarantine", "tx": tx, "ok": ok}

    def _exit(self, state, v, shares: int, codes: list[str]) -> dict:
        chain, s = self.s.chain, self.settings
        preview = chain.preview_redeem(v.address, shares)
        evidence = {"kind": "exit", "safe": state.safe, "vault": v.address, "triggers": codes,
                    "shares": str(shares), "previewRedeem": str(preview), "versions": state.versions()}
        dar = DAR(safe=state.safe, op=OP_REDEEM, vault=v.address, amount=shares, minOut=min_out(preview, s.params),
                  policyVersion=state.policy.policy_version, priceLow=state.oracle.answer,
                  priceHigh=state.oracle.answer, tier=1, approvalHash=ZERO32, nonce=random_nonce(),
                  expiry=state.timestamp + s.params.dar_expiry, evidenceHash=evidence_hash(evidence))
        sim = chain.sim_vault_redeem(v.address, shares, state.safe)
        check = chain.module_check(dar, Approval.empty())
        if not sim.ok or not check.ok:
            err = sim.error if not sim.ok else check.error
            self.s.alert("critical", "ExitSimulationFailed", f"{v.label}: {err}", state.safe, v.address)
            self.s.ledger.append("EXIT_SIM_FAILED", state.safe, {"vault": v.address, "shares": str(shares),
                                                                 "triggers": codes}, revert_reason=err)
            return {"vault": v.address, "action": "sim_failed", "error": err}
        dar_hash = hex32(dar_digest(s.chain_id, s.addresses.module, dar))
        sig = sign_digest(self._key, dar_digest(s.chain_id, s.addresses.module, dar))
        sub_id = enqueue_submission(self.s, "exit_agent", dar, {"auth": sig}, None, dar_hash, None)
        self.s.ledger.append("EXIT_SIGNED", state.safe, {
            "vault": v.address, "label": v.label, "shares": str(shares), "minAssets": str(dar.minOut),
            "position": str(v.shares), "partial": shares < v.shares, "triggers": codes, "submissionId": sub_id,
            "dar": dar.to_json(), "evidence": evidence}, dar_hash=dar_hash)
        return {"vault": v.address, "action": "exit", "shares": shares, "partial": shares < v.shares,
                "submissionId": sub_id}

    def _inflight(self, safe: str, vault: str) -> bool:
        rows = self.s.db.query("SELECT id, dar FROM submissions WHERE source='exit_agent' AND safe=? AND vault=? "
                               f"AND status IN ({','.join('?' * len(INFLIGHT))})",
                               (safe.lower(), vault.lower(), *INFLIGHT))
        now = self.s.chain.block_timestamp()
        live = [r for r in rows if int(json.loads(r["dar"])["expiry"]) >= now]
        for r in rows:
            if r not in live:
                update(self.s, r["id"], status="failed", error="Expired before inclusion")
        return bool(live)

    def fallback(self, block: int) -> int:
        """If the Executor has not included an exit within 3 blocks, submit it ourselves."""
        wait = self.settings.params.exit_fallback_blocks
        n = 0
        # Automine Anvil only produces blocks on transactions, so wall time stands in for block count there.
        rows = self.s.db.query("SELECT * FROM submissions WHERE source='exit_agent' AND tx_hash IS NULL AND "
                               "status IN ('pending','claimed') AND (created_block + ? <= ? OR created_at <= ?)",
                               (wait, block, time.time() - wait * self.block_time))
        for sub in rows:
            if not claim(self.s, sub["id"], "exit_agent", allow_reclaim_from="executor"):
                continue
            dar = DAR.from_json(json.loads(sub["dar"]))
            sig = json.loads(sub["sigs"])["auth"]
            try:
                tx = self.s.chain.submit_redeem(self._key, dar, sig)
            except Exception as e:
                update(self.s, sub["id"], status="failed", error=f"self-submit failed: {getattr(e, 'reason', e)}")
                continue
            update(self.s, sub["id"], status="sent", tx_hash=tx, claimed_by="exit_agent")
            self.s.ledger.append("EXIT_SELF_SUBMITTED", sub["safe"], {
                "submissionId": sub["id"], "waitedBlocks": block - sub["created_block"], "vault": sub["vault"]},
                tx_hash=tx, dar_hash=sub["dar_hash"])
            record_receipt(self.s, sub["id"], tx)
            n += 1
        for sub in self.s.db.query("SELECT * FROM submissions WHERE source='exit_agent' AND status='sent' AND "
                                   "claimed_by='exit_agent'"):
            record_receipt(self.s, sub["id"], sub["tx_hash"], timeout=0)
        return n

    def track(self) -> None:
        rows = self.s.db.query("SELECT * FROM submissions WHERE source='exit_agent' AND applied=0 AND status IN "
                               "('confirmed','reverted','failed')")
        for sub in rows:
            self.s.db.execute("UPDATE submissions SET applied=1 WHERE id=?", (sub["id"],))
            result = json.loads(sub["result"] or "{}")
            ev = result.get("executed") or {}
            if sub["status"] == "confirmed":
                self.s.ledger.append("EXIT_CONFIRMED", sub["safe"], {
                    "vault": sub["vault"], "assets": str(ev.get("assets", "")), "shares": str(ev.get("shares", "")),
                    "tier": ev.get("tier"), "submittedBy": sub["claimed_by"], "block": result.get("blockNumber")},
                    tx_hash=sub["tx_hash"], dar_hash=sub["dar_hash"])
                self.s.bus.publish({"type": "execution", "safe": sub["safe"], "op": "REDEEM", "vault": sub["vault"],
                                    "txHash": sub["tx_hash"], "assets": str(ev.get("assets", ""))})
            else:
                self.s.ledger.append("EXIT_REVERTED", sub["safe"], {"vault": sub["vault"], "status": sub["status"]},
                                     tx_hash=sub["tx_hash"], revert_reason=sub["error"], dar_hash=sub["dar_hash"])


def _wait(chain, tx: str, timeout: float = 30.0):
    deadline = time.time() + timeout
    rec = chain.receipt(tx)
    while rec is None and time.time() < deadline:
        time.sleep(0.5)
        rec = chain.receipt(tx)
    return rec
