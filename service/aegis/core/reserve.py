"""Reserve Engine: R_required from the approved obligation schedule (TECHNICAL-DOCUMENT 03, algorithm 1)."""

from __future__ import annotations

import json
from dataclasses import dataclass

from eth_utils import keccak

from aegis.config import Params


@dataclass
class Obligation:
    id: str
    label: str
    amount: int
    due: int
    kind: str = "outflow"
    confirmed: bool = True
    settled: bool = False

    @property
    def is_inflow(self) -> bool:
        return self.kind == "inflow"


@dataclass
class ReserveResult:
    required: int
    peak_net_outflow: int
    buffer: int
    total_outflows: int
    peak_at: int | None
    schedule_hash: str
    horizon_end: int


def schedule_hash(obligations: list[Obligation]) -> str:
    """Hash of the unsettled schedule. Independent of the horizon so time passing does not change it."""
    items = sorted(
        ({"id": o.id, "amount": str(o.amount), "due": o.due, "kind": o.kind, "confirmed": bool(o.confirmed)}
         for o in obligations if not o.settled),
        key=lambda x: (x["due"], x["id"]),
    )
    return "0x" + keccak(text=json.dumps(items, sort_keys=True, separators=(",", ":"))).hex()


def required_reserve(obligations: list[Obligation], now: int, params: Params) -> ReserveResult:
    """R = max over t in [0, H] of max(0, sum O(<=t) - sum I(<=t)) + B, with B = max(B_min, b * sum O).

    Overdue unsettled obligations are still owed, so they count at t = now. At equal timestamps
    outflows are applied before inflows, which keeps the peak at least as high as the formula's.
    """
    horizon_end = now + params.horizon_days * 86400
    events: list[tuple[int, int, int]] = []
    total_out = 0
    for o in obligations:
        if o.settled or o.due > horizon_end:
            continue
        t = max(o.due, now)
        if o.is_inflow:
            if o.confirmed:
                events.append((t, 1, -o.amount))
        else:
            events.append((t, 0, o.amount))
            total_out += o.amount
    events.sort()
    running, peak, peak_at = 0, 0, None
    for t, _, delta in events:
        running += delta
        if running > peak:
            peak, peak_at = running, t
    buffer = max(params.buffer_min, -(-total_out * params.buffer_rate_bps // 10_000))
    return ReserveResult(
        required=peak + buffer,
        peak_net_outflow=peak,
        buffer=buffer,
        total_outflows=total_out,
        peak_at=peak_at,
        schedule_hash=schedule_hash(obligations),
        horizon_end=horizon_end,
    )


def deployable(liquid: int, required: int, fee_reserve: int) -> int:
    return max(0, liquid - required - fee_reserve)


def floor_in_sync(onchain_floor: int, required: int) -> bool:
    """A floor above R is more conservative and acceptable; below R the planner must hold."""
    return onchain_floor >= required
