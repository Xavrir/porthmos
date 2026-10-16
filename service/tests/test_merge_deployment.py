"""TD v0.4 C10: merging the TradeFlow sidecar never changes an existing key or value of deployments/<chainId>.json."""

from __future__ import annotations

import importlib.util
import json
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "merge_deployment.py"
_spec = importlib.util.spec_from_file_location("merge_deployment", SCRIPT)
merge = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(merge)

MAIN = """{
  "chainId": 31337,
  "usdc": "0x5FbDB2315678afecb367f032d93F642f64180aa3", "priceFeed": "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512",
  "registry": "0xa513E6E4b8f2a923D98304ec87F64353C4D5C853", "module": "0x2279B7A0a67DB372996a5FaB50D91eAA73d2eBe6",
  "roles": { "owner": "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" },
  "params": { "autoCap": "1000000000", "maxOracleAge": 180 },
  "abis": "contracts/out (forge artifacts)"
}
"""


def _sidecar(escrow: str = "0x" + "11" * 20) -> dict:
    return {
        "chainId": 31337,
        "deployedAgainst": {
            "registry": "0xa513E6E4b8f2a923D98304ec87F64353C4D5C853",
            "usdc": "0x5FbDB2315678afecb367f032d93F642f64180aa3",
        },
        "tradeEscrow": escrow,
        "multiSendCallOnly": "0x" + "22" * 20,
        "tradeEscrowBlock": 42,
        "issuers": {"carrier": "0x" + "33" * 20, "sensor": "0x" + "44" * 20, "surveyor": "0x" + "55" * 20},
    }


def _without_block(text: str) -> str:
    return "".join(line for line in text.splitlines(keepends=True) if not line.startswith(merge.BLOCK_PREFIXES))


def test_merge_adds_keys_and_keeps_every_existing_byte():
    merged = merge.merge_text(MAIN, _sidecar())
    assert _without_block(merged) == MAIN
    data = json.loads(merged)
    assert data["tradeEscrow"] == "0x" + "11" * 20
    assert data["tradeEscrowBlock"] == 42
    assert data["issuers"]["sensor"] == "0x" + "44" * 20
    assert {k: v for k, v in data.items() if k not in merge.KEYS} == json.loads(MAIN)


def test_remerge_is_idempotent_and_replaces_only_tradeflow_keys():
    first = merge.merge_text(MAIN, _sidecar())
    assert merge.merge_text(first, _sidecar()) == first
    second = merge.merge_text(first, _sidecar("0x" + "66" * 20))
    assert json.loads(second)["tradeEscrow"] == "0x" + "66" * 20
    assert _without_block(second) == MAIN


def test_refuses_stale_or_malformed_sidecar():
    stale = _sidecar()
    stale["deployedAgainst"]["registry"] = "0x" + "77" * 20
    with pytest.raises(merge.MergeError, match="another registry"):
        merge.merge_text(MAIN, stale)
    wrong_chain = _sidecar()
    wrong_chain["chainId"] = 84532
    with pytest.raises(merge.MergeError, match="chainId"):
        merge.merge_text(MAIN, wrong_chain)
    no_issuer = _sidecar()
    del no_issuer["issuers"]["surveyor"]
    with pytest.raises(merge.MergeError, match="issuers"):
        merge.merge_text(MAIN, no_issuer)


def test_refuses_existing_tradeflow_key_in_unexpected_layout():
    edited = MAIN.replace('  "abis"', '  "params2": 1, "tradeEscrow": "0x' + "99" * 20 + '",\n  "abis"')
    with pytest.raises(merge.MergeError, match="unexpected layout"):
        merge.merge_text(edited, _sidecar())


def test_cli_writes_main_file(tmp_path):
    (tmp_path / "31337.json").write_text(MAIN)
    (tmp_path / "31337.tradeflow.json").write_text(json.dumps(_sidecar()))
    assert merge.main(["--chain-id", "31337", "--deployments-dir", str(tmp_path)]) == 0
    assert _without_block((tmp_path / "31337.json").read_text()) == MAIN
    (tmp_path / "31337.tradeflow.json").write_text("{}")
    assert merge.main(["--chain-id", "31337", "--deployments-dir", str(tmp_path)]) == 1
