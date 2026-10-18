"""Read-only check: would the API's reconciliation now apply an executed DAR to its request?

Reads the transaction receipt and the AegisExecuted event from the RPC (the event through the same lag-tolerant
eth_getLogs path the API uses), and, with --db, looks the submission and request up in a SQLite file opened with
mode=ro. Nothing is written to the chain or the database. For the live database, pass a copy made with
`sqlite3 /data/aegis.db ".backup /tmp/aegis-copy.db"`; a WAL database cannot always be opened read-only in place.

Usage:
  CHAIN_ID=84532 RPC_URL=https://base-sepolia-rpc.publicnode.com \\
    uv run python scripts/diagnose_submission.py --tx 0xaef5... [--db /tmp/aegis-copy.db]
"""

from __future__ import annotations

import argparse
import json
import sqlite3
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from aegis.chain.rpc import RpcChain
from aegis.config import load_settings
from aegis.workflow import RECONCILE_AFTER

TERMINAL_STATUSES = ("confirmed", "reverted", "failed")
OPEN_STATUSES = ("pending", "claimed", "sent")


def verdict(sub: dict | None, request: dict | None, event_found: bool, now: float) -> str:
    """Mirrors Workflow.apply_submission_results and Workflow.reconcile_onchain."""
    if sub is None:
        return "no workflow submission with this DAR hash in the database"
    if request is None:
        return "the submission has no request; nothing to apply"
    if request["state"] in ("EXPLAINED", "CANCELLED"):
        return f"already final: request is {request['state']}"
    try:
        ours = json.loads(request["data"]).get("submissionId") == sub["id"]
    except (TypeError, ValueError):
        ours = False
    if not ours:
        return "the request points at another submission; this one is ignored"
    send_raised = sub["status"] == "failed" and not sub["tx_hash"] and event_found
    if sub["status"] in TERMINAL_STATUSES and not send_raised:
        if request["state"] in ("SUBMITTED", "CONFIRMED", "REVERTED"):
            return (f"RECOVERS on the next tick: apply_submission_results takes the '{sub['status']}' result "
                    f"(applied={sub['applied']}) and moves the request from {request['state']}")
        return f"not applied: request is {request['state']}, not SUBMITTED"
    if sub["status"] in OPEN_STATUSES or send_raised:
        if request["state"] != "SUBMITTED":
            return f"not applied: request is {request['state']}, not SUBMITTED"
        if not event_found:
            return "waiting: no AegisExecuted event for this DAR hash yet"
        wait = sub["created_at"] + RECONCILE_AFTER - now
        when = "within 30 s" if wait <= 0 else f"in about {int(wait) + 30} s"
        return (f"RECOVERS {when}: reconcile_onchain marks the '{sub['status']}' submission confirmed from the "
                "event, then apply_submission_results moves the request")
    return f"not applied: submission status is '{sub['status']}'"


def read_db(path: str, dar_hash: str) -> tuple[dict | None, dict | None]:
    conn = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    try:
        row = conn.execute("SELECT * FROM submissions WHERE source='workflow' AND lower(dar_hash)=? ORDER BY id DESC",
                           (dar_hash.lower(),)).fetchone()
        sub = dict(row) if row else None
        request = None
        if sub and sub["request_id"]:
            r = conn.execute("SELECT id, state, data FROM requests WHERE id=?", (sub["request_id"],)).fetchone()
            request = dict(r) if r else None
        return sub, request
    finally:
        conn.close()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n", 1)[0])
    parser.add_argument("--tx", required=True)
    parser.add_argument("--db", help="a copy of the API database, opened read-only")
    args = parser.parse_args()

    chain = RpcChain(load_settings(chain_mode="rpc"))
    rec = chain.receipt(args.tx)
    if rec is None:
        print("receipt: none (not mined, or the node has not seen it)")
        return 1
    print(f"receipt: status={rec.status} block={rec.block_number}")
    executed = [e for e in rec.executed if e["event"] == "AegisExecuted"]
    if not executed:
        print("no AegisExecuted event in this transaction")
        return 1
    ev = executed[0]
    print(f"AegisExecuted: safe={ev['safe']} darHash={ev['darHash']} op={ev['op']} assets={ev['assets']} "
          f"tier={ev['tier']}")
    head = chain.block_number()
    found = any(e.get("darHash", "").lower() == ev["darHash"].lower()
                for e in chain.events(ev["safe"], rec.block_number - 5))
    print(f"eth_getLogs from block {rec.block_number - 5} to head {head}: event {'found' if found else 'NOT found'}")
    if not args.db:
        print("pass --db with a copy of the API database to see what the next tick would do")
        return 0
    sub, request = read_db(args.db, ev["darHash"])
    if sub:
        print(f"submission {sub['id']}: status={sub['status']} applied={sub['applied']} tx_hash={sub['tx_hash']} "
              f"claimed_by={sub['claimed_by']}")
    if request:
        print(f"request {request['id']}: state={request['state']}")
    print("verdict:", verdict(sub, request, found, time.time()))
    return 0


if __name__ == "__main__":
    sys.exit(main())
