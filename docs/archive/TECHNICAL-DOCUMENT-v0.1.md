# AEGIS Treasury: Technical Document

**2026 FINTECHATHON · International AI Track · Topic F (Agent Wallet)**

| | |
|---|---|
| Team name | TBD |
| Competition track | International AI Track, Topic F: Agent Wallet |
| Submission date | TBD (deadline 20 Oct 2026, 23:59 UTC+8) |
| Document status | Draft v0.1. Values marked TBD are filled in after deployment and testing. |

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
| Bank risk officer | Sets per-client policy, monitors every client agent, approves escalations, can stop an agent |

**Selected topic:** Topic F, Agent Wallet. AEGIS is an AI agent that owns an execution role on a smart wallet and autonomously performs asset management, transaction execution and risk control on-chain.

### Core value and innovation

AEGIS keeps enough liquidity to meet scheduled obligations, allocates only the surplus to term vaults within risk limits, withdraws automatically when risk conditions change, and executes an action only if the conditions that justified it still hold at execution time.

Several parts of this already exist in the market. Autonomous stablecoin treasuries with risk scoring, guardrails and decision receipts are live (Aumo). Deterministic rebalancing and exit agents run on production vaults (kpk on Morpho). Policy-attested execution has been published as research (PACE, Aug 2026). We do not claim those as new.

Our contribution is the combination of four mechanisms in one working system:

1. **Obligation-aware reserve.** Liquidity requirements are derived from the actual payment schedule, and the reserve floor is enforced on-chain, not only advised.
2. **State-bound authorization.** Every execution carries a signed Decision Authorization Record (DAR) that binds the typed action (operation, vault, amount, slippage bound), the policy version and on-chain observable preconditions (oracle round, price band, expiry, nonce). The contract re-checks those preconditions at execution and rejects the action if they no longer hold.
3. **Structural containment.** The agent's execution path cannot send funds to any address other than the treasury's own wallet and allowlisted vaults. Induced transfers to an attacker are not detected and blocked. They are impossible by construction.
4. **Institutional oversight.** The bank holds a policy and kill-switch role, separate from custody, with a live view of every agent's decisions.

---

## 02 System Architecture

### Design principles

| Principle | Consequence in the design |
|---|---|
| The LLM is never a security boundary | The LLM process holds no key, never produces calldata, and cannot loosen any limit |
| Deterministic code calculates money | Reserve, allocation, risk scores and calldata come from tested code, not model output |
| Enforce on-chain what matters most | Allowlists, receiver checks, caps, reserve floor, DAR validity and pause are contract checks |
| Risk-reducing actions have a lower bar | Moving funds back to the treasury is allowed under conditions that would block moving funds out |
| Every decision leaves evidence | Executions emit events with the DAR hash; rejections revert with typed errors and are logged |
| Fail closed | Missing data, stale state or verification errors result in no action, never in a default action |

### Architecture diagram and component responsibilities

```
                          ┌──────────────────────────────┐
  Business owner ───────► │  Web App (React + viem)      │ ◄────── Bank risk officer
  (wallet: Owner key)     │  Treasury · Copilot · Audit  │         (wallet: Bank key)
                          │  Bank Risk Desk              │
                          └──────────────┬───────────────┘
                                         │ HTTPS (JSON, typed schemas)
┌────────────────────────────────────────▼───────────────────────────────────────┐
│ AEGIS Service (Python, FastAPI)                                                │
│                                                                                │
│  ┌──────────────┐   tools    ┌───────────────────────────────────────────────┐ │
│  │ Agent        │──────────► │ Deterministic core                            │ │
│  │ (LLM, no key)│ ◄────────  │ State Analyzer · Reserve Engine · Risk Engine │ │
│  └──────┬───────┘  results   │ Allocation Planner · Action Builder           │ │
│         │ ActionProposal     └───────────────────────────────────────────────┘ │
│         ▼                                                                      │
│  ┌──────────────────┐   ┌──────────────┐   ┌───────────────────────────────┐   │
│  │ Policy Verifier  │──►│ Simulator    │──►│ Authorizer (holds Auth key,    │   │
│  │ (rules, no LLM)  │   │ (eth_call)   │   │ separate process)              │   │
│  └──────────────────┘   └──────────────┘   └──────────────┬────────────────┘   │
│                                                           │ signed DAR         │
│  ┌──────────────────┐                      ┌──────────────▼────────────────┐   │
│  │ Exit Agent       │── protective DAR ──► │ Executor (relayer, gas only,  │   │
│  │ (monitor loop)   │                      │ no authority)                 │   │
│  └──────────────────┘                      └──────────────┬────────────────┘   │
│  Decision Ledger (SQLite) ◄── events, proposals, DARs, reverts                 │
└───────────────────────────────────────────────────────────┼────────────────────┘
                                                            │ RPC
┌───────────────────────────────────────────────────────────▼────────────────────┐
│ Base Sepolia                                                                   │
│  AegisModule (typed actions only) ─────────────► Safe (treasury wallet)        │
│       │                                              │                         │
│       └── reads PolicyRegistry, PriceFeed            └──► MockUSDC, Vault A/B  │
└────────────────────────────────────────────────────────────────────────────────┘
```

