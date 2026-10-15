"""Simulator: module.check view plus an eth_call of the vault leg, and the final signed eth_call."""

from __future__ import annotations

from dataclasses import dataclass

from aegis.chain.base import ChainClient, SimResult
from aegis.eip712 import DAR, OP_DEPOSIT, Approval


@dataclass
class Simulation:
    ok: bool
    error: str | None
    required_tier: int
    expected_out: int
    stage: str

    def to_json(self) -> dict:
        return {"ok": self.ok, "error": self.error, "requiredTier": self.required_tier,
                "expectedOut": str(self.expected_out), "stage": self.stage}


def expected_out(chain: ChainClient, op: int, vault: str, amount: int, safe: str) -> SimResult:
    """Deposit: previewDeposit (an eth_call of vault.deposit from the Safe would need the module's approve
    first). Redeem: eth_call of vault.redeem(shares, safe, safe) from the Safe address."""
    if op == OP_DEPOSIT:
        try:
            return SimResult(True, None, chain.preview_deposit(vault, amount))
        except Exception as e:
            return SimResult(False, f"previewDeposit failed: {e}")
    return chain.sim_vault_redeem(vault, amount, safe)


def check(chain: ChainClient, dar: DAR, approval: Approval | None, out: int) -> Simulation:
    result = chain.module_check(dar, approval or Approval.empty())
    if not result.ok:
        return Simulation(False, result.error, result.required_tier, out, "module.check")
    if out < dar.minOut:
        return Simulation(False, "SlippageExceeded", result.required_tier, out, "vault")
    return Simulation(True, None, result.required_tier, out, "module.check")


def final_signed_call(chain: ChainClient, dar: DAR, auth_sig: str, owner_sig: str | None, bank_sig: str | None,
                      approval: Approval | None, sender: str) -> SimResult:
    if dar.op == OP_DEPOSIT:
        return chain.sim_deposit_submission(dar, auth_sig, owner_sig or "", bank_sig or "",
                                            approval or Approval.empty(), sender)
    return chain.sim_redeem_submission(dar, auth_sig, sender)
