# AEGIS Treasury: Technical Document

**2026 FINTECHATHON · International AI Track · Topic F (Agent Wallet)**

| | |
|---|---|
| Team name | TBD |
| Competition track | International AI Track, Topic F: Agent Wallet |
| Submission date | TBD (deadline 20 Oct 2026, 23:59 UTC+8) |
| Document status | Draft v0.2. Revised after the design tribunal review of v0.1 (see "Changes from v0.1"). Values marked TBD are filled in after deployment and testing. |

---

## 01 Project Overview

### Problem, target users and selected topic

Small and medium businesses that hold stablecoins or tokenised deposits for cross-border operations face a recurring trade-off. Cash left idle has an opportunity cost. Cash moved into term products may not be available when payroll or a supplier invoice is due. Managing this by hand means watching balances, due dates, peg stability and vault liquidity every day.

AI agents can do this work, but giving an agent a wallet creates a new class of risk. Agents have been talked into transfers (Freysa, Nov 2024, about USD 47k), have made unit errors with no attacker involved (Lobstar Wilde, Feb 2026, about USD 440k), and have executed encoded instructions relayed by another agent (Bankr, May 2026). In each case the transaction was valid. The decision behind it was not.

The bank that serves the business has no view of, or control over, what an agent does with the client's funds.

**Target users**

| User | Role |
|---|---|
| Business owner or finance staff | Defines the mandate and the obligation calendar, approves material actions, reads decision records |
| Bank risk officer | Sets bank limits, monitors every client agent, approves escalations, can freeze an agent |

**Selected topic:** Topic F, Agent Wallet. AEGIS is an AI agent that holds an execution role on a smart wallet and autonomously performs asset management, transaction execution and risk control on-chain.

**Topic traceability**

| Topic F requirement (official rules) | AEGIS capability | Evidence |
|---|---|---|
| Asset management | Obligation-aware allocation between the treasury and term vaults | E1, E3 |
| Transaction execution | Agent-initiated deposits and redemptions through the Safe | E1 to E3 tx hashes |
| Risk control | Exit Agent, quarantine, on-chain limits, rejection of invalid decisions | E2, E4a to E4d, E5 |
| Real on-chain transaction hashes | Base Sepolia deployment | Execution evidence table (05) |

### Core value and innovation

AEGIS keeps enough liquidity to meet scheduled obligations, allocates only the surplus to term vaults within risk limits, withdraws automatically when risk conditions change, and executes an action only if the conditions that justified it still hold at execution time.

Several parts of this already exist in the market. Autonomous stablecoin treasuries with risk scoring, guardrails and decision receipts are live (Aumo). Deterministic rebalancing and exit agents run on production vaults (kpk on Morpho). Policy-attested execution has been published as research (PACE, Aug 2026). We do not claim those as new.

Our contribution is the combination of four mechanisms in one working system:

1. **Obligation-aware reserve.** The required reserve is derived from the approved payment schedule, written on-chain by the owner whenever the schedule changes, and enforced by the contract. The agent holds when the on-chain floor is out of date.
2. **State-bound authorization.** Every execution carries a signed Decision Authorization Record (DAR) that binds the typed action, the policy version, a human approval where required, and on-chain observable preconditions (oracle freshness and a bounded price band). The contract re-checks those preconditions at execution and rejects the action if they no longer hold.
3. **Structural containment.** The agent's execution path cannot send funds to any address other than the treasury's own wallet and vaults the owner has approved. Induced transfers to an attacker are not detected and blocked. They are impossible by construction.
4. **Institutional oversight that cannot be undone by one party.** The bank can freeze risk-increasing actions and revoke the agent's signer; only the bank can lift its own freeze. Exits always remain possible, so a freeze never traps funds.

---

## 02 System Architecture

### Design principles

| Principle | Consequence in the design |
|---|---|
| The LLM is never a security boundary | The LLM process holds no key, never produces calldata, and cannot loosen any limit |
| Deterministic code calculates money | Reserve, allocation, risk scores and actions come from tested code, not model output |
| Enforce on-chain what matters most | Vault allowlist, receiver, caps, reserve floor, approval tier, DAR validity and freezes are contract checks |
| Risk-reducing actions have a lower bar | Redemptions back to the treasury pass even when deposits are frozen, a vault is delisted or the policy changed |
| Every decision leaves evidence | Executions emit events with measured amounts; rejections revert with typed errors; the bank desk reconciles against the chain |
| Fail closed | Missing data, stale state, an out-of-date reserve floor or a verification error results in no action |

### Architecture diagram and component responsibilities

