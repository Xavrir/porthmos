"""TradeFlow API (TECHNICAL-DOCUMENT 02, TradeFlow API additions).

Owner and bank transactions are never returned: the web encodes createOrder, waive and refund itself against pinned
addresses (C1). The public order view carries on-chain fields only; the full view needs an owner or bank session of
the buyer (C9). Proof submissions pass admission before anything is written (C4).
"""

from __future__ import annotations

import base64
import binascii
import json

from fastapi import Depends, FastAPI, Header, Request
from pydantic import BaseModel
from starlette.concurrency import run_in_threadpool

from aegis.runtime import Runtime
from aegis.tradeflow.milestones import TradeFlow
from aegis.workflow import Session, WorkflowError


class DemoProofBody(BaseModel):
    index: int
    variant: str = "valid"


class ConfirmBody(BaseModel):
    index: int
    proofHash: str
    expiry: int | str
    signature: str


class LinkBody(BaseModel):
    obligationId: str


def register(app: FastAPI, rt: Runtime, session_dep, owner_dep, visible_safes, ip_hash) -> None:
    s = rt.services
    settings = rt.settings

    def need() -> TradeFlow:
        if rt.tradeflow is None:
            raise WorkflowError(503, "TradeFlowDisabled", "TradeFlow is not configured on this deployment")
        return rt.tradeflow

    def optional_session(request: Request, x_aegis_session: str | None = Header(default=None)) -> Session | None:
        return rt.sessions.get(x_aegis_session or request.cookies.get("aegis_session"))

    @app.get("/api/tradeflow/config")
    def config():
        if rt.tradeflow is None:
            return {"enabled": False}
        a, lim = settings.addresses, settings.tradeflow
        return {
            "enabled": True, "chainId": settings.chain_id, "tradeEscrow": a.trade_escrow,
            "multiSendCallOnly": a.multi_send_call_only, "token": a.usdc, "issuers": a.issuers,
            "demoIssuers": rt.tradeflow.issuers.available(),
            "limits": {"demoProofsPerTenantHour": lim.demo_proofs_per_tenant_hour,
                       "proofSubmissionsPerOrderHour": lim.proofs_per_order_hour,
                       "rejectedSubmissionsPerIpHour": lim.rejects_per_ip_hour,
                       "maxActiveOrders": lim.max_active_orders, "maxDocumentBytes": lim.max_document_bytes,
                       "authorizationExpirySeconds": lim.auth_expiry,
                       "confirmationExpirySeconds": lim.confirmation_expiry},
        }

    @app.get("/api/tradeflow/orders")
    def orders(sess: Session = Depends(session_dep)):
        return {"orders": need().orders_for(visible_safes(sess))}

    @app.get("/api/tradeflow/orders/{order_id}")
    def order(order_id: int, sess: Session | None = Depends(optional_session)):
        tf = need()
        row = tf.order_row(order_id) if order_id > 0 else None
        if row is not None and sess is not None and row["buyer"] in visible_safes(sess):
            return tf.full_view(order_id)
        view = tf.public_view(order_id) if order_id > 0 else None
        if view is None:
            raise WorkflowError(404, "NotFound")
        return view

    @app.post("/api/tradeflow/orders/{order_id}/proofs")
    async def submit_proof(order_id: int, request: Request):
        tf = need()
        lim = settings.tradeflow
        ip = ip_hash(request)
        if s.limiter.count("tf_reject_ip", ip, 3600) >= lim.rejects_per_ip_hour:
            raise WorkflowError(429, "RateLimited", "too many rejected proof submissions from this address")

        def rejected(err: WorkflowError) -> WorkflowError:
            s.limiter.hit("tf_reject_ip", ip, lim.rejects_per_ip_hour, 3600)
            return err

        cap = lim.max_document_bytes * 4 // 3 + 64 * 1024
        body = bytearray()
        async for chunk in request.stream():
            body += chunk
            if len(body) > cap:
                raise rejected(WorkflowError(413, "DocumentTooLarge",
                                             f"documents are limited to {lim.max_document_bytes} bytes"))
        try:
            data = json.loads(body or b"{}")
            if not isinstance(data, dict):
                raise ValueError("body must be a JSON object")
            doc = data.get("document")
            document = base64.b64decode(doc, validate=True) if doc is not None else None
        except (ValueError, TypeError, binascii.Error) as e:
            raise rejected(WorkflowError(400, "MalformedRequest", str(e))) from None
        try:
            return await run_in_threadpool(tf.submit_proof, order_id, data.get("index"), data.get("proof"),
                                           data.get("signature"), document)
        except WorkflowError as e:
            if e.extra.get("admitted") is False:
                raise rejected(e) from None
            raise

    @app.post("/api/tradeflow/orders/{order_id}/proofs/demo")
    def demo_proof(order_id: int, body: DemoProofBody, sess: Session = Depends(owner_dep)):
        return need().demo_proof(sess, order_id, body.index, body.variant)

    @app.post("/api/tradeflow/orders/{order_id}/confirm")
    def confirm(order_id: int, body: ConfirmBody, sess: Session = Depends(owner_dep)):
        return need().confirm(sess, order_id, body.index, body.proofHash, body.expiry, body.signature)

    @app.post("/api/tradeflow/orders/{order_id}/link")
    def link(order_id: int, body: LinkBody, sess: Session = Depends(owner_dep)):
        return need().link_obligation(sess, order_id, body.obligationId)
