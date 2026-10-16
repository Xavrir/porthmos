"""Merge deployments/<chainId>.tradeflow.json into deployments/<chainId>.json (TD v0.4, C10).

Adds or replaces only the TradeFlow keys (tradeEscrow, multiSendCallOnly, tradeEscrowBlock, issuers) as two lines
placed before the "abis" line. Every other byte of the main file stays the same. The script fails without writing
if any existing key or value would change, if the sidecar was deployed against another registry or token, or, with
--rpc-url, if the chain id differs or an address has no code.

Usage: python scripts/merge_deployment.py --chain-id 31337 [--rpc-url http://127.0.0.1:8545]
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import tempfile
import urllib.request
from pathlib import Path

DEPLOYMENTS_DIR = Path(__file__).resolve().parents[2] / "deployments"
KEYS = ("tradeEscrow", "multiSendCallOnly", "tradeEscrowBlock", "issuers")
ISSUER_ROLES = ("carrier", "sensor", "surveyor")
BLOCK_PREFIXES = ('  "tradeEscrow": ', '  "issuers": ')
ANCHOR = '  "abis": '
ADDRESS = re.compile(r"^0x[0-9a-fA-F]{40}$")


class MergeError(Exception):
    pass


def _address(value: object, name: str) -> str:
    if not isinstance(value, str) or not ADDRESS.match(value) or int(value, 16) == 0:
        raise MergeError(f"{name} is not a non-zero address: {value!r}")
    return value


def validate_sidecar(sidecar: dict, main: dict) -> None:
    if sidecar.get("chainId") != main.get("chainId"):
        raise MergeError(f"chainId mismatch: sidecar {sidecar.get('chainId')} vs main {main.get('chainId')}")
    against = sidecar.get("deployedAgainst") or {}
    for key in ("registry", "usdc"):
        if str(against.get(key, "")).lower() != str(main.get(key, "")).lower():
            raise MergeError(f"sidecar was deployed against another {key}; rerun DeployTradeEscrow.s.sol")
    _address(sidecar.get("tradeEscrow"), "tradeEscrow")
    _address(sidecar.get("multiSendCallOnly"), "multiSendCallOnly")
    block = sidecar.get("tradeEscrowBlock")
    if not isinstance(block, int) or isinstance(block, bool) or block < 0:
        raise MergeError(f"tradeEscrowBlock is not a block number: {block!r}")
    issuers = sidecar.get("issuers")
    if not isinstance(issuers, dict) or set(issuers) != set(ISSUER_ROLES):
        raise MergeError(f"issuers must have exactly {ISSUER_ROLES}")
    for role in ISSUER_ROLES:
        _address(issuers[role], f"issuers.{role}")


def render_block(sidecar: dict) -> str:
    issuers = ", ".join(f'"{role}": "{sidecar["issuers"][role]}"' for role in ISSUER_ROLES)
    return (
        f'  "tradeEscrow": "{sidecar["tradeEscrow"]}", "multiSendCallOnly": "{sidecar["multiSendCallOnly"]}", '
        f'"tradeEscrowBlock": {sidecar["tradeEscrowBlock"]},\n'
        f'  "issuers": {{ {issuers} }},\n'
    )


def merge_text(main_text: str, sidecar: dict) -> str:
    """Returns the merged file text. Raises MergeError if any existing key or value would change."""
    old = json.loads(main_text)
    validate_sidecar(sidecar, old)

    lines = main_text.splitlines(keepends=True)
    base_lines = [line for line in lines if not line.startswith(BLOCK_PREFIXES)]
    base_text = "".join(base_lines)
    try:
        base = json.loads(base_text)
    except json.JSONDecodeError as exc:
        raise MergeError(f"main file has TradeFlow keys in an unexpected layout: {exc}") from exc
    if any(key in base for key in KEYS):
        raise MergeError("main file has TradeFlow keys in an unexpected layout; refusing to rewrite them")
    if {k: v for k, v in old.items() if k not in KEYS} != base:
        raise MergeError("removing the previous TradeFlow lines would change other keys")

    anchors = [i for i, line in enumerate(base_lines) if line.startswith(ANCHOR)]
    if len(anchors) != 1:
        raise MergeError('main file must have exactly one top-level "abis" line to anchor the insert')
    new_lines = base_lines[: anchors[0]] + [render_block(sidecar)] + base_lines[anchors[0] :]
    new_text = "".join(new_lines)

    new = json.loads(new_text)
    if set(new) != set(base) | set(KEYS):
        raise MergeError(f"unexpected key set after merge: {sorted(set(new) ^ (set(base) | set(KEYS)))}")
    for key, value in base.items():
        if json.dumps(new[key], sort_keys=True) != json.dumps(value, sort_keys=True):
            raise MergeError(f"existing key {key!r} would change")
    if "".join(line for line in new_text.splitlines(keepends=True) if not line.startswith(BLOCK_PREFIXES)) != base_text:
        raise MergeError("existing bytes would change")
    for key in KEYS:
        if new[key] != sidecar[key]:
            raise MergeError(f"merged {key!r} does not equal the sidecar value")
    return new_text


def _rpc(url: str, method: str, params: list) -> object:
    body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params}).encode()
    req = urllib.request.Request(url, data=body, headers={"content-type": "application/json"})
    with urllib.request.urlopen(req, timeout=10) as resp:
        reply = json.load(resp)
    if "error" in reply:
        raise MergeError(f"{method} failed: {reply['error']}")
    return reply["result"]


def check_chain(rpc_url: str, sidecar: dict) -> None:
    chain_id = int(_rpc(rpc_url, "eth_chainId", []), 16)
    if chain_id != sidecar["chainId"]:
        raise MergeError(f"RPC chain id {chain_id} does not match {sidecar['chainId']}")
    for key in ("tradeEscrow", "multiSendCallOnly"):
        if _rpc(rpc_url, "eth_getCode", [sidecar[key], "latest"]) in ("0x", "0x0", None):
            raise MergeError(f"{key} {sidecar[key]} has no code on {rpc_url}")


def _write_atomic(path: Path, text: str) -> None:
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=f".{path.name}.")
    try:
        with os.fdopen(fd, "w", newline="") as fh:
            fh.write(text)
        os.replace(tmp, path)
    except BaseException:
        Path(tmp).unlink(missing_ok=True)
        raise


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--chain-id", type=int, required=True)
    parser.add_argument("--rpc-url", help="also check the chain id and that both addresses have code")
    parser.add_argument("--deployments-dir", type=Path, default=DEPLOYMENTS_DIR)
    args = parser.parse_args(argv)

    main_path = args.deployments_dir / f"{args.chain_id}.json"
    sidecar_path = args.deployments_dir / f"{args.chain_id}.tradeflow.json"
    try:
        main_text = main_path.read_text()
        sidecar = json.loads(sidecar_path.read_text())
        merged = merge_text(main_text, sidecar)
        if args.rpc_url:
            check_chain(args.rpc_url, sidecar)
    except (OSError, json.JSONDecodeError, MergeError) as exc:
        print(f"merge_deployment: {exc}", file=sys.stderr)
        return 1
    if merged == main_text:
        print(f"{main_path} already up to date")
        return 0
    _write_atomic(main_path, merged)
    print(f"merged {sidecar_path.name} into {main_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
