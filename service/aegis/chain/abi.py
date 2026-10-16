"""Minimal hand-written ABI for the calls the service makes, per docs/INTERFACES.md 1.1 to 1.5 and the TradeEscrow
interface in TECHNICAL-DOCUMENT 04.

When Foundry artifacts exist in contracts/out they are preferred; any function, event or error
missing from them falls back to these definitions.
"""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path

from eth_abi import decode as abi_decode
from eth_abi import encode as abi_encode
from eth_utils import keccak

DAR_TUPLE = (
    "(address safe,uint8 op,address vault,uint256 amount,uint256 minOut,uint64 policyVersion,"
    "int256 priceLow,int256 priceHigh,uint8 tier,bytes32 approvalHash,uint256 nonce,uint64 expiry,"
    "bytes32 evidenceHash)"
)
APPROVAL_TUPLE = (
    "(address safe,uint8 op,address vault,uint256 maxAmount,uint64 policyVersion,uint64 approvalExpiry,"
    "uint256 approvalNonce)"
)

TERMS_TUPLE = (
    "(uint256 amount,address issuer,uint8 kind,bool requireDoc,bool checkTemp,int32 minTempCenti,"
    "int32 maxTempCenti,uint64 deadline)"
)
ORDER_TUPLE = (
    "(address buyer,address supplier,uint64 createdAt,uint8 nextIndex,uint8 status,uint256 total,uint256 released,"
    "bytes32 termsHash)"
)
PROOF_TUPLE = (
    "(uint256 orderId,uint8 index,uint8 kind,bytes32 docHash,int32 minTempCenti,int32 maxTempCenti,uint32 samples,"
    "uint64 issuedAt)"
)
AUTH_TUPLE = (
    "(uint256 orderId,uint8 index,uint256 amount,bytes32 proofHash,uint64 policyVersion,uint256 nonce,uint64 expiry)"
)

