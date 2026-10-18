"""Persisted request workflow (TECHNICAL-DOCUMENT 03 state machine, INTERFACES 2 state strings)."""

from __future__ import annotations

import functools
import json
import logging
import threading
import time
import uuid
from collections.abc import Callable
from concurrent.futures import Future, ThreadPoolExecutor
from dataclasses import dataclass
from decimal import ROUND_DOWN, Decimal

from aegis.agent import intent as I
from aegis.agent.agent import Agent
from aegis.agent.llm import quoted
from aegis.agent.tools import AgentTools
from aegis.core import simulator
from aegis.core.pipeline import Prepared, Snapshot, approval_fits, prepare
from aegis.core.state import TreasuryState, load_state
from aegis.eip712 import (
    DAR,
    OP_DEPOSIT,
    OP_NAMES,
    Approval,
    approval_digest,
    approval_typed_data,
    dar_digest,
    hex32,
    recover_digest,
)
from aegis.errors import AuthorizerRefused
from aegis.obligations import iso
from aegis.obligations import to_json as obligation_json
from aegis.services import Services
from aegis.units import amount, display_usdc

STATES = (
    "REQUEST_RECEIVED INTENT_PARSED NEEDS_CLARIFICATION STATE_LOADED RISK_EVALUATED PLAN_OPTIONS_BUILT "
    "OPTION_SELECTED HELD PROPOSAL_VALIDATED POLICY_CHECKED POLICY_REJECTED SIMULATED SIM_FAILED "
    "AWAITING_APPROVAL APPROVAL_DENIED CORRECTION_REQUESTED APPROVAL_EXPIRED APPROVED FINAL_REVALIDATION "
    "DAR_SIGNED SUBMITTED CONFIRMED REVERTED EXPLAINED CANCELLED"
).split()
TERMINAL = {"EXPLAINED", "CANCELLED"}
TRANSITIONS: dict[str, set[str]] = {
    "REQUEST_RECEIVED": {"INTENT_PARSED"},
    "INTENT_PARSED": {"NEEDS_CLARIFICATION", "STATE_LOADED"},
    "NEEDS_CLARIFICATION": {"INTENT_PARSED"},
    "STATE_LOADED": {"RISK_EVALUATED"},
    "RISK_EVALUATED": {"PLAN_OPTIONS_BUILT"},
    "PLAN_OPTIONS_BUILT": {"OPTION_SELECTED"},
    "OPTION_SELECTED": {"HELD", "PROPOSAL_VALIDATED"},
    "HELD": {"EXPLAINED"},
    "PROPOSAL_VALIDATED": {"POLICY_CHECKED"},
    "POLICY_CHECKED": {"POLICY_REJECTED", "SIMULATED"},
    "POLICY_REJECTED": {"EXPLAINED"},
    "SIMULATED": {"SIM_FAILED", "AWAITING_APPROVAL", "FINAL_REVALIDATION"},
    "SIM_FAILED": {"EXPLAINED"},
    "AWAITING_APPROVAL": {"APPROVAL_DENIED", "CORRECTION_REQUESTED", "APPROVAL_EXPIRED", "APPROVED"},
    "APPROVAL_DENIED": {"EXPLAINED"},
    "CORRECTION_REQUESTED": {"OPTION_SELECTED"},
    "APPROVAL_EXPIRED": {"STATE_LOADED"},
    "APPROVED": {"FINAL_REVALIDATION"},
    "FINAL_REVALIDATION": {"STATE_LOADED", "DAR_SIGNED"},
    "DAR_SIGNED": {"SUBMITTED"},
    "SUBMITTED": {"CONFIRMED", "REVERTED"},
    "CONFIRMED": {"EXPLAINED"},
    "REVERTED": {"EXPLAINED"},
    "EXPLAINED": set(),
    "CANCELLED": set(),
}
LEDGER_STATES = {
    "HELD", "POLICY_REJECTED", "SIM_FAILED", "AWAITING_APPROVAL", "APPROVAL_DENIED", "APPROVAL_EXPIRED",
    "APPROVED", "DAR_SIGNED", "SUBMITTED", "CONFIRMED", "REVERTED", "CANCELLED",
}
CLARIFICATION_WINDOW = 30 * 60
RECONCILE_AFTER = 90.0

log = logging.getLogger("aegis")


class WorkflowError(Exception):
    def __init__(self, status: int, code: str, detail: str = "", extra: dict | None = None):
        super().__init__(f"{code}: {detail}")
        self.status = status
        self.code = code
        self.detail = detail
        self.extra = extra or {}


@dataclass
class Session:
    token: str
    role: str
    address: str
    safe: str | None


def llm_scope(fn):
    """Runs a user-facing workflow call as one agent request (one LLM budget check, one fallback notice)."""

    @functools.wraps(fn)
    def wrapper(self: "Workflow", session: Session, *args, **kwargs):
        with self.agent.request(session.safe or session.address):
            return fn(self, session, *args, **kwargs)

    return wrapper


class RequestStore:
    def __init__(self, services: Services):
        self.s = services

    def create(self, safe: str, role: str, message: str) -> dict:
        now = time.time()
        rec = {"id": f"req_{uuid.uuid4().hex[:16]}", "safe": safe.lower(), "role": role, "state": "REQUEST_RECEIVED",
               "message": message[:4000], "data": {"replans": 0, "flags": []}, "created_at": now, "updated_at": now}
        self.s.db.execute(
            "INSERT INTO requests(id, safe, role, state, message, data, created_at, updated_at) VALUES "
            "(?, ?, ?, ?, ?, ?, ?, ?)",
            (rec["id"], rec["safe"], role, rec["state"], rec["message"], json.dumps(rec["data"]), now, now))
        self.s.db.execute("INSERT INTO transitions(request_id, from_state, to_state, at, versions, note) VALUES "
                          "(?, NULL, 'REQUEST_RECEIVED', ?, '{}', ?)", (rec["id"], now, "chat message"))
        return rec

    def get(self, request_id: str, with_history: bool = False) -> dict | None:
        row = self.s.db.one("SELECT * FROM requests WHERE id=?", (request_id,))
        if row is None:
            return None
        row["data"] = json.loads(row["data"])
        if with_history:
            row["history"] = [
                {"from": t["from_state"], "to": t["to_state"], "at": t["at"],
                 "versions": json.loads(t["versions"] or "{}"), "note": t["note"]}
                for t in self.s.db.query("SELECT * FROM transitions WHERE request_id=? ORDER BY id", (request_id,))
            ]
        return row

    def save(self, rec: dict) -> None:
        rec["updated_at"] = time.time()
        self.s.db.execute("UPDATE requests SET data=?, updated_at=? WHERE id=?",
                          (json.dumps(rec["data"], default=str), rec["updated_at"], rec["id"]))

    def move(self, rec: dict, to: str, note: str = "", versions: dict | None = None) -> None:
        frm = rec["state"]
        if to not in STATES:
            raise ValueError(f"unknown state {to}")
        if to != "CANCELLED" and to not in TRANSITIONS[frm]:
            raise WorkflowError(409, "IllegalTransition", f"{frm} -> {to}")
        if to == "CANCELLED" and frm in TERMINAL:
            raise WorkflowError(409, "IllegalTransition", f"{frm} is terminal")
        now = time.time()
        rec["state"] = to
        rec["updated_at"] = now
        with self.s.db.tx() as conn:
            conn.execute("UPDATE requests SET state=?, data=?, updated_at=? WHERE id=?",
                         (to, json.dumps(rec["data"], default=str), now, rec["id"]))
            conn.execute("INSERT INTO transitions(request_id, from_state, to_state, at, versions, note) VALUES "
                         "(?, ?, ?, ?, ?, ?)", (rec["id"], frm, to, now, json.dumps(versions or {}, default=str),
                                                note[:1000]))
        self.s.bus.publish({"type": "state", "safe": rec["safe"], "requestId": rec["id"], "from": frm, "state": to,
                            "note": note[:200]})

    def by_state(self, state: str, safe: str | None = None) -> list[dict]:
        if safe:
            rows = self.s.db.query("SELECT id FROM requests WHERE state=? AND safe=? ORDER BY created_at",
                                   (state, safe.lower()))
        else:
            rows = self.s.db.query("SELECT id FROM requests WHERE state=? ORDER BY created_at", (state,))
        return [self.get(r["id"]) for r in rows]

    def open_for_safe(self, safe: str) -> list[dict]:
        rows = self.s.db.query("SELECT id FROM requests WHERE safe=? AND state NOT IN ('EXPLAINED','CANCELLED') "
                               "ORDER BY created_at", (safe.lower(),))
        return [self.get(r["id"]) for r in rows]