| Component | Responsibility | Trust level |
|---|---|---|
| Web App | Mandate and obligation input, chat, approval signing (EIP-712), audit views, Bank Risk Desk | Untrusted client; all inputs revalidated server-side |
| Agent | Interprets requests, selects tools, chooses among deterministic plan options, explains decisions | Untrusted output; bounded by everything downstream |
| State Analyzer | Reads balances, vault shares, vault liquidity, oracle rounds from chain | Trusted code, reads only |
| Reserve Engine | Computes required reserve and deployable capital from the obligation schedule | Trusted code |
| Risk Engine | Scores each vault and evaluates hard exit triggers | Trusted code |
| Allocation Planner | Produces the target allocation within caps and hysteresis | Trusted code |
| Action Builder | Converts a selected plan option into a typed action (operation, vault, amount, minimum output) | Trusted code; the only source of actions |
| Policy Verifier | Checks the proposal against client and bank policy; assigns the approval tier | Trusted code |
| Simulator | `eth_call` of the exact module call, with the signed DAR, against latest state; computes balance deltas | Trusted code |
| Authorizer | Signs the DAR only after verification and simulation succeed; separate process and key | Trusted; compromise is bounded on-chain (see 04) |
| Executor | Submits signed DARs and pays gas | No authority; compromise grants nothing |
| Exit Agent | Monitors triggers every block window; issues protective withdrawals | Trusted code; may only reduce exposure |
| Decision Ledger | Stores proposals, inputs, DARs, approvals, tx hashes and revert reasons | Append-only by convention; DAR hashes anchored on-chain |
| AegisModule | Accepts only typed actions; builds calldata itself with the Safe as receiver; enforces DAR validity, vault allowlist, caps, reserve floor, pause | Trust anchor |
| PolicyRegistry | Per-client policy: reserve floor, caps, allowlisted vaults, policy version, pause; owner and bank roles | Trust anchor |
| Safe | Custody. Owner keeps full control; the module is the agent's only path | Trust anchor |

### Key decisions and alternatives considered

| Decision | Chosen | Alternatives | Reason |
|---|---|---|---|
| Wallet | Safe smart account with a custom module | Custom wallet contract; EOA with session key | Safe is audited and widely deployed; custody stays with the owner; the module isolates the agent's path |
| Permission scoping | Typed actions: the module exposes only `DEPOSIT(vault, amount, minShares)` and `REDEEM(vault, shares, minAssets)` and builds the calldata itself, with the Safe hard-coded as receiver and owner | Arbitrary calldata checked against an allowlist; Zodiac Roles for target and selector scoping | Checking free-form calldata means parsing it, and every parser is attack surface. With typed actions an external transfer cannot even be expressed. Zodiac Roles adds value once the action set grows; for two actions it adds configuration risk without reducing attack surface |
| Approve handling | The module sets an exact `approve(vault, amount)` and resets it to zero after the deposit, in the same call | Standing infinite approval | A standing approval turns a vault bug into a treasury drain |
| Allowance module | Not used | Safe allowance module | It limits token transfers to a spender. The agent never needs a transfer path, so a cap on deposits inside AegisModule is the correct control |
| What the DAR binds | On-chain verifiable preconditions (oracle round and price band, policy version, expiry, nonce) and the typed action, plus an evidence hash for audit | Only an off-chain risk-state hash | A hash of off-chain state proves only that the Authorizer signed it. Preconditions the contract can re-read prove the decision is still valid |
| Chain | Base Sepolia (public, verifiable by judges) | FISCO BCOS; local Anvil | Judges must be able to verify tx hashes. Contracts are plain Solidity, so a FISCO BCOS deployment is an optional extension |
| Service language | One Python service | NestJS + Python split | Fewer moving parts for a 6-day build; the agent, finance and risk code share types |
| Agent framework | LangGraph state graph (or an equivalent explicit state machine) | Free-form multi-agent chat | Financial workflows need persisted, inspectable state and human-in-the-loop pauses; free-form agent dialogue is hard to bound and test |

