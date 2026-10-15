# AEGIS Treasury: Shared Interface Spec (v1)

This is the contract between the three workstreams (contracts, service, web). The design source of truth is `docs/TECHNICAL-DOCUMENT.md` (v0.2). If this spec and the technical document disagree, stop and report; do not improvise.

## Repository layout

```
fintechathon-2026/
  contracts/      Foundry project (Solidity 0.8.x)
  service/        Python 3.12 (uv), FastAPI service + authorizer + exit agent + keeper + executor
  web/            React + Vite + TypeScript + viem/wagmi
  deployments/    <chainId>.json written by the deploy script, read by service and web
  docs/           design documents (this file)
```

Chains: local Anvil `31337` (development and CI), Base Sepolia `84532` (evidence).

Units: MockUSDC has 6 decimals. All on-chain amounts are raw integers. The API returns amounts as decimal strings of raw units plus a `display` string. Prices from the feed have 8 decimals (1.00000000 = 100000000).

## 1. Contracts

### 1.1 MockUSDC (ERC-20, 6 decimals)
`mint(address to, uint256 amount)` open on 31337, owner-only otherwise.

### 1.2 MockPriceFeed (Chainlink AggregatorV3Interface, 8 decimals)
- `latestRoundData() returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)`
- `setPrice(int256 answer)` (admin): new round, `updatedAt = block.timestamp`.
- `poke()` (admin or keeper): new round with the same answer, `updatedAt = block.timestamp`.

### 1.3 MockVault (ERC-4626 over MockUSDC, OpenZeppelin ERC4626)
- Admin `setLiquidityCap(uint256 assets)`: `maxWithdraw`/`maxRedeem` are limited so that at most `assets` can leave in total until changed (`type(uint256).max` = unlimited).
- Admin `accrue(uint256 assets)`: mints assets into the vault to simulate yield.
- Admin `setRevertMode(bool deposit, bool redeem)`: forces `deposit`/`redeem` to revert (test C25).
- Standard `deposit`, `redeem`, `previewRedeem`, `maxRedeem`, `balanceOf`, `convertToAssets`.

### 1.4 PolicyRegistry
Per-Safe policy. Every state-changing call increments `policyVersion[safe]` and emits `PolicyChanged(safe, version, bytes4 selector)`.

Storage per Safe:
```
owner, bank, authorizer, exitKey
autoCap, dailyCap, bankLimit, reserveFloor, scheduleHash
maxBandWidth (price units, 8 decimals), maxOracleAge (seconds)
ownerFrozen, bankFrozen
allowedVault[vault] bool, quarantined[vault] bool, quarantinedAt[vault]
policyVersion
```

Functions and role matrix (revert `Unauthorized()` otherwise):

| Function | Owner | Bank | Exit key |
|---|---|---|---|
| `register(safe, owner, bank)` | called once by the Safe owner (msg.sender == owner) | | |
| `addVault(safe, vault)` | yes | | |
| `removeVault(safe, vault)` | yes | yes | |
| `setAutoCap(safe, v)`, `setDailyCap(safe, v)`, `setMaxBandWidth(safe, v)` | any value | only if lower than current | |
| `setMaxOracleAge(safe, v)` | any value | only if lower | |
| `setBankLimit(safe, v)` | | yes | |
| `setReserveFloor(safe, floor, scheduleHash)` | yes | | |
| `setAuthorizer(safe, a)`, `setExitKey(safe, k)` | yes | | |
| `revokeAuthorizer(safe)` | yes | yes (also sets `bankFrozen = true`) | |
| `ownerFreeze(safe)`, `ownerUnfreeze(safe)` | yes | | |
| `bankFreeze(safe)`, `bankUnfreeze(safe)` | | yes | |
| `quarantine(safe, vault)` | yes | yes | yes |
| `clearQuarantine(safe, vault)` | yes, and only if `block.timestamp >= quarantinedAt + 24 hours` | | |

### 1.5 AegisModule (Safe module)

Enabled on the Safe. Reads the registry. Calls the Safe with `execTransactionFromModuleReturnData` and requires success for every inner call.

Enums: `Op { DEPOSIT = 0, REDEEM = 1 }`, `Tier { T0, T1, T2, T3, T4 }`.

EIP-712 domain: `name = "AegisModule"`, `version = "1"`, `chainId`, `verifyingContract = module address`.

```solidity
struct Approval {
  address safe; uint8 op; address vault; uint256 maxAmount;
  uint64 policyVersion; uint64 approvalExpiry; uint256 approvalNonce;
}
struct DAR {
  address safe; uint8 op; address vault; uint256 amount; uint256 minOut;
  uint64 policyVersion; int256 priceLow; int256 priceHigh; uint8 tier;
  bytes32 approvalHash; uint256 nonce; uint64 expiry; bytes32 evidenceHash;
}
```
Typehashes are the standard EIP-712 encodings of the two structs above with these exact field orders. `approvalHash` = EIP-712 struct hash (`hashStruct`) of the Approval, or `bytes32(0)` for T1/T2.