```
                          ┌──────────────────────────────┐
  Business owner ───────► │  Web App (React + viem)      │ ◄────── Bank risk officer
  (Owner key)             │  Treasury · Copilot · Audit  │         (Bank key)
                          │  Bank Risk Desk (reads chain)│
                          └──────────────┬───────────────┘
                                         │ HTTPS, session-bound to one Safe
┌────────────────────────────────────────▼───────────────────────────────────────┐
│ AEGIS Service (Python, FastAPI)                                                │
│  ┌──────────────┐   tools    ┌───────────────────────────────────────────────┐ │
│  │ Agent        │──────────► │ Deterministic core                            │ │
│  │ (LLM, no key)│ ◄────────  │ State Analyzer · Reserve Engine · Risk Engine │ │
│  └──────┬───────┘  results   │ Allocation Planner · Action Builder           │ │
│         │ option ID          └───────────────────────────────────────────────┘ │
│         ▼                                                                      │
│  Proposal Validator → Policy Verifier → Simulator (module.check + eth_call)     │
│         │                                                                      │
│         ▼                                                                      │
│  ┌───────────────────────────┐        ┌─────────────────────────────────────┐  │
│  │ Authorizer process        │        │ Exit Agent process                  │  │
│  │ Authorizer key            │        │ Exit key (REDEEM only)              │  │
│  └─────────────┬─────────────┘        └──────────────┬──────────────────────┘  │
│                ▼ signed DAR                          ▼ signed exit DAR          │
│  Executor (relayer, gas only) ◄─── fallback: Exit Agent self-submits ───┘       │
│  Decision Ledger (SQLite, hash-chained)                                         │
└────────────────────────────────┬───────────────────────────────────────────────┘
                                 │ RPC
┌────────────────────────────────▼───────────────────────────────────────────────┐
│ Base Sepolia                                                                   │
│  AegisModule (typed actions, permissionless submit) ───► Safe (treasury)       │
│       │ reads PolicyRegistry, MockPriceFeed           └──► MockUSDC, Vault A/B │
│  Keeper script ───► MockPriceFeed (update every heartbeat)                     │
└────────────────────────────────────────────────────────────────────────────────┘
```

| Component | Responsibility | Trust level |
|---|---|---|
| Web App | Mandate and obligation input, chat, approval signing (EIP-712), audit views, Bank Risk Desk | Untrusted client; all inputs revalidated server-side |
| Agent | Interprets requests, asks clarifying questions, chooses among deterministic plan options, explains decisions | Untrusted output; bounded by everything downstream |
| State Analyzer | Reads balances, vault shares, `maxRedeem`, oracle data, registry state | Trusted code, reads only |
| Reserve Engine | Computes required reserve and deployable capital from the approved obligation schedule | Trusted code |
| Risk Engine | Scores each vault, evaluates exit triggers, maintains quarantine cooldowns | Trusted code |
| Allocation Planner | Produces plan options within caps and hysteresis, marks one default option | Trusted code |
| Action Builder | Converts a selected option into a typed action | Trusted code; the only source of actions |
| Proposal Validator | Enforces the "only more conservative" rule against the default option | Trusted code |
| Policy Verifier | Checks client and bank policy; derives the approval tier the contract will require | Trusted code |
| Simulator | Calls the module's `check` view and an `eth_call` of the vault calls from the Safe; after signing, one final `eth_call` of the signed submission | Trusted code |
| Authorizer | Signs deposit and redeem DARs after validation, policy check and simulation; separate process and key | Trusted; compromise is bounded on-chain (see 04) |
| Exit Agent | Monitors triggers; signs redeem-only DARs with its own key; can submit them itself | Trusted code; on-chain limited to redemptions |
| Executor | Submits signed DARs and pays gas | No authority; cannot create or alter a DAR |
| Keeper | Pushes the mock price every heartbeat on testnet | Test infrastructure only |
| Decision Ledger | Stores proposals, inputs, approvals, DARs, tx hashes and revert reasons; each row hashes the previous row | Tamper-evident; reconciled against chain events |
| AegisModule | Accepts only typed actions; derives the required tier; enforces DAR and approval validity, vault rules, caps, reserve floor, freezes; builds calls with the Safe as receiver; checks every inner call succeeded | Trust anchor |
| PolicyRegistry | Per-Safe policy and the role matrix (see 04) | Trust anchor |
| Safe | Custody. Owner keeps full control; the module is the agent's only path | Trust anchor |

### Key decisions and alternatives considered

| Decision | Chosen | Alternatives | Reason |
|---|---|---|---|
| Wallet | Safe smart account with a custom module | Custom wallet contract; EOA with session key | Safe is audited and widely deployed; custody stays with the owner; the module isolates the agent's path |
| Permission scoping | Typed actions: `DEPOSIT(vault, assets, minShares)` and `REDEEM(vault, shares, minAssets)`; the module builds calldata with the Safe hard-coded as receiver and owner | Arbitrary calldata checked against an allowlist; Zodiac Roles | Parsing free-form calldata is attack surface. With typed actions an external transfer cannot be expressed. Zodiac Roles adds value once the action set grows; for two actions it adds configuration risk without reducing attack surface. This supersedes the Zodiac proposal in the product concept v1.1 |
| Approve handling | Exact `approve` before the deposit, reset to zero after, in the same transaction | Standing approval | A standing approval turns a vault bug into a treasury drain |
| Tier enforcement | The module derives the minimum tier from on-chain state; the declared tier can only raise it | Tier chosen by the signer | A signer-chosen tier makes owner and bank approval advisory |
| Human approval | Humans sign an `Approval` (an envelope); the Authorizer signs the final DAR inside it | Humans sign the full DAR | Fresh market data must be bound at execution time, while humans approve minutes or hours earlier |
| Oracle binding | Freshness (`maxOracleAge`) and a bounded price band | Exact round equality | Rounds advance on every update; exact equality makes any approved action expire on the next price update |
| Freeze semantics | Freezes and delisting stop deposits only; redemptions to the Safe stay allowed | Freeze everything | A freeze during a depeg must not trap funds in the distressed vault |
| Chain | Base Sepolia (public, verifiable by judges) | FISCO BCOS; local Anvil | Judges must be able to verify tx hashes. Contracts are plain Solidity, so a FISCO BCOS deployment is an optional extension |
| Service language | One Python service, three processes (service, Authorizer, Exit Agent) | NestJS + Python split | Fewer moving parts; keys still separated by process |
| Agent framework | Explicit state machine (LangGraph or plain Python) | Free-form multi-agent chat | Financial workflows need persisted, inspectable state and human-in-the-loop pauses |