class Workflow:
    def __init__(self, services: Services, agent: Agent, authorizer, executor_address: str):
        self.s = services
        self.agent = agent
        self.authorizer = authorizer
        self.executor_address = executor_address
        self.store = RequestStore(services)
        self.tradeflow = None
        self._locks: dict[str, threading.RLock] = {}
        self._locks_guard = threading.Lock()
        self._prefetch = ThreadPoolExecutor(max_workers=4, thread_name_prefix="state-prefetch")
        self._stream = threading.local()


    def _lock(self, request_id: str) -> threading.RLock:
        with self._locks_guard:
            return self._locks.setdefault(request_id, threading.RLock())

    @property
    def labels(self) -> list[str]:
        return [v.label for v in self.s.settings.addresses.vaults]

    def _tools(self, safe: str) -> AgentTools:
        return AgentTools(self.s, safe, request_lookup=lambda rid: self.store.get(rid, with_history=True),
                          tradeflow=self.tradeflow)

    def _ledger(self, rec: dict, kind: str, payload: dict, **kw) -> None:
        base = {"intent": (rec["data"].get("intent") or {}).get("kind"), "flags": rec["data"].get("flags", [])}
        self.s.ledger.append(kind, rec["safe"], {**base, **payload}, request_id=rec["id"], **kw)

    def _move(self, rec: dict, to: str, note: str = "", versions: dict | None = None,
              ledger_payload: dict | None = None, **ledger_kw) -> None:
        self.store.move(rec, to, note, versions)
        if to in LEDGER_STATES:
            payload = {"note": note, **(ledger_payload or {})}
            if versions:
                payload["versions"] = versions
            self._ledger(rec, to, payload, **ledger_kw)

    def _now(self) -> int:
        return self.s.chain.block_timestamp()

    def _check_owner(self, session: Session, rec: dict) -> None:
        if session.role == "owner":
            if session.safe is None or rec["safe"] != session.safe.lower():
                raise WorkflowError(404, "NotFound", "no such request for this session")
        elif session.role == "bank":
            pass
        else:
            raise WorkflowError(403, "Forbidden")

    def view(self, session: Session, request_id: str) -> dict:
        rec = self.store.get(request_id, with_history=True)
        if rec is None:
            raise WorkflowError(404, "NotFound")
        self._check_owner(session, rec)
        if session.role == "bank" and not self._bank_of(session, rec["safe"]):
            raise WorkflowError(404, "NotFound")
        return self.present(rec)

    def _bank_of(self, session: Session, safe: str) -> bool:
        pol = self.s.chain.policy(safe, [])
        return pol.bank.lower() == session.address.lower()

    def present(self, rec: dict) -> dict:
        d = rec["data"]
        return {
            "requestId": rec["id"], "safe": rec["safe"], "state": rec["state"], "message": rec["message"],
            "createdAt": rec["created_at"], "updatedAt": rec["updated_at"], "intent": d.get("intent"),
            "selection": d.get("selection"), "outcome": d.get("outcome"), "reason": d.get("reason"),
            "reply": d.get("reply"), "actionCard": d.get("actionCard"), "dar": d.get("dar"),
            "darHash": d.get("darHash"), "txHash": d.get("txHash"), "revertReason": d.get("revertReason"),
            "approval": d.get("approval"), "approvalsReceived": sorted((d.get("signatures") or {}).keys()),
            "plan": d.get("planView"), "prepared": d.get("prepared"), "flags": d.get("flags", []),
            "obligationDraft": d.get("obligationDraft"), "proposal": d.get("proposal"), "confirms": d.get("confirms"),
            "history": rec.get("history", []),
        }

    def _response(self, rec: dict) -> dict:
        d = rec["data"]
        out = {"reply": d.get("reply", ""), "requestId": rec["id"], "state": rec["state"],
               "mode": self.agent.mode, "replyMode": self.agent.reply_mode(d.get("reply")),
               "llmBudget": self.agent.budget()}
        notice = self.agent.notice()
        if notice:
            out["reply"] = f"{out['reply']}\n{notice}" if out["reply"] else notice
            out["mode"] = "deterministic"
            out["llmFallback"] = self.agent.fallback()
        if d.get("actionCard") and rec["state"] not in TERMINAL:
            out["actionCard"] = d["actionCard"]
        elif d.get("actionCard") and d.get("outcome") in ("CONFIRMED", "REVERTED", "SUBMITTED"):
            out["actionCard"] = d["actionCard"]
        if d.get("obligationDraft"):
            out["obligationDraft"] = d["obligationDraft"]
        if d.get("question"):
            out["clarification"] = d["question"]
        if d.get("outcome") == "HELD" and d.get("reason"):
            out["holdReason"] = d["reason"]
        proposal = d.get("proposal")
        if proposal and proposal.get("open"):
            out["pendingConfirmation"] = {k: proposal[k] for k in ("requestId", "op", "vault", "amount", "tier",
                                                                   "expiresAt")}
        return out


    @llm_scope
    def chat(self, session: Session, message: str, request_id: str | None = None,
             stream: Callable[[str, dict], None] | None = None) -> dict:
        """stream(event, data), when given, receives status stages and the reply of this chat's own request while
        it is written. Explanations of other requests (for example one a "cancel" closes) never stream."""
        self._stream.emit, self._stream.request_id, self._stream.shown = stream, None, False
        try:
            return self._chat(session, message, request_id)
        finally:
            self._stream.emit = None

    def _status(self, stage: str) -> None:
        emit = getattr(self._stream, "emit", None)
        if emit is not None:
            emit("status", {"stage": stage})

    def _explain(self, rec: dict, facts: dict, use_model: bool = True) -> str:
        emit = getattr(self._stream, "emit", None)
        if emit is None or rec["id"] != self._stream.request_id or not use_model:
            return self.agent.explain(facts, use_model=use_model)
        if self._stream.shown:
            emit("replace", {"text": ""})
        self._status("writing")

        def on_delta(kind: str, text: str) -> None:
            self._stream.shown = True
            emit(kind, {"text": text})

        return self.agent.explain(facts, on_delta)

    def _chat(self, session: Session, message: str, request_id: str | None) -> dict:
        if session.role != "owner" or not session.safe:
            raise WorkflowError(403, "Forbidden", "chat requires an owner session bound to a Safe")
        message = (message or "").strip()
        if not message:
            raise WorkflowError(400, "EmptyMessage")
        self.agent.owner_said(message)
        self._status("thinking")
        now = self._now()
        bound = self._bound_proposal(session.safe, message, request_id, now)
        pending = None if bound else self._pending_clarification(session.safe, message, request_id, now)
        if pending is not None:
            self._stream.request_id = pending["id"]
            with self._lock(pending["id"]):
                rec = self.store.get(pending["id"])
                intent = I.Intent.from_json(rec["data"]["intent"])
                intent = I.guard(I.merge_answer(intent, message, now, self.labels))
                rec["data"]["intent"] = intent.to_json()
                rec["data"]["flags"] = sorted(set(rec["data"].get("flags", [])) | set(intent.flags))
                self._move(rec, "INTENT_PARSED", f"clarification answered: {message[:200]}")
                self._continue_after_intent(rec, intent)
                return self._response(rec)

        rec = self.store.create(session.safe, session.role, message)
        self._stream.request_id = rec["id"]
        # Chain reads do not depend on the intent, so they overlap the model call instead of following it.
        prefetch = (self._prefetch.submit(load_state, self.s.chain, self.s.settings, session.safe)
                    if self.agent.llm is not None else None)
        with self._lock(rec["id"]):
            intent = self.agent.parse_intent(message, now, self.labels)
            foreign = [a for a in intent.addresses if a.lower() != session.safe.lower()]
            if foreign:
                intent.flags = sorted(set(intent.flags) | {"crossClient"})
            intent = I.guard(intent)
            if intent.kind == I.CONFIRM:
                intent = self._confirmed_intent(session.safe, rec, intent, bound)
            elif intent.kind in I.WRITE_KINDS:
                self._close_proposals(session.safe, f"superseded by {rec['id']}")
            rec["data"]["intent"] = intent.to_json()
            rec["data"]["flags"] = intent.flags
            note = f"intent {intent.kind}" + (f" flags={intent.flags}" if intent.flags else "")
            if rec["data"].get("confirms"):
                note += f" confirms {rec['data']['confirms']}"
            self._move(rec, "INTENT_PARSED", note)
            if intent.kind == I.CANCEL:
                if bound:
                    cancelled, closed = None, self._close_proposal(bound, f"cancelled by {rec['id']}")
                else:
                    cancelled = self._cancel_latest(session.safe, exclude=rec["id"])
                    closed = self._close_proposals(session.safe, f"cancelled by {rec['id']}")
                what = [x for x in (cancelled, closed) if x]
                rec["data"]["outcome"] = "CANCELLED"
                rec["data"]["reason"] = f"cancel command; cancelled {', '.join(what)}" if what else "cancel command"
                rec["data"]["reply"] = (f"Cancelled {' and '.join(what)}. Nothing was submitted." if what
                                        else "There was nothing pending to cancel.")
                self._move(rec, "CANCELLED", rec["data"]["reason"])
                return self._response(rec)
            self._continue_after_intent(rec, intent, prefetch)
            return self._response(rec)

    def _pending_clarification(self, safe: str, message: str, request_id: str | None, now: int) -> dict | None:
        if request_id:
            rec = self.store.get(request_id)
            if rec and rec["safe"] == safe.lower() and rec["state"] == "NEEDS_CLARIFICATION":
                return rec
            if rec and rec["safe"] == safe.lower():
                raise WorkflowError(409, "NotAwaitingClarification", rec["state"])
            raise WorkflowError(404, "NotFound")
        waiting = [r for r in self.store.by_state("NEEDS_CLARIFICATION", safe)
                   if time.time() - r["updated_at"] < CLARIFICATION_WINDOW]
        if not waiting:
            return None
        rec = waiting[-1]
        pending = I.Intent.from_json(rec["data"]["intent"])
        return rec if I.answers(pending, message, now, self.labels) else None

    def _bound_proposal(self, safe: str, message: str, request_id: str | None, now: int) -> str | None:
        """A confirm or cancel sent with the requestId of a chat proposal acts on that proposal only, so a click on
        one proposal's card can never confirm a newer proposal or cancel an unrelated approval."""
        if not request_id:
            return None
        rec = self.store.get(request_id)
        if not rec or rec["safe"] != safe.lower() or not rec["data"].get("proposal"):
            return None
        if I.parse(message, now, self.labels).kind not in (I.CONFIRM, I.CANCEL):
            return None
        return rec["id"]

    def _open_proposal(self, safe: str, request_id: str | None = None) -> dict | None:
        if request_id:
            rec = self.store.get(request_id)
            if not rec["data"]["proposal"].get("open"):
                return None
        else:
            rows = self.s.db.query("SELECT id FROM requests WHERE safe=? AND json_extract(data, '$.proposal.open')=1 "
                                   "ORDER BY created_at DESC LIMIT 1", (safe.lower(),))
            if not rows:
                return None
            rec = self.store.get(rows[0]["id"])
        if time.time() - rec["data"]["proposal"]["at"] >= CLARIFICATION_WINDOW:
            return None
        return rec

    def _close_proposal(self, request_id: str, why: str) -> str | None:
        with self._lock(request_id):
            rec = self.store.get(request_id)
            if not rec["data"]["proposal"].get("open"):
                return None
            rec["data"]["proposal"].update({"open": False, "closed": why})
            self.store.save(rec)
            return rec["id"]

    def _close_proposals(self, safe: str, why: str) -> str | None:
        """Closes every open chat proposal of this Safe; returns the newest one closed."""
        newest = None
        for row in self.s.db.query("SELECT id FROM requests WHERE safe=? AND json_extract(data, '$.proposal.open')=1 "
                                   "ORDER BY created_at", (safe.lower(),)):
            with self._lock(row["id"]):
                rec = self.store.get(row["id"])
                if rec["data"]["proposal"].get("open"):
                    rec["data"]["proposal"].update({"open": False, "closed": why})
                    self.store.save(rec)
                    newest = rec["id"]
        return newest

    def _confirmed_intent(self, safe: str, rec: dict, intent: I.Intent, bound: str | None = None) -> I.Intent:
        """A chat "confirm" re-runs the open proposal as an explicit instruction, pinned to the proposed operation,
        vault and amount, so revalidation can only keep or lower it."""
        prop = self._open_proposal(safe, bound)
        if prop is not None:
            with self._lock(prop["id"]):
                prop = self.store.get(prop["id"])
                p = prop["data"]["proposal"]
                if p.get("open"):
                    p.update({"open": False, "confirmedBy": rec["id"]})
                    self.store.save(prop)
                    base = I.Intent.from_json(prop["data"]["intent"])
                    rec["data"]["confirms"] = prop["id"]
                    return I.Intent(I.ALLOCATE if p["op"] == "DEPOSIT" else I.REDEEM,
                                    f"confirm {prop['id']}: {base.text}"[:4000], amount=int(p["amount"]["raw"]),
                                    vault_hint=p["vault"]["name"], flags=intent.flags, mood="imperative",
                                    imperative=True)
        intent.refused = "NothingToConfirm"
        return intent

    def _continue_after_intent(self, rec: dict, intent: I.Intent,
                               prefetch: Future[TreasuryState] | None = None) -> None:
        self._status("reading")
        tools = self._tools(rec["safe"])
        tools.prefetched = prefetch
        if intent.missing:
            plan = None
            if intent.kind in I.ACTION_KINDS:
                tools.plan_allocation()
                plan = tools.snapshot.plan
            question = self.agent.clarification(intent, plan, self.labels)
            rec["data"]["question"] = question
            rec["data"]["reply"] = question
            rec["data"]["outcome"] = "NEEDS_CLARIFICATION"
            self._move(rec, "NEEDS_CLARIFICATION", f"missing {intent.missing}")
            return
        rec["data"].pop("question", None)
        self._plan_and_select(rec, intent, tools)

    def _plan_and_select(self, rec: dict, intent: I.Intent, tools: AgentTools, note: str = "") -> None:
        state_json = tools.get_treasury_state(refresh=True)
        snap = tools.snapshot
        self.s.record_triggers(rec["safe"], snap.risk, at=snap.state.timestamp)
        self._move(rec, "STATE_LOADED", note or "state loaded", snap.state.versions())
        risk_json = tools.get_risk_report()
        self._move(rec, "RISK_EVALUATED", _risk_note(snap), snap.state.versions())
        obligations_json = tools.get_obligations()
        plan_json = tools.plan_allocation()
        rec["data"]["plan"] = snap.plan.to_record()
        rec["data"]["planView"] = plan_json
        self._move(rec, "PLAN_OPTIONS_BUILT", f"default={snap.plan.default_id} hold={snap.plan.hold_reason}",
                   snap.versions())
        intent = self._resolve_percent(rec, intent, snap)
        selection = self.agent.select(intent, snap.plan, {
            "get_treasury_state": state_json, "get_obligations": obligations_json,
            "get_risk_report": risk_json, "plan_allocation": plan_json,
        })
        self._apply_selection(rec, intent, snap, tools, selection)

    def _apply_selection(self, rec: dict, intent: I.Intent, snap: Snapshot, tools: AgentTools,
                         selection: dict) -> None:
        proposed = tools.propose_action(selection["optionId"], selection.get("reductions"))
        if tools.flags:
            rec["data"]["flags"] = sorted(set(rec["data"].get("flags", [])) | set(tools.flags))
        if not proposed["accepted"]:
            selection = {"optionId": "hold", "reductions": None, "holdReason": "InvalidSelection",
                         "rationale": proposed.get("error"), "source": selection.get("source")}
        rec["data"]["selection"] = selection
        self._move(rec, "OPTION_SELECTED", f"{selection['optionId']} ({selection.get('source')}): "
                                           f"{selection.get('rationale') or ''}", snap.versions())
        prepared = prepare(self.s.chain, self.s.settings, snap, selection["optionId"], selection.get("reductions"),
                           rec["id"], self.authorizer.address)
        rec["data"]["prepared"] = prepared.to_json()
        tier = prepared.policy.tier if prepared.policy else 0
        if prepared.ok and prepared.stage == "simulated" and tier < 3 and not intent.may_execute_unsigned:
            self._propose(rec, intent, snap, prepared)
            return
        if prepared.is_hold or prepared.stage == "validation":
            reason = selection.get("holdReason") or snap.plan.hold_reason or "Hold"
            if prepared.stage == "validation":
                reason = "InvalidSelection"
            self._hold(rec, intent, snap, reason)
            return
        self._move(rec, "PROPOSAL_VALIDATED", "; ".join(prepared.validation.reasons), snap.versions())
        tier = prepared.policy.tier if prepared.policy else 0
        self._move(rec, "POLICY_CHECKED", f"tier T{tier}", snap.versions())
        card = self._action_card(rec, snap, prepared)
        rec["data"]["actionCard"] = card
        if prepared.stage == "policy":
            failed = [c.to_json() for c in prepared.policy.checks if not c.ok]
            self._finish(rec, "POLICY_REJECTED", prepared.error, {"failedChecks": failed, "action": _action(card)},
                         snap.versions())
            return
        self._move(rec, "SIMULATED", f"check ok={prepared.simulation.ok if prepared.simulation else False}",
                   snap.versions())
        if prepared.stage == "simulation":
            self._finish(rec, "SIM_FAILED", prepared.error, {"action": _action(card)}, snap.versions())
            return
        rec["data"]["tier"] = tier
        if tier >= 3:
            rec["data"]["approval"] = prepared.approval.to_json()
            rec["data"]["approvalTier"] = tier
            rec["data"]["signatures"] = {}
            facts = {"outcome": "AWAITING_APPROVAL", "action": _action(card), "tier": tier,
                     "requiredSigners": prepared.policy.required_signers, "tierReason": card["reason"]}
            rec["data"]["outcome"] = "AWAITING_APPROVAL"
            rec["data"]["reply"] = self._explain(rec, facts)
            self._move(rec, "AWAITING_APPROVAL", card["reason"], snap.versions(),
                       {"action": _action(card), "approval": rec["data"]["approval"], "tier": tier})
            return
        self._move(rec, "FINAL_REVALIDATION", "no human approval required at this tier", snap.versions())
        self._finalize(rec, intent)

    def _propose(self, rec: dict, intent: I.Intent, snap: Snapshot, prepared: Prepared) -> None:
        """T1/T2 from a message that did not instruct the action itself: record it and wait for "confirm"."""
        self._close_proposals(rec["safe"], f"superseded by {rec['id']}")
        card = self._action_card(rec, snap, prepared)
        now = time.time()
        rec["data"]["proposal"] = {"open": True, "at": now, "expiresAt": int(now + CLARIFICATION_WINDOW),
                                   "requestId": rec["id"], "op": card["op"], "vault": card["vault"],
                                   "amount": card["amount"], "tier": card["tier"], "optionId": card["optionId"],
                                   "why": "polite or indirect wording" if not intent.llm_filled
                                   else f"model filled {', '.join(intent.llm_filled)}"}
        self._hold(rec, intent, snap, "AwaitingConfirmation",
                   {"action": _action(card), "windowMinutes": CLARIFICATION_WINDOW // 60})

    def _resolve_percent(self, rec: dict, intent: I.Intent, snap: Snapshot) -> I.Intent:
        if intent.percent is None or intent.amount is not None or not intent.percent_of_free:
            return intent
        raw = int((Decimal(snap.plan.deployable) * Decimal(intent.percent) / 100).to_integral_value(ROUND_DOWN))
        if raw <= 0:
            intent.refused = "NothingDeployable"
        intent.amount = raw or None
        rec["data"]["intent"] = intent.to_json()
        return intent

    def _hold(self, rec: dict, intent: I.Intent, snap: Snapshot, reason: str, extra: dict | None = None) -> None:
        facts = {"state": "HELD", "outcome": "HELD", "reason": reason,
                 "floor": display_usdc(snap.plan.onchain_floor), "required": display_usdc(snap.plan.required),
                 "defaultLabel": snap.plan.default.label if snap.plan.default else "", **(extra or {})}
        if reason in ("ReadOnly", "NothingToConfirm"):
            facts["summary"] = self._summary(intent, snap, rec)
            if intent.kind == I.ORDERS:
                facts["summary"], data = self._orders_summary(intent, rec)
                if data:
                    facts["orders"] = quoted("TradeFlow records and TradeEscrow reads for this Safe",
                                             json.dumps(data, sort_keys=True, default=str))
        if reason == "AwaitingObligationConfirmation":
            rec["data"]["obligationDraft"] = _obligation_draft(intent)
        refusal = (intent.kind == I.TRANSFER_OUT or bool(intent.refused)
                   or bool(I.SUSPICIOUS_FLAGS & set(rec["data"].get("flags", []))))
        if intent.kind == I.TRANSFER_OUT or "crossClient" in rec["data"].get("flags", []):
            facts["securityNote"] = "transfer or cross-client request refused"
        rec["data"]["outcome"] = "HELD"
        rec["data"]["reason"] = reason
        self._move(rec, "HELD", reason, snap.versions(), {"reason": reason, "planHash": snap.plan.plan_hash,
                                                          "defaultOptionId": snap.plan.default_id})
        # A refusal is answered by its template: the model would only see the attacker's text (and could echo its
        # address), and a slow model call made the refusal itself take tens of seconds.
        rec["data"]["reply"] = self._explain(rec, facts, use_model=not refusal)
        self._move(rec, "EXPLAINED", "explained")

    def _finish(self, rec: dict, state: str, reason: str | None, facts: dict, versions: dict | None = None,
                **ledger_kw) -> None:
        rec["data"]["outcome"] = state
        rec["data"]["reason"] = reason
        self._move(rec, state, reason or "", versions, {"reason": reason, **facts}, **ledger_kw)
        rec["data"]["reply"] = self._explain(rec, {"outcome": state, "reason": reason, **facts})
        self._move(rec, "EXPLAINED", "explained")

    def _orders_summary(self, intent: I.Intent, rec: dict) -> tuple[str, dict]:
        if self.tradeflow is None:
            return "TradeFlow is not enabled on this deployment, so there are no supplier orders.", {}
        tools = self._tools(rec["safe"])
        if intent.order_id is not None:
            order = tools.get_order(intent.order_id)
            if "error" in order:
                return f"There is no order {intent.order_id} for this treasury.", {}
            held = tools.explain_hold(intent.order_id, intent.milestone)
            return f"{held['text']} {_order_line(order)}", {"order": order, "milestone": held}
        orders = tools.get_orders()
        active = [o for o in orders["orders"] if o["status"] == "ACTIVE"]
        lines = [f"Committed to suppliers: {orders['committed']['display']} USDC in escrow across {len(active)} "
                 f"active order{'s' if len(active) != 1 else ''}."]
        lines += [_order_line(o) for o in orders["orders"][:5]]
        if len(orders["orders"]) > 5:
            lines.append(f"{len(orders['orders']) - 5} more orders are listed in TradeFlow.")
        return " ".join(lines), orders

    def _summary(self, intent: I.Intent, snap: Snapshot, rec: dict) -> str:
        s, p = snap.state, snap.plan
        if intent.kind == I.EXPLAIN:
            last = self.s.db.one("SELECT id FROM requests WHERE safe=? AND id<>? AND state='EXPLAINED' "
                                 "ORDER BY updated_at DESC LIMIT 1", (rec["safe"], rec["id"]))
            if last:
                prev = self.store.get(last["id"])
                return f"Last request {prev['id']}: {prev['data'].get('reply', '')}"
        if intent.kind == I.RISK:
            parts = []
            for v in snap.risk.vaults:
                trig = ", ".join(t.code for t in v.triggers) or "no triggers"
                parts.append(f"{v.label}: score {v.score:.2f}, {trig}{', quarantined' if v.quarantined else ''}")
            return ("Risk: " + "; ".join(parts) + f". Oracle age {snap.risk.oracle_age}s "
                    f"(limit {snap.risk.max_oracle_age}s).")
        vaults = ", ".join(f"{v.label} {display_usdc(v.assets)}" for v in s.vaults)
        if intent.asked:
            lead = (f"Right now up to {display_usdc(p.deployable)} USDC is deployable after keeping the required "
                    f"reserve of {display_usdc(p.required)} USDC. " if intent.asked == I.ALLOCATE else "")
            return (lead + "This answers your question only; nothing was proposed. To act, send an instruction, for "
                    "example 'deposit 1,000 USDC into Vault B'. " + self._summary(I.Intent(I.STATUS, ""), snap, rec))
        note = ""
        if "crossClient" in rec["data"].get("flags", []):
            note = " I can only show this session's treasury; other clients' data is not accessible."
        return (f"Safe holds {display_usdc(s.safe_usdc)} USDC; vaults: {vaults}. Required reserve "
                f"{display_usdc(p.required)} USDC (on-chain floor {display_usdc(p.onchain_floor)}, "
                f"{'in sync' if p.in_sync else 'out of sync'}). Deployable {display_usdc(p.deployable)} USDC. "
                f"Default plan: {p.default.label}.{note}")

    def _action_card(self, rec: dict, snap: Snapshot, prepared: Prepared) -> dict:
        v = prepared.validation
        opt = v.option
        state = snap.state
        tier = prepared.policy.tier if prepared.policy else 0
        reasons = []
        if opt.op == OP_DEPOSIT:
            vs = state.vault(opt.vault)
            if tier == 4:
                reasons.append(f"amount above bankLimit {display_usdc(state.policy.bank_limit)} USDC")
            if v.assets > state.policy.auto_cap:
                reasons.append(f"amount above autoCap {display_usdc(state.policy.auto_cap)} USDC")
            if vs and not vs.ever_deposited:
                reasons.append("first deposit into this vault")
            if v.escalate_tier:
                reasons.append("above the default option")
            reserve_after = state.safe_usdc - v.assets
        else:
            reasons.append("protective redemption back to the Safe")
            reserve_after = state.safe_usdc + v.assets
        sim = prepared.simulation
        card = {
            "requestId": rec["id"],
            "op": OP_NAMES[opt.op],
            "optionId": opt.id,
            "vault": {"address": opt.vault, "name": opt.vault_label},
            "amount": amount(v.assets),
            "shares": str(v.shares) if opt.op != OP_DEPOSIT else None,
            "tier": tier,
            "requiredSigners": prepared.policy.required_signers if prepared.policy else [],
            "reason": "; ".join(reasons) or "routine deposit within autoCap",
            "reserveAfter": amount(max(reserve_after, 0)),
            "simulation": {
                "ok": bool(sim and sim.ok), "error": sim.error if sim else prepared.error,
                ("sharesOut" if opt.op == OP_DEPOSIT else "assetsOut"): amount(sim.expected_out) if sim else None,
            },
            "policyChecks": [c.to_json() for c in prepared.policy.checks] if prepared.policy else [],
        }
        if prepared.approval is not None and tier >= 3:
            card["approvalTypedData"] = approval_typed_data(self.s.settings.chain_id, self.s.settings.addresses.module,
                                                            prepared.approval)
        return card


    def _finalize(self, rec: dict, intent: I.Intent) -> None:
        """FINAL_REVALIDATION: reload state, recompute the plan, simulate again; sign only if the new action
        still fits inside the human Approval."""
        snap = self.s.snapshot(rec["safe"])
        sel = rec["data"]["selection"]
        approval = Approval.from_json(rec["data"]["approval"]) if rec["data"].get("approval") else None
        prepared = prepare(self.s.chain, self.s.settings, snap, sel["optionId"], sel.get("reductions"), rec["id"],
                           self.authorizer.address, approval=approval)
        if not prepared.ok or prepared.is_hold:
            self._move(rec, "STATE_LOADED", f"conditions changed: {prepared.error or 'now hold'}", snap.versions())
            self._replan_from_loaded(rec, f"conditions changed: {prepared.error or 'now hold'}")
            return
        if approval is not None and prepared.approval is not None:
            misfit = approval_fits(approval, prepared.dar, snap.state, rec["data"].get("approvalTier", 3),
                                   prepared.policy.tier)
            if misfit:
                self._move(rec, "STATE_LOADED", f"outside the Approval: {misfit}", snap.versions())
                self._replan_from_loaded(rec, f"outside the Approval: {misfit}")
                return
        sigs = rec["data"].get("signatures") or {}
        if prepared.dar.tier >= 3 and "owner" not in sigs:
            self._move(rec, "STATE_LOADED", "approval required at revalidation", snap.versions())
            self._replan_from_loaded(rec, "tier rose to T3 at revalidation")
            return
        if prepared.dar.tier >= 4 and "bank" not in sigs:
            self._move(rec, "STATE_LOADED", "bank approval required at revalidation", snap.versions())
            self._replan_from_loaded(rec, "tier rose to T4 at revalidation")
            return
        payload = {
            "requestId": rec["id"], "safe": rec["safe"], "selection": sel, "dar": prepared.dar.to_json(),
            "approval": prepared.approval.to_json() if prepared.approval else None,
            "approvalSignatures": sigs if prepared.approval else {},
            "obligations": [obligation_json(o) | {"due": o.due} for o in snap.obligations],
            "evidence": prepared.evidence,
            "serviceResults": {"validation": prepared.validation.to_json(), "policy": prepared.policy.to_json(),
                               "simulation": prepared.simulation.to_json()},
        }
        try:
            signed = self.authorizer.sign(payload)
        except AuthorizerRefused as e:
            rec["data"]["outcome"] = "CANCELLED"
            rec["data"]["reason"] = f"AuthorizerRefused: {e}"
            rec["data"]["reply"] = self._explain(rec, {"outcome": "CANCELLED", "reason": rec["data"]["reason"]})
            self._move(rec, "CANCELLED", rec["data"]["reason"], snap.versions(), {"reason": rec["data"]["reason"]})
            return
        dar = prepared.dar
        dar_hash = hex32(dar_digest(self.s.settings.chain_id, self.s.settings.addresses.module, dar))
        if signed.get("darHash", dar_hash).lower() != dar_hash.lower():
            raise WorkflowError(500, "DarHashMismatch")
        rec["data"]["dar"] = dar.to_json()
        rec["data"]["darHash"] = dar_hash
        rec["data"]["authSig"] = signed["signature"]
        card = rec["data"].get("actionCard") or self._action_card(rec, snap, prepared)
        rec["data"]["actionCard"] = card
        self._move(rec, "DAR_SIGNED", f"tier T{dar.tier}", snap.versions(),
                   {"dar": dar.to_json(), "evidence": prepared.evidence, "action": _action(card)},
                   dar_hash=dar_hash)
        final = simulator.final_signed_call(self.s.chain, dar, signed["signature"], sigs.get("owner"),
                                            sigs.get("bank"), prepared.approval, self.executor_address)
        if not final.ok:
            rec["data"]["outcome"] = "CANCELLED"
            rec["data"]["reason"] = f"FinalSimulationFailed: {final.error}"
            rec["data"]["reply"] = self._explain(rec, {"outcome": "CANCELLED", "reason": rec["data"]["reason"]})
            self._move(rec, "CANCELLED", rec["data"]["reason"], snap.versions(), {"reason": final.error},
                       dar_hash=dar_hash)
            return
        sub_id = enqueue_submission(self.s, "workflow", dar, {"auth": signed["signature"], "owner": sigs.get("owner"),
                                                              "bank": sigs.get("bank")},
                                    prepared.approval, dar_hash, rec["id"])
        rec["data"]["submissionId"] = sub_id
        rec["data"]["outcome"] = "SUBMITTED"
        rec["data"]["reply"] = self._explain(rec, {"outcome": "SUBMITTED", "action": _action(card), "tier": dar.tier})
        self._move(rec, "SUBMITTED", f"submission {sub_id}", snap.versions(), {"action": _action(card)},
                   dar_hash=dar_hash)

    def _replan_from_loaded(self, rec: dict, reason: str) -> None:
        """Already in STATE_LOADED; continue the planning chain from there."""
        rec["data"]["replans"] = rec["data"].get("replans", 0) + 1
        if rec["data"]["replans"] > self.s.settings.params.max_replans:
            rec["data"]["outcome"] = "CANCELLED"
            rec["data"]["reason"] = f"ReplanLimit after {reason}"
            rec["data"]["reply"] = self._explain(rec, {"outcome": "CANCELLED", "reason": rec["data"]["reason"]})
            self._move(rec, "CANCELLED", rec["data"]["reason"])
            return
        for k in ("approval", "signatures", "approvalTier", "actionCard", "dar", "darHash"):
            rec["data"].pop(k, None)
        intent = I.Intent.from_json(rec["data"]["intent"])
        tools = self._tools(rec["safe"])
        state_json = tools.get_treasury_state(refresh=True)
        snap = tools.snapshot
        risk_json = tools.get_risk_report()
        self._move(rec, "RISK_EVALUATED", _risk_note(snap), snap.state.versions())
        obligations_json = tools.get_obligations()
        plan_json = tools.plan_allocation()
        rec["data"]["plan"] = snap.plan.to_record()
        rec["data"]["planView"] = plan_json
        self._move(rec, "PLAN_OPTIONS_BUILT", f"default={snap.plan.default_id} hold={snap.plan.hold_reason}",
                   snap.versions())
        intent = self._resolve_percent(rec, intent, snap)
        selection = self.agent.select(intent, snap.plan, {
            "get_treasury_state": state_json, "get_obligations": obligations_json,
            "get_risk_report": risk_json, "plan_allocation": plan_json,
        })
        self._apply_selection(rec, intent, snap, tools, selection)


    @llm_scope
    def approve(self, session: Session, request_id: str, signature: str, approval_json: dict) -> dict:
        rec = self.store.get(request_id)
        if rec is None:
            raise WorkflowError(404, "NotFound")
        if session.role == "owner":
            self._check_owner(session, rec)
        elif not self._bank_of(session, rec["safe"]):
            raise WorkflowError(404, "NotFound")
        with self._lock(request_id):
            rec = self.store.get(request_id)
            if rec["state"] != "AWAITING_APPROVAL":
                raise WorkflowError(409, "NotAwaitingApproval", rec["state"])
            if self._expire_if_due(rec):
                return self._response(rec)
            stored = Approval.from_json(rec["data"]["approval"])
            try:
                given = Approval.from_json(approval_json)
            except (KeyError, TypeError, ValueError):
                raise WorkflowError(400, "BadApproval", "approval object is malformed") from None
            if given != stored:
                raise WorkflowError(400, "ApprovalMismatch", "approval differs from the one proposed")
            settings = self.s.settings
            signer = recover_digest(approval_digest(settings.chain_id, settings.addresses.module, stored), signature)
            policy = self.s.chain.policy(rec["safe"], [])
            expected = policy.owner if session.role == "owner" else policy.bank
            if (signer is None or signer.lower() != expected.lower()
                    or session.address.lower() != expected.lower()):
                raise WorkflowError(400, "BadSignature", f"Approval must be signed by the {session.role}")
            tier = rec["data"].get("approvalTier", 3)
            if session.role == "bank" and tier < 4:
                raise WorkflowError(409, "BankApprovalNotRequired")
            sigs = rec["data"].setdefault("signatures", {})
            sigs[session.role] = signature
            self.store.save(rec)
            self._ledger(rec, "APPROVAL_SIGNATURE", {"role": session.role, "signer": signer,
                                                     "approval": rec["data"]["approval"]})
            needed = ["owner"] + (["bank"] if tier >= 4 else [])
            missing = [r for r in needed if r not in sigs]
            if missing:
                rec["data"]["reply"] = f"Approval recorded. Still waiting for: {', '.join(missing)}."
                self.store.save(rec)
                return self._response(rec)
            self._move(rec, "APPROVED", f"signed by {', '.join(needed)}", None,
                       {"approval": rec["data"]["approval"], "signers": needed})
            self._move(rec, "FINAL_REVALIDATION", "approval complete")
            self._finalize(rec, I.Intent.from_json(rec["data"]["intent"]))
            return self._response(rec)

    @llm_scope
    def deny(self, session: Session, request_id: str, reason: str) -> dict:
        rec = self.store.get(request_id)
        if rec is None:
            raise WorkflowError(404, "NotFound")
        if session.role == "owner":
            self._check_owner(session, rec)
        elif not self._bank_of(session, rec["safe"]):
            raise WorkflowError(404, "NotFound")
        with self._lock(request_id):
            rec = self.store.get(request_id)
            if rec["state"] != "AWAITING_APPROVAL":
                raise WorkflowError(409, "NotAwaitingApproval", rec["state"])
            card = rec["data"].get("actionCard") or {}
            self._finish(rec, "APPROVAL_DENIED", f"{session.role}: {(reason or 'denied')[:300]}",
                         {"action": _action(card), "deniedBy": session.role})
            return self._response(rec)

    @llm_scope
    def correct(self, session: Session, request_id: str, message: str) -> dict:
        rec = self.store.get(request_id)
        if rec is None:
            raise WorkflowError(404, "NotFound")
        if session.role != "owner":
            raise WorkflowError(403, "Forbidden", "corrections come from the owner")
        self._check_owner(session, rec)
        with self._lock(request_id):
            rec = self.store.get(request_id)
            if rec["state"] != "AWAITING_APPROVAL":
                raise WorkflowError(409, "NotAwaitingApproval", rec["state"])
            now = self._now()
            original = I.Intent.from_json(rec["data"]["intent"])
            fix = I.parse(message, now, self.labels)
            corrected = I.Intent(original.kind, original.text + " | correction: " + message[:500],
                                 amount=fix.amount if fix.amount is not None else original.amount,
                                 vault_hint=fix.vault_hint or original.vault_hint,
                                 flags=sorted(set(original.flags) | set(fix.flags)))
            if fix.kind in (I.CANCEL, I.TRANSFER_OUT) or "hold" in message.lower():
                corrected.kind = I.STATUS
            rec["data"]["intent"] = corrected.to_json()
            rec["data"]["flags"] = corrected.flags
            for k in ("approval", "signatures", "approvalTier", "actionCard"):
                rec["data"].pop(k, None)
            self._move(rec, "CORRECTION_REQUESTED", message[:300])
            tools = self._tools(rec["safe"])
            state_json = tools.get_treasury_state(refresh=True)
            snap = tools.snapshot
            selection = self.agent.select(corrected, snap.plan, {"get_treasury_state": state_json,
                                                                 "plan_allocation": tools.plan_allocation()})
            if corrected.kind == I.STATUS:
                selection = {"optionId": "hold", "reductions": None, "holdReason": "OwnerCorrectedToHold",
                             "rationale": "owner asked to hold", "source": "rules"}
            rec["data"]["plan"] = snap.plan.to_record()
            rec["data"]["planView"] = snap.plan.to_json()
            self._apply_selection(rec, corrected, snap, tools, selection)
            return self._response(rec)

    def cancel(self, request_id: str, reason: str) -> bool:
        with self._lock(request_id):
            rec = self.store.get(request_id)
            if rec is None or rec["state"] in TERMINAL:
                return False
            if rec["state"] == "SUBMITTED":
                sub = self.s.db.one("SELECT status FROM submissions WHERE id=?", (rec["data"].get("submissionId"),))
                if sub and sub["status"] != "pending":
                    return False
                self.s.db.execute("UPDATE submissions SET status='dropped', updated_at=?, error=? WHERE id=? "
                                  "AND status='pending'", (time.time(), reason, rec["data"].get("submissionId")))
            rec["data"]["outcome"] = "CANCELLED"
            rec["data"]["reason"] = reason
            rec["data"]["reply"] = self._explain(rec, {"outcome": "CANCELLED", "reason": reason})
            self._move(rec, "CANCELLED", reason, None, {"reason": reason})
            return True

    def _cancel_latest(self, safe: str, exclude: str) -> str | None:
        for rec in reversed(self.store.open_for_safe(safe)):
            if rec["id"] != exclude and rec["state"] in ("NEEDS_CLARIFICATION", "AWAITING_APPROVAL"):
                if self.cancel(rec["id"], "cancelled by owner"):
                    return rec["id"]
        return None

    def pending_approvals(self, session: Session) -> list[dict]:
        out = []
        for rec in self.store.by_state("AWAITING_APPROVAL"):
            sigs = rec["data"].get("signatures") or {}
            tier = rec["data"].get("approvalTier", 3)
            if session.role == "owner":
                if session.safe and rec["safe"] == session.safe.lower() and "owner" not in sigs:
                    out.append(self.present(rec))
            elif session.role == "bank" and tier >= 4 and "bank" not in sigs and self._bank_of(session, rec["safe"]):
                out.append(self.present(rec))
        return out


    def _expire_if_due(self, rec: dict) -> bool:
        approval = rec["data"].get("approval")
        if not approval:
            return False
        now = self._now()
        if now < int(approval["approvalExpiry"]):
            return False
        self._move(rec, "APPROVAL_EXPIRED", f"approval expired at {iso(int(approval['approvalExpiry']))}", None,
                   {"approval": approval})
        self._move(rec, "STATE_LOADED", "approval expired; replanning")
        self._replan_from_loaded(rec, "approval expired")
        return True

    def expire_approvals(self) -> int:
        n = 0
        for rec in self.store.by_state("AWAITING_APPROVAL"):
            with self._lock(rec["id"]):
                fresh = self.store.get(rec["id"])
                if fresh["state"] == "AWAITING_APPROVAL" and self._expire_if_due(fresh):
                    n += 1
        return n

    def apply_submission_results(self) -> int:
        """Moves each SUBMITTED request to the outcome of its submission. A submission counts as applied only after
        its request took the result: the Executor can confirm before _finalize (still holding the request lock while
        it explains) has moved the request to SUBMITTED, and a failed tick must not lose a result."""
        rows = self.s.db.query(
            "SELECT * FROM submissions WHERE source='workflow' AND status IN ('confirmed','reverted','failed') AND "
            "(applied=0 OR request_id IN (SELECT id FROM requests WHERE state='SUBMITTED')) ORDER BY id")
        n = 0
        for sub in rows:
            try:
                n += self._apply_submission(sub)
            except Exception:
                log.exception("applying submission %s failed; retrying next tick", sub["id"])
        return n

    def _apply_submission(self, sub: dict) -> int:
        lock = self._lock(sub["request_id"] or "")
        if not lock.acquire(blocking=False):
            return 0
        try:
            rec = self.store.get(sub["request_id"]) if sub["request_id"] else None
            ours = rec is not None and rec["data"].get("submissionId") == sub["id"]
            if not ours or rec["state"] not in ("SUBMITTED", "CONFIRMED", "REVERTED"):
                self._mark_applied(sub["id"])
                return 0
            if sub["status"] == "failed" and not sub["tx_hash"] and self._nonce_used(sub):
                # The send raised (an RPC timeout, say) after the node took the transaction; reconcile_onchain
                # confirms it from its AegisExecuted event instead of reporting a revert that did not happen.
                return 0
            card = rec["data"].get("actionCard") or {}
            result = json.loads(sub["result"] or "{}")
            rec["data"]["txHash"] = sub["tx_hash"]
            if sub["status"] == "confirmed":
                ev = result.get("executed") or {}
                payload = {"action": _action(card), "op": OP_NAMES.get(sub["op"]), "vault": sub["vault"],
                           "assets": str(ev.get("assets", "")), "shares": str(ev.get("shares", "")),
                           "tier": ev.get("tier"), "block": result.get("blockNumber"), "txHash": sub["tx_hash"]}
                state, reason = "CONFIRMED", None
                ledger_kw = {}
            else:
                reason = sub["error"] or "Reverted"
                rec["data"]["revertReason"] = reason
                payload = {"action": _action(card), "txHash": sub["tx_hash"]}
                state = "REVERTED"
                ledger_kw = {"revert_reason": reason}
            if rec["state"] == "SUBMITTED":
                self._finish(rec, state, reason, payload, None, tx_hash=sub["tx_hash"], dar_hash=sub["dar_hash"],
                             **ledger_kw)
            else:
                rec["data"]["reply"] = self._explain(rec, {"outcome": state, "reason": reason, **payload})
                self._move(rec, "EXPLAINED", "explained")
            self._mark_applied(sub["id"])
            return 1
        finally:
            lock.release()

    def _nonce_used(self, sub: dict) -> bool:
        dar = DAR.from_json(json.loads(sub["dar"]))
        return self.s.chain.used_nonce(dar.safe, dar.nonce)

    def _mark_applied(self, sub_id: int) -> None:
        self.s.db.execute("UPDATE submissions SET applied=1 WHERE id=?", (sub_id,))

    def reconcile_onchain(self, older_than: float = RECONCILE_AFTER) -> int:
        """Confirms SUBMITTED requests from AegisExecuted events when the submission row never learned the outcome,
        for example when the Executor stopped between broadcasting and recording the tx hash or receipt, or its send
        raised although the transaction went out. The event
        carries the DAR hash, so it identifies the submission without the row's tx hash."""
        rows = self.s.db.query(
            "SELECT s.* FROM submissions s JOIN requests r ON r.id = s.request_id WHERE s.source='workflow' AND "
            "r.state='SUBMITTED' AND s.status IN ('pending','claimed','sent','failed') AND s.created_at <= ? "
            "ORDER BY s.id",
            (time.time() - older_than,))
        by_safe: dict[str, list[dict]] = {}
        for sub in rows:
            by_safe.setdefault(sub["safe"], []).append(sub)
        n = 0
        for safe, subs in by_safe.items():
            start = min(sub["created_block"] for sub in subs)
            executed = {e["darHash"].lower(): e for e in self.s.chain.events(safe, start)
                        if e.get("event") == "AegisExecuted"}
            for sub in subs:
                ev = executed.get(sub["dar_hash"].lower())
                if ev is None:
                    continue
                result = json.dumps({"blockNumber": ev["blockNumber"], "executed": ev})
                cur = self.s.db.execute(
                    "UPDATE submissions SET status='confirmed', tx_hash=?, result=?, error=NULL, updated_at=? "
                    "WHERE id=? AND status IN ('pending','claimed','sent','failed')",
                    (ev["txHash"], result, time.time(), sub["id"]))
                if cur.rowcount:
                    log.warning("submission %s confirmed from chain event in tx %s", sub["id"], ev["txHash"])
                    n += 1
        return n

    def drop_pending_deposits(self, safe: str, vault: str, reason: str = "VaultQuarantined") -> list[str]:
        dropped = []
        for rec in self.store.open_for_safe(safe):
            card = rec["data"].get("actionCard") or {}
            if card.get("op") != "DEPOSIT" or (card.get("vault") or {}).get("address", "").lower() != vault.lower():
                continue
            if rec["state"] in ("AWAITING_APPROVAL", "APPROVED", "FINAL_REVALIDATION", "DAR_SIGNED", "SUBMITTED"):
                if self.cancel(rec["id"], reason):
                    dropped.append(rec["id"])
        return dropped


def _order_line(o: dict) -> str:
    line = (f"Order {o['orderId']}: {o['total']['display']} USDC, {o['released']['display']} released, "
            f"{o['committed']['display']} committed, status {o['status']}")
    flagged = [f"milestone {m['index'] + 1} {m['state'].lower()} ({m['reason']})" for m in o["milestones"]
               if m["state"] in ("HELD", "WAITING")]
    return line + ("; " + "; ".join(flagged) if flagged else "") + "."


def _risk_note(snap: Snapshot) -> str:
    trig = [f"{v.label}:{t.code}" for v in snap.risk.vaults for t in v.triggers]
    return "triggers: " + (", ".join(trig) if trig else "none")


def _action(card: dict) -> dict:
    if not card:
        return {}
    return {"op": card.get("op"), "vault": (card.get("vault") or {}).get("name"),
            "vaultAddress": (card.get("vault") or {}).get("address"), "amount": (card.get("amount") or {}).get("raw"),
            "amountDisplay": (card.get("amount") or {}).get("display"), "tier": card.get("tier")}


def _obligation_draft(intent: I.Intent) -> dict:
    months = intent.months or 1
    label = intent.label or "Obligation"
    items = []
    for i in range(months):
        due = intent.due + i * 30 * 86400 if intent.due else None
        items.append({"label": f"{label}" + (f" #{i + 1}" if months > 1 else ""), "amount": amount(intent.amount or 0),
                      "dueDate": iso(due) if due else None})
    return {"items": items, "note": "Confirm in Treasury > Obligations (POST /api/obligations). Nothing changes "
                                    "until you add it and sign the floor update."}


def enqueue_submission(services: Services, source: str, dar: DAR, sigs: dict, approval: Approval | None,
                       dar_hash: str, request_id: str | None) -> int:
    now = time.time()
    cur = services.db.execute(
        "INSERT INTO submissions(source, op, request_id, safe, vault, dar, sigs, approval, dar_hash, status, "
        "created_block, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)",
        (source, dar.op, request_id, dar.safe.lower(), dar.vault.lower(), json.dumps(dar.to_json()),
         json.dumps(sigs), json.dumps(approval.to_json()) if approval else None, dar_hash,
         services.chain.block_number(), now, now))
    services.bus.publish({"type": "submission", "safe": dar.safe, "submissionId": cur.lastrowid, "source": source,
                          "darHash": dar_hash, "status": "pending"})
    return cur.lastrowid
