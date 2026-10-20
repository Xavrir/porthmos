# Porthmos: Security Self-Assessment Report

| | |
|:-|:-|
| Document type | Security **self-assessment** by the project team. It is not a third-party audit or certification. |
| Assessment date | 20 October 2026 |
| Reviewed revision | `main` at `1c19881`. This assessment changed documentation only; every finding below describes the code as it is at that commit |
| Network in scope | Base Sepolia testnet (84532) and local Anvil (31337). No mainnet deployment exists. |
| Companion documents | [Technical Documentation](TECHNICAL_DOCUMENTATION.md) · [Execution Evidence](EXECUTION_EVIDENCE.md) |

## Contents

1. [Executive security summary](#1-executive-security-summary)
2. [Scope and methodology](#2-scope-and-methodology)
3. [System assets and trust boundaries](#3-system-assets-and-trust-boundaries)
4. [Threat model](#4-threat-model)
5. [Smart contract security assessment](#5-smart-contract-security-assessment)
6. [AI agent security assessment](#6-ai-agent-security-assessment)
7. [Treasury, oracle and risk assessment](#7-treasury-oracle-and-risk-assessment)
8. [Web, API and infrastructure security](#8-web-api-and-infrastructure-security)
9. [Security controls matrix](#9-security-controls-matrix)
10. [Security findings](#10-security-findings)
11. [Security testing results](#11-security-testing-results)
12. [Incident response and recovery](#12-incident-response-and-recovery)
13. [Regulatory and compliance considerations](#13-regulatory-and-compliance-considerations)
14. [Residual risks and recommendations](#14-residual-risks-and-recommendations)
15. [Final assessment](#15-final-assessment)

---

## 1. Executive security summary

**Purpose.** To record, for judges and future engineers, which security controls Porthmos actually implements, how each was verified, which weaknesses remain, and what must change before real money could be involved.

**Scope.** The three Porthmos contracts and their mocks, the five-process Python service, the Copilot's LLM integration, the React web app's signing paths, the hosting configuration, and the recorded Base Sepolia evidence.

**Overall observed posture.** For a hackathon prototype on testnet, the fund-containment design is strong and well tested: the agent's only on-chain path (`AegisModule`) cannot express a transfer to a third party, every limit that matters is enforced on-chain, signatures bind the exact action and the state it was planned in, and freezes never trap funds. These properties are covered by unit, fuzz and invariant tests and were demonstrated by reverted attack transactions on Base Sepolia. The main weaknesses are operational rather than contract-level: shared hot server keys for all tenants on a single host, mocked market and proof sources, browser-held testnet keys, and an unanchored off-chain ledger.

| Strengths (verified) | Limitations (open) |
|:-|:-|
| Typed actions; receiver fixed to the Safe (containment invariant F1) | Contracts not externally audited |
| On-chain tiers; owner and bank Approvals verified on-chain | Authorizer and Exit keys shared across tenants, hot, on one host |
| State-bound DAR: policy version, price band, oracle age, 120 s expiry | Vaults, price feed and proof issuers are mocks or server keys |
| Random nonces in used-sets; EIP-712 domains bound to chain and contract | Off-chain ledger is tamper-evident only against partial edits |
| Freezes block risk-increasing actions; redeems and refunds always pass | Single VM and SQLite file; no high availability |
| Proof-gated escrow with fixed payee, fixed amounts, in-order payment | No dispute process; supplier has no guaranteed payout |
| LLM holds no key; only selects or reduces deterministic options | Classifier for chat messages is rule-based (English and Indonesian) |
| Deployed bytecode matches the reviewed source byte for byte | The hosted API was unreachable during this assessment |

No Critical or High severity issue was found in the contracts. One High-impact issue was found in the web onboarding path (addresses taken from the API without pinning, PRT-01); it is open, with a small recommended fix. In line with the team's decision for this submission, no code was changed during the assessment.

---

## 2. Scope and methodology

### 2.1 Components reviewed

| Component | Files |
|:-|:-|
| Contracts | `contracts/src/AegisModule.sol`, `PolicyRegistry.sol`, `TradeEscrow.sol`, `MockUSDC.sol`, `MockPriceFeed.sol`, `MockVault.sol`, interfaces; deploy and attack scripts |
| Service | `service/aegis/` (API, workflow, core, agent, procs, tradeflow, sessions, SIWE, onboarding, ledger, supervisor, config) |
| Web | `web/src/lib/txguard.ts`, `identity.tsx`, `siwe.ts`, `keys.ts`, `onboard/*`, `tradeflow/*`, `pages/SignUp.tsx`, `vercel.json` |
| Infrastructure | `deploy/tencent/Dockerfile`, `docker-compose.yml`, `Caddyfile.aegis`, `aegis.env.example` |
| Evidence | `deployments/84532.json`, `deployments/evidence-84532.json` |

### 2.2 Methods

| Method | What was done |
|:-|:-|
| Static inspection | Manual line review of all three Porthmos contracts and the security-relevant service and web modules listed above |
| Automated tests | Ran every suite: Foundry (unit, fuzz, invariants), pytest unit, pytest integration against Anvil, Vitest, ESLint, `tsc`, `npm audit` |
| Threat review | Walked each adversary in [§4](#4-threat-model) through the code paths |
| Blockchain verification | Re-fetched every recorded transaction's receipt from Base Sepolia, re-executed every reverted attack at its parent block to decode the custom error, and compared deployed runtime bytecode with the local build, using a read-only script kept outside the repository (equivalent `cast` commands are in [Execution Evidence §2](EXECUTION_EVIDENCE.md#2-reproducibility-information)) |
| Live check | Probed the hosted web and API endpoints (read-only) |

### 2.3 Exclusions and environmental limitations

- No formal verification, symbolic execution, or third-party static analyser (Slither, Mythril) was run.
- No penetration test of the hosted VM; the API host refused connections during the assessment, so live behaviour (CORS, rate limits, LLM mode) was not observed.
- The Safe core contracts, OpenZeppelin, Base and the LLM provider are trusted dependencies and were not reviewed.
- Browser QA scripts (`web/scripts/qa/`) and accessibility were not re-run.
- Tests ran on Windows 11. Two Windows-only portability defects were found (PRT-12); the affected suites were run with an environment workaround rather than a code change.

---

## 3. System assets and trust boundaries

### 3.1 Protected assets

| Asset | Where | Protection |
|:-|:-|:-|
| Treasury funds (test USDC) in each tenant Safe and in vaults | Safe, MockVault | Safe custody; `AegisModule` typed actions; `PolicyRegistry` limits |
| Escrowed milestone funds | `TradeEscrow` | Fixed payee and amounts; proof + Authorizer signatures |
| Authorization keys | Owner and bank (browser or wallet); Authorizer, Exit, Executor, Keeper (server) | Per-process key isolation; on-chain bounds per key |
| Policy and approval data | `PolicyRegistry`; EIP-712 Approvals | Role matrix; `policyVersion`; signatures |
| Decision records | SQLite ledger; chain events | Hash chain; reconciliation against events |
| Session tokens | Browser; `sessions` table | SIWE sign-in; 12 h expiry |
| Operator secrets | `aegis.env` on the host | File mode 600, never committed |
| Privacy data | Client IP hashes, chat text | Salted SHA-256 for IPs; chat text sent to the LLM provider |

### 3.2 Trust boundaries

| Boundary | Crossed by | Trust decision |
|:-|:-|:-|
| Browser → API | HTTPS requests with a session header; SIWE and onboarding signatures | API trusts only the signed address and the session's Safe |
| Browser → chain | Owner/bank transactions | Web encodes them itself against pinned addresses (`txguard.ts`) |
| API → LLM provider | Owner text and facts, as quoted data | Model output is untrusted; only an option ID and reductions are used |
| API → Authorizer | Signing request with an internal token | Authorizer re-derives everything from its own chain reads |
| Service → chain | Signed DARs and releases | Contracts re-check every condition |
| Issuers → service/escrow | Signed `MilestoneProof` | Contract checks issuer signature and conditions; truthfulness of the attestation is trusted |

---

## 4. Threat model

### 4.1 Adversaries

| Adversary | Capability assumed |
|:-|:-|
| A1 Malicious chat user or third-party content | Writes arbitrary chat text; controls vault names, documents, metadata |
| A2 Manipulated or faulty LLM | Returns arbitrary JSON or text |
| A3 Compromised API process / host | Holds every server key and token; serves arbitrary API responses |
| A4 Leaked single server key | One of Authorizer, Exit, Executor, Keeper, demo issuer, faucet/admin |
| A5 Network attacker | Replays or reorders signed messages and transactions |
| A6 Malicious visitor | Abuses the public onboarding, tries to read or act on another tenant |
| A7 Dishonest supplier and/or issuer | Signs false proofs; front-runs releases |
| A8 Malicious vault or token | Reverts, re-enters, returns unexpected values |
| A9 Bank risk officer acting badly | Uses every bank power |

Out of scope: compromise of the owner's own key (self-custody), consensus attacks, bugs in Safe core contracts, malware in the visitor's browser.

### 4.2 Attack surfaces and threat scenarios

| # | Scenario | Adversary | Existing protections | Result |
|:-|:-|:-|:-|:-|
| S1 | "Send all USDC to 0x…" in chat | A1, A2 | Transfer not representable; `TRANSFER_OUT` holds `NotRepresentable`; address flags | Contained (E4c, A5, A14) |
| S2 | LLM picks the riskiest option | A2 | Proposal Validator escalates to T3 | Contained (A4) |
| S3 | Change the amount in a signed DAR | A3, A5 | EIP-712 over every field | Reverts `BadSignature` (C3, E4a) |
| S4 | Replay an executed DAR or Approval | A5 | Random nonces in a used-set | Reverts `NonceUsed` (C5, E4b) |
| S5 | Execute after the price moved | A3, A5 | Price band, max band width, oracle age, expiry | Reverts `PriceOutOfBand` (C16, E4d) |
| S6 | Deposit into an attacker vault | A3, A4 | Owner-only `addVault`; first deposit needs owner Approval | Reverts `VaultNotAllowed` / `MissingApproval` (C2, C11) |
| S7 | Leaked Authorizer key drains funds | A4 | Typed actions, caps, floor, tiers | Bounded to T2 deposits inside the treasury (F1) |
| S8 | Bank traps funds by freezing | A9 | Freezes skip redeem and refund | Exits pass (C20, T26, E5) |
| S9 | Compromised API returns a draining Safe transaction | A3 | Web encodes owner transactions; refuses unpinned targets | Refused (W6, W7, txguard tests) |
| S10 | Compromised API points onboarding at a malicious module | A3 | Server-side activation checks only (also under the attacker's control) | **Not prevented** (PRT-01, open) |
| S11 | Tenant B reads or acts on tenant A | A6 | Session-bound Safe; Authorizer serves only known tenants | Refused (M7, I8, T39) |
| S12 | False or out-of-range proof triggers payment | A7 | On-chain condition checks; Authorizer co-signature | Reverts `ConditionNotMet` (T16, E6c) |
| S13 | Issuer lies within the conditions | A7 | Multiple issuers per order; owner waive/refund; bank freeze | **Not detectable**: residual (PRT-05) |
| S14 | Malicious vault re-enters or reverts | A8 | `nonReentrant`; inner call success required; exact approve reset | Reverts `ExecutionFailed` (C25) |
| S15 | Faucet drain, mass sign-up | A6 | Signed requests; one drip per address; per-IP and daily budgets; tenant cap | Bounded (M2, M5) |

---

## 5. Smart contract security assessment

### 5.1 Authorization

- `AegisModule.deposit` requires the DAR signer to equal `registry.authorizer(safe)`, not zero and not the Exit key. `redeem` accepts the Authorizer or the Exit key.
- The minimum tier is derived on-chain (`requiredTier`): above `bankLimit` → T4, above `autoCap` or first deposit into a vault → T3. A declared tier can only raise it. T3 and T4 require Approval signatures from `registry.owner` and `registry.bank`.
- `PolicyRegistry` separates powers: only the owner widens policy (add vault, raise caps, set Authorizer); the bank can only tighten, freeze and revoke; only the bank lifts its own freeze; `register` is limited to the sole owner of a threshold-1 Safe or the Safe itself.
- `TradeEscrow` has no admin role. `createOrder`, `waive` and `refund` require `msg.sender` to be the buyer Safe; `release` is permissionless but needs two signatures.

### 5.2 Signatures

EIP-712 with OpenZeppelin `EIP712` and `ECDSA.tryRecover` (rejects high-s malleable signatures and invalid lengths; errors map to address zero, which is always refused). Separate domains (`AegisModule`, `TradeEscrow`) mean a DAR signature cannot be read as a release authorization. Digests are cross-checked against independent implementations (`Eip712.t.sol`, `TradeEscrowEip712.t.sol`, and the Python and viem encoders).

### 5.3 Nonces and replay resistance

- DAR and Approval nonces share `usedNonce[safe][nonce]`; `deposit` marks the Approval nonce, then the DAR nonce; a DAR whose nonce equals its Approval nonce is refused.
- Release nonces live in `TradeEscrow.usedNonce[buyer][nonce]`.
- Domains include chain ID and contract address (cross-chain and cross-deployment replay fail, T30).
- Expiry: DAR 120 s, Approval 24 h (checked on-chain), release authorization 120 s. Any `PolicyRegistry` change bumps `policyVersion` and invalidates in-flight DARs, Approvals and release authorizations (C7, T21).

### 5.4 Transaction integrity and payment controls

- The module builds every call itself: `approve(vault, amount)`, `IERC4626.deposit(amount, safe)`, `approve(vault, 0)`; `IERC4626.redeem(shares, safe, safe)`. No caller-supplied calldata, `Operation.Call` only (never delegatecall).
- Amounts are measured as balance changes; `minOut` slippage bounds are enforced; inner call failure reverts `ExecutionFailed`.
- Caps: Safe USDC after deposit ≥ `reserveFloor`; per-UTC-day total ≤ `dailyCap`.
- `TradeEscrow` pays exactly the milestone amount to the stored supplier, in index order; `createOrder` requires the three amounts to sum exactly to `total` (checked without overflow) and verifies the received balance.

### 5.5 Emergency actions

| Action | Who | Effect |
|:-|:-|:-|
| `ownerFreeze` / `bankFreeze` | Owner / bank | Blocks deposits, order creation, releases and waivers; redeems and refunds still pass |
| `revokeAuthorizer` | Owner or bank | Sets the Authorizer to zero; by the bank it also sets the bank freeze |
| `quarantine(safe, vault)` | Owner, bank, Exit key | Blocks deposits into that vault; owner clears it after 24 h |
| `removeVault` | Owner or bank | Removes from the allowlist; redeems still allowed |

There is no global pause and no upgrade mechanism: all three contracts are immutable.

### 5.6 External dependencies

- **Oracle:** `MockPriceFeed.latestRoundData()`; the module rejects `updatedAt == 0`, future timestamps, age above `maxOracleAge`, non-positive answers and prices outside the signed band. Redeems ignore the oracle by design.
- **Vaults:** only owner-added vaults; a vault can still fail (revert) or report an unfair share price. Exact approval and `minOut` bound the damage per call.
- **Token:** MockUSDC. With a real token that has a blocklist, a blocklisted supplier would make releases revert (PRT-09).

### 5.7 State integrity

- Reentrancy: every state-changing function in `AegisModule` and `TradeEscrow` is `nonReentrant`; `TradeEscrow` applies effects before the token transfer.
- Arithmetic: Solidity 0.8 checked arithmetic; the one `unchecked` block (price band width) is preceded by checks that guarantee a non-negative result.
- Invariants fuzzed: containment (F1), reserve floor (F2), escrow balance, payees, no double payment, refunds and commitments (T32 to T35).
- Locked funds: escrow funds can always be refunded after the pending deadline; vault positions can always be redeemed unless the vault itself blocks withdrawal (with the mocks, only the mock admin can do that).

---

## 6. AI agent security assessment

| Concern | Control | Verification |
|:-|:-|:-|
| Prompt injection via chat | Rule parser decides if a message is an action; questions are read-only; action + injection markers refused whole (`SuspiciousRequest`); addresses other than the session Safe flagged `crossClient` | `tests/test_copilot_safety.py` (147 cases), `tests/integration/test_copilot_anvil.py`; E4c ledger record |
| Indirect injection (vault names, documents, order data) | Passed as quoted data with a source label and a trust note; never reaches a signer | `agent/llm.py:quoted`; A5 |
| Tool misuse | Tools bound to the session Safe; no Safe, address or calldata arguments; unknown arguments dropped and flagged | `agent/tools.py`; M7 |
| Unauthorized financial action by AI | LLM has no key and no calldata path; choices above the default escalate to owner Approval | `core/validator.py`; A4 |
| Separation of reasoning and execution | LLM in the API process; signing in the Authorizer process with independent re-verification; enforcement on-chain | `procs/authorizer.py`; A11 |
| Unvalidated model output | Option ID must exist; reductions may only lower; stated amount and vault cannot be exceeded or switched; JSON parsed defensively | `agent/agent.py:select`, `_within_request` |
| Approval bypass | Tier derived on-chain; T3/T4 signatures verified on-chain | C11 to C14 |
| Model or provider failure | Deterministic fallback per request; 20 s timeout; 30 s cool-down; budgets | A12, `test_chat_stream.py` |
| Sensitive data disclosure in replies | Reply guard drops replies with leak phrases or unknown addresses/hashes, also while streaming | `safe_reply`, `ReplyStream`; A16 |
| Auditability | Every request persists its transitions, the option source (`rules`/`llm`), flags and ledger rows | `workflow.py`, `ledger.py` |

**Can AI output bypass contract-level controls?** No path was found. The strongest thing a manipulated model can do is (a) choose a smaller option or hold, (b) choose a larger option, which is escalated to the owner's signature, or (c) produce misleading wording, which the reply guard limits but cannot fully prevent. Even if every off-chain layer failed, the contracts bound the outcome to deposits inside policy and redeems back to the Safe.

**Residual AI risks.** The message classifier is rule-based and covers English and Indonesian phrasing; an unusual phrasing may be misread. A misread T1/T2 instruction still stays inside on-chain caps, the floor and previously used vaults. Owner chat text is sent to an external LLM provider through a proxy signed in with a team account (PRT-10).

---

## 7. Treasury, oracle and risk assessment

| Area | Assessment |
|:-|:-|
| Price-feed validity | Freshness, positivity and band checks on-chain; the feed is a mock with an admin (`setPrice`) and a keeper (`poke`). Real deployment would need a real feed and staleness handling per asset. |
| Depeg handling | Exit Agent quarantines and redeems at > 1 % deviation (E2). With one stable asset and one feed this reduces vault risk, not exposure to the stablecoin itself. |
| Oracle trust and manipulation | Trust is fully in the mock admin. No TWAP or multi-source aggregation. TradeEscrow deliberately makes no oracle call at release time. |
| Liquidity constraints | Exit trigger at releasable liquidity < 1.2 × position; partial redeems sized by `maxRedeem`; repeated per window (A8). |
| Accounting integrity | Escrowed funds leave the Safe and are excluded from deployable cash (`committedOf`); reserve floor enforced on-chain; invariants fuzzed. |
| Missing or invalid milestone evidence | Admission refuses unsigned or mismatched proofs with no state change; failed conditions hold; the contract refuses them independently (E6c). |
| Decimals | USDC 6, price 8; constants in one place (`config.py`: `USDC`, `PRICE_ONE`); band width in feed units (`2,000,000` = 0.02). |
| Fail-open vs fail-closed | Fail-closed: missing data, stale state, out-of-sync floor, Authorizer not current, or a verification error result in no action. Exits are the deliberate exception: they stay open. |

---

## 8. Web, API and infrastructure security

| Area | Observed implementation | Notes |
|:-|:-|:-|
| Authentication | SIWE (EIP-4361) with server nonces (single use, 10 min), domain allowlist, URI, chain, time window and role resource checks; EOA, ERC-1271 and ERC-6492 signatures | `service/aegis/siwe.py`, `sessions.py`; 25 tests in `test_siwe.py` |
| Authorization | Owner sessions bind to the one Safe whose `registry.owner` is the signer; bank sessions see only Safes whose `registry.bank` is the signer; every route takes the Safe from the session | `api/app.py:resolve_safe`; M6, M7 |
| Input validation | Pydantic bodies; strict address and amount parsing; 4,000-character chat cap; 1 MB document cap | |
| Rate limiting | Per-IP auth and onboarding; per-tenant chat, attacks, demo proofs; LLM budgets | `limits.py`; M10 |
| Sensitive data | IPs stored as salted SHA-256; HTTP access log off on 84532 because the SSE URL can carry the session token | PRT-07 |
| CORS | Explicit origin list; `GET`, `POST`, `OPTIONS`; no credentials | Production list still includes localhost origins (PRT-08) |
| Secrets and CI | No secrets found in tracked files: `.env.example` holds only the public Anvil keys; the WalletConnect project ID in `web/.env.production` is a public client identifier | `.gitignore` excludes `*.env`, `.secrets/` |
| Dependencies | `npm audit --omit=dev`: 0 vulnerabilities (20 Oct 2026). No Python vulnerability scan was run. Contract libraries are vendored at pinned versions | Recommend `pip-audit` |
| Container | Non-root, read-only root FS, all capabilities dropped, `no-new-privileges`, 512 MB, loopback-only port | `deploy/tencent/docker-compose.yml` |
| Web headers | `web/vercel.json` sets only `Cache-Control` for assets; no CSP, `X-Frame-Options`, `X-Content-Type-Options` or `Referrer-Policy` | PRT-11 |
| Logging and monitoring | Rotating per-process logs; health endpoint with block lag and oracle age; no alerting service | |

---

## 9. Security controls matrix

Status values: **Verified (test)**, **Verified (on-chain)**, **Implemented** (code present, no specific test found), **Partial**, **Planned**.

| Control | Implementation | Verification evidence | Status | Residual risk |
|:-|:-|:-|:-|:-|
| Typed actions, receiver fixed to the Safe | `AegisModule._executeDeposit/_executeRedeem` | Invariant F1; E4c | Verified (test, on-chain) | None found |
| Vault allowlist (owner-only add) | `PolicyRegistry.addVault`, module check | C2, R1 | Verified (test) | Owner adds a bad vault |
| On-chain tier derivation | `requiredTier` | C11 to C13 | Verified (test) | None found |
| Owner Approval for T3 | `_approvalChecks` | C12, C14, C30, C31; E1 | Verified (test, on-chain) | – |
| Bank Approval for T4 | `_approvalChecks` | C13 | Verified (test) | Not shown on-chain |
| DAR tamper detection | EIP-712 | C3; E4a, E6f | Verified (test, on-chain) | – |
| Replay protection | Nonce used-sets | C5, T23; E4b | Verified (test, on-chain) | – |
| Expiry | DAR, Approval, release | C6, C31, T22 | Verified (test) | – |
| Price band and oracle freshness | `_executionChecks` | C16 to C18; E4d | Verified (test, on-chain) | Mock oracle trust |
| Reserve floor | `_executionChecks` | C8, F2; E3 | Verified (test, on-chain) | Obligations self-reported |
| Daily cap | `_executionChecks` | C9 | Verified (test) | – |
| Freeze blocks deposits, exits stay open | Module and registry | C19, C20, R3; E5; tenant exit under freeze (18 Oct 2026) | Verified (test, on-chain) | – |
| Only bank lifts bank freeze | `bankUnfreeze` | R2 | Verified (test) | – |
| Quarantine with 24 h cooldown | Registry | R4, R7, C24 | Verified (test) | Exit-key DoS (availability) |
| Proof-gated release | `TradeEscrow._releaseChecks` | T9 to T23; E6b, E6c, E6e | Verified (test, on-chain) | Issuer truthfulness |
| Fixed payee and amounts | `TradeEscrow` | T4, T20, T33; E6 | Verified (test, on-chain) | – |
| Refund after deadline, even when frozen | `refund` | T25, T26 | Verified (test) | Not shown on-chain |
| LLM cannot sign or loosen | Process and key separation | A4, A11, A14, M12 | Verified (test) | Misleading wording |
| Chat confirm gate for T1/T2 | `workflow.py` | A14, I9 | Verified (test) | Rule coverage of phrasing |
| Authorizer re-verification | `procs/authorizer.py` | A11, A13, T37 | Verified (test) | Shared hot key |
| Per-process secrets | `supervisor.py` | M12 | Verified (test) | Single host |
| Browser transaction guard | `txguard.ts` | W6, W7, T45, T47 | Verified (test) | Integrity of the web build |
| Onboarding config pinning | Not present: onboarding uses API-supplied addresses | – | Planned (PRT-01) | Malicious module on new tenants if the API host is compromised |
| Tenant isolation | Sessions, tools, stream | M7, I8, T39 | Verified (test) | – |
| SIWE sign-in | `siwe.py` | `test_siwe.py` | Verified (test) | localhost domains allowed in production config |
| Hash-chained ledger + reconciliation | `ledger.py` | A10, T42 | Partial | Whole-chain rewrite by host not detectable |
| Rate limits and budgets | `limits.py` | M2, M5, M10 | Verified (test) | – |
| Internal token check | `!=` comparison; fails closed when the token is empty | Code review | Implemented (not constant-time, PRT-13) | Timing side channel (low) |
| Security headers on the web | – | Code review | Planned (PRT-11) | Clickjacking; higher XSS impact |
| HSM/MPC signing, external audit, real oracles | – | – | Planned | – |

---

## 10. Security findings

Severity reflects impact if the design were used with real funds, adjusted for likelihood. Status: **Open** (a fix is recommended), **Accepted** (known trade-off for the testnet prototype). No finding was fixed in code during this assessment.

### 10.1 Confirmed findings

| ID | Severity | Component | Finding | Status |
|:-|:-|:-|:-|:-|
| PRT-01 | High | Web onboarding | Onboarding addresses taken from the API without pinning | Open |
| PRT-02 | Medium | Service keys | Shared hot operator keys across all tenants on one host | Accepted |
| PRT-03 | Medium | API host | API process holds mock admin, faucet, attacker and demo issuer keys and the internal token | Accepted (mock-only powers) |
| PRT-04 | Medium | Ledger | Hash chain not anchored; full rewrite by the host is undetectable | Open |
| PRT-05 | Medium | TradeFlow | Proof issuers are trusted; demo issuers are server keys | Accepted |
| PRT-06 | Low | TradeFlow | Buyer-side stall: supplier has no guaranteed payout | Accepted |
| PRT-07 | Low | API | Session token accepted in the SSE query string | Accepted (mitigated) |
| PRT-08 | Low | Config | Production CORS and SIWE allowlists include localhost | Open |
| PRT-09 | Informational | TradeEscrow | Token blocklists can block releases | Accepted |
| PRT-10 | Low | Privacy | Chat text sent to an LLM provider through a team-account proxy | Accepted |
| PRT-11 | Low | Web | No security headers or CSP on a site that stores burner keys | Open |
| PRT-12 | Low | Reproducibility | Windows and toolchain issues break 17 service tests, 1 integration test and 1 contract test | Open (workarounds documented) |
| PRT-13 | Low | API | Internal token compared with `!=` | Open |
| PRT-14 | Low | API | Negative `limit` on `/api/ledger` returns unbounded rows | Open |
| PRT-15 | Informational | Registry | `register` does not reject a zero or owner-equal bank on-chain | Accepted |
| PRT-16 | Informational | Exit key | A leaked Exit key can quarantine every tenant's vaults (availability) | Accepted |

#### PRT-01 Onboarding addresses taken from the API without pinning (High, Open)

- **Component:** `web/src/lib/onboard/runner.ts`, `web/src/pages/SignUp.tsx`.
- **Explanation:** During sign-up the browser key creates the Safe through `config.safeProxyFactory`/`safeSingleton`, enables `config.module` on it, and allows `config.vaults` in `config.registry`. All of these come from `GET /api/onboard/config`, and the onboarding senders (`onboard/signers.ts`) send directly, without `txguard`.
- **Exploit scenario:** A compromised API host serves its own contract as `module`. The owner key enables it on the new Safe. A Safe module can call `execTransactionFromModule` with any target, so once funds arrive (the faucet mints 100,000 test USDC at activation) the attacker drains the Safe. The server-side activation check would also be under the attacker's control.
- **Evidence:** code paths above; the limitation is already listed in the design specification ("The module address in onboarding comes from the API config"), though the registry, vault and Safe factory addresses are affected too.
- **Recommended remediation:** before the onboarding runner starts, compare `config.registry`, `module`, `usdc`, the two vault addresses, `safeSingleton`, `safeProxyFactory` and (where pinned) `fallbackHandler` with the bundled `web/public/deployments/<chainId>.json`, and refuse on any mismatch, in the same way `txguard.ts` already pins the TradeFlow addresses. This is a small, web-only change; a prototype was written and tested during the assessment (3 unit tests passed) but not kept, because this submission is documentation-only.
- **Current mitigations:** an injected wallet shows the target of each onboarding call; the attack needs the API host itself to be compromised.
- **Residual risk until fixed:** a compromised API host can take over newly created tenant Safes.

#### PRT-02 Shared hot operator keys across all tenants (Medium, Accepted)

- **Component:** `service/aegis/supervisor.py`, `onboarding.py` (activation requires the shared Authorizer and Exit key), `deploy/tencent/aegis.env.example`.
- **Explanation:** One Authorizer key and one Exit key serve every tenant, as plaintext environment variables on one VM.
- **Failure scenario:** A leak lets the attacker make T2 deposits for every tenant (each within that tenant's caps, floor and previously used vaults) and redeem or quarantine everywhere. No funds can leave any Safe, but recovery needs one owner transaction per tenant to replace the Authorizer.
- **Remediation:** HSM or MPC signing; per-tenant or per-cohort signer keys; key rotation runbook.

#### PRT-03 API process holds mock admin and demo powers (Medium, Accepted)

- **Explanation:** The API process receives `DEPLOYER_KEY`/`ADMIN_KEY` (owner of MockUSDC, MockPriceFeed and the MockVaults), `ATTACKER_KEY`, the three demo issuer keys and `INTERNAL_TOKEN`.
- **Failure scenario:** A compromised API can move the mock price for every tenant, set vault revert modes that block redemptions, mint test USDC, and obtain releases for demo-issued milestones (paid only to the supplier the owner chose).
- **Why accepted:** these powers exist only because the market and issuers are mocked; real vaults, feeds and issuers have no such admin. Must not carry over to production.

#### PRT-04 Decision ledger is not anchored (Medium, Open)

- **Component:** `service/aegis/ledger.py`.
- **Explanation:** Each row stores `prev_hash` and `row_hash = sha256(row)`. Editing one row breaks verification, but anyone with write access to the database can recompute the whole chain. Reconciliation against `AegisExecuted`/`MilestoneReleased` events detects missing execution rows, not altered holds, refusals or explanations.
- **Remediation:** periodically anchor the head hash on-chain or in an external append-only log, and sign rows with a key not held by the API process.

#### PRT-05 Trusted proof issuers (Medium, Accepted)

- **Explanation:** `TradeEscrow` checks that the issuer signed a proof meeting the conditions; it cannot check that the proof is true. In the demo all three issuers are server keys reachable from the API process (see PRT-03).
- **Failure scenario:** A lying or compromised issuer, or one colluding with the supplier, triggers payment of that milestone to the fixed supplier.
- **Mitigations present:** fixed payee and amounts; a different issuer per milestone; issuer cannot be the supplier; Authorizer co-signature; owner or bank freeze.
- **Remediation:** issuer registry with revocation, k-of-n issuers, TradeTrust/eBL verification, signed sensor gateways, dispute window.

#### PRT-06 Buyer-side stall (Low, Accepted)

A release needs the buyer's Authorizer and no freeze. The buyer side can refuse or freeze until the deadline and then refund; the supplier is protected only by the lock-up until the deadline. Documented in the design specification (tribunal finding N1). Remediation: record proven milestones on-chain so a refund cannot cover them; arbitration.

#### PRT-07 Session token in the SSE query string (Low, Accepted)

`GET /api/stream?session=…` accepts the token as a query parameter (EventSource cannot send headers). Query strings can end up in proxy or access logs. Mitigation present: the API's access log is off on 84532 (`API_ACCESS_LOG`). Recommendation: short-lived stream tickets, and confirm Caddy access logging is disabled.

#### PRT-08 Development origins in the production allowlists (Low, Open)

`DEFAULT_ORIGINS`, `DEFAULT_SIWE_DOMAINS` and `deploy/tencent/aegis.env.example` include `localhost` origins and `localhost:*`/`127.0.0.1:*` SIWE domains for the 84532 service. A SIWE message produced by any page served on the user's localhost would be accepted by the production API. Impact is low (the user must sign it), but production should list only `porthmos.vercel.app`. Not changed in this assessment because it is a deployment setting.

#### PRT-09 Token blocklists (Informational, Accepted)

With a real stablecoin that blocklists addresses, a blocklisted supplier makes every `release` and `waive` revert; funds return only by refund after the deadline. Recommendation: check the payee before funding; owner-approved payee change.

#### PRT-10 Chat text sent to an LLM provider (Low, Accepted)

Owner messages (first 1,000 characters for explanations; full message for intent parsing), amounts and pseudonymous IDs go to the LLM through CLIProxyAPI signed in with a team account. No keys or identity documents are sent. Production would need a provider contract with a data-processing agreement, or a self-hosted model.

#### PRT-11 No security headers or CSP (Low, Open)

The web app keeps burner owner and bank keys in `localStorage`; a cross-site-scripting bug would expose them. No `innerHTML`/`dangerouslySetInnerHTML` use was found. `web/vercel.json` sets no security headers. Recommendation: add `X-Content-Type-Options: nosniff`, a `Referrer-Policy`, and `X-Frame-Options: DENY` / `frame-ancestors 'none'` (low risk), then a `script-src`/`connect-src` policy tested in a browser against the wallet SDKs (WalletConnect, Coinbase).

#### PRT-12 Reproducibility issues (Low, Open, workarounds documented)

- `service/aegis/chain/abi.py` reads Forge artifacts with `read_text()` and the platform default encoding. On Windows, once `contracts/out` exists, 17 tests in `test_rpc_batching.py` fail with `UnicodeDecodeError` and the service cannot load ABIs from the artifacts. Workaround: `PYTHONUTF8=1` (all 412 pass). Fix: `read_text(encoding="utf-8")`. Linux and macOS, and the Docker image (which has no `contracts/out`), are not affected.
- `service/scripts/evidence_84532.py` calls `os.killpg`, which does not exist on Windows; `test_e6_dry_run_on_anvil` completes every E6 transaction but fails at cleanup there. Fix: fall back to `Popen.terminate()` when `os.killpg` is missing.
- `contracts/test/TradeEscrowFunding.t.sol` calls `vm.lastCallGas()`; with Foundry 1.5.1-stable and 1.6.0-nightly the vendored forge-std 1.17.0 cannot decode the result, so one test fails. All tests pass with Foundry 1.8.6-nightly; the requirement is now documented. Pin that version in any future CI.

#### PRT-13 Non-constant-time internal token comparison (Low, Open)

`/internal/quarantine` and the Authorizer's guard compared the token with `!=`. Both endpoints fail closed when the token is empty, and the Authorizer listens only on 127.0.0.1, so practical exposure was small. Recommendation: use `hmac.compare_digest`, as the admin-token check already does.

#### PRT-14 Unbounded ledger query (Low, Open)

`GET /api/ledger?limit=-1` passed `-1` to SQLite `LIMIT`, which means "no limit". Results were still filtered to the caller's Safes, so no cross-tenant data leaked, but the response size was unbounded. Recommendation: `Query(200, ge=1, le=2000)`.

#### PRT-15 `register` accepts any bank address (Informational, Accepted)

`PolicyRegistry.register` does not reject `bank_ == 0` or `bank_ == owner_`. The service's activation check refuses both (`BadBank`), and a self-registered Safe only weakens its own oversight.

#### PRT-16 Exit-key quarantine as a denial of service (Informational, Accepted)

The shared Exit key may quarantine any vault of any tenant; each quarantine bumps `policyVersion`, invalidating in-flight DARs and release authorizations, and only the owner can clear it after 24 h. Availability impact only.

### 10.2 Uncertain observations (not confirmed as defects)

| Observation | Evidence | Why uncertain |
|:-|:-|:-|
| Bank-desk reconciliation in the recorded evidence run reported 1 mismatch (5 executions on-chain vs 4 in the ledger) and the step "tradeflow bank desk: timed out" | `deployments/evidence-84532.json` (`bankDesk`, `failures`) | The run included script-driven transactions (for example `_previousAttempts`) that never had ledger rows; the cause was not reproduced in this assessment |
| The hosted API refused connections on port 443 | `curl` on 20 Oct 2026 ~12:45 UTC | Could be a host outage or a network restriction on the assessor's side |

### 10.3 Changes applied during this assessment

None to code. This assessment produced documentation only, so the website, the service and the contracts behave exactly as at commit `1c19881`, and the deployed bytecode still matches the reviewed source. The recommended fixes above (PRT-01 and PRT-11 to PRT-14) are small and can be applied after the submission.

---

## 11. Security testing results

Environment: Windows 11, Node 24.21, Python 3.12.10, uv 0.13.3, Foundry and Anvil 1.8.6-nightly (`bbc7910`); integration tests on a freshly started Anvil. Details and raw counts: [Execution Evidence §10](EXECUTION_EVIDENCE.md#10-test-execution-matrix).

| Command | Result |
|:-|:-|
| `forge test` | 106 reported (109 test functions), all passed |
| `uv run pytest -m "not integration"` (`PYTHONUTF8=1` on Windows) | 412 passed, 20 skipped (integration) |
| `uv run pytest -m integration` (fresh Anvil) | 19 passed; `test_e6_dry_run_on_anvil` fails only at Windows cleanup (PRT-12) |
| `npx vitest run` / `npm run lint` / `npm run build` | 176 passed / clean / succeeds |
| `npm audit --omit=dev` | 0 vulnerabilities |
| Read-only on-chain re-verification | 33 transactions and 11 contracts consistent |

### 11.1 Mandatory regression scenarios

| Scenario | Automated test | On-chain evidence | Result |
|:-|:-|:-|:-|
| Valid authorized execution | `test_C1_validT2DepositWithinCaps`, `test_t3_deposit_executes_on_chain` | E1 (success) | PASS |
| Invalid signature rejected | `test_C10_depositSignedByNonAuthorizer`, `test_T19_…` | – | PASS |
| Modified amount rejected | `test_C3_darFieldChangedAfterSigning`, `test_T18_…`, `testFuzz_tamperedAuthorizationAmount` | E4a, E6f (reverted `BadSignature`) | PASS |
| Unauthorized signer rejected | `test_C22_exitKeySignsDeposit`, `test_R3_bankRevokesAuthorizer`, `test_ownerOnlyAndBankOnlyFunctions` | – | PASS |
| Replayed transaction rejected | `test_C5_reusedNonce`, `test_T23_…`, `test_approvalSignedByWrongKeyAndReplayedApproval` | E4b (reverted `NonceUsed`) | PASS |
| Expired authorization rejected | `test_C6_expiredDar`, `test_T22_expiredAuthorization`, `test_approvalMismatchAndExpiry` | – | PASS |
| Spending limit exceeded | `test_C9_dailyCapExceededPerUtcDay`, `test_C12_…`, `test_C13_…`, `test_C8_…` (floor) | – | PASS |
| Invalid or stale oracle rejected | `test_C18_staleOracle`, `test_C16_priceOutsideBand`, `test_C17_bandWiderThanMax` | E4d (reverted `PriceOutOfBand`) | PASS |
| Paused/frozen operation rejected | `test_C19_depositWhileBankFrozen`, `test_T12_…`, `test_T3_…` | E5, E6g (reverted `Frozen`) | PASS |
| Exits allowed while frozen | `test_C20_…`, `test_T26_…`, `test_owner_exit_runs_while_the_bank_freeze_holds` | E5 exit; tenant exit 18 Oct 2026 | PASS |
| Valid milestone release | `test_T9_…`, `test_happy_path_three_releases_through_the_pipeline` | E6b, E6e (success) | PASS |
| Invalid milestone prevents payment | `test_T16_conditionNotMetEvenWithValidAuthorizerSignature`, `test_hold_on_out_of_range_temperature_then_forced_submit_reverts` | E6c (reverted `ConditionNotMet`) | PASS |
| Ledger and on-chain consistency | `test_ledger_reconciles_with_chain`, A10, T42 | Evidence `ledgerRef` rows; bank desk 1 mismatch (see §10.2) | PASS (tests); evidence observation open |
| Prompt injection produces no transaction | `test_copilot_safety.py`, `test_question_and_injection_produce_no_transaction` | E4c (ledger record only) | PASS |

**Not executed:** an LLM-in-the-loop injection benchmark (AgentDojo-style), browser QA, load tests, and any test against the hosted API.

---

## 12. Incident response and recovery

| Incident | Available control | Who | Recovery path |
|:-|:-|:-|:-|
| Agent misbehaves or Authorizer key suspected | `bankFreeze` / `ownerFreeze`; `revokeAuthorizer` | Bank, owner | Owner sets a new Authorizer (`setAuthorizer`); bank lifts its freeze |
| Vault or stablecoin distress | Exit Agent quarantine and redeem; manual quarantine | Exit key, owner, bank | Owner clears quarantine after 24 h |
| Exit key suspected | Owner `setExitKey` | Owner | One transaction per tenant |
| Service outage | Funds stay in the Safe; anyone can submit a signed exit; the owner controls the Safe directly | Owner | Redeem from vaults directly; restart the container; roll back by re-tagging the previous image |
| Held or disputed milestone | `waive` or `refund` after the deadline | Owner | Off-chain negotiation; no arbitration |
| Onboarding abuse | `ONBOARDING_OPEN=0`, rate limits, tenant cap | Operator | Existing tenants unaffected |

**Known limitations.** No on-call alerting, no automated key rotation, no global pause, and recovery from a shared-key leak needs every owner to act. There is no runbook beyond `deploy/tencent/README.md`.

---

## 13. Regulatory and compliance considerations

- **Payments and custody.** Porthmos is a non-custodial design (the owner holds the Safe), but an operator running the Authorizer and Exit keys for clients, and a bank seat, would likely fall under payment-service, custody-adjacent or technology-risk rules in each jurisdiction. The project's target market notes refer to Singapore (MAS stablecoin framework, TradeTrust); no licence, legal opinion or regulator engagement exists.
- **Stablecoin settlement.** On-chain settlement is only possible where stablecoin payments are permitted; the team's own analysis excludes Indonesia, where crypto is not a legal means of payment.
- **Identity.** There is no KYC/KYB, sanctions screening or Travel Rule handling. Supplier addresses are whatever the owner enters.
- **Data privacy.** Client IPs are stored as salted hashes; chat text goes to an LLM provider (PRT-10); obligations and chat history live in an unencrypted SQLite file on the host.
- **Cryptographic evidence is not legal compliance.** EIP-712 signatures and on-chain events show who authorised what; they do not by themselves satisfy record-keeping, audit-trail or consumer-protection obligations.

---

## 14. Residual risks and recommendations

### 14.1 Open and accepted risks for the prototype

Mock vaults, price feed and issuers; shared hot server keys (PRT-02, PRT-03); unanchored ledger (PRT-04); trusted issuers and buyer-side stall (PRT-05, PRT-06); single host and SQLite; browser-held testnet keys; rule-based chat classification; LLM data sharing (PRT-10); no dispute process; fixed three milestones; obligations entered by hand.

### 14.2 Controls required before any real-money use

1. Independent smart-contract audit of `AegisModule`, `PolicyRegistry` and `TradeEscrow`, plus static analysis and formal checks of the invariants.
2. HSM or MPC custody for the Authorizer and Exit keys, per-tenant or per-cohort keys, and a rotation runbook.
3. Real ERC-4626 vaults with due diligence, real price feeds (with staleness and deviation handling per asset), and removal of every mock admin power.
4. Real issuer integrations (TradeTrust/eBL, signed sensor gateways), an issuer registry with revocation, k-of-n attestations and a dispute window.
5. Ledger anchoring and signed rows; external, append-only audit logging.
6. Production configuration hygiene: remove localhost from CORS and SIWE lists (PRT-08); a full CSP (PRT-11); stream tickets instead of query tokens (PRT-07).
7. Managed database, a second host, monitoring and alerting.
8. Legal review, licensing, KYC/KYB and sanctions screening for the operating jurisdiction.
9. A CI pipeline (none exists today) running the test suites, `npm audit` and a Python dependency audit (`pip-audit`).
10. The small code fixes recommended in PRT-01, PRT-12, PRT-13 and PRT-14; PRT-01 first, because it protects new tenants against a compromised API host.

---

## 15. Final assessment

**What was verified.** The contract-level guarantees (containment, tiers, approvals, state-bound signatures, replay protection, freezes that keep exits open, proof-gated escrow) are implemented, covered by unit, fuzz and invariant tests that pass, and demonstrated by successful and reverted transactions on Base Sepolia whose receipts and revert reasons were re-checked in this assessment. The deployed contracts are byte-identical to the reviewed source. The off-chain defences (rule-first Copilot, validator, Authorizer re-verification, per-process keys, browser transaction guard, tenant isolation, SIWE) are implemented and covered by passing tests.

**What remains unverified.** Live behaviour of the hosted API during this assessment (unreachable), the live LLM path, and any property that depends on real-world issuers, vaults or price feeds.

**Testnet demonstration vs production readiness.** Porthmos is a credible, well-engineered **testnet prototype**: its most important safety property, that an AI agent cannot move treasury funds outside policy, rests on on-chain checks rather than on the model. It is **not production-ready**: it uses mocks, shared hot keys and a single host, and it has not been externally audited. The findings above are the list of work between the two.
