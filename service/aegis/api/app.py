"""AEGIS API (INTERFACES 2). Every endpoint takes the Safe from the session, never from the body."""

from __future__ import annotations

import asyncio
import json
import time
from contextlib import asynccontextmanager

from eth_utils import is_address
from fastapi import Depends, FastAPI, Header, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel

from aegis.config import PRICE_ONE, UINT256_MAX, USDC, load_key
from aegis.core.pipeline import Snapshot
from aegis.ledger import reconcile
from aegis.obligations import floor_update, parse_due
from aegis.obligations import to_json as obligation_json
from aegis.procs.keeper import PAUSE_KEY
from aegis.runtime import Runtime
from aegis.units import amount, parse_raw, price
from aegis.workflow import Session, WorkflowError

SCENARIOS = ("depeg", "liquidity", "stale", "obligation", "restore")


class SessionBody(BaseModel):
    role: str
    address: str
    signature: str | None = None
    issuedAt: str | None = None


class ChatBody(BaseModel):
    message: str
    requestId: str | None = None


class ObligationBody(BaseModel):
    label: str
    amount: str | int | dict
    dueDate: str | int
    confirmedInflow: bool | None = False


class ApprovalBody(BaseModel):
    signature: str
    approval: dict


class DenyBody(BaseModel):
    reason: str | None = None


class CorrectBody(BaseModel):
    message: str


class ScenarioBody(BaseModel):
    name: str


class InternalQuarantine(BaseModel):
    safe: str
    vault: str