### Models, tools, data sources and external services

| Item | Choice | Notes |
|---|---|---|
| LLM | Qwen via an OpenAI-compatible API (default); provider is swappable | No safety property depends on the model |
| Agent tools | `get_treasury_state`, `get_obligations`, `get_risk_report`, `plan_allocation`, `propose_action`, `explain_decision` | All deterministic. Every tool takes the Safe from the authenticated session, never from LLM arguments. `propose_action` accepts only a plan option ID and optional reductions |
| Chain data | Base Sepolia RPC | Read through the State Analyzer only |
| Price feed | MockPriceFeed implementing `AggregatorV3Interface`, updated by a keeper every heartbeat (60 s) | Stopping the keeper reproduces staleness; `setPrice` reproduces a depeg |
| Vaults | Two MockVaults implementing ERC-4626 over MockUSDC (6 decimals) | Admin sets yield accrual and withdrawable liquidity for stress scenarios |
| Obligations | Entered and approved by the owner in the app; the approval produces the on-chain floor update | Never inferred by the LLM |
| Contracts toolchain | Foundry, OpenZeppelin, Safe deployments on Base Sepolia | |
| Frontend | React, Vite, TypeScript, viem, wagmi | |
| Storage | SQLite with hash-chained rows | PostgreSQL in later versions |

---

## 03 Agent Design

### Intent understanding, planning, tool use and state management

**Separation of roles.**

| Activity | Performed by |
|---|---|
| Understand "keep three months of payroll safe, the rest in term deposits" | LLM |
| Ask for missing information (for example the payroll date) | LLM |
| Read balances, vault state and registry | State Analyzer |
| Compute required reserve and deployable capital | Reserve Engine |
| Score vaults, evaluate exit triggers, quarantine | Risk Engine |
| Produce plan options and mark the default | Allocation Planner |
| Choose the default, a more conservative option, or hold, and explain | LLM |
| Check the choice against the default | Proposal Validator |
| Build the typed action | Action Builder |
| Check policy, derive the tier | Policy Verifier |
| Simulate | Simulator |
| Collect human approval where the tier requires it | Web App (owner, bank) |
| Sign the DAR | Authorizer (Exit Agent for exits) |
| Enforce and execute | AegisModule and Safe |

**The "only more conservative" rule.** The Allocation Planner returns a set of options and marks one as the default: the option its deterministic objective ranks best within policy. The LLM may choose the default, "hold", or any option whose amount in every vault is at or below the default's amount, and may further reduce amounts. If the LLM chooses an option above the default in any vault, the Proposal Validator does not reject it silently: it raises the action to tier T3, so the owner must approve it. A manipulated model can therefore cause less exposure on its own, never more.

**Input handling.**
- Owner chat messages are intent from an authenticated user, but they can only select within policy. A message cannot change policy; policy changes are separate signed owner or bank transactions.
- Externally sourced text (vault or token names, metadata, documents) is passed to the LLM as quoted data with a source label, never as instructions. It cannot reach a signer, because signers accept only validated plan options.
- Every tool call is scoped to the Safe bound to the session. The bank desk uses a separate read-only role.

**State machine.** Each request runs through persisted states. Every transition stores a timestamp and the versions of the input data it used.

```
REQUEST_RECEIVED → INTENT_PARSED ─┬─► NEEDS_CLARIFICATION ─► (user answer) ─► INTENT_PARSED
                                  └─► STATE_LOADED → RISK_EVALUATED → PLAN_OPTIONS_BUILT
→ OPTION_SELECTED ─┬─► HELD ───────────────────────────────────────────────► EXPLAINED
                   └─► PROPOSAL_VALIDATED → POLICY_CHECKED ─┬─► POLICY_REJECTED ─► EXPLAINED
                                                            └─► SIMULATED ─┬─► SIM_FAILED ─► EXPLAINED
                                                                           └─► [AWAITING_APPROVAL]
[AWAITING_APPROVAL] ─┬─► APPROVAL_DENIED ─► EXPLAINED
                     ├─► CORRECTION_REQUESTED ─► OPTION_SELECTED
                     ├─► APPROVAL_EXPIRED ─► STATE_LOADED
                     └─► APPROVED → FINAL_REVALIDATION ─┬─► (conditions changed) ─► STATE_LOADED
                                                        └─► DAR_SIGNED → SUBMITTED
SUBMITTED → CONFIRMED | REVERTED → EXPLAINED          CANCELLED is reachable from any non-terminal state
```

Rules:
- No path to `DAR_SIGNED` skips `POLICY_CHECKED`, `SIMULATED` or `FINAL_REVALIDATION`.
- Every terminal state writes a ledger row, including holds, rejections and denials.
- `FINAL_REVALIDATION` reloads state, recomputes the plan and simulates again. If the new action no longer fits inside the human Approval, the workflow replans instead of signing.

