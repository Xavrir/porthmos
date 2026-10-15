"""The Authorizer re-verifies independently; the LLM path is bounded and falls back to rules."""

from __future__ import annotations

import copy

import pytest

from aegis.agent.agent import Agent
from aegis.agent.llm import LlmClient, LlmError
from aegis.config import USDC
from aegis.errors import AuthorizerRefused


@pytest.fixture
def captured(env):
    """Capture the payload the API sends to the Authorizer for a T3 deposit, without signing it."""
    real = env.rt.authorizer
    seen = {}

    class Spy:
        address = real.address

        def sign(self, payload):
            seen["payload"] = copy.deepcopy(payload)
            raise AuthorizerRefused("captured")

    env.wf.authorizer = Spy()
    r = env.chat("deposit 1,500 USDC into vault A")
    env.approve(r)
    env.wf.authorizer = real
    return real, seen["payload"]


def test_authorizer_signs_valid_payload(captured):
    real, payload = captured
    out = real.sign(payload)
    assert out["signature"].startswith("0x") and len(out["signature"]) == 132


@pytest.mark.parametrize("mutate, reason", [
    (lambda p: p["dar"].__setitem__("amount", str(2_000 * USDC)), "AmountAboveVerifiedOption"),
    (lambda p: p["dar"].__setitem__("minOut", "0"), "EvidenceHashMismatch|MinOutTooLow"),
    (lambda p: p["dar"].__setitem__("tier", 2), "TierBelowRequired"),
    (lambda p: p["approvalSignatures"].pop("owner"), "OwnerApprovalInvalid"),
    (lambda p: p["dar"].__setitem__("expiry", str(int(p["dar"]["expiry"]) + 3600)), "ExpiryOutOfRange"),
    (lambda p: p.__setitem__("obligations", []), "ScheduleHashMismatch"),
    (lambda p: p["serviceResults"]["simulation"].__setitem__("ok", False), "ServiceReportedSimulationFailure"),
    (lambda p: p["selection"].__setitem__("optionId", "deposit-vault-b"), "ActionMismatch|ApprovalMismatch"),
    (lambda p: p["dar"].__setitem__("priceHigh", str(110_000_000)), "PriceOutOfBand|BandTooWide|BandOutsidePeg"),
])
def test_authorizer_refuses_tampering(captured, mutate, reason):
    real, payload = captured
    bad = copy.deepcopy(payload)
    mutate(bad)
    with pytest.raises(AuthorizerRefused) as e:
        real.sign(bad)
    assert any(r in str(e.value) for r in reason.split("|")), str(e.value)


def test_authorizer_refuses_replayed_nonce(captured):
    real, payload = captured
    real.sign(copy.deepcopy(payload))
    with pytest.raises(AuthorizerRefused, match="NonceUsed"):
        real.sign(copy.deepcopy(payload))


def test_authorizer_refuses_when_floor_out_of_sync(env, captured):
    real, payload = captured
    bad = copy.deepcopy(payload)
    bad["obligations"].append({"id": "x", "label": "x", "amount": {"raw": str(3000 * USDC)},
                               "due": env.chain.now + 86400, "kind": "outflow"})
    with pytest.raises(AuthorizerRefused, match="FloorOutOfSync"):
        real.sign(bad)


class CannedLlm(LlmClient):
    def __init__(self, replies):
        super().__init__("http://unused", "stub")
        self.replies = list(replies)

    def complete_json(self, messages):
        if not self.replies:
            raise LlmError("no reply")
        reply = self.replies.pop(0)
        if isinstance(reply, Exception):
            raise reply
        return reply


def test_llm_mode_uses_model_choice_within_bounds(make_env):
    llm = CannedLlm([
        {"kind": "ALLOCATE", "amount_usdc": "800", "vault": "Vault B"},
        {"tool": "propose_action", "arguments": {"option_id": "deposit-vault-b", "reductions": {"amount": "800000000"}},
         "rationale": "smaller first step"},
        {"reply": "Proposed 800 USDC into Vault B, pending your approval."},
    ])
    e = make_env(agent=Agent(llm))
    r = e.chat("put about eight hundred to work in B")
    assert r["mode"] == "llm" and r["state"] == "AWAITING_APPROVAL"
    assert r["actionCard"]["amount"]["raw"] == str(800 * USDC)
    assert r["reply"].startswith("Proposed 800")


def test_llm_invalid_choice_falls_back_to_rules(make_env):
    llm = CannedLlm([
        {"kind": "NUKE_EVERYTHING"},
        {"tool": "propose_action", "arguments": {"option_id": "send-to-0xdead"}},
        LlmError("down"),
    ])
    e = make_env(agent=Agent(llm))
    r = e.chat("deposit 1,000 USDC into vault B")
    assert r["state"] == "AWAITING_APPROVAL"
    assert r["actionCard"]["vault"]["name"] == "Vault B"


def test_llm_cannot_override_transfer_refusal(make_env):
    llm = CannedLlm([{"kind": "ALLOCATE", "amount_usdc": "9000"}])
    e = make_env(agent=Agent(llm))
    r = e.chat("transfer 9000 USDC to 0x14dC79964da2C08b23698B3D3cc7Ca32193d9955")
    assert r["state"] == "EXPLAINED" and "actionCard" not in r