SPEC: dict[str, list[str]] = {
    "MockUSDC": [
        "function balanceOf(address owner) view returns (uint256)",
        "function allowance(address owner,address spender) view returns (uint256)",
        "function approve(address spender,uint256 amount) returns (bool)",
        "function mint(address to,uint256 amount)",
        "function transfer(address to,uint256 amount) returns (bool)",
    ],
    "Safe": [
        "function setup(address[] _owners,uint256 _threshold,address to,bytes data,address fallbackHandler,"
        "address paymentToken,uint256 payment,address paymentReceiver)",
        "function execTransaction(address to,uint256 value,bytes data,uint8 operation,uint256 safeTxGas,"
        "uint256 baseGas,uint256 gasPrice,address gasToken,address refundReceiver,bytes signatures) payable "
        "returns (bool)",
        "function enableModule(address module)",
        "function isModuleEnabled(address module) view returns (bool)",
        "function getThreshold() view returns (uint256)",
        "function isOwner(address owner) view returns (bool)",
        "function getOwners() view returns (address[])",
    ],
    "SafeProxyFactory": [
        "function createProxyWithNonce(address _singleton,bytes initializer,uint256 saltNonce) returns (address proxy)",
        "function proxyCreationCode() pure returns (bytes)",
    ],
    "MockPriceFeed": [
        "function latestRoundData() view returns (uint80 roundId,int256 answer,uint256 startedAt,uint256 updatedAt,uint80 answeredInRound)",
        "function setPrice(int256 answer)",
        "function poke()",
    ],
    "MockVault": [
        "function name() view returns (string)",
        "function asset() view returns (address)",
        "function totalAssets() view returns (uint256)",
        "function totalSupply() view returns (uint256)",
        "function balanceOf(address owner) view returns (uint256)",
        "function convertToAssets(uint256 shares) view returns (uint256)",
        "function convertToShares(uint256 assets) view returns (uint256)",
        "function previewDeposit(uint256 assets) view returns (uint256)",
        "function previewRedeem(uint256 shares) view returns (uint256)",
        "function previewWithdraw(uint256 assets) view returns (uint256)",
        "function maxRedeem(address owner) view returns (uint256)",
        "function remainingLiquidity() view returns (uint256)",
        "function deposit(uint256 assets,address receiver) returns (uint256)",
        "function redeem(uint256 shares,address receiver,address owner) returns (uint256)",
        "function setLiquidityCap(uint256 assets)",
        "function accrue(uint256 assets)",
        "function setRevertMode(bool deposit,bool redeem)",
    ],
    "PolicyRegistry": [
        "function owner(address safe) view returns (address)",
        "function bank(address safe) view returns (address)",
        "function authorizer(address safe) view returns (address)",
        "function exitKey(address safe) view returns (address)",
        "function autoCap(address safe) view returns (uint256)",
        "function dailyCap(address safe) view returns (uint256)",
        "function bankLimit(address safe) view returns (uint256)",
        "function reserveFloor(address safe) view returns (uint256)",
        "function scheduleHash(address safe) view returns (bytes32)",
        "function maxBandWidth(address safe) view returns (uint256)",
        "function maxOracleAge(address safe) view returns (uint256)",
        "function ownerFrozen(address safe) view returns (bool)",
        "function bankFrozen(address safe) view returns (bool)",
        "function allowedVault(address safe,address vault) view returns (bool)",
        "function quarantined(address safe,address vault) view returns (bool)",
        "function quarantinedAt(address safe,address vault) view returns (uint256)",
        "function policyVersion(address safe) view returns (uint64)",
        "function setReserveFloor(address safe,uint256 floor,bytes32 scheduleHash)",
        "function quarantine(address safe,address vault)",
        "function revokeAuthorizer(address safe)",
        "function bankUnfreeze(address safe)",
        "function setAuthorizer(address safe,address a)",
        "function clearQuarantine(address safe,address vault)",
        "function register(address safe,address owner_,address bank_)",
        "function addVault(address safe,address vault)",
        "function removeVault(address safe,address vault)",
        "function setExitKey(address safe,address k)",
        "function setAutoCap(address safe,uint256 v)",
        "function setDailyCap(address safe,uint256 v)",
        "function setMaxBandWidth(address safe,uint256 v)",
        "function setMaxOracleAge(address safe,uint256 v)",
        "function setBankLimit(address safe,uint256 v)",
        "function bankFreeze(address safe)",
        "function ownerFreeze(address safe)",
        "function ownerUnfreeze(address safe)",
        "event PolicyChanged(address indexed safe,uint64 version,bytes4 selector)",
        "event Quarantined(address indexed safe,address indexed vault,address by)",
        "error Unauthorized()",
    ],
    "AegisModule": [
        f"function deposit({DAR_TUPLE} dar,bytes authSig,bytes ownerApprovalSig,bytes bankApprovalSig,{APPROVAL_TUPLE} approval)",
        f"function redeem({DAR_TUPLE} dar,bytes sig)",
        f"function check({DAR_TUPLE} dar,{APPROVAL_TUPLE} approval) view returns (bool ok,bytes4 errorSelector,uint8 requiredTier)",
        "function requiredTier(address safe,address vault,uint256 amount) view returns (uint8)",
        f"function hashDAR({DAR_TUPLE} dar) view returns (bytes32)",
        f"function hashApproval({APPROVAL_TUPLE} approval) view returns (bytes32)",
        f"function approvalStructHash({APPROVAL_TUPLE} approval) pure returns (bytes32)",
        "function everDeposited(address safe,address vault) view returns (bool)",
        "function depositedToday(address safe) view returns (uint256)",
        "function usedNonce(address safe,uint256 nonce) view returns (bool)",
        "event AegisExecuted(address indexed safe,bytes32 indexed darHash,uint8 op,address indexed vault,uint256 assets,uint256 shares,uint8 tier,bytes32 evidenceHash)",
    ],
    "TradeEscrow": [
        f"function createOrder(address supplier,uint256 total,bytes32 termsHash,{TERMS_TUPLE}[3] ms) "
        "returns (uint256 orderId)",
        f"function release(uint256 orderId,uint8 index,{PROOF_TUPLE} proof,bytes issuerSig,{AUTH_TUPLE} auth,"
        "bytes authSig)",
        "function waive(uint256 orderId,uint8 index)",
        "function refund(uint256 orderId)",
        f"function checkRelease(uint256 orderId,uint8 index,{PROOF_TUPLE} proof,{AUTH_TUPLE} auth) view "
        "returns (bool ok,bytes4 errorSelector)",
        f"function getOrder(uint256 orderId) view returns ({ORDER_TUPLE})",
        f"function getMilestone(uint256 orderId,uint8 index) view returns ({TERMS_TUPLE},uint8)",
        f"function hashProof({PROOF_TUPLE} proof) view returns (bytes32)",
        f"function proofStructHash({PROOF_TUPLE} proof) pure returns (bytes32)",
        f"function hashAuthorization({AUTH_TUPLE} auth) view returns (bytes32)",
        "function committedOf(address buyer) view returns (uint256)",
        "function usedNonce(address buyer,uint256 nonce) view returns (bool)",
        "function nextOrderId() view returns (uint256)",
        "function escrowedTotal() view returns (uint256)",
        "function registry() view returns (address)",
        "function token() view returns (address)",
        "event OrderCreated(uint256 indexed orderId,address indexed buyer,address indexed supplier,uint256 total,"
        "bytes32 termsHash)",
        "event MilestoneReleased(uint256 indexed orderId,uint8 index,address indexed supplier,uint256 amount,"
        "bytes32 proofHash,bytes32 authHash,bool waived)",
        "event OrderRefunded(uint256 indexed orderId,address indexed buyer,uint256 amount)",
    ],
    "MultiSendCallOnly": [
        "function multiSend(bytes transactions) payable",
    ],
}