### Models, tools, data sources and external services

| Item | Choice | Notes |
|---|---|---|
| LLM | Qwen via an OpenAI-compatible API (default); provider is swappable | No safety property depends on the model. Changing the model must not change any enforcement result |
| Agent tools | `get_treasury_state`, `get_obligations`, `get_risk_report`, `plan_allocation`, `propose_action`, `explain_decision` | All tools are deterministic code. `propose_action` accepts only a plan option ID and an optional reduction |
| Chain data | Base Sepolia RPC: balances, ERC-4626 vault state, oracle rounds, module events | Read through the State Analyzer only |
| Price feed | MockPriceFeed implementing the Chainlink `AggregatorV3Interface` | We control it to reproduce depeg and staleness scenarios |
| Vaults | Two MockVaults implementing ERC-4626 over MockUSDC (6 decimals) | Admin can set yield accrual and withdrawable liquidity for stress scenarios |
| Obligations | Entered and approved by the owner in the app | Never inferred by the LLM |
| Contracts toolchain | Foundry (forge, anvil), OpenZeppelin, Safe deployments on Base Sepolia | |
| Frontend | React, Vite, TypeScript, viem, wagmi | |
| Storage | SQLite for the MVP | PostgreSQL in later versions |

---

## 03 Agent Design

### Intent understanding, planning, tool use and state management

**Separation of roles.** The LLM decides what to ask and how to explain. Deterministic code decides how much and what exactly to execute.

| Activity | Performed by |
|---|---|
| Understand "keep three months of payroll safe, the rest in term deposits" | LLM |
| Ask for missing information (for example the payroll date) | LLM |
| Read balances and vault state | State Analyzer |
| Compute required reserve and deployable capital | Reserve Engine |
| Score vaults and evaluate exit triggers | Risk Engine |
| Produce allocation options within limits | Allocation Planner |
| Choose an option, or choose to hold, and explain why | LLM |
| Build the typed action | Action Builder |
| Check policy, assign approval tier | Policy Verifier |
| Simulate | Simulator |
| Sign the DAR | Authorizer |
| Enforce and execute | AegisModule and Safe |

**The "only more conservative" rule.** The Allocation Planner returns a set of options, each with an upper bound per venue. The LLM may select one option and may reduce any amount, or may select "hold". The Proposal Validator rejects any LLM output where a venue is not in the selected option or an amount exceeds its bound. This bounds the effect of a manipulated model to doing less, never more. Aumo applies the same rule; we adopt it.

**Input handling.**
- Owner chat messages are treated as intent from an authenticated user, but they can only select within policy. A message cannot change policy; policy changes are separate signed owner or bank transactions.
- Any externally sourced text (token or vault names, metadata, documents) is passed to the LLM as quoted data with a source label, never as instructions. Its content cannot reach the signer, because the signer only accepts deterministic plan IDs.

**State machine.** Each request runs through persisted states. Every transition stores a timestamp and the version of the input data it used.

```
REQUEST_RECEIVED → INTENT_PARSED → STATE_LOADED → RISK_EVALUATED
→ PLAN_OPTIONS_BUILT → OPTION_SELECTED → PROPOSAL_VALIDATED
→ POLICY_CHECKED → SIMULATED → [AWAITING_APPROVAL] → FINAL_REVALIDATION
→ DAR_SIGNED → SUBMITTED → CONFIRMED | REVERTED → EXPLAINED
```

No transition may skip `POLICY_CHECKED`, `SIMULATED` or `FINAL_REVALIDATION`. If an approval arrives after the DAR expiry, the workflow returns to `STATE_LOADED` and replans instead of signing stale data.

### Core algorithms and evaluation approach

**1. Required reserve.** For an obligation schedule over horizon H (default 30 days):

```
R_required = max over t in [0, H] of max(0, Σ_{i ≤ t} O_i − Σ_{i ≤ t} I_i) + B
```