def create_app(rt: Runtime, start_background: bool = True) -> FastAPI:
    @asynccontextmanager
    async def lifespan(app: FastAPI):
        if start_background:
            rt.start_background()
        yield
        rt.stop()

    app = FastAPI(title="AEGIS Treasury API", version="1.0", lifespan=lifespan)
    app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"],
                       expose_headers=["*"])
    s = rt.services

    @app.exception_handler(WorkflowError)
    async def wf_error(_: Request, exc: WorkflowError):
        return JSONResponse({"error": exc.code, "detail": exc.detail}, status_code=exc.status)

    def session_dep(request: Request, x_aegis_session: str | None = Header(default=None)) -> Session:
        token = x_aegis_session or request.cookies.get("aegis_session")
        sess = rt.sessions.get(token)
        if sess is None:
            raise WorkflowError(401, "SessionRequired", "POST /api/session first and send X-Aegis-Session")
        return sess

    def owner_dep(sess: Session = Depends(session_dep)) -> Session:
        if sess.role != "owner" or not sess.safe:
            raise WorkflowError(403, "OwnerOnly")
        return sess

    def bank_dep(sess: Session = Depends(session_dep)) -> Session:
        if sess.role != "bank":
            raise WorkflowError(403, "BankOnly")
        return sess

    def bank_safes(sess: Session) -> list[str]:
        return [x for x in s.safes if s.chain.policy(x, []).bank.lower() == sess.address.lower()]

    def resolve_safe(sess: Session, requested: str | None) -> str:
        """Owner: always the session Safe; asking for another one is refused. Bank: one of its Safes."""
        if sess.role == "owner":
            if requested and requested.lower() != sess.safe.lower():
                s.ledger.append("CROSS_CLIENT_REFUSED", sess.safe, {"requestedSafe": requested,
                                                                    "address": sess.address})
                raise WorkflowError(403, "CrossClientRefused", "this session is bound to one Safe")
            return sess.safe
        safes = bank_safes(sess)
        if requested:
            match = next((x for x in safes if x.lower() == requested.lower()), None)
            if match is None:
                raise WorkflowError(404, "UnknownSafe")
            return match
        if not safes:
            raise WorkflowError(404, "UnknownSafe")
        return safes[0]

    def snap_for(safe: str) -> Snapshot:
        return s.snapshot(safe)

    def treasury_view(snap: Snapshot) -> dict:
        st, p, plan = snap.state, snap.state.policy, snap.plan
        return {
            "safe": st.safe,
            "block": st.block,
            "timestamp": st.timestamp,
            "balances": {
                "safeUsdc": amount(st.safe_usdc),
                "vaults": [{"address": v.address, "name": v.label, "shares": str(v.shares), "assets": amount(v.assets),
                            "withdrawable": amount(v.withdrawable_assets), "allowed": v.allowed,
                            "quarantined": v.quarantined, "everDeposited": v.ever_deposited} for v in st.vaults],
                "total": amount(st.total_value),
            },
            "reserve": {"required": amount(snap.reserve.required), "onchainFloor": amount(p.reserve_floor),
                        "inSync": plan.in_sync, "buffer": amount(snap.reserve.buffer),
                        "scheduleHash": snap.reserve.schedule_hash, "onchainScheduleHash": p.schedule_hash},
            "deployable": amount(plan.deployable),
            "policy": {"autoCap": amount(p.auto_cap), "dailyCap": amount(p.daily_cap), "bankLimit": amount(p.bank_limit),
                       "frozen": {"owner": p.owner_frozen, "bank": p.bank_frozen}, "version": p.policy_version,
                       "depositedToday": amount(st.deposited_today), "maxBandWidth": str(p.max_band_width),
                       "maxOracleAge": p.max_oracle_age},
            "plan": {"defaultOptionId": plan.default_id, "holdReason": plan.hold_reason,
                     "default": plan.default.to_json() if plan.default else None},
        }

    @app.get("/api/health")
    def health():
        out = {"ok": True, "service": "aegis-api", "chainId": rt.settings.chain_id, "chainMode": rt.settings.chain_mode,
               "agentMode": rt.workflow.agent.mode, "demo": rt.settings.demo_mode, "safes": s.safes,
               "module": rt.settings.addresses.module, "inProcessWorkers": rt.in_process, "time": int(time.time())}
        try:
            out["block"] = rt.chain.block_number()
            out["chain"] = "ok"
        except Exception as e:
            out["ok"] = False
            out["chain"] = f"unreachable: {type(e).__name__}"
        return out

    @app.post("/api/session")
    def create_session(body: SessionBody):
        result = rt.sessions.create(body.role, body.address, body.signature, body.issuedAt)
        resp = JSONResponse(result)
        resp.set_cookie("aegis_session", result["token"], httponly=True, samesite="lax", max_age=12 * 3600)
        return resp

    @app.get("/api/treasury")
    def treasury(safe: str | None = None, sess: Session = Depends(session_dep)):
        return treasury_view(snap_for(resolve_safe(sess, safe)))

    @app.get("/api/obligations")
    def list_obligations(safe: str | None = None, sess: Session = Depends(session_dep)):
        target = resolve_safe(sess, safe)
        snap = snap_for(target)
        return {"obligations": [obligation_json(o) for o in s.obligations.list(target)],
                "reserve": {"required": amount(snap.reserve.required), "buffer": amount(snap.reserve.buffer),
                            "peakNetOutflow": amount(snap.reserve.peak_net_outflow),
                            "onchainFloor": amount(snap.state.policy.reserve_floor), "inSync": snap.plan.in_sync,
                            "scheduleHash": snap.reserve.schedule_hash}}

    @app.post("/api/obligations")
    def add_obligation(body: ObligationBody, sess: Session = Depends(owner_dep)):
        try:
            raw = parse_raw(body.amount)
            due = parse_due(body.dueDate)
        except (ValueError, TypeError) as e:
            raise WorkflowError(400, "BadObligation", str(e)) from None
        label = body.label.strip()
        if not label:
            raise WorkflowError(400, "BadObligation", "label required")
        ob = s.obligations.add(sess.safe, label, raw, due, inflow=bool(body.confirmedInflow))
        upd = floor_update(rt.chain, sess.safe, s.obligations.list(sess.safe, False), rt.chain.block_timestamp(),
                           rt.settings.params)
        s.ledger.append("OBLIGATION_ADDED", sess.safe, {"obligation": obligation_json(ob), "floorUpdate": upd})
        s.bus.publish({"type": "obligation", "safe": sess.safe, "obligation": obligation_json(ob)})
        return {"obligation": obligation_json(ob), "floorUpdate": upd}

    @app.post("/api/obligations/{obligation_id}/settle")
    def settle_obligation(obligation_id: str, sess: Session = Depends(owner_dep)):
        ob = s.obligations.settle(sess.safe, obligation_id)
        if ob is None:
            raise WorkflowError(404, "NotFound", "no unsettled obligation with that id for this Safe")
        upd = floor_update(rt.chain, sess.safe, s.obligations.list(sess.safe, False), rt.chain.block_timestamp(),
                           rt.settings.params)
        s.ledger.append("OBLIGATION_SETTLED", sess.safe, {"obligation": obligation_json(ob), "floorUpdate": upd})
        s.bus.publish({"type": "obligation", "safe": sess.safe, "obligation": obligation_json(ob)})
        return {"obligation": obligation_json(ob), "floorUpdate": upd}

    @app.get("/api/risk")
    def risk(safe: str | None = None, sess: Session = Depends(session_dep)):
        snap = snap_for(resolve_safe(sess, safe))
        return {"safe": snap.state.safe, **snap.risk.to_json()}

    @app.get("/api/oracle")
    def oracle():
        r = rt.chain.latest_round()
        now = rt.chain.block_timestamp()
        limit = rt.settings.params.default_max_oracle_age
        if s.safes:
            limit = s.chain.policy(s.safes[0], []).max_oracle_age or limit
        age = max(0, now - r.updated_at)
        return {"price": price(r.answer), "roundId": r.round_id, "updatedAt": r.updated_at, "ageSeconds": age,
                "stale": age > limit, "maxOracleAge": limit,
                "pegDeviationPct": round(abs(r.answer - PRICE_ONE) / PRICE_ONE * 100, 4)}

    @app.post("/api/agent/chat")
    def chat(body: ChatBody, sess: Session = Depends(owner_dep)):
        return rt.workflow.chat(sess, body.message, body.requestId)

    @app.get("/api/requests/{request_id}")
    def get_request(request_id: str, sess: Session = Depends(session_dep)):
        return rt.workflow.view(sess, request_id)

    @app.post("/api/requests/{request_id}/approval")
    def approve(request_id: str, body: ApprovalBody, sess: Session = Depends(session_dep)):
        return rt.workflow.approve(sess, request_id, body.signature, body.approval)

    @app.post("/api/requests/{request_id}/deny")
    def deny(request_id: str, body: DenyBody, sess: Session = Depends(session_dep)):
        return rt.workflow.deny(sess, request_id, body.reason or "")

    @app.post("/api/requests/{request_id}/correct")
    def correct(request_id: str, body: CorrectBody, sess: Session = Depends(owner_dep)):
        return rt.workflow.correct(sess, request_id, body.message)

    @app.get("/api/approvals/pending")
    def pending(sess: Session = Depends(session_dep)):
        return {"role": sess.role, "pending": rt.workflow.pending_approvals(sess)}

    @app.get("/api/ledger")
    def ledger(safe: str | None = None, limit: int = Query(200, le=2000), sess: Session = Depends(session_dep)):
        target = resolve_safe(sess, safe) if (sess.role == "owner" or safe) else None
        rows = s.ledger.rows(target, limit=limit)
        if target is None and sess.role == "bank":
            allowed = {x.lower() for x in bank_safes(sess)}
            rows = [r for r in rows if r["safe"] in allowed or r["safe"] is None]
        return {"rows": rows, "integrity": s.ledger.verify()}

    @app.get("/api/events")
    def events(safe: str | None = None, sess: Session = Depends(session_dep)):
        if sess.role == "owner" or safe:
            targets = [resolve_safe(sess, safe)]
        else:
            targets = bank_safes(sess)
        out = []
        for t in targets:
            out.extend(rt.chain.events(t))
        out.sort(key=lambda e: (e.get("blockNumber", 0), e.get("logIndex", 0)))
        return {"events": out}

    @app.get("/api/alerts")
    def alerts(sess: Session = Depends(session_dep)):
        if sess.role == "owner":
            rows = s.db.query("SELECT * FROM alerts WHERE safe=? OR safe IS NULL ORDER BY id DESC LIMIT 100",
                              (sess.safe.lower(),))
        else:
            allowed = {x.lower() for x in bank_safes(sess)}
            rows = [r for r in s.db.query("SELECT * FROM alerts ORDER BY id DESC LIMIT 300")
                    if r["safe"] is None or r["safe"] in allowed]
        return {"alerts": rows}

    @app.get("/api/bank/clients")
    def bank_clients(sess: Session = Depends(bank_dep)):
        clients = []
        for safe in bank_safes(sess):
            snap = snap_for(safe)
            p = snap.state.policy
            rec = reconcile(s.ledger, rt.chain.events(safe), safe)
            awaiting = rt.workflow.store.by_state("AWAITING_APPROVAL", safe)
            clients.append({
                "safe": safe, "owner": p.owner, "riskScore": round(max((v.score for v in snap.risk.vaults),
                                                                         default=0.0), 4),
                "triggers": sorted({t.code for v in snap.risk.vaults for t in v.triggers}),
                "quarantined": [v.address for v in snap.state.vaults if v.quarantined],
                "frozen": {"owner": p.owner_frozen, "bank": p.bank_frozen},
                "pendingEscalations": sum(1 for r in awaiting if r["data"].get("approvalTier", 3) >= 4),
                "pendingApprovals": len(awaiting),
                "mismatches": rec["mismatches"], "reconciliation": rec,
                "totalValue": amount(snap.state.total_value),
                "reserve": {"required": amount(snap.reserve.required), "onchainFloor": amount(p.reserve_floor),
                            "inSync": snap.plan.in_sync},
                "policyVersion": p.policy_version,
                "limits": {"autoCap": amount(p.auto_cap), "dailyCap": amount(p.daily_cap),
                           "bankLimit": amount(p.bank_limit)},
            })
        return {"clients": clients}

    @app.post("/api/demo/scenario")
    def scenario(body: ScenarioBody, sess: Session = Depends(session_dep)):
        if not (rt.settings.demo_mode and rt.settings.is_local_chain):
            raise WorkflowError(403, "DemoDisabled", "scenarios run only on chain 31337 with DEMO_MODE")
        if body.name not in SCENARIOS:
            raise WorkflowError(400, "UnknownScenario", f"one of {SCENARIOS}")
        return run_scenario(rt, sess, body.name, resolve_safe(sess, None))

    @app.post("/api/demo/fake/apply-floor")
    def fake_apply_floor(sess: Session = Depends(owner_dep)):
        """Offline demo only: stands in for the owner wallet sending floorUpdate to the in-memory chain."""
        if rt.settings.chain_mode != "fake":
            raise WorkflowError(404, "NotFound")
        upd = floor_update(rt.chain, sess.safe, s.obligations.list(sess.safe, False), rt.chain.block_timestamp(),
                           rt.settings.params)
        rt.chain.apply_reserve_floor(sess.safe, int(upd["floor"]["raw"]), upd["scheduleHash"])
        s.ledger.append("DEMO_FLOOR_APPLIED", sess.safe, {"floor": upd["floor"], "scheduleHash": upd["scheduleHash"]})
        return {"applied": True, **upd}

    @app.post("/internal/quarantine")
    def internal_quarantine(body: InternalQuarantine, x_aegis_internal: str | None = Header(default=None)):
        if not rt.settings.internal_token or x_aegis_internal != rt.settings.internal_token:
            raise WorkflowError(401, "InternalOnly")
        if not (is_address(body.safe) and is_address(body.vault)) or s.known_safe(body.safe) is None:
            raise WorkflowError(400, "BadRequest")
        dropped = rt.workflow.drop_pending_deposits(body.safe, body.vault)
        return {"dropped": dropped}

    @app.get("/api/stream")
    async def stream(request: Request, session: str | None = None,
                     x_aegis_session: str | None = Header(default=None)):
        token = x_aegis_session or request.cookies.get("aegis_session") or session
        sess = rt.sessions.get(token)
        if sess is None:
            raise WorkflowError(401, "SessionRequired")
        scope = sess.safe if sess.role == "owner" else None
        sid, queue = s.bus.subscribe(scope)
        allowed = {x.lower() for x in bank_safes(sess)} if sess.role == "bank" else None

        async def gen():
            try:
                yield f"event: hello\ndata: {json.dumps({'role': sess.role, 'safe': sess.safe})}\n\n"
                while True:
                    if await request.is_disconnected():
                        break
                    try:
                        ev = await asyncio.wait_for(queue.get(), timeout=15)
                    except TimeoutError:
                        yield ": keepalive\n\n"
                        continue
                    if allowed is not None and ev.get("safe") and str(ev["safe"]).lower() not in allowed:
                        continue
                    yield f"event: {ev.get('type', 'message')}\ndata: {json.dumps(ev, default=str)}\n\n"
            finally:
                s.bus.unsubscribe(sid)

        return StreamingResponse(gen(), media_type="text/event-stream",
                                 headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})

    return app


