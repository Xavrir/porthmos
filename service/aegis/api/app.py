"""AEGIS API (INTERFACES 2). Every endpoint takes the Safe from the session, never from the body."""

from __future__ import annotations

import asyncio
import functools
import hmac
import json
import logging
import time
from contextlib import asynccontextmanager

from eth_utils import is_address
from fastapi import Depends, FastAPI, Header, Query, Request
from fastapi.encoders import jsonable_encoder
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel

from aegis.api import tradeflow as tradeflow_api
from aegis.attacks import Attacks
from aegis.config import PRICE_ONE
from aegis.core.pipeline import Snapshot
from aegis.ledger import reconcile
from aegis.market import MARKET_SCENARIOS, SCENARIOS, market_state, run_scenario
from aegis.obligations import floor_update, parse_due
from aegis.obligations import to_json as obligation_json
from aegis.onboarding import Onboarding
from aegis.procs.keeper import LAST_POKE_KEY, PAUSE_KEY
from aegis.runtime import Runtime
from aegis.units import amount, parse_raw, price
from aegis.workflow import Session, WorkflowError

log = logging.getLogger("aegis.api")
CHAT_HEARTBEAT = 10.0

class SessionBody(BaseModel):
    message: str | None = None
    signature: str | None = None
    role: str | None = None
    address: str | None = None
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
    vault: str | None = None
    cap: str | int | None = None


class FundBody(BaseModel):
    owner: str
    bank: str
    issuedAt: str | None = None
    signature: str | None = None


class ActivateBody(BaseModel):
    safe: str
    owner: str
    message: str | None = None
    signature: str | None = None
    issuedAt: str | None = None