- `O_i`: approved obligations due at time i.
- `I_i`: inflows marked "confirmed" by the owner. Unconfirmed inflows count as zero.
- `B`: buffer, `max(B_min, b × Σ O_i)`, defaults `B_min = 500 USDC`, `b = 10%`.

Taking the maximum over cumulative net outflow, not the sum, covers the worst point in the horizon, so an early large payment is covered even if later inflows offset it.

**2. Deployable capital.**

```
D = max(0, L − R_required − F)
```

`L` is liquid USDC in the Safe plus the immediately withdrawable part of vault positions. `F` is reserved for fees.

**3. Vault risk assessment.** Two layers.

- **Hard exit triggers** (any one fires a protective withdrawal from that vault):

  | Trigger | Default threshold | Rationale |
  |---|---|---|
  | Peg deviation | `|p − 1.00| > 1.0%` | A stablecoin outside 1% is in distress, not in normal noise |
  | Oracle staleness | `now − updatedAt > 3 × heartbeat` | Tolerates missed updates without acting on dead data |
  | Withdrawable liquidity | `< 1.2 × our position` | Leave before the exit door closes, not after |

- **Ranking score** for allocation, normalised 0 to 1: `r = 0.4 × peg + 0.3 × liquidity + 0.2 × utilisation + 0.1 × concentration`. Weights are configuration, not calibrated values, and are reported as such.

**4. Allocation.** Greedy by risk-adjusted net yield `y_i − c_i − λ × r_i`, subject to: a per-vault cap of 60% of D, a minimum trade size, and a hysteresis band of 5% of target to avoid churn. A rebalance is proposed only when drift exceeds the band, a risk score crosses a threshold, or the obligation schedule changes. A convex optimiser (CVXPY) is a later extension; the greedy version is easier to test and explain.

**5. Exit Agent.** Runs every N blocks (default N = 5 on Base Sepolia, about 10 seconds). On a trigger it builds a protective `redeem` to the Safe, signed as tier T1, and submits it without waiting for approval. Protective actions are exempt from the oracle-freshness precondition, because a stale oracle is itself an exit reason.

**Evaluation approach.**

| Area | Method |
|---|---|
| Financial | Replay obligation and price scenarios; compare against baselines: idle cash, highest-APY allocation, static 50/50 allocation. Metrics: obligation coverage, liquidity shortfall, net return after gas |
| Risk response | Inject depeg, staleness and liquidity shocks; measure blocks from shock to protective execution |
| Agent task completion | Scripted task set covering allocation, rebalance, hold, obligation change and clarification. Pass if the final on-chain state matches the expected state |
| Robustness | Same request repeated 10 times must yield the same executed state |
| Security | Attack suite (see 04 and 05); counterfactual tests where one input fact changes and the decision must change correctly |

Results: TBD after testing.

---

## 04 Security Design

### Threat model

| Asset | Treasury funds in the Safe and vaults |
|---|---|
| Adversaries | A user or third party attempting prompt injection; a malicious data source; a compromised server process or key; replay of old authorizations |
| Out of scope for the MVP | Compromise of the owner's own wallet; consensus-level attacks; bugs in the Safe core contracts |

### Tiered permissions and confirmation for sensitive actions

| Tier | Examples | Required signatures |
|---|---|---|
| T0 Read | Balances, risk report, explanations | None |
| T1 Protective | Redeem from a vault back to the Safe | Authorizer |
| T2 Routine | Deposit or rebalance within the auto cap, reserve floor respected | Authorizer |
| T3 Material | Deposit above the auto cap, first allocation to a vault | Authorizer + Owner (EIP-712) |
| T4 Escalated | Exceeding the bank's per-client limit | Authorizer + Owner + Bank |
| Blocked | Any transfer out of the Safe, any non-allowlisted target or selector, any receiver other than the Safe | Not representable |

Policy changes (reserve floor, caps, allowlisted vaults) are not agent actions. They are direct transactions by the owner, and by the bank for bank-controlled limits, to the PolicyRegistry. Each change increments `policyVersion`, which invalidates every outstanding DAR.

### On-chain enforcement (AegisModule)

The module has two entry points, `deposit(dar, sigs)` and `redeem(dar, sigs)`. The DAR is an EIP-712 struct:

```
DAR { safe, op, vault, amount, minOut, policyVersion, oracleRound, priceLow, priceHigh,
      tier, nonce, expiry, evidenceHash }
```