### Core algorithms and evaluation approach

**1. Required reserve.** For an obligation schedule over horizon H (default 30 days):

```
R_required = max over t in [0, H] of max(0, Σ_{i ≤ t} O_i − Σ_{i ≤ t} I_i) + B
```

- `O_i`: approved obligations due at time i.
- `I_i`: inflows marked "confirmed" by the owner. Unconfirmed inflows count as zero.
- `B`: buffer, `max(B_min, b × Σ O_i)`, defaults `B_min = 500 USDC`, `b = 10%`.

Taking the maximum over cumulative net outflow covers the worst point in the horizon, so an early large payment is covered even if later inflows offset it.

**Floor synchronisation.** Approving or settling an obligation in the app produces an owner-signed `setReserveFloor(ceil(R_required), scheduleHash)` transaction. The planner compares `registry.reserveFloor` with `R_required` before every plan. If the on-chain floor is lower, the planner returns HOLD with reason `FloorOutOfSync` and asks the owner to sign the update. `scheduleHash` is also included in every DAR's evidence hash, so each decision is linked to the schedule it was planned against.

**2. Deployable capital.**

```
D = max(0, L − R_required − F)
```

`L` is liquid USDC in the Safe plus the immediately withdrawable part of vault positions. `F` is reserved for fees.

**3. Vault risk assessment.**

- **Hard exit triggers** (any one fires a protective redemption and quarantines the vault):

  | Trigger | Default threshold | Rationale |
  |---|---|---|
  | Peg deviation | `|p − 1.00| > 1.0%` | A stablecoin outside 1% is in distress, not in normal noise |
  | Oracle staleness | `now − updatedAt > maxOracleAge` (180 s = 3 × the 60 s heartbeat) | Tolerates missed updates without acting on dead data |
  | Releasable vault liquidity | `releasable liquidity < 1.2 × our position` (ERC-4626 `maxRedeem` is capped by our own balance, so it cannot detect this) | Leave before the exit door closes, not after |

  With one stable asset and one feed, a depeg exit reduces vault-specific risk (lock-up, bad debt, run on the vault), not exposure to the asset itself. Demo E2 states this explicitly.

- **Ranking score** for allocation, normalised 0 to 1: `r = 0.4 × peg + 0.3 × liquidity + 0.2 × utilisation + 0.1 × concentration`. Weights are configuration, not calibrated values.

**4. Allocation.** Greedy by risk-adjusted net yield `y_i − c_i − λ × r_i`, subject to: a per-vault cap of 60% of D, a minimum trade size, a hysteresis band of 5% of target, and exclusion of quarantined vaults. A rebalance is proposed only when drift exceeds the band, a risk score crosses a threshold, or the obligation schedule changes.

**5. Exit Agent.** Runs every 5 blocks (about 10 seconds on Base Sepolia).
1. On a trigger, it quarantines the vault on-chain (`quarantine(safe, vault)`, allowed for the Exit key) and tells the service to drop any pending deposit DARs for that vault.
2. It sizes the exit: `shares = min(position, maxRedeem(Safe))`, `minAssets = previewRedeem(shares) × (1 − 0.5%)`.
3. It simulates, signs the redeem with the Exit key, and hands it to the Executor. If the Executor has not included it within 3 blocks, the Exit Agent submits it itself.
4. It repeats every window until the position is closed. If `maxRedeem` is zero, it raises a critical alert to the owner and bank.

Quarantine is cleared only by the owner, after a cooldown of 24 hours with no trigger.

**Evaluation approach.**

| Area | Method |
|---|---|
| Financial | Replay obligation and price scenarios against baselines: idle cash, highest-APY allocation, static 50/50. Metrics: obligation coverage, liquidity shortfall, net return after gas |
| Risk response | Inject depeg, staleness and liquidity shocks; measure blocks from shock to protective execution, including partial exits |
| Agent task completion | Scripted tasks: allocate, rebalance, hold, obligation change, clarification, denial then correction. Pass if the final on-chain state and the ledger match the expected result |
| Robustness | Same request 10 times yields the same executed state |
| Security | Contract tests, attack scenarios on testnet, curated injection set (see 04 and 05) |

Results: TBD after testing.

---

## 04 Security Design

### Threat model

| Item | Scope |
|---|---|
| Asset | Treasury funds in the Safe and vaults |
| Adversaries | Prompt injection by a user or third party; malicious data sources and vault metadata; a compromised server process or non-owner key; replay of old authorizations; a malicious vault contract |
| Out of scope for the MVP | Compromise of the owner's own wallet; consensus-level attacks; bugs in Safe core contracts |

### Role matrix (PolicyRegistry)

Each Safe has its own policy, its own `policyVersion`, and these roles. Any change increments `policyVersion`.