def run_scenario(rt: Runtime, sess: Session, name: str, safe: str) -> dict:
    s = rt.services
    chain = rt.chain
    admin = load_key("admin", rt.settings.chain_id)
    result: dict = {"scenario": name, "safe": safe}
    if name == "depeg":
        result["tx"] = chain.admin_set_price(admin, 98_500_000)
        result["price"] = price(98_500_000)
    elif name == "liquidity":
        snap = s.snapshot(safe)
        held = [v for v in snap.state.vaults if v.shares] or snap.state.vaults[:1]
        v = max(held, key=lambda x: x.assets)
        cap = v.assets // 2
        result["tx"] = chain.admin_set_liquidity_cap(admin, v.address, cap)
        result["vault"] = {"address": v.address, "name": v.label, "liquidityCap": amount(cap),
                           "position": amount(v.assets)}
    elif name == "stale":
        s.db.kv_set(PAUSE_KEY, True)
        limit = s.chain.policy(safe, []).max_oracle_age or rt.settings.params.default_max_oracle_age
        chain.admin_increase_time(limit + 10)
        result["keeperPaused"] = True
        result["advancedSeconds"] = limit + 10
    elif name == "obligation":
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
    s.ledger.append("DEMO_SCENARIO", safe, {"scenario": name, "by": sess.role,
                                            **{k: v for k, v in result.items() if k not in ("safe",)}})
    s.bus.publish({"type": "scenario", "safe": safe, "name": name})
    return result