For each call, the module checks, in order:

1. `!paused` (owner or bank can pause; bank pause is the kill switch).
2. EIP-712 signature from the registered Authorizer over the full DAR, plus owner and bank signatures as required by `tier`. Any change to any field, including `vault` or `amount`, invalidates the signature.
3. `block.timestamp ≤ dar.expiry` and `dar.nonce` unused, then mark it used.
4. `dar.policyVersion == registry.policyVersion`.
5. `dar.vault` is in the client's allowlist.
6. For `deposit` only (risk-increasing): the oracle round equals `dar.oracleRound`, the price is within `[priceLow, priceHigh]`, the oracle is fresh, the Safe's USDC balance after the deposit is at least `reserveFloor`, the amount is within `autoCap` unless `tier ≥ T3`, and the rolling 24-hour deposited amount stays within `dailyCap`.
7. The module builds the calls itself: exact `approve`, `deposit(amount, receiver = Safe)`, `approve(0)` for deposits; `redeem(shares, receiver = Safe, owner = Safe)` for redemptions. It enforces `minOut` against the result.
8. Emit `AegisExecuted(darHash, op, vault, amount, evidenceHash)`.

There is no code path that sets a receiver other than the Safe. Any failed check reverts with a typed error, for example `PolicyVersionMismatch`, `VaultNotAllowed` or `ReserveFloorBreached`. The reverted transaction hash is the evidence.

### Key separation and blast radius

| Key | Holder | If compromised |
|---|---|---|
| Owner | Business owner's wallet | Full control of their own Safe. Out of scope, as with any self-custody wallet |
| Bank | Bank risk officer's wallet | Can pause and tighten bank limits; cannot move funds |
| Authorizer | Separate server process | Attacker can move funds only between the Safe and allowlisted vaults, within caps and above the reserve floor. Funds cannot leave the treasury. The owner or bank can pause and rotate the key |
| Executor | Relayer | Nothing beyond gas; it cannot create a valid DAR |
| LLM process | No key | Nothing on-chain; worst case is a wrong proposal that downstream checks reject |

The design goal: no single compromised component short of the owner's own key can move funds out of the treasury.

### Protection against prompt injection, privilege escalation and privacy leakage

| Threat | Mitigation | Where enforced |
|---|---|---|
| Direct prompt injection ("send everything to 0x…") | No transfer path exists; the request cannot be expressed as a typed action | AegisModule (step 7) |
| Indirect injection via vault or token metadata | External text passed as labelled data; signer accepts plan IDs only | Agent input handling, Proposal Validator |
| Manipulated model inflates an amount | "Only more conservative" bound against deterministic plan | Proposal Validator |
| Parameter tampering after approval (vault or amount changed) | EIP-712 signature covers every DAR field | AegisModule (step 2) |
| Replay of a valid DAR | Nonce and expiry | AegisModule (step 3) |
| Acting on stale conditions | Oracle round, price band, freshness, policy version | AegisModule (steps 4, 6) |
| Unit or amount error | Simulation shows exact balance deltas; reserve floor check on-chain | Simulator, AegisModule (step 6) |
| Malicious or swapped vault | Vault allowlist set by owner and bank; exact approve reset to zero | AegisModule (steps 5, 7) |
| Privilege escalation through chat | Chat cannot change policy; policy changes require owner or bank transactions | PolicyRegistry |
| Look-alike address | Receivers are never free-form; the module hard-codes the Safe | AegisModule (step 7) |
| Data leakage to the LLM provider | The LLM receives aggregated amounts and pseudonymous IDs; no keys, no personal identity documents; secrets are loaded from the environment and redacted from logs | AEGIS Service |

---

## 05 Deployment and Testing

### Environment

| Item | Value |
|---|---|
| Network | Base Sepolia (chain ID 84532) |
| Contracts | Solidity 0.8.x, Foundry, OpenZeppelin |
| Wallet | Safe v1.4.1 deployment on Base Sepolia |
| Service | Python 3.12, FastAPI, SQLite |
| Frontend | Node 20, React, Vite, viem |
| LLM | OpenAI-compatible endpoint, configured by environment variable |

### Deployment instructions (outline)

