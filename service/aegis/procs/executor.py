"""Executor: relays signed DARs and milestone releases and pays gas. It holds no authority and cannot alter what was
signed."""

from __future__ import annotations

import json
import time

from eth_account import Account

from aegis.core import simulator
from aegis.eip712 import DAR, OP_DEPOSIT, Approval
from aegis.services import Services
from aegis.tradeflow.typed import MilestoneProof, ReleaseAuthorization

OP_RELEASE = 2

RECEIPT_TIMEOUT = 60.0
STALE_CLAIM = 30.0


def claim(services: Services, sub_id: int, by: str, allow_reclaim_from: str | None = None) -> bool:
    now = time.time()
    if allow_reclaim_from:
        # A claim younger than STALE_CLAIM may still be mid-send; taking it over would double-submit.
        cur = services.db.execute(
            "UPDATE submissions SET status='claimed', claimed_by=?, updated_at=? WHERE id=? AND tx_hash IS NULL AND "
            "(status='pending' OR (status='claimed' AND claimed_by=? AND updated_at <= ?))",
            (by, now, sub_id, allow_reclaim_from, now - STALE_CLAIM))
    else:
        cur = services.db.execute("UPDATE submissions SET status='claimed', claimed_by=?, updated_at=? WHERE id=? "
                                  "AND status='pending'", (by, now, sub_id))
    return cur.rowcount == 1


def update(services: Services, sub_id: int, **fields) -> None:
    fields["updated_at"] = time.time()
    cols = ", ".join(f"{k}=?" for k in fields)
    services.db.execute(f"UPDATE submissions SET {cols} WHERE id=?", (*fields.values(), sub_id))
    row = services.db.one("SELECT safe, status, tx_hash, dar_hash, source FROM submissions WHERE id=?", (sub_id,))
    services.bus.publish({"type": "submission", "safe": row["safe"], "submissionId": sub_id, **{
        k: row[k] for k in ("status", "tx_hash", "dar_hash", "source")}})


def send_release(services: Services, sub: dict, key: str, sender_label: str) -> None:
    """checkRelease, then a final signed eth_call of release(); a failure is reported to the milestone workflow as
    status 'failed' with the error selector, a mined revert as 'reverted'."""
    chain = services.chain
    r = json.loads(sub["dar"])
    order_id, index = int(r["orderId"]), int(r["index"])
    proof, auth = MilestoneProof.from_json(r["proof"]), ReleaseAuthorization.from_json(r["auth"])
    check = chain.escrow_check_release(order_id, index, proof, auth)
    if not check.ok:
        update(services, sub["id"], status="failed", error=check.error or "CheckFailed")
        return
    sender = Account.from_key(key).address
    pre = chain.sim_release(order_id, index, proof, r["issuerSig"], auth, r["authSig"], sender)
    if not pre.ok:
        update(services, sub["id"], status="failed", error=pre.error)
        return
    try:
        tx = chain.submit_release(key, order_id, index, proof, r["issuerSig"], auth, r["authSig"])
    except Exception as e:
        update(services, sub["id"], status="failed", error=f"SendFailed: {getattr(e, 'reason', e)}")
        return
    update(services, sub["id"], status="sent", tx_hash=tx, claimed_by=sender_label)
    record_receipt(services, sub["id"], tx)


def send_submission(services: Services, sub: dict, key: str, sender_label: str) -> None:
    """Preflight with a final signed eth_call, broadcast, then record the receipt."""
    if sub["op"] == OP_RELEASE:
        send_release(services, sub, key, sender_label)
        return
    chain = services.chain
    dar = DAR.from_json(json.loads(sub["dar"]))
    sigs = json.loads(sub["sigs"])
    approval = Approval.from_json(json.loads(sub["approval"])) if sub["approval"] else None
    if chain.used_nonce(dar.safe, dar.nonce):
        update(services, sub["id"], status="superseded", error="NonceUsed: already executed")
        return
    sender = Account.from_key(key).address
    pre = simulator.final_signed_call(chain, dar, sigs["auth"], sigs.get("owner"), sigs.get("bank"), approval, sender)
    if not pre.ok:
        update(services, sub["id"], status="failed", error=pre.error)
        return
    try:
        if dar.op == OP_DEPOSIT:
            tx = chain.submit_deposit(key, dar, sigs["auth"], sigs.get("owner") or "", sigs.get("bank") or "",
                                      approval or Approval.empty())
        else:
            tx = chain.submit_redeem(key, dar, sigs["auth"])
    except Exception as e:
        update(services, sub["id"], status="failed", error=f"send failed: {getattr(e, 'reason', e)}")
        return
    update(services, sub["id"], status="sent", tx_hash=tx, claimed_by=sender_label)
    record_receipt(services, sub["id"], tx)


def record_receipt(services: Services, sub_id: int, tx: str, timeout: float = RECEIPT_TIMEOUT) -> bool:
    deadline = time.time() + timeout
    rec = services.chain.receipt(tx)
    while rec is None and time.time() < deadline:
        time.sleep(0.5)
        rec = services.chain.receipt(tx)
    if rec is None:
        return False
    executed = rec.executed[0] if rec.executed else None
    result = {"blockNumber": rec.block_number, "executed": executed}
    if rec.status == 1:
        update(services, sub_id, status="confirmed", result=json.dumps(result))
    else:
        update(services, sub_id, status="reverted", error=rec.revert_reason or "Reverted", result=json.dumps(result))
    return True


class Executor:
    def __init__(self, services: Services, key: str, withhold_sources: tuple[str, ...] = ()):
        self.s = services
        self._key = key
        self.address = Account.from_key(key).address
        self.withhold_sources = withhold_sources

    def tick(self) -> int:
        n = 0
        for sub in self.s.db.query("SELECT * FROM submissions WHERE status='sent' AND tx_hash IS NOT NULL"):
            if sub["claimed_by"] in ("executor", self.address):
                record_receipt(self.s, sub["id"], sub["tx_hash"], timeout=0)
        for sub in self.s.db.query("SELECT * FROM submissions WHERE status='pending' ORDER BY id"):
            if sub["source"] in self.withhold_sources:
                continue
            if not claim(self.s, sub["id"], "executor"):
                continue
            send_submission(self.s, sub, self._key, "executor")
            n += 1
        return n