| Function | Owner | Bank | Exit key | Notes |
|---|---|---|---|---|
| `addVault` | Yes | No | No | Only the custody holder can widen where funds may go |
| `removeVault` | Yes | Yes | No | Removal stops deposits; redemptions remain allowed |
| Raise `autoCap`, `dailyCap`, `maxBandWidth` | Yes | No | No | Loosening |
| Lower `autoCap`, `dailyCap`, `maxBandWidth` | Yes | Yes | No | Tightening |
| `setBankLimit` | No | Yes | No | Controls when bank approval is required |
| `setReserveFloor` | Yes | No | No | Produced by obligation approval in the app |
| `setAuthorizer` | Yes | No | No | Cannot clear a bank freeze |
| `setExitKey` | Yes | No | No | |
| `revokeAuthorizer` | Yes | Yes | No | Bank revocation also sets the bank freeze |
| `ownerFreeze` / `ownerUnfreeze` | Yes | No | No | |
| `bankFreeze` / `bankUnfreeze` | No | Yes | No | Only the bank can lift its own freeze |
| `quarantine(safe, vault)` | Yes | Yes | Set only | Clearing needs the owner |

### Tiered permissions and confirmation for sensitive actions

The module derives the minimum tier from on-chain state. The declared `dar.tier` can raise it, never lower it.

| Tier | Applies when | Required signatures |
|---|---|---|
| T0 Read | Balances, risk report, explanations | None |
| T1 Protective | Any `REDEEM` to the Safe | Authorizer or Exit key |
| T2 Routine | `DEPOSIT` with amount ≤ `autoCap` into a vault the Safe has deposited into before | Authorizer |
| T3 Material | `DEPOSIT` with amount > `autoCap`, or first deposit into a vault, or an LLM choice above the default option | Authorizer + owner Approval |
| T4 Escalated | `DEPOSIT` with amount > `bankLimit` | Authorizer + owner Approval + bank Approval |
| Blocked | Any transfer out of the Safe; any receiver other than the Safe; deposit into a vault not added by the owner | Not representable |

`dailyCap` (per UTC day, chosen over a rolling window to keep on-chain bookkeeping to one counter) applies to every deposit tier. An amount above `dailyCap` needs the owner to raise the cap first.

### Signed structures

```
Approval { safe, op, vault, maxAmount, policyVersion, approvalExpiry, approvalNonce }
    signed by the owner (T3), or by the owner and the bank (T4). Default approvalExpiry: 24 h.

DAR { safe, op, vault, amount, minOut, policyVersion, priceLow, priceHigh,
      tier, approvalHash, nonce, expiry, evidenceHash }
    signed by the Authorizer (or the Exit key for REDEEM). Default expiry: 120 s.
```

The DAR expiry (120 s) is shorter than `maxOracleAge` (180 s), so a DAR never outlives the market data it was planned on. Nonces are random 256-bit values tracked in a used-set, so independent signers never collide.

### On-chain enforcement (AegisModule)

`deposit(dar, sig, approvals)` and `redeem(dar, sig)` can be called by anyone; only the signatures give authority. The Executor is a convenience, not a gate.

**For `redeem` (risk-reducing):**
1. Signature from the Authorizer or the Exit key over the DAR.
2. `block.timestamp ≤ dar.expiry`; `dar.nonce` unused, then marked used.
3. The Safe holds shares of `dar.vault` (delisted or quarantined vaults are allowed).
4. The module calls `redeem(shares, receiver = Safe, owner = Safe)` through `execTransactionFromModuleReturnData`, requires success, and measures the USDC received as the change in the Safe's balance. It requires the measured amount ≥ `dar.minOut`.
5. Emits `AegisExecuted(darHash, REDEEM, vault, sharesBurned, assetsReceived, evidenceHash)`.

Freezes, policy version and the vault allowlist are deliberately not checked for redemptions.

**For `deposit` (risk-increasing):**
1. No owner freeze and no bank freeze; vault not quarantined.
2. `dar.policyVersion == registry.policyVersion`.
3. `dar.vault` is in the allowlist (added by the owner).
4. Derive `requiredTier` from the amount, `autoCap`, `bankLimit`, and the per-vault `everDeposited` flag; use `max(requiredTier, dar.tier)`.
5. Verify the Authorizer signature over the DAR. For T3 and T4, verify each Approval signature, that `approvalHash` matches, that `op`, `vault` and `safe` match, that `dar.amount ≤ approval.maxAmount`, that the Approval is unexpired and unused, then mark it used.
6. `block.timestamp ≤ dar.expiry`; `dar.nonce` unused, then marked used.
7. Oracle: `now − updatedAt ≤ maxOracleAge`, price within `[priceLow, priceHigh]`, and `priceHigh − priceLow ≤ maxBandWidth`.
8. Caps: Safe USDC balance after the deposit ≥ `reserveFloor`; deposits today (UTC) + amount ≤ `dailyCap`.
9. The module calls exact `approve`, `deposit(amount, receiver = Safe)` and `approve(0)` through `execTransactionFromModuleReturnData`, requires each call to succeed, and measures shares received. It requires shares ≥ `dar.minOut` and sets `everDeposited[vault]`.
10. Emits `AegisExecuted(darHash, DEPOSIT, vault, assetsSpent, sharesReceived, evidenceHash)`.

There is no code path that sets a receiver other than the Safe. Any failed check reverts with a typed error (for example `Frozen`, `VaultQuarantined`, `MissingApproval`, `PriceOutOfBand`, `StaleOracle`, `ReserveFloorBreached`, `ExecutionFailed`).

