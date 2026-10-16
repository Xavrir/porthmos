"""Shared market state and stress scenarios. The feed and vaults are shared by every tenant, so a market
scenario is visible to all of them (docs/MULTI-TENANT.md, Per-tenant stress and attack actions)."""

from __future__ import annotations

import time

from aegis.config import PRICE_ONE, UINT256_MAX, USDC, load_key
from aegis.obligations import floor_update
from aegis.obligations import to_json as obligation_json
from aegis.procs.keeper import LAST_POKE_KEY, PAUSE_KEY
from aegis.runtime import Runtime
from aegis.units import amount, price
from aegis.workflow import WorkflowError

MARKET_SCENARIOS = ("depeg", "liquidity", "stale", "restore")
TENANT_SCENARIOS = ("obligation",)
SCENARIOS = MARKET_SCENARIOS + TENANT_SCENARIOS
SCENARIO_KEY = "market_scenario"
DEFAULT_LIQUIDITY_CAP = 1_000 * USDC


def market_state(rt: Runtime) -> dict:
    s, chain, params = rt.services, rt.chain, rt.settings.params
    r = chain.latest_round()
    age = max(0, chain.block_timestamp() - r.updated_at)
    limit = params.default_max_oracle_age
    vaults = []
    for v in rt.settings.addresses.vaults:
        remaining = chain.remaining_liquidity(v.address)
        vaults.append({"address": v.address, "name": v.label,
                       "totalAssets": amount(chain.vault_total_assets(v.address)),
                       "liquidityCapped": remaining is not None,
                       "remainingLiquidity": amount(remaining) if remaining is not None else None})
    active = []
    if abs(r.answer - PRICE_ONE) > params.peg_threshold:
        active.append("depeg")
    if any(v["liquidityCapped"] for v in vaults):
        active.append("liquidity")
    if age > limit:
        active.append("stale")
    return {
        "price": price(r.answer), "roundId": r.round_id, "updatedAt": r.updated_at, "ageSeconds": age,
        "stale": age > limit, "maxOracleAge": limit,
        "pegDeviationPct": round(abs(r.answer - PRICE_ONE) / PRICE_ONE * 100, 4),
        "keeper": {"paused": bool(s.db.kv_get(PAUSE_KEY, False)), "lastPoke": s.db.kv_get(LAST_POKE_KEY)},
        "vaults": vaults, "active": active, "scenario": s.db.kv_get(SCENARIO_KEY), "time": int(time.time()),
    }


def _vault(rt: Runtime, hint: str | None):
    vaults = rt.settings.addresses.vaults
    if not hint:
        return None
    return next((v for v in vaults if hint.lower() in (v.address.lower(), v.label.lower())), None)


def run_scenario(rt: Runtime, name: str, safe: str | None, by: str, vault: str | None = None,
                 cap: int | None = None) -> dict:
    """`safe` is the session's tenant, or None for an admin call without a session."""
    s, chain, local = rt.services, rt.chain, rt.settings.is_local_chain
    result: dict = {"scenario": name, "safe": safe}
    admin = load_key("admin", rt.settings.chain_id) if name in MARKET_SCENARIOS else ""
    if name == "depeg":
        result["tx"] = chain.admin_set_price(admin, 98_500_000)
        result["price"] = price(98_500_000)
    elif name == "liquidity":
        target = _vault(rt, vault)
        if target is None and vault:
            raise WorkflowError(400, "UnknownVault")
        if target is None and safe is not None:
            snap = s.snapshot(safe)
            held = [v for v in snap.state.vaults if v.shares] or snap.state.vaults[:1]
            v = max(held, key=lambda x: x.assets)
            target, default_cap = rt.settings.vault_meta(v.address), v.assets // 2
        else:
            target = target or rt.settings.addresses.vaults[0]
            default_cap = DEFAULT_LIQUIDITY_CAP
        limit = default_cap if cap is None else cap
        result["tx"] = chain.admin_set_liquidity_cap(admin, target.address, limit)
        result["vault"] = {"address": target.address, "name": target.label, "liquidityCap": amount(limit)}
    elif name == "stale":
        s.db.kv_set(PAUSE_KEY, True)
        result["keeperPaused"] = True
        if local:
            limit = rt.settings.params.default_max_oracle_age
            if safe is not None:
                limit = chain.policy(safe, []).max_oracle_age or limit
            chain.admin_increase_time(limit + 10)
            result["advancedSeconds"] = limit + 10
    elif name == "obligation":
        if safe is None:
            raise WorkflowError(403, "OwnerOnly")
        now = chain.block_timestamp()
        ob = s.obligations.add(safe, "Supplier invoice (scenario)", 2000 * USDC, now + 7 * 86400)
        upd = floor_update(chain, safe, s.obligations.list(safe, False), now, rt.settings.params)
        s.ledger.append("OBLIGATION_ADDED", safe, {"obligation": obligation_json(ob), "floorUpdate": upd,
                                                   "scenario": True})
        result["obligation"] = obligation_json(ob)
        result["floorUpdate"] = upd
    elif name == "restore":
        txs = [chain.admin_set_price(admin, PRICE_ONE)]
        for v in rt.settings.addresses.vaults:
            txs.append(chain.admin_set_liquidity_cap(admin, v.address, UINT256_MAX))
        s.db.kv_set(PAUSE_KEY, False)
        txs.append(chain.poke(admin))
        result["txs"] = txs
        result["note"] = "Quarantine stays until the owner clears it after the 24 h cooldown."
    # Callers read the new market state right after this returns; on a chain with block time it is not mined yet.
    for tx in [result["tx"]] if "tx" in result else result.get("txs", []):
        chain.wait_receipt(tx, timeout=30)
    market_wide = name in MARKET_SCENARIOS
    if market_wide:
        s.db.kv_set(SCENARIO_KEY, None if name == "restore" else {"name": name, "at": int(time.time()), "by": by})
    s.ledger.append("DEMO_SCENARIO", None if market_wide else safe,
                    {"scenario": name, "by": by, **{k: v for k, v in result.items() if k != "safe"}})
    s.bus.publish({"type": "scenario", "safe": None if market_wide else safe, "name": name})
    return result