1. `forge script script/Deploy.s.sol --rpc-url $BASE_SEPOLIA_RPC --broadcast`: deploys MockUSDC, MockPriceFeed, VaultA, VaultB, PolicyRegistry, AegisModule.
2. Create a Safe for the demo business; enable AegisModule on it; register the Authorizer address and the bank address in the PolicyRegistry.
3. Set the initial policy: allowlisted vaults, reserve floor, auto cap, daily cap.
4. Fund the Safe with MockUSDC; seed vault liquidity.
5. Configure `.env` for the service (RPC URL, contract addresses, Authorizer key, LLM endpoint) and start the service and the web app.

Full commands and a one-step script: in the repository README (TBD).

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
| C1 | Valid T2 deposit within caps | Executes, emits `AegisExecuted`; vault approval is zero afterwards |
| C2 | Vault not in allowlist | Reverts `VaultNotAllowed` |
| C3 | Amount or vault changed after signing | Reverts `BadSignature` |
| C4 | Redeem result below `minOut` | Reverts `SlippageExceeded` |
| C5 | Reused nonce | Reverts `NonceUsed` |
| C6 | Expired DAR | Reverts `Expired` |
| C7 | Policy version changed after signing | Reverts `PolicyVersionMismatch` |
| C8 | Deposit that would breach the reserve floor | Reverts `ReserveFloorBreached` |
| C9 | Daily cap exceeded | Reverts `DailyCapExceeded` |
| C10 | Signature from a non-Authorizer key | Reverts `BadSignature` |
| C11 | T3 action without owner signature | Reverts `MissingApproval` |
| C12 | Paused by bank | Reverts `Paused` |
| C13 | Protective redeem while the oracle is stale | Executes |
| F1 | Fuzz: any sequence of module calls | Funds never reach an address outside the Safe and allowlisted vaults |
| F2 | Fuzz: any sequence of risk-increasing calls | Safe USDC balance never ends below the reserve floor |

**Service and agent tests**

| ID | Case | Expected |
|---|---|---|
| A1 | Reserve calculation on fixed schedules, including an early large payment | Matches hand-computed values |
| A2 | Scripted tasks: allocate, rebalance, hold, obligation change, clarification | Final state matches expected |
| A3 | Same request 10 times | Identical executed state |
| A4 | LLM output exceeding plan bounds (forced via a test double) | Rejected by Proposal Validator |
| A5 | Injection in vault metadata and in chat | No action outside policy; logged |
| A6 | Counterfactual: change one fact (due date, price) | Decision changes as specified |
| A7 | Adapted attack cases from AgentDojo and CrAIBench | Attack success rate reported |

**End-to-end demo scenarios (execution evidence)**

| # | Scenario | Tx hash |
|---|---|---|
| E1 | Normal allocation: reserve kept, surplus deposited | TBD |
| E2 | Risk shock: depeg injected, Exit Agent redeems | TBD |
| E3 | Obligation shock: new invoice, policy version bump, rebalance to cover | TBD |
| E4a | Attack: DAR with amount changed after signing (reverted) | TBD |
| E4b | Attack: replayed DAR (reverted) | TBD |
| E4c | Attack: prompt injection requesting an external transfer | No transaction representable; log reference TBD |
| E5 | Bank kill switch, then an agent action (reverted) | TBD |

### Known limitations

| Limitation | Impact | Planned improvement |
|---|---|---|
| Vaults and price feed are mocks | Yield and risk numbers are illustrative | Adapters to real ERC-4626 vaults and Chainlink feeds after audit |
| Authorizer key is a server key | Compromise is bounded but possible | HSM or MPC signing; threshold of independent verifiers |
| Risk thresholds are heuristics | Not calibrated against historical incidents | Backtest thresholds on historical depeg and liquidity events |
| Obligations are self-reported | Wrong input gives a wrong reserve | Import from invoicing or accounting systems |
| Single chain, single stable asset | Limited scope | Multi-asset and FISCO BCOS deployment |
| Contracts not audited | Not suitable for real funds | External audit before any mainnet use |
| Custom module instead of audited permission modules | More custom code to trust | Adopt Zodiac Roles when the action set grows beyond deposit and redeem |
| LLM provider availability | Copilot unavailable during outages | Deterministic fallback mode: plans and protective exits run without the LLM |

The last row is a deliberate property: the Exit Agent and the reserve logic do not depend on the LLM, so a model outage removes explanations, not protection.

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
- ERC-4626 Tokenized Vault Standard; EIP-712 Typed Structured Data Signing
- HSBC and Ant Digital AI-agent tokenised-deposit test, 9 Oct 2026