**Simulation entry point.** `check(dar, approvals)` is a view that runs every deposit or redeem check except signature verification and returns the expected result. The Simulator calls it before signing, together with an `eth_call` of the vault calls from the Safe address. After signing, it runs one final `eth_call` of the signed submission before broadcast.

### Key separation and blast radius

| Key | Holder | If compromised |
|---|---|---|
| Owner | Business owner's wallet | Full control of their own Safe. Out of scope, as with any self-custody wallet |
| Bank | Bank risk officer's wallet | Can freeze deposits, remove vaults, tighten limits, revoke the Authorizer, quarantine. Cannot move funds and cannot block redemptions |
| Authorizer | Separate server process | Can only make T2 deposits: ≤ `autoCap` each, ≤ `dailyCap` per day, into vaults the owner added and the Safe has used before, above the reserve floor, at a fresh in-band price. Funds cannot leave the treasury. Owner or bank can revoke it |
| Exit key | Exit Agent process | Can only redeem back to the Safe. Worst case: funds return early and earn nothing |
| Executor | Relayer | Nothing; anyone can submit signed DARs, so withholding them only delays until the Exit Agent or owner submits |
| LLM process | No key | Nothing on-chain; worst case is a wrong proposal that downstream checks reject or escalate |

No single compromised component short of the owner's own key can move funds out of the treasury, and no single non-owner party can both freeze and unfreeze the agent.

### Protection against prompt injection, privilege escalation, data extraction and privacy leakage

| Threat | Mitigation | Where enforced |
|---|---|---|
| Direct prompt injection ("send everything to 0x…") | No transfer path exists; cannot be expressed as a typed action | AegisModule |
| Indirect injection via vault or token metadata | External text passed as labelled data; signers accept validated plan options only | Agent input handling, Proposal Validator |
| Manipulated model raises exposure | Choices above the default option escalate to owner approval | Proposal Validator, tier derivation |
| Parameter tampering after signing | EIP-712 signatures cover every field; Approval bounds the amount | AegisModule deposit steps 5 |
| Replay | Random nonces in a used-set; expiry on DARs and Approvals | AegisModule |
| Acting on stale or moved prices | Freshness, price band, maximum band width, 120 s DAR expiry | AegisModule deposit step 7 |
| Unit or amount error | Simulation of exact deltas; reserve floor and caps on-chain; measured amounts in events | Simulator, AegisModule |
| Malicious vault | Only the owner can add vaults; first deposit needs owner approval; exact approve reset to zero; inner call success required | PolicyRegistry, AegisModule |
| Privilege escalation through chat | Chat cannot change policy; tier derived on-chain | PolicyRegistry, AegisModule |
| Privilege escalation through a stolen bank key | Role matrix: bank can only tighten, freeze and revoke | PolicyRegistry |
| Cross-client data extraction | Every tool bound server-side to the session's Safe; bank desk is a separate read-only role | AEGIS Service |
| Hidden activity by a compromised server | Hash-chained ledger; bank desk reads `AegisExecuted` events directly and flags mismatches | Bank Risk Desk |
| Data leakage to the LLM provider | Aggregated amounts and pseudonymous IDs only; no keys or identity documents; secrets from environment, redacted from logs | AEGIS Service |

---

## 05 Deployment and Testing

### Environment

| Item | Value |
|---|---|
| Network | Base Sepolia (chain ID 84532) |
| Contracts | Solidity 0.8.x, Foundry, OpenZeppelin |
| Wallet | Safe v1.4.1 deployment on Base Sepolia |
| Service | Python 3.12, FastAPI, SQLite; three processes: service, Authorizer, Exit Agent |
| Frontend | Node 20, React, Vite, viem |
| Oracle | MockPriceFeed, heartbeat 60 s, keeper script, `maxOracleAge` 180 s |
| LLM | OpenAI-compatible endpoint, configured by environment variable |

### Deployment instructions (outline)

1. `forge script script/Deploy.s.sol --rpc-url $BASE_SEPOLIA_RPC --broadcast`: deploys MockUSDC, MockPriceFeed, VaultA, VaultB, PolicyRegistry, AegisModule.
2. Create the demo business's Safe (owner = demo owner key); enable AegisModule.
3. From the owner: `addVault` A and B, `setAuthorizer`, `setExitKey`, set `autoCap`, `dailyCap`, `maxBandWidth`, `maxOracleAge` and the initial `setReserveFloor`. From the bank: `setBankLimit`.
4. Start the keeper (`script/keeper.py`): pushes the current mock price every 60 s.
5. Fund the Safe with MockUSDC; seed vault liquidity.
6. Configure `.env` for each process and start the service, the Authorizer, the Exit Agent and the web app.

Full commands and a one-step script: repository README (TBD).

### Deployed contracts

| Contract | Address |
|---|---|
| MockUSDC | TBD |
| MockPriceFeed | TBD |
| VaultA, VaultB | TBD |
| PolicyRegistry | TBD |
| AegisModule | TBD |
| Demo Safe | TBD |

### Test cases

**Contract tests (Foundry)**