Functions:
```solidity
function deposit(DAR calldata dar, bytes calldata authSig,
                 bytes calldata ownerApprovalSig, bytes calldata bankApprovalSig,
                 Approval calldata approval) external;   // anyone may call
function redeem(DAR calldata dar, bytes calldata sig) external; // anyone may call
function check(DAR calldata dar, Approval calldata approval)
    external view returns (bool ok, bytes4 errorSelector, uint8 requiredTier);
function requiredTier(address safe, address vault, uint256 amount) external view returns (uint8);
function hashDAR(DAR calldata) external view returns (bytes32);      // full EIP-712 digest
function hashApproval(Approval calldata) external view returns (bytes32); // full EIP-712 digest
function approvalStructHash(Approval calldata) external pure returns (bytes32);
function everDeposited(address safe, address vault) external view returns (bool);
function depositedToday(address safe) external view returns (uint256); // UTC day bucket
function usedNonce(address safe, uint256 nonce) external view returns (bool);
```

`redeem` checks (in order): signer is registry `authorizer` or `exitKey` for `dar.safe`; `op == REDEEM`; not expired; nonce unused (mark used); `everDeposited[safe][vault]` (spec v1.1 tightening; delisted or quarantined vaults stay redeemable); Safe holds shares of `vault`; `shares = dar.amount`; call `vault.redeem(shares, safe, safe)`; measure USDC delta of the Safe; require delta ≥ `minOut`; emit. Does NOT check freezes, policyVersion, allowlist, quarantine or oracle.

`deposit` checks (in order): `op == DEPOSIT`; not owner-frozen, not bank-frozen; vault not quarantined; `policyVersion` matches; vault allowed; tier = max(requiredTier(safe, vault, amount), dar.tier) where requiredTier is T4 if amount > bankLimit (bankLimit 0 means no bank requirement), else T3 if amount > autoCap or !everDeposited, else T2; signer of DAR is the authorizer (exit key rejected); for T3/T4 verify owner approval sig (and bank for T4), `approvalStructHash(approval) == dar.approvalHash`, approval fields match (safe, op, vault), `amount ≤ maxAmount`, approval `policyVersion` matches, unexpired, approval nonce unused (mark used); DAR not expired, nonce unused (mark used); oracle `updatedAt` within `maxOracleAge`, answer within band, `priceHigh − priceLow ≤ maxBandWidth`; USDC balance of Safe − amount ≥ reserveFloor; depositedToday + amount ≤ dailyCap; execute approve(amount), deposit(amount, safe), approve(0); measure shares delta ≥ minOut; set everDeposited; add to depositedToday; emit.

Errors (exact names, used by service and web for display):
```
Unauthorized() BadSignature() WrongOp() Expired() NonceUsed() Frozen() VaultQuarantined()
PolicyVersionMismatch() VaultNotAllowed() MissingApproval() ApprovalMismatch() ApprovalExceeded()
ApprovalExpired() StaleOracle() PriceOutOfBand() BandTooWide() ReserveFloorBreached()
DailyCapExceeded() NoPosition() SlippageExceeded() ExecutionFailed()
```

Events:
```solidity
event AegisExecuted(address indexed safe, bytes32 indexed darHash, uint8 op, address indexed vault,
                    uint256 assets, uint256 shares, uint8 tier, bytes32 evidenceHash);
event PolicyChanged(address indexed safe, uint64 version, bytes4 selector);   // registry
event Quarantined(address indexed safe, address indexed vault, address by);    // registry
```

### 1.6 Deployment artifact
`deployments/<chainId>.json`:
```json
{
  "chainId": 31337,
  "usdc": "0x..", "priceFeed": "0x..", "vaultA": "0x..", "vaultB": "0x..",
  "registry": "0x..", "module": "0x..", "safe": "0x..",
  "safeSingleton": "0x..", "safeProxyFactory": "0x..",
  "roles": { "owner": "0x..", "bank": "0x..", "authorizer": "0x..", "exitKey": "0x..", "executor": "0x..", "keeper": "0x.." },
  "params": { "autoCap": "1000000000", "dailyCap": "5000000000", "bankLimit": "3000000000",
              "reserveFloor": "4500000000", "maxBandWidth": "2000000", "maxOracleAge": 180 },
  "abis": "contracts/out (forge artifacts)"
}
```
Local roles use Anvil default accounts: index 0 deployer/admin, 1 owner, 2 bank, 3 authorizer, 4 exit key, 5 executor, 6 keeper, 7 attacker. These keys are public Anvil test keys and must never be used on a public network.