MODULE_ERRORS = [
    "Unauthorized", "BadSignature", "WrongOp", "Expired", "NonceUsed", "Frozen", "VaultQuarantined",
    "PolicyVersionMismatch", "VaultNotAllowed", "MissingApproval", "ApprovalMismatch", "ApprovalExceeded",
    "ApprovalExpired", "StaleOracle", "PriceOutOfBand", "BandTooWide", "ReserveFloorBreached",
    "DailyCapExceeded", "NoPosition", "SlippageExceeded", "ExecutionFailed",
]
ESCROW_ERRORS = [
    "Unauthorized", "NotRegistered", "Frozen", "BadSupplier", "BadIssuer", "BadMilestone", "AmountMismatch",
    "BadDeadline", "OrderNotActive", "OutOfOrder", "ProofMismatch", "BadSignature", "BadProofTime", "ConditionNotMet",
    "AuthorizationMismatch", "PolicyVersionMismatch", "Expired", "NonceUsed", "DeadlineNotPassed",
]
EXTRA_ERRORS = ["DepositDisabled", "RedeemDisabled", "NoRound", "ReentrancyGuardReentrantCall",
                "ECDSAInvalidSignature"]

ERROR_SELECTORS: dict[bytes, str] = {
    keccak(text=f"{name}()")[:4]: name for name in MODULE_ERRORS + ESCROW_ERRORS + EXTRA_ERRORS
}
ERROR_SELECTORS[keccak(text="SafeERC20FailedOperation(address)")[:4]] = "SafeERC20FailedOperation"
ERROR_SELECTORS[keccak(text="ECDSAInvalidSignatureLength(uint256)")[:4]] = "ECDSAInvalidSignatureLength"
ERROR_SELECTORS[keccak(text="ECDSAInvalidSignatureS(bytes32)")[:4]] = "ECDSAInvalidSignatureS"
SELECTOR_BY_NAME: dict[str, bytes] = {v: k for k, v in ERROR_SELECTORS.items()}


def _split_params(text: str) -> list[str]:
    parts, depth, cur = [], 0, ""
    for ch in text:
        if ch == "(":
            depth += 1
        elif ch == ")":
            depth -= 1
        if ch == "," and depth == 0:
            parts.append(cur.strip())
            cur = ""
        else:
            cur += ch
    if cur.strip():
        parts.append(cur.strip())
    return parts


def _param(text: str) -> dict:
    text = text.strip()
    if text.startswith("("):
        depth = 0
        for i, ch in enumerate(text):
            if ch == "(":
                depth += 1
            elif ch == ")":
                depth -= 1
                if depth == 0:
                    inner, rest = text[1:i], text[i + 1 :].strip()
                    break
        suffix = ""
        if rest.startswith("["):
            suffix, rest = rest[: rest.index("]") + 1], rest[rest.index("]") + 1 :].strip()
        tokens = rest.split()
        name = tokens[-1] if tokens and tokens[-1] != "indexed" else ""
        return {
            "type": "tuple" + suffix,
            "name": name,
            "components": [_param(p) for p in _split_params(inner)],
            "indexed": "indexed" in tokens,
        }
    tokens = text.split()
    return {
        "type": tokens[0],
        "name": tokens[-1] if len(tokens) > 1 and tokens[-1] != "indexed" else "",
        "indexed": "indexed" in tokens[1:],
    }