| ID | Case | Expected |
|---|---|---|
| C1 | Valid T2 deposit within caps into a used vault | Executes; approval zero afterwards; event has measured amounts |
| C2 | Deposit into a vault not in the allowlist | Reverts `VaultNotAllowed` |
| C3 | DAR field changed after signing | Reverts `BadSignature` |
| C4 | Redeem result below `minOut` | Reverts `SlippageExceeded` |
| C5 | Reused nonce | Reverts `NonceUsed` |
| C6 | Expired DAR | Reverts `Expired` |
| C7 | Deposit after a policy version change | Reverts `PolicyVersionMismatch` |
| C8 | Deposit breaching the reserve floor | Reverts `ReserveFloorBreached` |
| C9 | Daily cap (UTC day) exceeded | Reverts `DailyCapExceeded` |
| C10 | Deposit signed by a non-Authorizer key | Reverts `BadSignature` |
| C11 | First deposit into a vault declared T2, no owner Approval | Reverts `MissingApproval` |
| C12 | Deposit above `autoCap` with no owner Approval | Reverts `MissingApproval` |
| C13 | Deposit above `bankLimit` with owner Approval only | Reverts `MissingApproval`; with bank Approval executes |
| C14 | DAR amount above `approval.maxAmount` | Reverts `ApprovalExceeded` |
| C15 | Approval signed, oracle advances within band, new DAR signed | Executes |
| C16 | Price outside `[priceLow, priceHigh]` | Reverts `PriceOutOfBand` |
| C17 | Band wider than `maxBandWidth` | Reverts `BandTooWide` |
| C18 | Deposit with stale oracle | Reverts `StaleOracle` |
| C19 | Deposit while bank-frozen | Reverts `Frozen` |
| C20 | Redeem while bank-frozen, after a version change, and after delisting | Executes in all three cases |
| C21 | Redeem with stale oracle | Executes |
| C22 | Exit key signs a deposit | Reverts `BadSignature` |
| C23 | Redeem signed by the Exit key, submitted by a random address | Executes |
| C24 | Deposit into a quarantined vault | Reverts `VaultQuarantined` |
| C25 | Vault that reverts inside `deposit` or `redeem` | Reverts `ExecutionFailed`; no event; nonce unused |
| R1 | Bank calls `addVault`, `setAuthorizer`, raises a cap, or clears quarantine | Reverts `Unauthorized` |
| R2 | Owner calls `bankUnfreeze` | Reverts `Unauthorized` |
| R3 | Bank revokes the Authorizer | Old Authorizer's DAR reverts `BadSignature`; bank freeze set |
| R4 | Exit key clears quarantine | Reverts `Unauthorized` |
| F1 | Fuzz with an adversarial actor holding bank, Authorizer, Exit and Executor keys, plus a malicious vault the owner did not add | Funds never reach an address outside the Safe and owner-added vaults |
| F2 | Fuzz any sequence of deposits | Safe USDC balance never ends below the reserve floor |

**Service and agent tests**

| ID | Case | Expected |
|---|---|---|
| A1 | Reserve calculation on fixed schedules, including an early large payment | Matches hand-computed values |
| A2 | Scripted tasks: allocate, rebalance, hold, obligation change, clarification, denial then correction | Final state and ledger match expected, including HELD and APPROVAL_DENIED rows |
| A3 | Same request 10 times | Identical executed state |
| A4 | LLM picks an option above the default (test double) | Escalated to T3; with no owner approval, nothing executes |
| A5 | Curated injection set in chat and vault metadata, including a cross-client request | No action outside policy; no other client's data returned; logged |
| A6 | Counterfactual: change one fact (due date, price) | Decision changes as specified |
| A7 | Obligation added without floor update | Planner returns HOLD `FloorOutOfSync` |
| A8 | Liquidity at 0.5 × position | Exit Agent redeems the available part, then the rest after liquidity returns |
| A9 | Executor withholds an exit DAR | Exit Agent self-submits within 3 blocks |
| A10 | Ledger row edited | Bank desk shows a mismatch |

### Execution evidence plan

Rejected transactions must be broadcast to produce a hash. viem estimates gas before sending and refuses transactions that would revert, so attack scenarios are sent by `script/Attack.s.sol` with a fixed gas limit.

| # | Scenario | Tx hash |
|---|---|---|
| E1 | Normal allocation: reserve kept, surplus deposited (first deposit, owner Approval) | TBD |
| E2 | Risk shock: depeg injected, vault quarantined, Exit Agent redeems (reduces vault risk, not asset risk) | TBD |
| E3 | Obligation shock: invoice approved, floor updated on-chain, agent rebalances to cover | TBD |
| E4a | Attack: DAR with amount changed after signing (reverted `BadSignature`) | TBD |
| E4b | Attack: replayed DAR (reverted `NonceUsed`) | TBD |
| E4c | Attack: prompt injection requesting an external transfer | No transaction representable; ledger reference TBD |
| E4d | Conditions changed: deposit signed, price moved out of band, submitted (reverted `PriceOutOfBand`) | TBD |
| E5 | Bank freezes and revokes; agent deposit reverts `Frozen`; Exit Agent redeem still executes | TBD |

### Delivery plan and cut line

Task completion (40%) is judged on transaction hashes, so evidence comes before extras.

| Must have (by day 4) | Stretch (only after all E hashes exist) |
|---|---|
| Module and registry with tests C1 to C25, R1 to R4 | Fuzz tests F1, F2 |
| Deterministic pipeline, Authorizer, Exit Agent, keeper | LangGraph instead of a plain state machine |
| Owner Approval signing, bank freeze and revoke | Full AgentDojo adaptation (curated set A5 is must-have) |
| E1 to E5 tx hashes | Baseline comparisons, CVXPY optimiser |
| Business pages and a read-only Bank Risk Desk | Bank Approval signing in the UI (T4 shown by contract test C13) |