## 2. Service (FastAPI, `http://localhost:8787`)

Processes: `api` (FastAPI + agent + engines + ledger), `authorizer` (holds AUTHORIZER_KEY, HTTP on 8788, internal only), `exit_agent` (holds EXIT_KEY, loop), `executor` (EXECUTOR_KEY, submits), `keeper` (KEEPER_KEY, pokes feed every 60 s). On 31337 a single `make dev` may run them as separate processes.

Session: header `X-Aegis-Session: <token>`. `POST /api/session {role: "owner"|"bank", address}` returns a token bound to one Safe (owner) or read-only all Safes (bank). Every tool and endpoint takes the Safe from the session, never from the body or the LLM.

LLM: OpenAI-compatible via `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL`. If unset, the agent runs in deterministic mode (rule-based intent parsing, template explanations). Every feature must work in deterministic mode.

Endpoints (JSON; amounts as `{ "raw": "4500000000", "display": "4,500.00" }`):
```
GET  /api/health
POST /api/session
GET  /api/treasury            -> balances (safe USDC, per-vault shares+assets), reserve {required, onchainFloor, inSync}, deployable, policy {autoCap, dailyCap, bankLimit, frozen{owner,bank}, version}
GET  /api/obligations         -> list
POST /api/obligations         -> add {label, amount, dueDate, confirmedInflow?}; returns {obligation, floorUpdate: {to, data, value} for the owner wallet to sign}
POST /api/obligations/{id}/settle
GET  /api/risk                -> per vault {score, components{peg,liquidity,utilisation,concentration}, triggers[], quarantined, maxRedeem}
GET  /api/oracle              -> {price, updatedAt, ageSeconds, stale}
POST /api/agent/chat          -> {message} -> {reply, requestId, state, actionCard?}
GET  /api/requests/{id}       -> full workflow record with state history
POST /api/requests/{id}/approval -> {signature, approval} (owner or bank EIP-712 Approval sig)
POST /api/requests/{id}/deny  -> {reason}
POST /api/requests/{id}/correct -> {message}
GET  /api/approvals/pending   -> requests waiting for this session's role
GET  /api/ledger              -> ledger rows (hash-chained) with tx hashes and revert reasons
GET  /api/events              -> AegisExecuted/PolicyChanged/Quarantined read from chain
GET  /api/bank/clients        -> bank only: all Safes, risk score, frozen flags, pending escalations, ledger/chain mismatch count
POST /api/demo/scenario       -> {name: "depeg"|"liquidity"|"stale"|"obligation"|"restore"} (31337 and demo flag only)
GET  /api/stream              -> Server-Sent Events: state changes, new ledger rows, risk updates, executions
```

`actionCard`:
```json
{ "requestId": "..", "op": "DEPOSIT", "vault": {"address":"0x..","name":"Vault A"},
  "amount": {...}, "tier": 3, "requiredSigners": ["authorizer","owner"],
  "reason": "..", "reserveAfter": {...}, "simulation": {"ok": true, "sharesOut": {...}},
  "policyChecks": [{"name":"reserveFloor","ok":true,"detail":".."}],
  "approvalTypedData": { EIP-712 typed data for the owner/bank wallet to sign } }
```

Workflow states (exact strings): `REQUEST_RECEIVED INTENT_PARSED NEEDS_CLARIFICATION STATE_LOADED RISK_EVALUATED PLAN_OPTIONS_BUILT OPTION_SELECTED HELD PROPOSAL_VALIDATED POLICY_CHECKED POLICY_REJECTED SIMULATED SIM_FAILED AWAITING_APPROVAL APPROVAL_DENIED CORRECTION_REQUESTED APPROVAL_EXPIRED APPROVED FINAL_REVALIDATION DAR_SIGNED SUBMITTED CONFIRMED REVERTED EXPLAINED CANCELLED`.

## 3. Web

- Reads `deployments/<chainId>.json` (copied into `web/public/deployments/` at build) and the service API.
- Wallets: injected wallet (wagmi). On chain 31337 only, a "Demo identities" switcher may sign with the public Anvil keys for owner and bank; this switcher must not exist in production builds for other chains.
- Pages: Landing (story + live system), Treasury (business), Copilot (chat + action cards + approval signing), Risk (vault radar, oracle, stress lab controls on 31337), Audit (ledger + on-chain events + explorer links), Bank Risk Desk (all clients, freeze, revoke, approvals, reconciliation).
- Design: follow the `design-taste-frontend` skill. Must work without the service in a clearly labelled "replay" mode using recorded fixtures, so the site is reviewable even when the backend is down.