class AttackBody(BaseModel):
    kind: str


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

    app = FastAPI(title="AEGIS Treasury API", version="2.0", lifespan=lifespan)
    app.add_middleware(CORSMiddleware, allow_origins=rt.settings.allowed_origins,
                       allow_methods=["GET", "POST", "OPTIONS"],
                       allow_headers=["Content-Type", "X-Aegis-Session", "X-Aegis-Admin"], allow_credentials=False)
    s = rt.services
    onboarding = Onboarding(s, rt.sessions)
    attacks = Attacks(s, rt.authorizer)

    @app.exception_handler(WorkflowError)
    async def wf_error(_: Request, exc: WorkflowError):
        return JSONResponse({**exc.extra, "error": exc.code, "detail": exc.detail}, status_code=exc.status)

    def client_ip(request: Request) -> str:
        if rt.settings.trust_proxy:
            forwarded = request.headers.get("x-forwarded-for", "")
            if forwarded.strip():
                # The proxy appends the address it saw last; earlier entries are client-supplied.
                return forwarded.split(",")[-1].strip()
        return request.client.host if request.client else "unknown"

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
        return rt.sessions.bank_safes(sess.address)

    def visible_safes(sess: Session) -> set[str]:
        return {sess.safe.lower()} if sess.role == "owner" else {x.lower() for x in bank_safes(sess)}

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
        out = {
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
        if rt.tradeflow is not None:
            # Committed escrow has left the Safe: it is shown for the full position, never added to L or R.
            out["figures"] = {"cash": amount(st.liquid), "committed": amount(rt.tradeflow.committed(st.safe)),
                              "free": amount(plan.deployable)}
        return out

    @app.get("/api/health")
    def health():
        agent = rt.workflow.agent
        llm_mode = agent.mode
        if agent.llm is not None and agent.gate is not None and agent.gate.exhausted():
            llm_mode = "rate-limited"
        refs = [r["safe"] for r in s.tenants.served() if r["reference"]]
        out = {"ok": True, "service": "aegis-api", "chainId": rt.settings.chain_id, "chainMode": rt.settings.chain_mode,
               "agentMode": agent.mode, "llmMode": llm_mode, "demo": rt.settings.demo_mode,
               "referenceSafe": refs[0] if refs else None, "tenantCount": s.tenants.activated_count(),
               "onboardingOpen": onboarding.is_open(), "module": rt.settings.addresses.module,
               "inProcessWorkers": rt.in_process, "tradeflow": {"enabled": rt.tradeflow is not None},
               "time": int(time.time())}
        out["keeper"] = {"paused": bool(s.db.kv_get(PAUSE_KEY, False)), "lastPoke": s.db.kv_get(LAST_POKE_KEY)}
        try:
            out["block"] = rt.chain.block_number()
            out["blockLagSeconds"] = max(0, out["time"] - rt.chain.head_timestamp())
            oracle = rt.chain.latest_round()
            out["keeper"]["oracleUpdatedAt"] = oracle.updated_at
            out["keeper"]["oracleAgeSeconds"] = max(0, rt.chain.block_timestamp() - oracle.updated_at)
            out["chain"] = "ok"
        except Exception as e:
            out["ok"] = False
            out["chain"] = f"unreachable: {type(e).__name__}"
        return out

    @app.get("/api/auth/nonce")
    def auth_nonce(request: Request):
        resp = JSONResponse(rt.sessions.siwe.issue_nonce(onboarding.ip_hash(client_ip(request))))
        resp.headers["Cache-Control"] = "no-store"
        return resp

    @app.get("/api/auth/roles")
    def auth_roles(address: str, request: Request):
        if not s.limiter.hit("auth_roles_ip", onboarding.ip_hash(client_ip(request)),
                             rt.settings.limits.auth_per_ip_minute, 60):
            raise WorkflowError(429, "RateLimited", "too many requests from this address; wait a minute")
        return rt.sessions.roles(address)

    @app.post("/api/session")
    def create_session(body: SessionBody):
        result = rt.sessions.create(body.role, body.address, body.message, body.signature, body.issuedAt)
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
        out = {"obligations": [obligation_json(o) for o in s.obligations.list(target)],
               "reserve": {"required": amount(snap.reserve.required), "buffer": amount(snap.reserve.buffer),
                           "peakNetOutflow": amount(snap.reserve.peak_net_outflow),
                           "onchainFloor": amount(snap.state.policy.reserve_floor), "inSync": snap.plan.in_sync,
                           "scheduleHash": snap.reserve.schedule_hash}}
        if sess.role == "owner":
            out["floorUpdate"] = floor_update(rt.chain, target, s.obligations.list(target, False),
                                              rt.chain.block_timestamp(), rt.settings.params)
        return out

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

    def chat_turn(sess: Session, body: ChatBody, stream=None) -> dict:
        lim = rt.settings.limits
        if not s.limiter.hit("chat", sess.safe.lower(), lim.chat_per_tenant, lim.chat_window):
            raise WorkflowError(429, "RateLimited", f"at most {lim.chat_per_tenant} chat messages per "
                                                    f"{lim.chat_window // 60} minutes per treasury")
        if stream is None:
            return rt.workflow.chat(sess, body.message[:4000], body.requestId)
        return rt.workflow.chat(sess, body.message[:4000], body.requestId, stream=stream)

    @app.post("/api/agent/chat")
    def chat(body: ChatBody, sess: Session = Depends(owner_dep)):
        return chat_turn(sess, body)

    @app.post("/api/agent/chat/stream")
    async def chat_stream(body: ChatBody, request: Request, x_aegis_session: str | None = Header(default=None)):
        """The chat turn as Server-Sent Events: status, delta and replace while it runs, then done with the exact
        /api/agent/chat body, or error. Session and rate-limit refusals arrive as error events too."""
        loop = asyncio.get_running_loop()
        queue: asyncio.Queue = asyncio.Queue()

        def emit(event: str, data) -> None:
            loop.call_soon_threadsafe(queue.put_nowait, (event, data))

        def work() -> None:
            try:
                sess = owner_dep(session_dep(request, x_aegis_session))
                emit("done", jsonable_encoder(chat_turn(sess, body, emit)))
            except WorkflowError as e:
                emit("error", {"status": e.status, "code": e.code, "detail": e.detail})
            except Exception:
                log.exception("chat stream failed")
                emit("error", {"status": 500, "code": "InternalError", "detail": "the chat request failed"})
            finally:
                loop.call_soon_threadsafe(queue.put_nowait, None)

        # The turn runs to completion even if the client goes away: it is a persisted request, not a view.
        worker = loop.run_in_executor(None, work)

        async def gen():
            while True:
                try:
                    item = await asyncio.wait_for(queue.get(), timeout=CHAT_HEARTBEAT)
                except TimeoutError:
                    yield ": keepalive\n\n"
                    continue
                if item is None:
                    break
                event, data = item
                yield f"event: {event}\ndata: {json.dumps(data, default=str)}\n\n"
            await worker

        return StreamingResponse(gen(), media_type="text/event-stream",
                                 headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})

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
        allowed = visible_safes(sess)
        if target is None and sess.role == "bank":
            rows = [r for r in rows if r["safe"] in allowed or r["safe"] is None]
        integrity = s.ledger.verify()
        broken = [b for b in integrity["broken"] if b["safe"] in allowed or b["safe"] is None]
        return {"rows": rows, "integrity": {"ok": integrity["ok"], "rows": len(rows), "broken": broken}}

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
        safes = bank_safes(sess)

        def escrow_scan() -> list[dict]:
            return rt.chain.escrow_events(0, rt.chain.block_number()) if rt.tradeflow is not None else []

        # Every client's snapshot and both event scans share batched round trips instead of running one by one.
        escrow_events, events, *snaps = rt.chain.gather(
            [escrow_scan, rt.chain.events, *(functools.partial(snap_for, safe) for safe in safes)])
        summaries = rt.chain.gather([functools.partial(rt.tradeflow.bank_summary, safe, escrow_events)
                                     for safe in safes]) if rt.tradeflow is not None else [None] * len(safes)
        for safe, snap, tf in zip(safes, snaps, summaries):
            p = snap.state.policy
            rec = reconcile(s.ledger, [e for e in events if e.get("safe", "").lower() == safe.lower()], safe)
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
            if tf is not None:
                clients[-1]["tradeflow"] = tf
                clients[-1]["mismatches"] += tf["reconciliation"]["mismatches"]
        return {"clients": clients}

    @app.get("/api/market")
    def market():
        return market_state(rt)

    @app.post("/api/demo/scenario")
    def scenario(body: ScenarioBody, request: Request, x_aegis_session: str | None = Header(default=None),
                 x_aegis_admin: str | None = Header(default=None)):
        if body.name not in SCENARIOS:
            raise WorkflowError(400, "UnknownScenario", f"one of {SCENARIOS}")
        token = rt.settings.admin_token
        admin = bool(token) and hmac.compare_digest((x_aegis_admin or "").encode(), token.encode())
        sess = rt.sessions.get(x_aegis_session or request.cookies.get("aegis_session"))
        local_demo = rt.settings.demo_mode and rt.settings.is_local_chain
        if body.name in MARKET_SCENARIOS:
            if not admin and not local_demo:
                raise WorkflowError(403, "AdminRequired", "market scenarios move shared contracts; send X-Aegis-Admin")
        elif not local_demo:
            raise WorkflowError(403, "DemoDisabled", "use POST /api/obligations on this chain")
        if sess is None and not admin:
            raise WorkflowError(401, "SessionRequired", "POST /api/session first and send X-Aegis-Session")
        try:
            cap = parse_raw(body.cap) if body.cap is not None else None
        except (TypeError, ValueError) as e:
            raise WorkflowError(400, "BadCap", str(e)) from None
        safe = resolve_safe(sess, None) if sess else None
        try:
            return run_scenario(rt, body.name, safe, sess.role if sess else "admin", body.vault, cap)
        except RuntimeError as e:
            raise WorkflowError(503, "AdminKeyMissing", str(e)) from None

    @app.get("/api/onboard/config")
    def onboard_config():
        return onboarding.config()

    @app.post("/api/onboard/fund")
    def onboard_fund(body: FundBody, request: Request):
        return onboarding.fund(body.owner, body.bank, body.issuedAt, body.signature, client_ip(request))

    @app.get("/api/onboard/status")
    def onboard_status(owner: str, request: Request):
        return onboarding.status(owner, client_ip(request))

    @app.post("/api/onboard/activate")
    def onboard_activate(body: ActivateBody, request: Request):
        return onboarding.activate(body.safe, body.owner, body.message, body.signature, client_ip(request),
                                   legacy_issued_at=body.issuedAt)

    @app.post("/api/tenant/attack")
    def tenant_attack(body: AttackBody, sess: Session = Depends(owner_dep)):
        return attacks.run(sess.safe, body.kind)

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

    tradeflow_api.register(app, rt, session_dep, owner_dep, visible_safes,
                           lambda request: onboarding.ip_hash(client_ip(request)))

    @app.get("/api/stream")
    async def stream(request: Request, session: str | None = None,
                     x_aegis_session: str | None = Header(default=None)):
        token = x_aegis_session or request.cookies.get("aegis_session") or session
        sess = rt.sessions.get(token)
        if sess is None:
            raise WorkflowError(401, "SessionRequired")
        sid, queue = s.bus.subscribe(visible_safes(sess))

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
                    yield f"event: {ev.get('type', 'message')}\ndata: {json.dumps(ev, default=str)}\n\n"
            finally:
                s.bus.unsubscribe(sid)

        return StreamingResponse(gen(), media_type="text/event-stream",
                                 headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})

    return app

