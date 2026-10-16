"""Demo issuers: server-held keys that stand in for a carrier (eBL), a reefer sensor gateway and a surveyor.

Test infrastructure only. The keys are owned by the API process (C3) and load at the point of use, so a missing key
disables demo proofs and nothing else.
"""

from __future__ import annotations

import json
import secrets

from eth_account import Account
from eth_utils import keccak

from aegis.config import ISSUER_ROLES, Settings, load_issuer_key
from aegis.eip712 import ZERO32
from aegis.tradeflow.typed import KINDS, MilestoneProof, MilestoneTerms, Order, sign_typed

VARIANTS = ("valid", "outOfRange", "corrected")
DEMO_SAMPLES = 96
EXCURSION_CENTI = 140


class DemoIssuers:
    def __init__(self, settings: Settings):
        self.settings = settings

    def _key(self, role: str) -> str | None:
        return load_issuer_key(role, self.settings.chain_id, self.settings.addresses.issuers.get(role))

    def available(self) -> dict[str, bool]:
        return {role: self._key(role) is not None for role in ISSUER_ROLES}

    def for_issuer(self, issuer: str) -> tuple[str, str] | None:
        """(role, key) of the demo issuer whose address is this milestone's issuer, if any."""
        for role in ISSUER_ROLES:
            key = self._key(role)
            if key and Account.from_key(key).address.lower() == issuer.lower():
                return role, key
        return None

    def build(self, role: str, key: str, order: Order, index: int, terms: MilestoneTerms, variant: str,
              latest_block_ts: int) -> tuple[MilestoneProof, str, bytes | None]:
        """issuedAt = max(order.createdAt, latest block timestamp) (C6): never ahead of the chain."""
        if variant not in VARIANTS:
            raise ValueError(f"variant must be one of {VARIANTS}")
        document = json.dumps({"demo": True, "issuer": role, "kind": KINDS[terms.kind], "orderId": order.orderId,
                               "index": index, "variant": variant, "nonce": secrets.token_hex(8)},
                              sort_keys=True).encode()
        doc_hash = keccak(document)
        lo = hi = samples = 0
        if terms.checkTemp:
            quarter = (terms.maxTempCenti - terms.minTempCenti) // 4
            lo, hi, samples = terms.minTempCenti + quarter, terms.maxTempCenti - quarter, DEMO_SAMPLES
        if variant == "outOfRange":
            if terms.checkTemp:
                hi = terms.maxTempCenti + EXCURSION_CENTI
            elif terms.requireDoc:
                doc_hash, document = ZERO32, None
            else:
                raise ValueError("this milestone has no condition that a proof can fail")
        proof = MilestoneProof(order.orderId, index, terms.kind, doc_hash, lo, hi, samples,
                               max(order.createdAt, latest_block_ts))
        signature = sign_typed(key, "MilestoneProof", self.settings.chain_id, self.settings.addresses.trade_escrow,
                               proof)
        return proof, signature, document