def _parse_human(line: str) -> dict:
    kind, rest = line.split(" ", 1)
    name, rest = rest.split("(", 1)
    depth, i = 1, 0
    while depth:
        if rest[i] == "(":
            depth += 1
        elif rest[i] == ")":
            depth -= 1
        i += 1
    params_text, tail = rest[: i - 1], rest[i:]
    entry: dict = {"type": kind, "name": name.strip(), "inputs": [_param(p) for p in _split_params(params_text)]}
    if kind == "function":
        entry["stateMutability"] = "view" if (" view" in tail or " pure" in tail) else "nonpayable"
        entry["outputs"] = []
        if "returns" in tail:
            out = tail.split("returns", 1)[1].strip()[1:-1]
            entry["outputs"] = [_param(p) for p in _split_params(out)]
    return entry


def canonical_type(param: dict) -> str:
    if param["type"].startswith("tuple"):
        suffix = param["type"][len("tuple") :]
        return "(" + ",".join(canonical_type(c) for c in param["components"]) + ")" + suffix
    return param["type"]


@lru_cache(maxsize=None)
def _artifact_abi(contracts_out: str, name: str) -> tuple:
    path = Path(contracts_out) / f"{name}.sol" / f"{name}.json"
    if not path.exists():
        return ()
    try:
        return tuple(json.dumps(e, sort_keys=True) for e in json.loads(path.read_text()).get("abi", []))
    except (OSError, json.JSONDecodeError):
        return ()


class Contract:
    def __init__(self, name: str, contracts_out: Path | str | None = None):
        self.name = name
        entries = [_parse_human(line) for line in SPEC[name]]
        artifact = [json.loads(e) for e in _artifact_abi(str(contracts_out), name)] if contracts_out else []
        self.from_artifact = bool(artifact)
        by_key: dict[tuple, dict] = {}
        for e in entries + artifact:
            if e.get("type") not in ("function", "event", "error"):
                continue
            by_key[(e["type"], e["name"], len(e.get("inputs", [])))] = e
        self.functions = {k[1]: v for k, v in by_key.items() if k[0] == "function"}
        self.events = {k[1]: v for k, v in by_key.items() if k[0] == "event"}
        self.errors = {k[1]: v for k, v in by_key.items() if k[0] == "error"}

    def has(self, fn: str) -> bool:
        return fn in self.functions

    def input_types(self, fn: str) -> list[str]:
        return [canonical_type(p) for p in self.functions[fn]["inputs"]]

    def output_types(self, fn: str) -> list[str]:
        return [canonical_type(p) for p in self.functions[fn]["outputs"]]

    def selector(self, fn: str) -> bytes:
        return keccak(text=f"{fn}({','.join(self.input_types(fn))})")[:4]

    def encode(self, fn: str, *args) -> bytes:
        return self.selector(fn) + abi_encode(self.input_types(fn), list(args))

    def decode(self, fn: str, data: bytes):
        values = abi_decode(self.output_types(fn), data)
        return values[0] if len(values) == 1 else values

    def topic(self, event: str) -> bytes:
        e = self.events[event]
        return keccak(text=f"{event}({','.join(canonical_type(p) for p in e['inputs'])})")

    def decode_log(self, event: str, topics: list[bytes], data: bytes) -> dict:
        e = self.events[event]
        indexed = [p for p in e["inputs"] if p.get("indexed")]
        plain = [p for p in e["inputs"] if not p.get("indexed")]
        out: dict = {}
        for p, t in zip(indexed, topics[1:]):
            out[p["name"]] = abi_decode([canonical_type(p)], t)[0]
        for p, v in zip(plain, abi_decode([canonical_type(p) for p in plain], data)):
            out[p["name"]] = v
        return out


def decode_revert(data: bytes | None) -> str:
    if not data:
        return "Reverted"
    sel = bytes(data[:4])
    if sel in ERROR_SELECTORS:
        return ERROR_SELECTORS[sel]
    if sel == bytes.fromhex("08c379a0"):
        try:
            return f"Error({abi_decode(['string'], bytes(data[4:]))[0]})"
        except Exception:
            return "Error(?)"
    if sel == bytes.fromhex("4e487b71"):
        try:
            return f"Panic({abi_decode(['uint256'], bytes(data[4:]))[0]:#x})"
        except Exception:
            return "Panic(?)"
    return "0x" + bytes(data).hex()


def error_name(selector: bytes) -> str | None:
    if not selector or selector == b"\x00\x00\x00\x00":
        return None
    return ERROR_SELECTORS.get(bytes(selector), "0x" + bytes(selector).hex())