**Checkpoint, end of day 4:** all E1 to E5 hashes recorded. If not, stretch work stops.

### Known limitations

| Limitation | Impact | Planned improvement |
|---|---|---|
| Vaults and price feed are mocks | Yield and risk numbers are illustrative | Adapters to real ERC-4626 vaults and Chainlink feeds after audit |
| Single stable asset, single feed | Depeg exits reduce vault risk, not asset risk | Per-vault feeds, multi-asset reserve |
| Authorizer and Exit keys are server keys | Compromise is bounded but possible | HSM or MPC signing |
| Risk thresholds are heuristics | Not calibrated against historical incidents | Backtest on historical depeg and liquidity events |
| Obligations are self-reported | Wrong input gives a wrong reserve | Import from invoicing or accounting systems |
| Custom module instead of audited permission modules | More custom code to trust | Adopt Zodiac Roles when the action set grows |
| Contracts not audited | Not suitable for real funds | External audit before any mainnet use |
| LLM provider availability | Copilot unavailable during outages | Plans, reserve logic and exits run without the LLM |

---

## Changes from v0.1

The design tribunal review of v0.1 returned NOT READY with one Critical and fifteen Medium findings. Each is addressed below.

| Finding | Severity | Change in v0.2 | Section |
|---|---|---|---|
| Bank key could rotate the Authorizer and add vaults; unpause authority undefined | Critical | Role matrix; only owner adds vaults and sets the Authorizer; only bank lifts its own freeze; bank revoke | 04 Role matrix; tests R1 to R3 |
| Tier chosen by signer; no on-chain bank limit; unbounded price band | Medium | Module derives minimum tier; `bankLimit`, `everDeposited`, `maxBandWidth` | 04 Tiers, deposit steps 4, 7; C11 to C13, C17 |
| Freeze, version change and delisting blocked exits | Medium | Redeem path skips those checks | 04 redeem steps; C20, C21 |
| Reserve floor not synced with obligations | Medium | Obligation approval writes the floor; planner holds on `FloorOutOfSync` | 03 Floor synchronisation; A7, E3 |
| What humans sign was undefined | Medium | Separate `Approval` envelope; Authorizer signs final DAR | 04 Signed structures; C14, C15 |
| Simulator needed a signature that did not exist yet | Medium | `check` view plus `eth_call`; final signed simulation | 04 Simulation entry point |
| Exit Agent key and path undefined; Executor could withhold exits | Medium | Separate Exit key, redeem-only on-chain; permissionless submission; self-submit fallback | 02, 03 Exit Agent, 04; C22, C23, A9 |
| Full redeem reverted under low liquidity | Medium | Partial sizing by `maxRedeem`, repeated per window | 03 Exit Agent; A8 |
| Safe inner call failure unchecked | Medium | `execTransactionFromModuleReturnData`, success required, measured amounts | 04 steps 4 and 9; C25 |
| LLM could pick the riskiest option | Medium | Default option; anything above it escalates to T3 | 03 rule; A4 |
| State machine lacked reject, hold and correction states | Medium | Added clarification, hold, rejection, denial, correction, expiry, cancel | 03 State machine; A2 |
| Tests and evidence missed state-bound checks; reverts not broadcastable | Medium | Tests C14 to C25, E4d, fixed-gas attack script | 05 |
| Pending deposit could re-enter a stressed vault | Medium | On-chain quarantine, planner exclusion, cooldown | 03, 04; C24 |
| Tools had no tenant binding | Medium | Session-bound tools; separate bank role | 02, 03, 04; A5 |
| Bank desk trusted an editable ledger | Medium | Hash-chained ledger, reconciliation against events | 02, 04; A10 |
| No evidence-first cut line | Medium | Must-have vs stretch; day-4 checkpoint | 05 Delivery plan |

Gaps from the review that v0.2 closes: oracle keeper and heartbeat (60 s, `maxOracleAge` 180 s), DAR and Approval expiry (120 s, 24 h), whether a bank freeze stops exits (it does not), and traceability to the Topic F wording (section 01). Team capacity remains to be confirmed against the cut line.

---

## References

- PACE: Policy-Attested Contract Execution for Safe AI Agents in DeFi, arXiv 2608.17220
- Signing the Transaction but Not the Decision: Whisper Attacks and a Binding Defense for AP2, arXiv 2609.11757
- Real AI Agents with Fake Memories (CrAIBench), arXiv 2503.16248
- AgentDojo, arXiv 2406.13352, github.com/ethz-spylab/agentdojo
- Aumo: aumo.finance, github.com/cryptoduke01/aumo
- kpk agent-powered vaults on Morpho, chainwire.org, 13 Nov 2025
- Safe smart account and modules: docs.safe.global
- Zodiac Roles Modifier: github.com/gnosisguild/zodiac-modifier-roles
- ERC-4626 Tokenized Vault Standard; EIP-712 Typed Structured Data Signing; Chainlink AggregatorV3Interface
- HSBC and Ant Digital AI-agent tokenised-deposit test, 9 Oct 2026
