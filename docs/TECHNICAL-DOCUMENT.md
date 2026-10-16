# Porthmos: Technical Document

**2026 FINTECHATHON · International AI Track · Topic F (Agent Wallet)**

| | |
|---|---|
| Product | Porthmos (named AEGIS Treasury up to v0.2) |
| Team name | TBD |
| Competition track | International AI Track, Topic F: Agent Wallet |
| Submission date | TBD (deadline 20 Oct 2026, 23:59 UTC+8) |
| Document status | Draft v0.4. Applies the eleven confirmed findings of the design tribunal on v0.3 (see "Changes from v0.3"). v0.3 added the product name, the trade treasury positioning, the multi-tenant app as built, and the TradeFlow module as a design that is not built yet (see "Changes from v0.2"). Values marked TBD are filled in after deployment and testing. |

**Build status labels.** **[Built]** means the part runs on Base Sepolia and has tests in the repository. **[Design v0.3]** means the part is specified in this document and is not built yet. All of TradeFlow, including the TradeEscrow contract, is [Design v0.3]; the label keeps its name in v0.4 so that references stay stable. A change made in v0.4 is marked with the finding it answers, for example (v0.4, C1). Where v0.4 changes built code, the text says so. Text without a label describes the built system. The TradeEscrow contract interface in 04 is unchanged from v0.3.

**Names that do not change.** The product is now Porthmos. On-chain and API identifiers keep the old name, because a change would alter deployed bytecode, signature digests, Safe addresses or live URLs. These stay as they are: the contract names `AegisModule` and `PolicyRegistry`; the EIP-712 domain name `"AegisModule"`; the event `AegisExecuted`; the mock vault token names ("Aegis Vault A", "Aegis Vault B"); the signed message prefixes that the backend verifies (`AEGIS onboarding`, `AEGIS session`); the Safe salt tag `aegis-v2`; the browser storage key `aegis.wallet.v1`; the headers `X-Aegis-Session` and `X-Aegis-Admin` and the cookie `aegis_session`; the Python package `aegis`; the repository `Xavrir/aegis-treasury`; the site `aegis-treasury-eta.vercel.app`; and the API host `aegis-api.150-109-23-187.sslip.io`.

---

## 01 Project Overview

### Problem, target users and selected topic

Mid-sized trading companies pay foreign suppliers in stages. The buyer does not want to pay before the goods ship, arrive and pass inspection. The supplier does not want to ship without proof that the money exists and will be paid. Today a person checks each milestone against documents and approves each payment by hand.

Businesses that hold stablecoins or tokenised deposits for cross-border operations also face a recurring trade-off. Cash left idle has an opportunity cost. Cash moved into term products may not be available when payroll or a supplier invoice is due. Managing this by hand means watching balances, due dates, peg stability and vault liquidity every day.

AI agents can do this work, but giving an agent a wallet creates a new class of risk. Agents have been talked into transfers (Freysa, Nov 2024, about USD 47k), have made unit errors with no attacker involved (Lobstar Wilde, Feb 2026, about USD 440k), and have executed encoded instructions relayed by another agent (Bankr, May 2026). In each case the transaction was valid. The decision behind it was not.

The bank that serves the business has no view of, or control over, what an agent does with the client's funds.

**Target users**

| User | Role |
|---|---|
| Importer finance or treasury manager (primary) | Works at a mid-sized trading company, Singapore first. Defines the mandate and the obligation calendar, approves material actions, reads decision records. With TradeFlow: creates and funds trade orders and resolves held milestones [Design v0.3] |
| Supplier or exporter (secondary) | Sees that an order is funded and which milestones are paid. Receives each milestone payment at the address fixed in the order. Can submit a proof or a release, because submission is permissionless [Design v0.3] |
| Bank risk officer (overseer) | Sets bank limits, monitors every client agent, approves escalations, can freeze an agent. A freeze also stops milestone releases [Design v0.3] |

Singapore is the first market because it has a large wholesale trade sector (57,715 wholesale establishments in 2024), TradeTrust for verifiable trade documents, and a stablecoin framework from MAS. In Indonesia, crypto is not a legal means of payment (Bank Indonesia), so Indonesian trade volume is not counted as Porthmos settlement volume.

**Selected topic:** Topic F, Agent Wallet. Porthmos is an AI agent that holds an execution role on a smart wallet and autonomously performs asset management, transaction execution and risk control on-chain. TradeFlow extends transaction execution to conditional payments to suppliers [Design v0.3].

**Topic traceability**

| Topic F requirement (official rules) | Porthmos capability | Evidence |
|---|---|---|
| Asset management | Obligation-aware allocation between the treasury and term vaults | E1, E3 |
| Transaction execution | Agent-initiated deposits and redemptions through the Safe | E1 to E3 tx hashes |
| Transaction execution (conditional settlement) | Milestone payments to a fixed supplier after a verified proof [Design v0.3] | E6a to E6g (TBD) |
| Risk control | Exit Agent, quarantine, on-chain limits, rejection of invalid decisions | E2, E4a to E4d, E5 |
| Real on-chain transaction hashes | Base Sepolia deployment; every self-serve treasury also produces real transactions | Execution evidence table (05) |

### Product structure

| Layer | What it does | Status |
|---|---|---|
| Treasury core (the engine) | Obligation-aware reserve, state-bound authorization, structural containment, Exit Agent, Bank Risk Desk, hash-chained Decision Ledger | [Built] |
| Multi-tenant app | Any visitor creates a treasury on Base Sepolia: a Safe, an owner key and a bank key, configured by real transactions | [Built] |
| TradeFlow (first module) | Milestone escrow per trade order. Pays the supplier only on a verified proof from a trusted issuer | [Design v0.3] |

TradeFlow uses the engine. Escrowed milestone funds leave the Safe when the owner funds an order, so the treasury core manages only the remaining cash and can never invest committed funds. A held milestone uses the same oversight as a refused deposit: the ledger records it, the bank desk shows it, and a bank freeze stops it.

### Core value and innovation

Porthmos is an AI trade treasury with conditional settlement. It keeps enough liquidity to meet scheduled obligations, allocates only the surplus to term vaults within risk limits, withdraws automatically when risk conditions change, and executes an action only if the conditions that justified it still hold at execution time. With TradeFlow, it pays a supplier only when a trusted issuer's proof shows that a milestone is met [Design v0.3].

Several parts of this already exist in the market. Autonomous stablecoin treasuries with risk scoring, guardrails and decision receipts are live (Aumo). Deterministic rebalancing and exit agents run on production vaults (kpk on Morpho). Policy-attested execution has been published as research (PACE, Aug 2026). Trade escrow is not new either: Tazapay and Escrow.com run escrow for trade, TradeTrust verifies trade documents, and at least one other Topic F entry (sucsage/agentic-wallet) has built milestone escrow. We do not claim those as new.

Our contribution is the combination of four mechanisms in one working system [Built], plus a fifth in design:

1. **Obligation-aware reserve.** The required reserve is derived from the approved payment schedule, written on-chain by the owner whenever the schedule changes, and enforced by the contract. The agent holds when the on-chain floor is out of date.
2. **State-bound authorization.** Every execution carries a signed Decision Authorization Record (DAR) that binds the typed action, the policy version, a human approval where required, and on-chain observable preconditions (oracle freshness and a bounded price band). The contract re-checks those preconditions at execution and rejects the action if they no longer hold.
3. **Structural containment.** The agent's execution path cannot send funds to any address other than the treasury's own wallet and vaults the owner has approved. Induced transfers to an attacker are not detected and blocked. They are impossible by construction.
4. **Institutional oversight that cannot be undone by one party.** The bank can freeze risk-increasing actions and revoke the agent's signer; only the bank can lift its own freeze. Exits always remain possible, so a freeze never traps funds.
5. **Conditional settlement with split authority [Design v0.3].** A supplier payment needs two signatures that the contract checks: a trusted issuer's signed proof and the treasury's Authorizer. The contract checks the proof's conditions itself. The payee and every amount are fixed when the owner funds the order, so neither the agent nor an issuer can redirect funds or change an amount. With real, external issuers the two signatures come from independent parties. With the demo issuers, both are reachable from the API process, so the demo shows the authorization path, not the split (v0.4, C3).

---

## 02 System Architecture

### Design principles

| Principle | Consequence in the design |
|---|---|
| The LLM is never a security boundary | The LLM process holds no key, never produces calldata, and cannot loosen any limit |
| Deterministic code calculates money | Reserve, allocation, risk scores, actions and proof checks come from tested code, not model output |
| Enforce on-chain what matters most | Vault allowlist, receiver, caps, reserve floor, approval tier, DAR validity and freezes are contract checks. TradeFlow adds payee, amounts, milestone order and proof conditions [Design v0.3] |
| Risk-reducing actions have a lower bar | Redemptions back to the treasury pass even when deposits are frozen, a vault is delisted or the policy changed. Refunds of unreleased escrow to the buyer Safe pass even under a bank freeze [Design v0.3] |
| Third-party payments need proof and fixed terms | A supplier is paid only the amount fixed at order creation, only on an issuer proof that passes the on-chain conditions, and only with the Authorizer's signature [Design v0.3] |
| Every decision leaves evidence | Executions emit events with measured amounts; rejections revert with typed errors; the bank desk reconciles against the chain |
| Fail closed | Missing data, stale state, an out-of-date reserve floor or a verification error results in no action |
| Tenants share contracts, not authority | Every on-chain rule is keyed by Safe. Every session, tool, query and stream event is bound to the session's Safe |

### Architecture diagram and component responsibilities

```
                            ┌──────────────────────────────────────┐
  Importer owner ─────────► │ Web App (React + viem, on Vercel)    │ ◄───── Bank risk officer
  (browser burner key or    │ Onboarding · Treasury · Copilot      │        (browser burner key)
   injected wallet)         │ Trade* · Audit · Bank Risk Desk      │
  Supplier* (read-only) ──► │ Tenant keys never leave the browser  │
                            └──────────────────┬───────────────────┘
                                               │ HTTPS via Caddy (TLS), session-bound to one Safe
┌──────────────────────────────────────────────▼──────────────────────────────────┐
│ Porthmos Service (Python, FastAPI) · one container, five processes              │
│ API process                                                                     │
│  ┌──────────────┐   tools    ┌───────────────────────────────────────────────┐  │
│  │ Agent        │──────────► │ Deterministic core                            │  │
│  │ (LLM, no key)│ ◄────────  │ State Analyzer · Reserve Engine · Risk Engine │  │
│  └──────┬───────┘  results   │ Allocation Planner · Action Builder           │  │
│         │ option ID          │ Proof Verifier*                               │  │
│         ▼                    └───────────────────────────────────────────────┘  │
│  Proposal Validator → Policy Verifier → Simulator (module.check + eth_call)     │
│  Onboarding + faucet (DEPLOYER key) · Attack runner (ATTACKER key)              │
│  Demo issuers* · Tenant store · Sessions · Rate limits                          │
│                                                                                 │
│  ┌───────────────────────────┐  ┌───────────────────────────┐  ┌────────────┐   │
│  │ Authorizer process        │  │ Exit Agent process        │  │ Keeper     │   │
│  │ Authorizer key            │  │ Exit key (REDEEM only)    │  │ process    │   │
│  └─────────────┬─────────────┘  └──────────────┬────────────┘  └─────┬──────┘   │
│                ▼ signed DAR, release auth*     ▼ signed exit DAR     │          │
│  Executor process (gas only) ◄── fallback: Exit Agent self-submits   │          │
│  SQLite: tenants, sessions, workflow, hash-chained Decision Ledger   │          │
└─────────────┬───────────────────────────────────────────────┬────────┼──────────┘
              │ RPC                                           │        │
              │                     OpenAI-compatible API ◄───┘        │
              │                     CLIProxyAPI → claude-haiku-5-5     │
┌─────────────▼────────────────────────────────────────────────────────▼──────────┐
│ Base Sepolia                                                                    │
│  AegisModule (typed actions, permissionless submit) ───► Safe (one per tenant)  │
│       │ reads PolicyRegistry, MockPriceFeed           └──► MockUSDC, Vault A/B  │
│  TradeEscrow* ◄── funded by an owner Safe tx (MultiSendCallOnly)                │
│       │ reads PolicyRegistry; pays only the supplier or refunds the buyer Safe  │
│  Keeper process ───► MockPriceFeed (poke every 60 s)                            │
└─────────────────────────────────────────────────────────────────────────────────┘
  * TradeFlow, [Design v0.3], not built yet
```

| Component | Responsibility | Trust level |
|---|---|---|
| Web App | Onboarding with browser-held keys, mandate and obligation input, chat, approval signing (EIP-712), audit views, Bank Risk Desk | Untrusted client; all inputs revalidated server-side |
| Agent | Interprets requests, asks clarifying questions, chooses among deterministic plan options, explains decisions | Untrusted output; bounded by everything downstream |
| State Analyzer | Reads balances, vault shares, `maxRedeem`, oracle data, registry state | Trusted code, reads only |
| Reserve Engine | Computes required reserve and deployable capital from the approved obligation schedule | Trusted code |
| Risk Engine | Scores each vault, evaluates exit triggers, maintains quarantine cooldowns | Trusted code |
| Allocation Planner | Produces plan options within caps and hysteresis, marks one default option | Trusted code |
| Action Builder | Converts a selected option into a typed action | Trusted code; the only source of actions |
| Proposal Validator | Enforces the "only more conservative" rule against the default option | Trusted code |
| Policy Verifier | Checks client and bank policy; derives the approval tier the contract will require | Trusted code |
| Simulator | Calls the module's `check` view and an `eth_call` of the vault calls from the Safe; after signing, one final `eth_call` of the signed submission | Trusted code |
| Authorizer | Signs deposit and redeem DARs after validation, policy check and simulation; separate process and key; re-verifies every request against its own chain reads; refuses Safes that are not served tenants; signs nothing for a Safe whose registry authorizer is not its own address (`AuthorizerNotCurrent`, v0.4, V1) | Trusted; compromise is bounded on-chain (see 04) |
| Exit Agent | Monitors triggers for every served tenant that holds vault shares; signs redeem-only DARs with its own key; can submit them itself | Trusted code; on-chain limited to redemptions |
| Executor | Submits signed DARs and pays gas | No authority; cannot create or alter a DAR |
| Keeper | Process that pushes the mock price every 60 s on testnet | Test infrastructure only |
| Decision Ledger | Stores proposals, inputs, approvals, DARs, tx hashes and revert reasons; each row hashes the previous row. One chain across all tenants; each row names its Safe | Tamper-evident; reconciled against chain events |
| Tenant store | Table of served Safes: the reference treasury plus activated tenants. Every process reloads it every 3 s | Trusted code |
| Onboarding and faucet | Serves onboarding config, drips test ETH once per address, verifies a new treasury on-chain, mints test USDC once per tenant | Trusted code; uses the DEPLOYER key in the API process |
| Attack runner | Sends the per-tenant refused attacks (`tampered`, `replay`) | Its transactions are built to revert; ATTACKER key holds only test ETH |
| Supervisor | Starts the five processes, gives each only its own secrets, restarts a process that exits | Trusted code |
| AegisModule | Accepts only typed actions; derives the required tier; enforces DAR and approval validity, vault rules, caps, reserve floor, freezes; builds calls with the Safe as receiver; checks every inner call succeeded | Trust anchor |
| PolicyRegistry | Per-Safe policy and the role matrix (see 04) | Trust anchor |
| Safe | Custody. Owner keeps full control; the module is the agent's only path | Trust anchor |
| Proof Verifier [Design v0.3] | Checks a milestone proof with the same rules as the contract, plus the document hash when the document is uploaded | Trusted code |
| Verification Agent [Design v0.3] | Explains a verified or held milestone and proposes one next action from a fixed set | Untrusted output; cannot sign or choose amounts |
| Demo issuers [Design v0.3] | Server-held keys that stand in for a carrier (eBL), a reefer sensor gateway and a surveyor | Test infrastructure only |
| TradeEscrow [Design v0.3] | Holds milestone funds per order; releases only to the order's supplier; refunds only to the buyer Safe | Trust anchor |

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
| Service language | One Python service, five processes (API, Authorizer, Exit Agent, Executor, Keeper) | NestJS + Python split | Fewer moving parts; keys still separated by process |
| Agent framework | Explicit state machine in plain Python | LangGraph; free-form multi-agent chat | Financial workflows need persisted, inspectable state and human-in-the-loop pauses. LangGraph was considered in v0.2 and not adopted |
| Multi-tenancy | One shared deployment; every rule is keyed by Safe; a tenant is a Safe registered in PolicyRegistry and activated by the service | One deployment per tenant | No contract change and no redeploy; the recorded evidence stays valid; funds are isolated per Safe |
| Tenant keys | Owner and bank burner keys generated and held in the browser; optional injected wallet for the owner | Server-held tenant keys; custodial accounts | The server never holds a tenant key; one visitor can sit in both seats of their own test treasury |
| Hosting | Docker on a Tencent CVM behind an existing Caddy; one image runs the five processes under a supervisor | Serverless; one container per process | Fits a 512 MB budget; the supervisor still gives each process only its own key |
| LLM in production | `claude-haiku-5-5` through CLIProxyAPI (OpenAI-compatible) | Qwen (the v0.2 default) | Available to the team; the provider stays swappable; no safety property depends on the model |
| Owner transaction encoding (v0.4, C1) | The web encodes every owner and bank transaction itself, against addresses pinned from the bundled deployments file; the API returns parameters only | The API returns ready calldata (`floorUpdate {to, data, value}` in v0.2 and v0.3) | API calldata signed by the owner key let a compromised API host send a Safe delegatecall and drain the Safe. Local encoders already exist for the floor update and the Safe calls |
| TradeFlow contract [Design v0.3] | New TradeEscrow contract that reads PolicyRegistry | A `RELEASE_MILESTONE` action inside AegisModule (master context v1.2) | No change to the deployed module or registry, so the recorded evidence and every tenant stay valid. Escrowed funds leave the Safe, so the module's rule "the receiver is always the Safe" stays absolute |
| Escrow funding [Design v0.3] | One owner-signed Safe transaction: delegatecall to Safe MultiSendCallOnly v1.4.1 that batches `approve(escrow, total)` and `createOrder` | Transfer, then create; approve and create as two Safe transactions; agent-funded orders | Atomic; no standing allowance is left, because the escrow pulls exactly the approved total. The agent never commits funds to a third party (see "Funding path") |
| Release authority [Design v0.3] | Two signatures checked on-chain: the milestone issuer's `MilestoneProof` and the Safe's current Authorizer's `ReleaseAuthorization` | Issuer only; Authorizer only; owner signs every release | Issuer only lets one external key move funds. Authorizer only lets the agent pay without proof. An owner signature per release removes the automation; the owner already approved the terms when funding the order |
| Condition checks [Design v0.3] | The contract checks the signed summary fields against bounds fixed at creation | External oracle call at release; off-chain checks only | No oracle call at release time, so no oracle manipulation or liveness risk. The off-chain agent is never the only gate |

### Multi-tenant architecture [Built]

Any visitor of the public site creates their own treasury on Base Sepolia in about a minute, then uses it for real: the agent plans, the contract enforces, and every action is a real transaction. This needed no contract change and no redeploy, because the contracts in `deployments/84532.json` already key every rule by Safe. The Safe in that file is the **reference treasury**: it holds the recorded evidence, and no public session can bind to it, because its owner key is not public. Non-goals: mainnet, real funds, per-tenant vaults or price feeds, and account recovery beyond a key file download.

**Roles per tenant**

| Role | Holder | Notes |
|---|---|---|
| owner | Visitor. Default: a burner key generated in the browser. Optional: an injected wallet | Safe owner, threshold 1, registry owner |
| bank | Visitor. Always a second burner key generated in the browser | Lets one visitor sit in both seats of their own treasury |
| authorizer, exitKey, executor, keeper | Server: the shared operator keys (the 84532 keys) | Same addresses for every tenant |
| faucet | Server: the DEPLOYER key, which owns MockUSDC and the mocks | ETH drip and the one-time test USDC mint |
| attacker | Server: the ATTACKER key | Sends the per-tenant refused attacks |

Browser key storage is `localStorage["aegis.wallet.v1"] = {version:1, chainId:84532, owner:{type:"burner",pk}|{type:"injected",address}, bank:{pk}, safe}`. The UI offers "Download keys" and "Import keys" and states that this is testnet only and that anyone with the file controls the test treasury. No key goes to the server or into the bundle.

**Onboarding sequence.** All parameters come from `GET /api/onboard/config`. Every step is a real transaction, and the client sends every Safe and registry transaction itself.

| Step | Sender | Transaction or call | Notes |
|---|---|---|---|
| 1 | Browser | Create or load the owner and bank keys | Kept in browser storage |
| 2 | Browser to API | `POST /api/onboard/fund {owner, bank, issuedAt, signature}`; the owner signs `AEGIS onboarding\nowner: …\nbank: …\nchainId: 84532\nissuedAt: …` with personal_sign (max age 5 min) | The server tops up each address to its target (owner 0.00005 ETH, bank 0.00002 ETH) only if it is below half, once per address ever, and waits up to 60 s for receipts |
| 3 | Owner | `SafeProxyFactory.createProxyWithNonce(SafeL2 v1.4.1, setup([owner], 1, 0x0, 0x, fallbackHandler, 0x0, 0, 0x0), saltNonce)` with `saltNonce = uint256(keccak256(abi.encodePacked(owner, "aegis-v2")))` | The client predicts the Safe address first and skips this step if code exists there |
| 4 | Owner | `Safe.execTransaction(safe, 0, enableModule(AegisModule), …)` with the pre-validated signature form (`r = owner`, `s = 0`, `v = 1`) | Valid because `msg.sender` is the owner |
| 5 | Owner | `register(safe, owner, bank)`, `addVault(A)`, `addVault(B)`, `setAuthorizer`, `setExitKey`, `setAutoCap`, `setDailyCap`, `setMaxBandWidth`, `setMaxOracleAge` | Nine transactions with values from config. The reserve floor starts at 0. An injected wallet may batch steps 4 and 5 with EIP-5792 when it reports atomic batch support |
| 6 | Bank | `setBankLimit(safe, bankLimit)` | Always the bank burner key |
| 7 | Browser to API | `POST /api/onboard/activate {safe, owner, issuedAt, signature}` with the owner session message | The server verifies the chain, mints 100,000 test USDC to the Safe once, stores the tenant and starts serving it |

In total: 11 owner transactions, 1 bank transaction, and up to 3 server transactions (2 gas drips, 1 mint). `GET /api/onboard/status?owner=` reads every step from the chain and the database, so the client resumes after a reload and skips steps that are already done.

**Activation checks.** Activation fails with 409 `BadOnboardingState` and a list of codes unless all of these hold:

| Check | Failure code |
|---|---|
| The Safe is the address predicted for this owner, so it is a genuine proxy of the configured singleton, factory and fallback handler | `UnexpectedSafeAddress` |
| The owner holds no other treasury | `OwnerHasTreasury` |
| Safe code exists; threshold is 1; the owner is a Safe owner; the module is enabled | `SafeNotDeployed`, `ThresholdNotOne`, `OwnerNotOnSafe`, `ModuleNotEnabled` |
| `registry.owner(safe)` is the owner; the bank is non-zero and not the owner | `RegistryOwnerMismatch`, `BadBank` |
| Authorizer and Exit key equal the server operator keys | `WrongAuthorizer`, `WrongExitKey` |
| Both vaults are allowed | `VaultMissing:<name>` |
| Every cap is above 0 and at most its bound (auto cap 10,000 USDC, daily cap 50,000 USDC, bank limit 50,000 USDC, band width 0.05, oracle age 3,600 s) | `AutoCapOutOfBounds`, `DailyCapOutOfBounds`, `BankLimitOutOfBounds`, `MaxBandWidthOutOfBounds`, `MaxOracleAgeOutOfBounds` |
| No other activation of this Safe is minting | `ActivationInProgress` |

The mint is claimed with one atomic database update, so concurrent calls cannot mint twice. A mint still pending after 60 s is kept as recorded and never retried.

**Sessions and isolation.**
- On 84532, every `POST /api/session` needs the owner or bank to sign `AEGIS session\nrole: …\naddress: …\nchainId: 84532\nissuedAt: …` with personal_sign (max age 10 min). Sessions last 12 hours.
- An owner session binds to the one activated tenant where `registry.owner(safe)` equals the address, read from the chain when the session is created. A bank session is read-only across the tenants whose registry bank is the address; the bank acts on-chain with its own key.
- Every endpoint, tool and the LLM agent read the Safe from the session only. The stream, ledger, events, pending approvals, requests and bank client list return only the session's tenants. Stream events that carry a Safe reach only that tenant's sessions; market-wide events (oracle pokes, market scenarios) carry no Safe and reach everyone.
- The Authorizer refuses to sign for a Safe that is not a served tenant (`UnknownSafe`).

**Per-tenant attacks.** `POST /api/tenant/attack {kind}` (owner session) makes the ATTACKER key broadcast a transaction against the session's Safe with a fixed gas limit of 800,000, so it is mined and reverts. `tampered`: the Authorizer signs a small deposit DAR whose expiry is at least one hour in the past, and the amount is then changed; it reverts `BadSignature`, and as signed it could only revert `Expired`. `replay`: the tenant's last executed DAR is sent again; it reverts `NonceUsed` (409 `NothingToReplay` if there is none). Market scenarios (`depeg`, `liquidity`, `stale`, `restore`) move shared contracts, so on 84532 they need the `X-Aegis-Admin` token.

**Owner and bank transactions are built in the browser (v0.4, C1).** The owner and bank keys sign only transactions that the web encodes itself. The rules:
- The API returns parameters only. For the reserve floor it returns the floor value and the schedule hash; the web encodes `setReserveFloor(safe, floor, scheduleHash)` to the registry. Any `to` or `data` field that the API still returns is ignored. This fix to the built floor update is being implemented in the web now.
- Target addresses come from the deployments file bundled into the web build (`web/public/deployments/<chainId>.json`), never from an API response: the registry, the Safe proxy factory and, for TradeFlow, TradeEscrow and MultiSendCallOnly.
- The send function accepts only typed intents (for example "floor update", "fund order", "waive", "refund") and encodes each one with a local encoder. It has no path that sends caller-supplied calldata. It refuses any target that is not pinned, and any Safe `execTransaction` that it did not build itself. This applies to burner keys and to injected wallets.
- The confirm dialog shows the decoded call that the web built, not a value taken from the API.

The onboarding transactions already target pinned contracts. The module address inside `enableModule` still comes from the onboarding config; see Known limitations.

**Abuse limits** (environment-configurable defaults)

| Limit | Default |
|---|---|
| Onboarding per IP per day | 3 (faucet and activation counted separately) |
| Total tenants | 300, then onboarding closes (`onboardingOpen: false`) |
| Faucet ETH per UTC day | 0.003 ETH; each address funded at most once |
| Test USDC per tenant | 100,000, minted once at activation |
| Onboarding status polling | 60 per minute per IP |
| Chat messages per tenant | 20 per 10 min |
| LLM calls | 300 per hour overall and 60 per hour per tenant; over budget, the request runs in deterministic mode with a notice |
| Attack actions per tenant | 6 per hour |

Errors use codes such as `RateLimited`, `OnboardingClosed`, `FaucetEmpty`, `NotActivated` and `BadOnboardingState`. Setting `ONBOARDING_OPEN=0` stops new sign-ups without affecting existing treasuries.

**Hosting**

| Item | Value |
|---|---|
| Host | Tencent CVM, Docker Compose project `aegis` |
| TLS and routing | An existing Caddy on the host terminates TLS for `aegis-api.150-109-23-187.sslip.io` and proxies to `127.0.0.1:8787`, flushing Server-Sent Events at once |
| Service container | One image (Python 3.13 slim, uv). `python -m aegis all` runs the five processes under a supervisor that gives each process only its own secrets and restarts a process that exits, with backoff from 1 s up to 30 s. The secrets list is fixed; v0.4 adds `INTERNAL_TOKEN` and the demo issuer keys to it (C3) |
| Container hardening | Non-root user, read-only root filesystem, all capabilities dropped, `no-new-privileges`, 512 MB memory limit, port published on 127.0.0.1 only |
| Data | SQLite on a volume: the shared service database, the Authorizer's own database of signed nonces, per-process logs |
| LLM | CLIProxyAPI v8 container (128 MB), reachable only on the compose network at `http://cliproxy:8317/v1`, model `claude-haiku-5-5`. Any LLM error or a timeout (20 s) makes that request deterministic, with a one-line notice; after an error the service skips the LLM for 30 s |
| Web | Static build on Vercel; `VITE_API_URL` points at the API. If the API is unreachable, the site falls back to replay of the recorded evidence with a visible banner |
| CORS | Allowed origins: the Vercel site and local dev ports. Headers `Content-Type`, `X-Aegis-Session`, `X-Aegis-Admin`; methods GET, POST, OPTIONS; no credentials |
| Privacy | Client IPs are stored only as salted SHA-256 hashes. The HTTP access log is off on 84532, because the stream URL can carry the session token |
| Health | `GET /api/health` reports chain id, block lag, keeper last poke and oracle age, LLM mode, tenant count and `onboardingOpen` |

### TradeFlow architecture [Design v0.3]

**Scope.** One trade order has one buyer (a registered Safe), one supplier address fixed at creation, the MockUSDC token, and exactly three milestones. Each milestone has its own amount, trusted issuer, proof kind, conditions and deadline. The demo split is 20% / 40% / 40%, but amounts are per-order parameters. ZK proofs, real IoT data and real TradeTrust or eBL integration are roadmap only.

| Milestone (on-chain index) | Proof kind | Demo share | Issuer in the demo | Conditions | Example deadline |
|---|---|---|---|---|---|
| 1 (index 0): handed to carrier | `HANDOVER` | 20% | Demo carrier, a stand-in for an eBL or TradeTrust document | Document hash required (bill of lading) | Creation + 7 days |
| 2 (index 1): arrived | `ARRIVAL` | 40% | Demo reefer sensor gateway, a stand-in for an IoT gateway | Document hash required (sensor log export); temperature within 2.00 to 8.00 °C (200 to 800 centi-degrees); at least one sample | Creation + 21 days |
| 3 (index 2): quality accepted | `QUALITY` | 40% | Demo surveyor | Document hash required (survey report) | Creation + 30 days |

This document numbers milestones 1 to 3; the contract uses indexes 0 to 2. The web computes the split in integer token units and adds any remainder to the last milestone, so the three amounts always sum exactly to the funded total.

**Funding path.** Funding is a human action. The buyer Safe calls `createOrder` in one Safe transaction that the owner signs. The transaction is a delegatecall from the Safe to Safe's `MultiSendCallOnly` v1.4.1, which batches two calls from the Safe: `MockUSDC.approve(tradeEscrow, total)` and `TradeEscrow.createOrder(...)`. `createOrder` pulls exactly `total` with `transferFrom`, so the allowance returns to zero in the same transaction. With a burner owner, the owner key sends `execTransaction` with the same pre-validated signature form as onboarding step 4.

| Option | Verdict | Reason |
|---|---|---|
| MultiSendCallOnly: `approve` + `createOrder` in one Safe transaction | Chosen | Atomic; exact allowance consumed in the same transaction; one owner signature. MultiSendCallOnly refuses nested delegatecalls |
| Transfer to the escrow, then `createOrder` credits the balance change | Rejected | Needs a batch anyway to be safe. Between two transactions, anyone could claim the transferred balance, and balance-based accounting breaks when someone donates tokens |
| `approve` and `createOrder` as two Safe transactions | Rejected | Two owner signatures and a standing allowance between them |
| The agent funds orders through AegisModule | Rejected | The module has no such action, and must not: the agent never commits funds to a third party |

Availability was checked on 17 Oct 2026. On 84532, code exists at the canonical MultiSendCallOnly v1.4.1 address `0x9641d764fc13c8B624c04430C7356C1C7C8102e2` (`eth_getCode`). On 31337, `Deploy.s.sol` deploys only SafeL2, SafeProxyFactory and the fallback handler, so the TradeFlow deploy script must also deploy MultiSendCallOnly there from `lib/safe-smart-account`. A delegatecall target controls the Safe for the length of the call, so the web takes the MultiSendCallOnly and TradeEscrow addresses from the bundled deployments file, checks that code exists at them, and refuses to sign if the API config reports different addresses. The demo issuer addresses and the default conditions, split and deadlines also come from the bundled build, not from the API (v0.4, C1).

**Off-chain flow**

1. The owner opens the Trade page and enters the supplier address, the total and the terms reference. The page fills the issuers, conditions and deadlines from the bundled build (v0.4, C1). The owner can link an existing obligation to the order.
2. The page shows what will be signed (the exact approve amount and every order field) and warns if the Safe cash after funding falls below the on-chain reserve floor. The web encodes the MultiSend batch and the Safe transaction itself, and the owner key sends it. The service never builds or sends it.
3. The service reads `OrderCreated` and writes an `ORDER_CREATED` ledger row with the transaction hash. If an obligation was linked, the service settles it and returns the new floor value and schedule hash; the web encodes the floor update and the owner signs it, as for any obligation change (v0.4, C1). This stops the same payment from being counted twice.
4. A proof arrives. It is sent by the issuer or supplier (`POST /api/tradeflow/orders/{id}/proofs`) or, in the demo, signed by a demo issuer on the owner's request.
5. Admission (v0.4, C4). The Proof Verifier first runs the pure checks: the order exists and is active; the milestone is not already paid; the proof's order, index and kind match; the signature recovers to the milestone's issuer; an uploaded document is at most 1 MB and hashes to `docHash`. A failure returns 4xx (413 for an oversized document), writes no ledger row and changes no state. Only an admitted, issuer-signed proof can change the milestone's state.
6. The Proof Verifier runs the remaining checks (see 03, algorithm 7) and writes `PROOF_RECEIVED` with the proof hash and each check result. A transient condition (a freeze, an earlier milestone not yet paid, an Authorizer that is not current) puts the milestone in `WAITING`, and it is checked again on the next `PolicyChanged` or `MilestoneReleased` event (v0.4, C5).
7. If every check passes, the API asks the Authorizer for a `ReleaseAuthorization`. The Authorizer re-verifies from its own chain reads and signs. The Executor runs `checkRelease` and a final signed `eth_call`, then submits, and reports the result back to the milestone workflow. `MilestoneReleased` produces a `MILESTONE_RELEASED` row. A failed preflight or a revert goes to `RELEASE_FAILED`, with at most two automatic re-signs (v0.4, C7).
8. If an admitted proof fails a condition or its time check, the milestone is `HELD`. The API does not ask for a release. The ledger row names the failed checks. The Verification Agent explains the hold and proposes one next action. The owner decides.
9. The owner resolves a hold with a Safe transaction that the web encodes and the owner key signs: `waive` to release despite the failed condition (for example after a survey), or `refund` of all unreleased funds after the pending milestone's deadline. The API returns only the order state (v0.4, C1). For a late release or a corrected proof after a hold, the owner instead signs a `ReleaseConfirmation` (v0.4, C8).

**Time base (v0.4, C6).** Every off-chain time comparison uses the latest block timestamp, never the server's wall clock: the Proof Verifier, the Authorizer's expiry window and the deadline checks. Demo issuers set `issuedAt = max(order.createdAt, latest block timestamp)`. On 84532 the built clock helper already returns the latest block timestamp; on 31337 it returns the later of chain time and wall time, so a test uses a fake chain that runs behind wall time (T51).

**Owner release confirmation (v0.4, C8).** A late release (after the pending milestone's deadline) and a corrected proof after a hold need the owner's EIP-712 signature:

```
ReleaseConfirmation(uint256 orderId,uint8 index,bytes32 proofHash,uint64 expiry)
    signed by registry.owner(buyer); TradeEscrow domain (name "TradeEscrow", version "1", chain id, escrow address).
    Default expiry: 24 h, like the Approval. Sent with POST /api/tradeflow/orders/{id}/confirm.
```

The Authorizer verifies it. The contract never reads it, so the TradeEscrow interface does not change; the domain gives replay protection across chains and escrow deployments, and the type string differs from every on-chain struct. The Authorizer checks the deadline itself on-chain, so a late release cannot pass without the signature. For a corrected proof, the Authorizer relies on the API to report the earlier hold; when it does, the signature is required. That part stays workflow policy, not a security boundary.

**Authorizer checks for a release** (`POST /sign-release`, internal token): the Safe is a served tenant and is the order's buyer; `registry.authorizer(buyer)` equals the Authorizer's own address, else `AuthorizerNotCurrent` (v0.4, V1); the order is active; the index is the next milestone; the Safe is not owner-frozen or bank-frozen; the proof binds this order, index and kind; the issuer signature recovers to the milestone issuer; `order.createdAt ≤ issuedAt ≤` the latest block timestamp (v0.4, C6); the conditions hold; the amount equals the milestone amount; `proofHash` is the proof's struct hash; `policyVersion` equals the registry value; the expiry is in `(now, now + 120 s + 15 s skew]`, where now is the latest block timestamp; the nonce is unused on-chain and in the Authorizer's own database; the pending milestone's deadline has not passed, unless a valid owner `ReleaseConfirmation` for this order, index and `proofHash` is attached and unexpired (v0.4, C8); if the API reports an earlier hold of this milestone, the same confirmation is required. Any failure is a refusal with a reason code. The same `AuthorizerNotCurrent` check now also runs before the Authorizer signs a DAR (v0.4, V1; a change to built code).

**Treasury integration.** Escrowed funds have left the Safe. The treasury view shows three figures:

| Figure | Definition |
|---|---|
| Cash | USDC in the Safe plus the withdrawable part of vault positions (`L` in algorithm 2) |
| Committed | `TradeEscrow.committedOf(safe)`: unreleased escrow for this Safe's active orders, read from the chain |
| Free | Deployable capital `D` (algorithm 2) |

The reserve engine counts upcoming non-escrow obligations as before. Committed funds are not part of `L` and not part of `R_required`. They can never be invested, by construction: they sit in TradeEscrow, which has no function that sends tokens to a vault, and AegisModule acts only on funds held by the Safe.

**API additions**

| Method and path | Caller | Purpose |
|---|---|---|
| `GET /api/tradeflow/config` | Public | `enabled`, limits, and the escrow, MultiSendCallOnly, token and demo issuer addresses for display. The web uses its bundled values and refuses to act if these differ (v0.4, C1). Returns `{enabled: false}` when TradeFlow is not configured (v0.4, C10) |
| `GET /api/tradeflow/orders` | Owner or bank session | Orders whose buyer is a session Safe, from `OrderCreated` events and escrow state |
| `GET /api/tradeflow/orders/{id}` | Anyone; full view only for an owner or bank session of the buyer (v0.4, C9) | Public view: on-chain fields only (order and milestone terms, statuses, and the hashes of the creation, release, waive and refund transactions). Full view adds proofs, check results, hold reasons, explanations and ledger references |
| `POST /api/tradeflow/orders/{id}/proofs` | Anyone, rate-limited | Submit `{index, proof, signature, document?}`; the issuer signature is the authority. Proofs that fail admission get 4xx and change nothing; documents above 1 MB get 413; the service keeps only the document hash (v0.4, C4) |
| `POST /api/tradeflow/orders/{id}/proofs/demo` | Owner session | Ask a demo issuer to sign `{index, variant: "valid" or "outOfRange" or "corrected"}`; signs only for milestones whose issuer is that demo key |
| `POST /api/tradeflow/orders/{id}/confirm` | Owner session | Carries the owner's signed `ReleaseConfirmation` for a corrected proof after a hold, or for a late release (v0.4, C8) |

The v0.3 `resolution` endpoint, which returned waive and refund calldata, is removed: the web encodes `waive(orderId, index)` and `refund(orderId)` itself (v0.4, C1).

New abuse limits: demo proofs 12 per tenant per hour; admitted proof submissions 30 per order per hour; rejected submissions count against a separate budget of 30 per IP hash per hour and never against the per-order budget (v0.4, C4); at most 5 active orders per tenant (off-chain). New stream event type `tradeflow`, scoped to the buyer Safe. New ledger kinds: `ORDER_CREATED`, `PROOF_RECEIVED`, `MILESTONE_WAITING`, `MILESTONE_HELD`, `RELEASE_CONFIRMED`, `RELEASE_SIGNED`, `RELEASE_FAILED`, `MILESTONE_RELEASED`, `MILESTONE_WAIVED`, `ORDER_REFUNDED`. Rejected admissions write no row. The bank desk adds, per client, the active orders, the committed amount and the held milestones, and reconciles `MilestoneReleased` and `OrderRefunded` events against the ledger.

**Demo issuers.** Three server-held keys (`ISSUER_CARRIER_KEY`, `ISSUER_SENSOR_KEY`, `ISSUER_SURVEYOR_KEY`) are owned by the API process only; on 31337 they are derived from the Anvil mnemonic. The supervisor today passes every variable that is not in its fixed `SECRETS` list to every child. v0.4 therefore adds the three issuer keys and `INTERNAL_TOKEN` to `SECRETS` and to the `OWNED` map: the issuer keys go to the API only, and `INTERNAL_TOKEN` goes to the API, the Authorizer and the Exit Agent only, not to the Executor or the Keeper (v0.4, C3; a change to built code). The keys load at the point of use, so a missing key disables demo proofs and nothing else. The UI labels them as stand-ins for TradeTrust or eBL documents and IoT gateways. They sign only proofs; they need no ETH. In the web demo, the supplier is a third burner key generated in the browser and stored as an optional `supplier` field in the same `aegis.wallet.v1` entry, so a visitor can watch the supplier side.

**Deployment artifact (v0.4, C10).** A new script `script/DeployTradeEscrow.s.sol` deploys TradeEscrow (and MultiSendCallOnly on 31337 only) and writes the keys `tradeEscrow`, `multiSendCallOnly`, `tradeEscrowBlock` and `issuers {carrier, sensor, surveyor}` to a separate file, `deployments/<chainId>.tradeflow.json`. A merge script (`service/scripts/merge_deployment.py`) adds them to `deployments/<chainId>.json` and fails if any existing key or value would change. `make deploy` runs `Deploy.s.sol`, then `DeployTradeEscrow.s.sol`, then the merge, so a local redeploy on 31337 keeps TradeFlow.

**TradeFlow is optional at runtime (v0.4, C10).** If `tradeEscrow` is missing from the deployments file, the service reports `enabled: false`, the TradeFlow endpoints answer 503 `TradeFlowDisabled`, the web hides the Trade page, and every built feature works as before. TradeFlow database tables are new tables only, so the pre-TradeFlow image runs on the same data volume.

### Models, tools, data sources and external services

| Item | Choice | Notes |
|---|---|---|
| LLM | `claude-haiku-5-5` through CLIProxyAPI, an OpenAI-compatible proxy on the same host. Configured by `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL`; the provider is swappable | No safety property depends on the model. Without an LLM, every feature runs in deterministic mode |
| Agent tools | `get_treasury_state`, `get_obligations`, `get_risk_report`, `plan_allocation`, `propose_action`, `explain_decision` | All deterministic. Every tool takes the Safe from the authenticated session, never from LLM arguments. `propose_action` accepts only a plan option ID and optional reductions |
| TradeFlow tools [Design v0.3] | `get_orders`, `get_order`, `verify_proof`, `explain_hold` | Deterministic and session-bound. None signs, and none takes an amount, payee or milestone index from the LLM |
| Chain data | Base Sepolia RPC | Read through the State Analyzer only |
| Price feed | MockPriceFeed implementing `AggregatorV3Interface`, updated by the keeper process every heartbeat (60 s) | Stopping the keeper reproduces staleness; `setPrice` reproduces a depeg |
| Vaults | Two MockVaults implementing ERC-4626 over MockUSDC (6 decimals) | Admin sets yield accrual and withdrawable liquidity for stress scenarios |
| Obligations | Entered and approved by the owner in the app; the approval produces the on-chain floor update | Never inferred by the LLM |
| Proof sources [Design v0.3] | EIP-712 `MilestoneProof` signed by the milestone's issuer key; demo issuers on the server | Real TradeTrust or eBL documents and IoT gateways are roadmap |
| Contracts toolchain | Foundry (solc 0.8.28, Cancun), OpenZeppelin 5.4, Safe v1.4.1 deployments on Base Sepolia | |
| Frontend | React 19, Vite 8, TypeScript 6, viem 2, wagmi 3 | Deployed on Vercel |
| Storage | SQLite (WAL) with hash-chained ledger rows | PostgreSQL in later versions |
| Hosting | Tencent CVM, Docker Compose, Caddy | See "Hosting" |

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
| Create and fund a trade order [Design v0.3] | Owner, through a Safe transaction |
| Check a milestone proof [Design v0.3] | Proof Verifier |
| Explain a verified or held milestone, propose a next action [Design v0.3] | LLM (Verification Agent) |
| Sign a release authorization [Design v0.3] | Authorizer, after its own re-verification |
| Waive a held milestone or refund an order [Design v0.3] | Owner, through a Safe transaction |
| Enforce and pay the supplier [Design v0.3] | TradeEscrow |

**The "only more conservative" rule.** The Allocation Planner returns a set of options and marks one as the default: the option its deterministic objective ranks best within policy. The LLM may choose the default, "hold", or any option whose amount in every vault is at or below the default's amount, and may further reduce amounts. If the LLM chooses an option above the default in any vault, the Proposal Validator does not reject it silently: it raises the action to tier T3, so the owner must approve it. A manipulated model can therefore cause less exposure on its own, never more.

**Input handling.**
- Owner chat messages are intent from an authenticated user, but they can only select within policy. A message cannot change policy; policy changes are separate signed owner or bank transactions.
- Externally sourced text (vault or token names, metadata, documents) is passed to the LLM as quoted data with a source label, never as instructions. It cannot reach a signer, because signers accept only validated plan options.
- Every tool call is scoped to the Safe bound to the session. The bank desk uses a separate read-only role.
- Proof contents and uploaded trade documents are external data. They reach the LLM only as quoted data. The release decision comes from the deterministic checks, never from the LLM [Design v0.3].

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

**Milestone state machine [Design v0.3].** Each milestone of an order has its own persisted off-chain state. On-chain, a milestone is only `PENDING`, `RELEASED`, `WAIVED` or `REFUNDED` (see 04).

```
(proof fails admission: 4xx, no ledger row, no state change)

AWAITING_PROOF → PROOF_RECEIVED ─┬─► PROOF_VERIFIED → RELEASE_SIGNED ─┬─► RELEASE_SUBMITTED ─┬─► RELEASED
                                 │                                    │                       └─► RELEASE_FAILED (revert)
                                 │                                    └─► RELEASE_FAILED (preflight fails)
                                 ├─► WAITING ─(PolicyChanged or MilestoneReleased: check again)─► PROOF_RECEIVED
                                 └─► HELD ─┬─► (owner waives) ─────────────────────────────► WAIVED
                                           ├─► (new proof + owner ReleaseConfirmation) ─────► PROOF_RECEIVED
                                           └─► (pending deadline passed, owner refunds) ────► REFUNDED
RELEASE_FAILED ─┬─► (retryable selector, fewer than 2 re-signs used) ─► PROOF_RECEIVED
                ├─► (cause is now a WAITING reason) ─────────────────► WAITING
                └─► (any other selector, or a third failure) ─────────► HELD (ReleaseFailed:<selector>)
A refund moves every milestone that is not yet paid to REFUNDED. An order that is no longer active ends
every open milestone with the terminal reason OrderNotActive.
```

Rules:
- No path to `RELEASE_SIGNED` skips `PROOF_VERIFIED` and the Authorizer's own re-verification.
- Admission comes first (v0.4, C4). A proof whose order is unknown or inactive, whose milestone is already paid, whose order, index or kind does not match, whose signature does not recover to the milestone's issuer, or whose uploaded document is too large or does not hash to `docHash` is refused with 4xx. It writes no ledger row and changes no state. An unsigned or wrongly signed proof can therefore never hold a milestone.
- `WAITING` is for transient reasons (v0.4, C5): `Frozen` (owner or bank freeze), `OutOfOrder` (an earlier milestone is not yet paid, for example its release is still pending), and `AuthorizerNotCurrent` (v0.4, V1). The service checks a waiting milestone again on every `PolicyChanged` event of the buyer Safe and every `MilestoneReleased` event of the order, with no owner action. A bank unfreeze or the earlier release being mined therefore resumes the milestone.
- `HELD` is only for an admitted, issuer-signed proof. Reason codes: `ConditionNotMet`, `BadProofTime`, `DeadlinePassed`, `ReleaseFailed:<selector>`.
- `RELEASE_FAILED` (v0.4, C7). The Executor reports every preflight failure and revert of a release. The service first runs the verification again: if the cause is now a `WAITING` reason, the milestone goes to `WAITING` and no retry is used. Otherwise, for `PolicyVersionMismatch`, `Expired`, or `NonceUsed` with no `MilestoneReleased` event for this milestone, the service signs again, at most twice per milestone. Any other selector, or a third failure, ends in `HELD` with reason `ReleaseFailed:<selector>`. Each transition writes one ledger row.
- `OrderNotActive` is a terminal reason (v0.4, C5): when an order is refunded or completed, every open milestone of it ends with this reason.
- After a hold, the agent does not ask for a release on a later proof for the same milestone until the owner signs a `ReleaseConfirmation` for that proof (v0.4, C8). A corrected proof is a known manipulation path, so it gets a human look.
- After the pending milestone's deadline, the agent does not ask for a release. It holds with `DeadlinePassed` and offers the owner a late release (with a signed `ReleaseConfirmation`) or a refund.
- A `RELEASE_FAILED` with `OutOfOrder` after a `MilestoneReleased` event for the same milestone counts as released: someone else submitted the same release first.
- All time comparisons use the latest block timestamp (v0.4, C6).
- Every terminal state writes a ledger row.
- These rules are workflow policy, not a security boundary. The contract enforces the binding rules on its own.

### Core algorithms and evaluation approach

**1. Required reserve.** For an obligation schedule over horizon H (default 30 days):

```
R_required = max over t in [0, H] of max(0, Σ_{i ≤ t} O_i − Σ_{i ≤ t} I_i) + B
```

- `O_i`: approved obligations due at time i.
- `I_i`: inflows marked "confirmed" by the owner. Unconfirmed inflows count as zero.
- `B`: buffer, `max(B_min, b × Σ O_i)`, defaults `B_min = 500 USDC`, `b = 10%`.

Taking the maximum over cumulative net outflow covers the worst point in the horizon, so an early large payment is covered even if later inflows offset it. Escrowed TradeFlow milestones are not obligations in this formula, because their funds have already left the Safe [Design v0.3].

**Floor synchronisation.** Approving or settling an obligation in the app produces an owner-signed `setReserveFloor(ceil(R_required), scheduleHash)` transaction. The API returns the floor value and the schedule hash, and the web encodes the call to the pinned registry (v0.4, C1). The planner compares `registry.reserveFloor` with `R_required` before every plan. If the on-chain floor is lower, the planner returns HOLD with reason `FloorOutOfSync` and asks the owner to sign the update. `scheduleHash` is also included in every DAR's evidence hash, so each decision is linked to the schedule it was planned against. A new tenant starts with floor 0 while the required reserve is the 500 USDC buffer, so its agent holds until the owner sends the first floor update.

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

**5. Exit Agent.** Runs every 5 blocks (about 10 seconds on Base Sepolia), for every served tenant that holds vault shares.
1. On a trigger, it quarantines the vault on-chain (`quarantine(safe, vault)`, allowed for the Exit key) and tells the service to drop any pending deposit DARs for that vault.
2. It sizes the exit: `shares = min(position, maxRedeem(Safe))`, `minAssets = previewRedeem(shares) × (1 − 0.5%)`.
3. It simulates, signs the redeem with the Exit key, and hands it to the Executor. If the Executor has not included it within 3 blocks, the Exit Agent submits it itself.
4. It repeats every window until the position is closed. If `maxRedeem` is zero, it raises a critical alert to the owner and bank.

Quarantine is cleared only by the owner, after a cooldown of 24 hours with no trigger.

**6. Treasury view with escrow [Design v0.3].**

```
Cash      = Safe USDC + withdrawable vault assets                (= L)
Committed = TradeEscrow.committedOf(Safe)                        (unreleased escrow, read from the chain)
Free      = D = max(0, L − R_required − F)
```

Committed is shown so the owner sees the full position (Cash + Committed). It is never added to `L` or `R_required`.

**7. Milestone proof verification [Design v0.3].** For a proof of milestone `i` of order `o`, "now" is the latest block timestamp (v0.4, C6). The Proof Verifier runs two stages.

Stage A, admission (v0.4, C4). A failure returns 4xx, writes no ledger row and changes no state:
1. The order exists and is active, and milestone `i` is not already paid.
2. `proof.orderId`, `proof.index` and `proof.kind` match the order and milestone.
3. The EIP-712 signature recovers to the milestone's issuer.
4. If a document was uploaded: it is at most 1 MB (413 otherwise) and `keccak256(document) == docHash`.

Stage B, in the contract's order where the contract has the check:
5. `i` is the next unpaid milestone, else `WAITING` with `OutOfOrder`.
6. The buyer Safe is not frozen, else `WAITING` with `Frozen`.
7. `registry.authorizer(buyer)` is the service's Authorizer address, else `WAITING` with `AuthorizerNotCurrent` (v0.4, V1).
8. `order.createdAt ≤ proof.issuedAt ≤ now`, else `HELD` with `BadProofTime`.
9. Conditions: if a document is required, `docHash` is non-zero; if temperature applies, `samples > 0`, `minTempCenti ≤ maxTempCenti`, and both lie within the milestone bounds (inclusive). Else `HELD` with `ConditionNotMet`.
10. Off-chain only: the pending deadline has not passed, else `HELD` with `DeadlinePassed` unless a valid owner `ReleaseConfirmation` exists.

The Verification Agent then writes a short explanation and proposes one action from a fixed set: `REQUEST_RESURVEY`, `WAIT_FOR_CORRECTED_PROOF`, `WAIVE`, `REFUND_AFTER_DEADLINE` or `NO_ACTION`. An answer outside the set is replaced by the rule-based proposal. In deterministic mode, a template and the same rules produce the text and the proposal. A proposal is a button for the owner; nothing executes without the owner.

**Evaluation approach.**

| Area | Method |
|---|---|
| Financial | Replay obligation and price scenarios against baselines: idle cash, highest-APY allocation, static 50/50. Metrics: obligation coverage, liquidity shortfall, net return after gas |
| Risk response | Inject depeg, staleness and liquidity shocks; measure blocks from shock to protective execution, including partial exits |
| Agent task completion | Scripted tasks: allocate, rebalance, hold, obligation change, clarification, denial then correction. Pass if the final on-chain state and the ledger match the expected result |
| Robustness | Same request 10 times yields the same executed state |
| Security | Contract tests, attack scenarios on testnet, curated injection set (see 04 and 05) |
| Tenant isolation | Every endpoint and the stream tried across two tenants; a two-tenant end-to-end run on Anvil |
| Proof verification [Design v0.3] | Fixed proof corpus: valid, out of range, wrong issuer, tampered field, wrong order, early or future issue time, missing document. Expected: 100% correct verdicts and the same verdict from the contract's `checkRelease` |
| Settlement latency [Design v0.3] | Blocks from a valid proof to `MilestoneReleased` |

Results so far: on 17 Oct 2026, the local runs of the contract (47), service unit (111) and web (21) tests passed. The on-chain evidence E1 to E5 is recorded (05). The financial replay against baselines and a full AgentDojo run are not done: TBD.

---

## 04 Security Design

### Threat model

| Item | Scope |
|---|---|
| Asset | Treasury funds in each tenant's Safe and vaults. Escrowed milestone funds in TradeEscrow [Design v0.3] |
| Adversaries | Prompt injection by a user or third party; malicious data sources and vault metadata; a compromised server process or non-owner key; replay of old authorizations; a malicious vault contract; a visitor who abuses the public onboarding or tries to reach another tenant; a dishonest supplier or proof issuer, or both together [Design v0.3] |
| Out of scope for the MVP | Compromise of the owner's own wallet; consensus-level attacks; bugs in Safe core contracts; malware or script injection in a visitor's browser, which holds testnet burner keys (see Known limitations) |

### Role matrix (PolicyRegistry)

Each Safe has its own policy, its own `policyVersion`, and these roles. Any change increments `policyVersion`.

| Function | Owner | Bank | Exit key | Notes |
|---|---|---|---|---|
| `register(safe, owner, bank)` | Once, by the Safe owner when the Safe has threshold 1, or by the Safe itself | No | No | A co-owner of a multi-owner Safe cannot take the registry owner role |
| `addVault` | Yes | No | No | Only the custody holder can widen where funds may go |
| `removeVault` | Yes | Yes | No | Removal stops deposits; redemptions remain allowed |
| Raise `autoCap`, `dailyCap`, `maxBandWidth`, `maxOracleAge` | Yes | No | No | Loosening |
| Lower `autoCap`, `dailyCap`, `maxBandWidth`, `maxOracleAge` | Yes | Yes | No | Tightening |
| `setBankLimit` | No | Yes | No | Controls when bank approval is required |
| `setReserveFloor` | Yes | No | No | Produced by obligation approval in the app |
| `setAuthorizer` | Yes | No | No | Cannot clear a bank freeze |
| `setExitKey` | Yes | No | No | |
| `revokeAuthorizer` | Yes | Yes | No | Bank revocation also sets the bank freeze |
| `ownerFreeze` / `ownerUnfreeze` | Yes | No | No | |
| `bankFreeze` / `bankUnfreeze` | No | Yes | No | Only the bank can lift its own freeze |
| `quarantine(safe, vault)` | Yes | Yes | Set only | Clearing needs the owner |

**TradeEscrow roles [Design v0.3].** TradeEscrow has no admin, no owner, no pause and no upgrade path. It reads PolicyRegistry for the buyer Safe: `owner` (to require a registered Safe), `authorizer` and `exitKey` (to check the release signer), `ownerFrozen` and `bankFrozen`, and `policyVersion`. It does not read `bank`, because the bank acts only through the registry freeze.

| Function | Buyer Safe (owner-signed Safe tx) | Bank | Authorizer | Milestone issuer | Anyone |
|---|---|---|---|---|---|
| `createOrder` | Yes | No | No | No | No |
| `release` | No | No | Signs `ReleaseAuthorization` | Signs `MilestoneProof` | Submits |
| `waive` | Yes | No | No | No | No |
| `refund` | Yes, after the pending deadline | No | No | No | No |
| Stop releases and waivers | Owner freeze | Bank freeze | No | No | No |

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

`dailyCap` (per UTC day, chosen over a rolling window to keep on-chain bookkeeping to one counter) applies to every deposit tier. An amount above `dailyCap` needs the owner to raise the cap first. A `bankLimit` of 0 means no bank approval is required.

**TradeFlow actions [Design v0.3].** TradeFlow actions are not DAR tiers. They map to these confirmations:

| Action | Who acts | Required signatures |
|---|---|---|
| Fund an order (`createOrder`) | Owner, through a Safe transaction | Owner. The owner approves the supplier, amounts, issuers, conditions and deadlines once, here |
| Release a milestone | Anyone submits | Milestone issuer (`MilestoneProof`) + Authorizer (`ReleaseAuthorization`) |
| Waive a held milestone | Owner, through a Safe transaction | Owner |
| Refund an order | Owner, through a Safe transaction, after the pending deadline | Owner |
| Pay anyone other than the order's supplier; refund to anyone other than the buyer Safe; pay an amount other than the milestone amount | | Not representable |

### Signed structures

```
Approval { safe, op, vault, maxAmount, policyVersion, approvalExpiry, approvalNonce }
    signed by the owner (T3), or by the owner and the bank (T4). Default approvalExpiry: 24 h.

DAR { safe, op, vault, amount, minOut, policyVersion, priceLow, priceHigh,
      tier, approvalHash, nonce, expiry, evidenceHash }
    signed by the Authorizer (or the Exit key for REDEEM). Default expiry: 120 s.
```

The DAR expiry (120 s) is shorter than `maxOracleAge` (180 s), so a DAR never outlives the market data it was planned on. Nonces are random 256-bit values tracked in a used-set, so independent signers never collide. The EIP-712 domain is `name = "AegisModule"`, `version = "1"`, the chain id and the module address. `approvalHash` is the EIP-712 struct hash of the Approval, or zero for T1 and T2.

Off-chain signed messages (personal_sign, verified by the backend; the prefixes keep the old name):

```
AEGIS onboarding\nowner: <checksum>\nbank: <checksum>\nchainId: 84532\nissuedAt: <ISO-8601>     max age 5 min
AEGIS session\nrole: owner|bank\naddress: <checksum>\nchainId: 84532\nissuedAt: <ISO-8601>     max age 10 min
```

**TradeFlow structures [Design v0.3].** EIP-712 domain: `name = "TradeEscrow"`, `version = "1"`, the chain id and the TradeEscrow address. The separate domain means a DAR signature can never be read as a release authorization, and the reverse.

```
MilestoneProof(uint256 orderId,uint8 index,uint8 kind,bytes32 docHash,int32 minTempCenti,int32 maxTempCenti,uint32 samples,uint64 issuedAt)
    signed by the milestone's issuer (an EOA).
    docHash: keccak256 of the evidence document (bill of lading, sensor log export, survey report).
    minTempCenti, maxTempCenti, samples: summary of the readings; zero when temperature does not apply.

ReleaseAuthorization(uint256 orderId,uint8 index,uint256 amount,bytes32 proofHash,uint64 policyVersion,uint256 nonce,uint64 expiry)
    signed by the buyer Safe's current Authorizer (registry.authorizer(buyer)); the Exit key is refused.
    proofHash: EIP-712 struct hash (hashStruct) of the MilestoneProof. Default expiry: 120 s, like the DAR.
```

The field orders above are the type strings. `int32` values are sign-extended to 32 bytes, as EIP-712 specifies; the service and web encoders must use the same types (test T29).

One off-chain structure joins them in v0.4: `ReleaseConfirmation(uint256 orderId,uint8 index,bytes32 proofHash,uint64 expiry)`, signed by the owner in the same TradeEscrow domain and verified only by the Authorizer, never by the contract (see 02, "Owner release confirmation"; C8).

### On-chain enforcement (AegisModule)

`deposit(dar, authSig, ownerApprovalSig, bankApprovalSig, approval)` and `redeem(dar, sig)` can be called by anyone; only the signatures give authority. The Executor is a convenience, not a gate.

**For `redeem` (risk-reducing):**
1. Signature from the Authorizer or the Exit key over the DAR.
2. `dar.op` is `REDEEM`; `block.timestamp ≤ dar.expiry`; `dar.nonce` unused, then marked used.
3. The Safe has deposited into `dar.vault` through the module before (`everDeposited`) and holds at least `dar.amount` shares of it; otherwise `NoPosition`. Delisted or quarantined vaults are allowed. The `everDeposited` check stops the Safe from calling `redeem` on a contract it never deposited into (test C26).
4. The module calls `redeem(shares, receiver = Safe, owner = Safe)` through `execTransactionFromModuleReturnData`, requires success, and measures the USDC received as the change in the Safe's balance. It requires the measured amount ≥ `dar.minOut`.
5. Emits `AegisExecuted(safe, darHash, REDEEM, vault, assetsReceived, sharesBurned, T1, evidenceHash)`.

Freezes, policy version, the vault allowlist and the oracle are deliberately not checked for redemptions.

**For `deposit` (risk-increasing):**
1. No owner freeze and no bank freeze; vault not quarantined.
2. `dar.policyVersion == registry.policyVersion`.
3. `dar.vault` is in the allowlist (added by the owner).
4. Derive `requiredTier` from the amount, `autoCap`, `bankLimit`, and the per-vault `everDeposited` flag; use `max(requiredTier, dar.tier)`.
5. Verify the Authorizer signature over the DAR. For T3 and T4, verify each Approval signature, that `approvalHash` matches, that `op`, `vault` and `safe` match, that `dar.amount ≤ approval.maxAmount`, that the Approval's policy version is current, that the Approval is unexpired and unused, then mark it used.
6. `block.timestamp ≤ dar.expiry`; `dar.nonce` unused, then marked used.
7. Oracle: `now − updatedAt ≤ maxOracleAge`, price within `[priceLow, priceHigh]`, and `priceHigh − priceLow ≤ maxBandWidth`.
8. Caps: Safe USDC balance after the deposit ≥ `reserveFloor`; deposits today (UTC) + amount ≤ `dailyCap`.
9. The module calls exact `approve`, `deposit(amount, receiver = Safe)` and `approve(0)` through `execTransactionFromModuleReturnData`, requires each call to succeed, and measures shares received. It requires shares ≥ `dar.minOut` and sets `everDeposited[vault]`.
10. Emits `AegisExecuted(safe, darHash, DEPOSIT, vault, assetsSpent, sharesReceived, tier, evidenceHash)`.

There is no code path that sets a receiver other than the Safe. Any failed check reverts with a typed error (for example `Frozen`, `VaultQuarantined`, `MissingApproval`, `PriceOutOfBand`, `StaleOracle`, `ReserveFloorBreached`, `ExecutionFailed`). The full error list is in `docs/INTERFACES.md`.

**Simulation entry point.** `check(dar, approval)` is a view that runs every deposit or redeem check except signature verification and returns the expected result and tier. The Simulator calls it before signing, together with an `eth_call` of the vault calls from the Safe address. After signing, it runs one final `eth_call` of the signed submission before broadcast.

### On-chain enforcement (TradeEscrow) [Design v0.3]

**State.**

```solidity
contract TradeEscrow is EIP712("TradeEscrow", "1"), ReentrancyGuard {
    enum Kind { HANDOVER, ARRIVAL, QUALITY }                 // 0, 1, 2; milestone i must have kind i
    enum OrderStatus { NONE, ACTIVE, COMPLETED, REFUNDED }
    enum MilestoneStatus { PENDING, RELEASED, WAIVED, REFUNDED }

    struct MilestoneTerms {
        uint256 amount;        // raw token units, > 0
        address issuer;        // trusted issuer EOA for this milestone
        uint8   kind;          // Kind
        bool    requireDoc;    // proof.docHash must be non-zero
        bool    checkTemp;     // temperature condition applies
        int32   minTempCenti;  // inclusive lower bound, centi-degrees Celsius
        int32   maxTempCenti;  // inclusive upper bound
        uint64  deadline;      // unix seconds; gates refund only
    }
    struct Order {
        address buyer;         // registered Safe; msg.sender of createOrder
        address supplier;      // fixed at creation; the only payee
        uint64  createdAt;
        uint8   nextIndex;     // next unpaid milestone, 0 to 3
        uint8   status;        // OrderStatus
        uint256 total;         // sum of the three amounts
        uint256 released;      // paid to the supplier so far
        bytes32 termsHash;     // hash of the off-chain purchase order
    }

    IPolicyRegistry public immutable registry;
    IERC20 public immutable token;                           // MockUSDC
    uint256 public nextOrderId = 1;
    uint256 public escrowedTotal;                            // sum of unreleased funds of active orders
    mapping(uint256 => Order) internal _orders;
    mapping(uint256 => MilestoneTerms[3]) internal _terms;
    mapping(uint256 => MilestoneStatus[3]) internal _mstatus;
    mapping(address => uint256) public committedOf;          // per buyer Safe
    mapping(address => mapping(uint256 => bool)) public usedNonce;
}
```

**Functions.**

```solidity
function createOrder(address supplier, uint256 total, bytes32 termsHash, MilestoneTerms[3] calldata ms)
    external returns (uint256 orderId);
function release(uint256 orderId, uint8 index, MilestoneProof calldata proof, bytes calldata issuerSig,
                 ReleaseAuthorization calldata auth, bytes calldata authSig) external;   // anyone may call
function waive(uint256 orderId, uint8 index) external;                                    // buyer Safe only
function refund(uint256 orderId) external;                                                // buyer Safe only
function checkRelease(uint256 orderId, uint8 index, MilestoneProof calldata proof,
                      ReleaseAuthorization calldata auth) external view returns (bool ok, bytes4 errorSelector);
function getOrder(uint256 orderId) external view returns (Order memory);
function getMilestone(uint256 orderId, uint8 index) external view returns (MilestoneTerms memory, MilestoneStatus);
function hashProof(MilestoneProof calldata) external view returns (bytes32);              // full EIP-712 digest
function proofStructHash(MilestoneProof calldata) external pure returns (bytes32);        // hashStruct
function hashAuthorization(ReleaseAuthorization calldata) external view returns (bytes32); // full EIP-712 digest
```

All state-changing functions are `nonReentrant`, follow checks, effects, then the token call, and use SafeERC20. No function moves tokens except `createOrder` (in), `release` and `waive` (to the supplier) and `refund` (to the buyer).

**`createOrder` checks, in order** (`msg.sender` is the buyer Safe):
1. `registry.owner(msg.sender) != 0`, else `NotRegistered`.
2. No owner freeze and no bank freeze on `msg.sender`, else `Frozen`. Funding commits money to a third party, so it is treated as risk-increasing.
3. `supplier` is not zero, not the buyer, not the escrow and not the token, else `BadSupplier`.
4. For each milestone `i`: `amount > 0`, `kind == i`, and if `checkTemp` then `minTempCenti ≤ maxTempCenti`; else `BadMilestone`.
5. For each milestone: `issuer` is not zero and not the supplier, else `BadIssuer`. The supplier cannot attest to its own milestones.
6. `amount_0 + amount_1 + amount_2 == total`, else `AmountMismatch`.
7. `block.timestamp < deadline_0 ≤ deadline_1 ≤ deadline_2`, else `BadDeadline`.
8. Effects: assign `orderId = nextOrderId++`, store the order and terms, add `total` to `committedOf[buyer]` and `escrowedTotal`.
9. Pull `total` with `safeTransferFrom(buyer, escrow, total)` and require the escrow's balance change to equal `total`, else `AmountMismatch`.
10. Emit `OrderCreated`.

**`release` checks, in order.** The order matters for which error a judge sees, not for safety: every check must pass. Proof checks come before the authorization, so a failed condition reports `ConditionNotMet` even when an Authorizer signature is present.
1. Order status is `ACTIVE`, else `OrderNotActive`.
2. `index == order.nextIndex`, else `OutOfOrder`. Milestones are paid in order, and a second release of the same milestone fails here.
3. No owner freeze and no bank freeze on the buyer Safe, else `Frozen`.
4. `proof.orderId == orderId`, `proof.index == index`, `proof.kind == milestone.kind`, else `ProofMismatch`.
5. The proof signature recovers to `milestone.issuer` (and not to zero), else `BadSignature`.
6. `order.createdAt ≤ proof.issuedAt ≤ block.timestamp`, else `BadProofTime`.
7. Conditions, else `ConditionNotMet`: if `requireDoc`, `proof.docHash != 0`; if `checkTemp`, `proof.samples > 0`, `proof.minTempCenti ≤ proof.maxTempCenti`, `proof.minTempCenti ≥ milestone.minTempCenti` and `proof.maxTempCenti ≤ milestone.maxTempCenti`.
8. The authorization signature recovers to `registry.authorizer(buyer)`, not to zero and not to `registry.exitKey(buyer)`, else `BadSignature`. A changed amount fails here.
9. `auth.orderId == orderId`, `auth.index == index`, `auth.amount == milestone.amount`, `auth.proofHash == proofStructHash(proof)`, else `AuthorizationMismatch`.
10. `auth.policyVersion == registry.policyVersion(buyer)`, else `PolicyVersionMismatch`.
11. `block.timestamp ≤ auth.expiry`, else `Expired`.
12. `usedNonce[buyer][auth.nonce]` is false, else `NonceUsed`.
13. Effects: mark the nonce used; set the milestone `RELEASED`; increment `nextIndex`; add the amount to `released`; subtract it from `committedOf[buyer]` and `escrowedTotal`; if `nextIndex == 3`, set the order `COMPLETED`.
14. `safeTransfer(order.supplier, milestone.amount)`.
15. Emit `MilestoneReleased(orderId, index, supplier, amount, proofHash, authDigest, false)`.

Release does not check the deadline. The deadline only gates refunds. After it passes, the service holds instead of asking for a release (03), so the owner decides between a late release and a refund.

**`waive(orderId, index)` checks, in order:** `msg.sender == order.buyer` (`Unauthorized`); order `ACTIVE` (`OrderNotActive`); `index == order.nextIndex` (`OutOfOrder`); no owner or bank freeze (`Frozen`). Effects as in release, with the milestone set `WAIVED`. It pays only `milestone.amount` and only to the supplier. Emits `MilestoneReleased(orderId, index, supplier, amount, 0, 0, true)`.

**`refund(orderId)` checks, in order:** `msg.sender == order.buyer` (`Unauthorized`); order `ACTIVE` (`OrderNotActive`); `block.timestamp > deadline` of milestone `nextIndex` (`DeadlineNotPassed`). Freezes are not checked: exits are always allowed. Effects: `amount = total − released`; every unpaid milestone set `REFUNDED`; order `REFUNDED`; subtract `amount` from `committedOf[buyer]` and `escrowedTotal`. Then `safeTransfer(order.buyer, amount)` and emit `OrderRefunded`.

**`checkRelease`** runs release checks 1 to 12 except the two signature checks (5 and 8) and returns the first failing error selector. The Simulator calls it before asking the Authorizer, and the Executor calls it again with a final signed `eth_call` before broadcast.

**Errors.** Shared names keep the AegisModule meaning.

```
Unauthorized() NotRegistered() Frozen() BadSupplier() BadIssuer() BadMilestone() AmountMismatch()
BadDeadline() OrderNotActive() OutOfOrder() ProofMismatch() BadSignature() BadProofTime()
ConditionNotMet() AuthorizationMismatch() PolicyVersionMismatch() Expired() NonceUsed() DeadlineNotPassed()
```

**Events.**

```solidity
event OrderCreated(uint256 indexed orderId, address indexed buyer, address indexed supplier,
                   uint256 total, bytes32 termsHash);
event MilestoneReleased(uint256 indexed orderId, uint8 index, address indexed supplier, uint256 amount,
                        bytes32 proofHash, bytes32 authHash, bool waived);
event OrderRefunded(uint256 indexed orderId, address indexed buyer, uint256 amount);
```

**State machine.**

```
Order:      NONE ──createOrder──► ACTIVE ──release or waive of index 2──► COMPLETED
                                    │
                                    └──refund (after the pending milestone's deadline)──► REFUNDED

Milestone i (only when i == nextIndex):   PENDING ──release──► RELEASED
                                                  ──waive────► WAIVED
                                                  ──refund───► REFUNDED (all unpaid milestones at once)
```

**Invariants** (tested in T32 to T35):
- `token.balanceOf(escrow) == escrowedTotal == Σ (total − released)` over active orders, when nobody sends tokens to the escrow directly (with donations, the balance is greater or equal).
- Tokens leave the escrow only to an order's supplier (`release`, `waive`) or to the order's buyer Safe (`refund`).
- No double payment: for every order, `released ≤ total`, each milestone is paid at most once, and `released` equals the sum of the paid milestones below `nextIndex`.
- `committedOf[buyer]` equals the sum of unreleased funds of the buyer's active orders.

**Interaction with the registry.** Every registry change bumps `policyVersion`, including a bank tightening a cap, an owner floor update and an Exit Agent quarantine. An authorization in flight then fails `PolicyVersionMismatch`, and the service signs a new one after re-verification. Freeze and unfreeze also bump the version, so an authorization signed before a freeze cannot be used after the unfreeze.

### Key separation and blast radius

| Key | Holder | If compromised |
|---|---|---|
| Owner | Business owner's wallet (a browser burner key in the multi-tenant app) | Full control of their own Safe. Out of scope, as with any self-custody wallet |
| Bank | Bank risk officer's wallet (a browser burner key in the multi-tenant app) | Can freeze deposits, remove vaults, tighten limits, revoke the Authorizer, quarantine. With TradeFlow: can stop releases and waivers [Design v0.3]. Cannot move funds and cannot block redemptions or refunds |
| Authorizer | Separate server process | Can only make T2 deposits: ≤ `autoCap` each, ≤ `dailyCap` per day, into vaults the owner added and the Safe has used before, above the reserve floor, at a fresh in-band price. Funds cannot leave the treasury. With TradeFlow it can sign releases, but a release also needs a valid issuer proof that meets the conditions, and it pays only the fixed amount to the fixed supplier [Design v0.3]. Owner or bank can revoke it |
| Exit key | Exit Agent process | Can only redeem back to the Safe. Worst case: funds return early and earn nothing |
| Executor | Relayer | Nothing; anyone can submit signed DARs, so withholding them only delays until the Exit Agent or owner submits |
| LLM process | No key | Nothing on-chain; worst case is a wrong proposal that downstream checks reject or escalate |
| Demo issuer keys [Design v0.3] | API process only (v0.4, C3) | Can sign proofs for milestones whose issuer is that demo key. A release also needs the Authorizer, but the API process also holds `INTERNAL_TOKEN` and can ask the Authorizer to sign. So in the demo, a compromise of the API process alone can obtain releases for demo-issued milestones. Each pays only the fixed amount to the supplier the owner chose |

No single compromised component short of the owner's own key can move funds out of the treasury, and no single non-owner party can both freeze and unfreeze the agent. This holds only because the owner key signs nothing but transactions that the web encodes itself against pinned addresses (v0.4, C1). In v0.3 and in the built floor update before the v0.4 fix, it did not hold: a compromised API could return a Safe `execTransaction` with a delegatecall as the "floor update", and one owner click would drain the Safe. With TradeFlow, the only path out of the treasury is an owner-funded order, and its funds go only to the supplier the owner chose or back to the Safe [Design v0.3].

**Shared operator keys in a multi-tenant setting [Built].** The Authorizer, Exit, Executor and Keeper keys are the same for every tenant, and activation requires that. Each key's on-chain limits still apply per tenant, but one leak reaches every tenant at once.

| Key or secret | Holder | Blast radius across tenants |
|---|---|---|
| Authorizer | Authorizer process | T2 deposits for every tenant, each within that tenant's caps, floor and used vaults. No funds leave any Safe. Recovery needs each owner (or bank) to revoke or replace it: one transaction per tenant, because only the owner sets the Authorizer |
| Exit key | Exit Agent process | Can quarantine every tenant's vaults and redeem every position back to its Safe. Quarantine bumps each tenant's `policyVersion` and needs the owner to clear it after 24 h. An availability attack, not a loss |
| Executor, Keeper | Their processes | Gas spending only. The keeper can only refresh the current price, not set it |
| DEPLOYER (faucet and mock admin) | API process | Mints test USDC; owns the mock price feed and vaults, so it can move the price for every tenant, cap vault liquidity, or set vault revert modes that block redemptions. This power exists only because the market is mocked |
| ATTACKER | API process | Sends transactions that revert; holds a little test ETH |
| `INTERNAL_TOKEN` | API, Authorizer, Exit Agent (v0.4, C3; the built supervisor also passes it to the Executor and the Keeper until the v0.4 change) | Lets a caller ask the Authorizer to sign. The Authorizer re-verifies every request against its own chain reads; `sign-inert` signs only DARs that expired at least one hour ago |
| `ADMIN_TOKEN` | Operator | Runs market scenarios on the shared mocks, which affect every tenant |
| The API host | One container | Holds all of the above. Worst case: every server key at once. With the v0.4 owner transaction rule (C1), funds still cannot leave any Safe except through TradeFlow orders that owners funded, to the suppliers they chose. The host also serves the onboarding config, so it could still point new tenants at a malicious module (see Known limitations) |

### Protection against prompt injection, privilege escalation, data extraction and privacy leakage

| Threat | Mitigation | Where enforced |
|---|---|---|
| Direct prompt injection ("send everything to 0x…") | No transfer path exists; cannot be expressed as a typed action | AegisModule |
| Indirect injection via vault or token metadata | External text passed as labelled data; signers accept validated plan options only | Agent input handling, Proposal Validator |
| Manipulated model raises exposure | Choices above the default option escalate to owner approval | Proposal Validator, tier derivation |
| Parameter tampering after signing | EIP-712 signatures cover every field; Approval bounds the amount | AegisModule deposit step 5 |
| Replay | Random nonces in a used-set; expiry on DARs and Approvals | AegisModule |
| Acting on stale or moved prices | Freshness, price band, maximum band width, 120 s DAR expiry | AegisModule deposit step 7 |
| Unit or amount error | Simulation of exact deltas; reserve floor and caps on-chain; measured amounts in events | Simulator, AegisModule |
| Malicious vault | Only the owner can add vaults; first deposit needs owner approval; exact approve reset to zero; inner call success required; redeem only from vaults the Safe deposited into | PolicyRegistry, AegisModule |
| Privilege escalation through chat | Chat cannot change policy; tier derived on-chain | PolicyRegistry, AegisModule |
| Privilege escalation through a stolen bank key | Role matrix: bank can only tighten, freeze and revoke | PolicyRegistry |
| Cross-client data extraction | Every tool, endpoint and stream event bound server-side to the session's Safe; bank desk is a separate read-only role | Porthmos Service |
| Acting on another tenant's Safe | Owner sessions need a signed session message and `registry.owner(safe)` equal to the signer; the Authorizer signs only for served tenants | Sessions, Authorizer, PolicyRegistry |
| Onboarding abuse (faucet drain, mass sign-ups) | Signed onboarding request, one drip per address, daily ETH budget, per-IP limits, tenant cap, one treasury per owner, one mint per Safe | Onboarding |
| Hidden activity by a compromised server | Hash-chained ledger; bank desk reads `AegisExecuted` events directly and flags mismatches | Bank Risk Desk |
| Data leakage to the LLM provider | The owner's chat text, aggregated amounts and pseudonymous IDs only; no keys or identity documents; secrets from environment, redacted from logs. Client IPs stored only as salted hashes | Porthmos Service |
| Owner key signs API-supplied calldata (v0.4, C1) | The API returns parameters only; the web encodes every owner and bank transaction against pinned addresses; the send function refuses unpinned targets and any Safe `execTransaction` it did not build | Web App |
| LLM triggers a supplier payment [Design v0.3] | The LLM only explains and proposes from a fixed set; a release needs deterministic checks, the Authorizer's re-verification and the on-chain checks | Verification Agent, Authorizer, TradeEscrow |

### TradeFlow threats [Design v0.3]

| Threat | Effect if it succeeds | Mitigation | Residual risk |
|---|---|---|---|
| Issuer key compromise | False proofs for that issuer's milestones | A release also needs the Authorizer; it pays only the fixed amount, only to the fixed supplier, only in order; the owner or bank can freeze | Early payment to the supplier the owner chose. Roadmap: issuer registry with revocation, k-of-n issuers |
| Supplier and issuer collude | Payment for goods not delivered | Issuer cannot be the supplier; each milestone has its own issuer (carrier, sensor, surveyor), so full payment needs several parties to lie; the final 40% depends on a surveyor the buyer chose | The contract cannot detect a signed lie. Roadmap: dispute window, arbitration |
| Replay across orders or chains | One proof or authorization used twice | EIP-712 domain with chain id and escrow address; `orderId` and `index` in both structs; `proofHash` ties an authorization to one proof; random nonce in a used-set; 120 s expiry; `OutOfOrder` after payment | None known |
| Front-running a release | Someone copies a pending release | Submission is permissionless and the payee is fixed, so a copy pays the same supplier the same amount. The original reverts `OutOfOrder`; the service treats that as released when the event exists | The copier pays the gas |
| Griefing by withholding proofs | The supplier or an issuer never sends a proof | The owner refunds all unreleased funds after the pending milestone's deadline | Funds are locked until that deadline |
| Buyer-side stall | The buyer's Authorizer does not sign, or a bank freeze lasts past the deadline, and the owner refunds | The supplier is protected by the lock until the deadline and by the fixed payee, not by a guaranteed payout | Open question (see Known limitations) |
| Wrong data from an oracle | A release based on manipulated external data | Conditions are checked against the signed summary only; no oracle call at release | Trust moves to the issuer, by design |
| Rounding | Amounts that do not add up | Integer raw amounts per milestone, set by the owner; exact sum check on-chain; no percentage math on-chain; the web adds the remainder to the last milestone and shows all three amounts before signing | None |
| Malicious delegatecall target at funding | A Safe takeover during funding | The web pins MultiSendCallOnly and TradeEscrow from the bundled deployments file, checks code exists, refuses an API value that differs, and builds the whole Safe transaction itself (v0.4, C1) | Depends on the integrity of the web build |
| Owner waiver abuse | A waiver pays despite a failed condition | Only the buyer Safe can waive; it pays only the fixed amount to the fixed supplier; a bank freeze blocks it | This is the owner's own decision about the owner's funds |
| Unsigned proof spam (v0.4, C4) | An anonymous caller holds every milestone or uses up the issuer's rate budget | Admission checks first: unsigned, mismatched or oversized submissions get 4xx with no ledger row and no state change; rejected submissions use a separate per-IP budget | Ledger and disk stay bounded; signed submissions keep their own budget |
| Order data disclosure (v0.4, C9) | Anyone reads held proofs, hold reasons and ledger references of every tenant | The public order view returns on-chain fields only; the full view needs an owner or bank session of the buyer | None beyond public chain data |
| Order spam | Many tiny orders fill the index | Only registered Safes can create orders; the service lists only the session Safe's orders and caps active orders per tenant | On-chain storage cost is the spammer's |

---

## 05 Deployment and Testing

### Environment

| Item | Value |
|---|---|
| Network | Base Sepolia (chain ID 84532); local Anvil (31337) for development and integration tests |
| Web app | https://aegis-treasury-eta.vercel.app |
| API | https://aegis-api.150-109-23-187.sslip.io (`GET /api/health`) |
| Repository | https://github.com/Xavrir/aegis-treasury |
| Contracts | Solidity 0.8.28 (Cancun), Foundry, OpenZeppelin 5.4 |
| Wallet | Safe v1.4.1 (SafeL2) deployment on Base Sepolia |
| Service | Python 3.12 or later (container: Python 3.13), FastAPI, SQLite; five processes: API, Authorizer, Exit Agent, Executor, Keeper |
| Frontend | Node 20.19 or later, React 19, Vite 8, TypeScript 6, viem 2, wagmi 3 |
| Oracle | MockPriceFeed, heartbeat 60 s, keeper process, `maxOracleAge` 180 s |
| LLM | OpenAI-compatible endpoint configured by environment variables; production uses `claude-haiku-5-5` through CLIProxyAPI |

### Deployment instructions

**Contracts (done on 84532).**
1. `forge script script/Deploy.s.sol --rpc-url $RPC_URL --broadcast`, with every role key in the environment (public Anvil keys are used only on 31337). One run deploys MockUSDC, MockPriceFeed (keeper set), Vault A and Vault B (each seeded with 50,000 USDC), PolicyRegistry and AegisModule. It uses the canonical Safe v1.4.1 contracts, which it deploys itself only on 31337. It creates the reference Safe, enables the module, registers owner and bank, adds both vaults, sets the Authorizer, Exit key, caps, band width, oracle age and the initial reserve floor (4,500 USDC), sets the bank limit from the bank key, mints 10,000 USDC to the Safe, and writes `deployments/<chainId>.json`.
2. Event queries start at the deployment block, 48114516.

**Hosted service (done).** Follow `deploy/tencent/README.md`:
1. Copy the build context (service code, lock file, deployments files, `deploy/tencent`) to the host.
2. Create `aegis.env` and `cliproxy/config.yaml` from the examples, owned by root with mode 600. They hold the operator keys and tokens and are never committed.
3. Sign in CLIProxyAPI once. Without it, or with `LLM_BASE_URL` unset, the agent runs in deterministic mode.
4. `docker compose up -d --build`, add the Caddy site block, reload Caddy, and check `/api/health`.
5. Do not run the evidence script while the service runs: both send from the same keys, and their nonces would collide.
6. Rollback (v0.4, C10). Before the first TradeFlow rebuild, tag the running image and back up the database: `docker tag aegis-treasury:latest aegis-treasury:pre-tradeflow`, then the backup command in the README. To roll back: `docker tag aegis-treasury:pre-tradeflow aegis-treasury:latest && docker compose up -d --no-build`. TradeFlow adds only new tables, so the old image runs on the same volume. `deploy/tencent/README.md` must gain this rollback section with the TradeFlow change; it has none today. The web rolls back to the previous Vercel deployment.

**Web (done).** Vercel builds `web/`. The build copies `deployments/*.json` into `web/public/deployments/`, and `VITE_API_URL` points at the API.

**Local development.** `make anvil`, `make deploy` (from v0.4, C10: `Deploy.s.sol`, then `DeployTradeEscrow.s.sol`, then the deployments merge), then `make dev` (the five processes, each with only its own key), or `make dev-fake` for an offline demo with an in-memory chain. Full commands: `service/README.md` and `web/README.md`.

**TradeFlow [Design v0.3].** `forge script script/DeployTradeEscrow.s.sol --rpc-url $RPC_URL --broadcast` deploys TradeEscrow with the existing registry and MockUSDC, deploys MultiSendCallOnly on 31337 only, and writes the TradeFlow keys to `deployments/<chainId>.tradeflow.json`; the merge script then adds them to `deployments/<chainId>.json` and fails if any existing key would change (v0.4, C10). Then tag the running image (rollback step 6), add the three demo issuer keys to `aegis.env` (the v0.4 supervisor gives them to the API process only, C3), rebuild the service, and redeploy the web so it bundles the new addresses. Without these keys and addresses the service runs with TradeFlow disabled.

### Deployed contracts (Base Sepolia)

| Contract | Address |
|---|---|
| MockUSDC | `0x5C02E17b299d7BC9d5Af31128306a8E05e62BE63` |
| MockPriceFeed | `0x3e9eB7a3B431a3df26135B54C7dcC61149F1fda6` |
| VaultA, VaultB | `0xBEf3507AF91BB2cac0c18fa65Bf68D45f1B44F3d`, `0x7CAB5C889D4925834837dd5562Dd644Fd63d1D4a` |
| PolicyRegistry | `0xE6E9A49870C16F544F1adFB79003E4Df59055F2a` |
| AegisModule | `0x786863E82d233eb60555dfeEFEe06068d8EcB318` |
| Reference Safe | `0x2E1c2be3dD6BAa59344EdC6ee6A93D68e2295a0F` |
| Safe v1.4.1 SafeL2, SafeProxyFactory, CompatibilityFallbackHandler (canonical) | `0x29fcB43b46531BcA003ddC8FCB67FFE91900C762`, `0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67`, `0xfd0732Dc9E303f09fCEf3a7388Ad10A83459Ec99` |
| Safe v1.4.1 MultiSendCallOnly (canonical) [Design v0.3 dependency] | `0x9641d764fc13c8B624c04430C7356C1C7C8102e2` |
| TradeEscrow [Design v0.3] | TBD |

Operator role addresses are in `deployments/84532.json`.

### Test cases

| Suite | Count | Status |
|---|---|---|
| Contracts (Foundry; fuzz 256 runs; invariants 64 runs, depth 40) | 47 | Passed in a local run on 17 Oct 2026 |
| Service unit tests (`pytest -m "not integration"`) | 111 | Passed in a local run on 17 Oct 2026 |
| Service integration tests (`pytest -m integration`, against Anvil) | 8 | Not re-run for this document |
| Web (Vitest) | 21 | Passed in a local run on 17 Oct 2026 |
| v0.4 fixes to built code: W6, W7, A13, M12 extension, T52 | 5 planned | W6 is being implemented with the web floor-update fix |
| TradeFlow T1 to T54 [Design v0.3] | 54 planned | Not written |

Counts come from the test files: 47 Foundry tests in 5 suites; 97 service unit test functions that expand to 111 cases through two parametrized tests; 8 integration tests; 21 web tests in 5 files.

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
| C26 | Redeem from a contract the Safe never deposited into | Reverts `NoPosition` |
| C27 | Redeem while the vault is quarantined and the owner has frozen | Executes |
| C28 | Redeem with the wrong op, no position, or a bad signer | Reverts `WrongOp`, `NoPosition`, `BadSignature` |
| C29 | Redeem under partial vault liquidity | A full redeem reverts `ExecutionFailed`; a redeem of the available shares executes with measured amounts |
| C30 | Approval signed by the wrong key; Approval replayed | Reverts `BadSignature`; `NonceUsed` |
| C31 | Approval fields do not match the DAR; Approval expired | Reverts `ApprovalMismatch`; `ApprovalExpired` |
| C32 | `check` view on deposit and redeem cases | Same result and tier as execution |
| R1 | Bank calls `addVault`, `setAuthorizer`, raises a cap, or clears quarantine | Reverts `Unauthorized` |
| R2 | Owner calls `bankUnfreeze` | Reverts `Unauthorized` |
| R3 | Bank revokes the Authorizer | Old Authorizer's DAR reverts `BadSignature`; bank freeze set |
| R4 | Exit key clears quarantine | Reverts `Unauthorized` |
| R5 | Bank lowers each tightenable value, then sets one that is not lower | Lowering works; the other reverts `Unauthorized` |
| R6 | Owner-only and bank-only functions called by the other party | Reverts `Unauthorized` |
| R7 | Quarantine cooldown | Clearing before 24 h reverts; after 24 h works; a new quarantine resets the timer |
| R8 | Any policy change | `policyVersion` increments; `PolicyChanged` emitted |
| R9 | `register` by a non-owner, or a second time | Reverts `Unauthorized` |
| R10 | `register` for a multi-owner Safe by one co-owner | Reverts `Unauthorized`; works when the Safe itself calls |
| R11 | Unregistered Safe uses the module | Deposit reverts (`VaultNotAllowed`, `BadSignature`) |
| D1 | Approval digest | Equals the EIP-712 typed data v4 digest |
| D2 | DAR digest | Equals the EIP-712 typed data v4 digest |
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
| A11 | Authorizer receives a tampered payload (amount, minOut, tier, owner signature, expiry, schedule, simulation result, option, price band) | Refuses with the matching reason |
| A12 | LLM returns an invalid choice, times out, or exceeds its budget | Rule-based result for that request; the LLM cannot override a transfer refusal |
| A13 | The owner revokes or rotates the Authorizer, then a deposit is requested (v0.4, V1) | The Authorizer refuses with `AuthorizerNotCurrent` and signs nothing |
| M1 | Onboarding config shape | Matches the spec |
| M2 | Faucet | Drips once per address; respects the daily budget and the per-IP limit |
| M3 | Activation with each misconfiguration, a wrong or missing Safe, and repeated calls | Fails with the named code; mints exactly once |
| M4 | Onboarding status | Reports each step; rate-limited per IP |
| M5 | Tenant cap reached; testnet without a faucet key | Onboarding closes |
| M6 | Sessions | Owner binds to one tenant; bank to its tenants; an owner cannot onboard a second treasury |
| M7 | Tenant A tries every endpoint and the stream for tenant B | Nothing returned or done |
| M8 | New tenant activated in the API | Other processes serve it without a restart |
| M9 | Per-tenant attacks | `tampered` reverts `BadSignature`, `replay` reverts `NonceUsed`; inert signing refuses live DARs |
| M10 | Rate limits and LLM budgets | Chat and attack limits apply; LLM falls back per request |
| M11 | Health, CORS, admin-only market scenarios, `floorUpdate` for a new tenant | As specified |
| M12 | Supervisor secrets; Exit Agent scope | Each process gets only its own secrets; tenants without deposits are skipped. v0.4 extension (C3): the issuer keys are in the base set; only the API child gets `ISSUER_*`; the API, Authorizer and Exit Agent get `INTERNAL_TOKEN`; the Executor and Keeper do not |
| I1 to I7 | Integration on Anvil: reads match the deployment; T3 and T2 deposits execute; tampered and replayed DARs revert; partial exit and self-submit; depeg exit with deposits held; ledger reconciles with chain | As expected on a real chain |
| I8 | Two tenants end to end on Anvil | Tenant B sees nothing of tenant A; a bank freeze blocks deposits while the exit still works |

**Web tests (Vitest)**

| ID | Case | Count |
|---|---|---|
| W1 | Key storage under `aegis.wallet.v1`, download and import | 5 |
| W2 | API response normalisation | 3 |
| W3 | Onboarding and session message text | 3 |
| W4 | Onboarding runner: order, resume, skip of done steps | 4 |
| W5 | Safe address prediction and call encoding | 6 |
| W6 | v0.4, C1: the mocked API returns a `floorUpdate` whose `to` is the Safe and whose data is an `execTransaction`; then a valid response | Nothing is sent and a refusal shows; the valid response encodes exactly `setReserveFloor` to the pinned registry. Planned |
| W7 | v0.4, C1: the send function is given an unpinned target, and a Safe `execTransaction` it did not build | Both refused; no send. Planned |

**TradeFlow tests [Design v0.3]**

| ID | Case | Expected |
|---|---|---|
| T1 | `createOrder` through MultiSendCallOnly (approve + create) from a registered Safe | Escrow holds `total`; `committedOf` and `escrowedTotal` rise by `total`; allowance is zero afterwards; `OrderCreated` emitted |
| T2 | Caller is not a registered Safe | Reverts `NotRegistered` |
| T3 | Buyer owner-frozen or bank-frozen | Reverts `Frozen` |
| T4 | Supplier is zero, the buyer, the escrow or the token | Reverts `BadSupplier` |
| T5 | Issuer is zero or the supplier | Reverts `BadIssuer` |
| T6 | Zero amount, wrong kind for the index, or `minTemp > maxTemp` | Reverts `BadMilestone` |
| T7 | Amounts do not sum to `total` | Reverts `AmountMismatch` |
| T8 | First deadline not in the future, or deadlines decreasing | Reverts `BadDeadline` |
| T9 | Valid release of the first milestone (index 0), submitted by a random address | Supplier receives exactly the amount; event fields correct; nonce used; `nextIndex` is 1 |
| T10 | Release of a later milestone first, or the same milestone again | Reverts `OutOfOrder` |
| T11 | Release on a refunded, completed or unknown order | Reverts `OrderNotActive` |
| T12 | Release while owner-frozen, and while bank-frozen | Reverts `Frozen` |
| T13 | Proof for another order, index or kind | Reverts `ProofMismatch` |
| T14 | Proof signed by another key, or a proof field changed after signing | Reverts `BadSignature` |
| T15 | Proof issued before order creation, or in the future | Reverts `BadProofTime` |
| T16 | Temperature above max or below min, zero samples, `min > max` in the proof, or zero `docHash` when required; each also with a valid Authorizer signature | Reverts `ConditionNotMet` in every case |
| T17 | Readings exactly at both bounds | Executes (bounds are inclusive) |
| T18 | Authorization amount changed after signing | Reverts `BadSignature` |
| T19 | Authorization signed by the Exit key, by a revoked Authorizer, or by a random key | Reverts `BadSignature` |
| T20 | Authorization validly signed for the wrong amount, order, index or proof | Reverts `AuthorizationMismatch` |
| T21 | Policy changed after signing (bank tightens a cap; freeze then unfreeze) | Reverts `PolicyVersionMismatch` |
| T22 | Expired authorization | Reverts `Expired` |
| T23 | Nonce reused on the next milestone | Reverts `NonceUsed` |
| T24 | `waive` by the buyer Safe after a failed condition; by another address; while bank-frozen; out of order | Pays the supplier with `waived = true`; reverts `Unauthorized`; `Frozen`; `OutOfOrder` |
| T25 | `refund` before and after the pending deadline | Reverts `DeadlineNotPassed`; then the buyer receives `total − released`, the order is `REFUNDED`, and a later release reverts `OrderNotActive` |
| T26 | `refund` while owner-frozen and bank-frozen; by another address; twice | Executes; reverts `Unauthorized`; reverts `OrderNotActive` |
| T27 | All three milestones paid | Order `COMPLETED`; `committedOf` back to its earlier value; refund reverts `OrderNotActive` |
| T28 | `checkRelease` on every case above except signatures | Same error as `release` |
| T29 | EIP-712 digests of both structs, including negative temperatures | Equal to the eth_account and viem typed-data digests |
| T30 | Proof or authorization signed for another chain id or another escrow address | Reverts `BadSignature` |
| T31 | Release while the vault is quarantined by the Exit Agent after signing | Reverts `PolicyVersionMismatch` (quarantine bumps the version) |
| T32 | Invariant: escrow balance | Equals `escrowedTotal` and the sum of unreleased funds of active orders |
| T33 | Invariant: payees, with an adversary holding the Authorizer, Exit, issuer and Executor keys | Tokens leave only to an order's supplier or buyer; the adversary's balance never rises; supplier receipts + refunds + `escrowedTotal` equal total funded |
| T34 | Invariant: no double payment | `released ≤ total`; each milestone paid at most once; `released` equals paid milestones below `nextIndex` |
| T35 | Invariant: refunds and commitments | No refund before the pending deadline; `committedOf` equals unreleased funds per buyer |
| T36 | Service: Proof Verifier on the proof corpus | Valid proof: `PROOF_VERIFIED` and a release request. A failed condition, time check or deadline: `HELD` with that reason and no Authorizer call. v0.4, C4: an unsigned, wrongly signed or mismatched proof, then a valid proof: the first gets 4xx with no ledger row and no state change, the second reaches `RELEASE_SIGNED`; a document above 1 MB gets 413; rejected submissions do not use the per-order budget of signed ones |
| T37 | Authorizer `/sign-release` | Refuses unknown Safe, wrong buyer, amount mismatch, failed condition, frozen Safe, stale policy version, expiry out of range, used nonce. v0.4: refuses `AuthorizerNotCurrent` when the registry authorizer is not its address (V1); after the deadline, or after a reported hold, refuses a request with no `ReleaseConfirmation`, with one signed by a key other than `registry.owner(buyer)`, with one over another `proofHash`, or with an expired one (C8) |
| T38 | Verification Agent bounds | An answer outside the action set is replaced by the rule; the LLM never supplies an amount, payee, index or signature; deterministic mode works without an LLM |
| T39 | Tenant isolation | Tenant B cannot list, request demo proofs for, or confirm tenant A's orders; `tradeflow` stream events are scoped. v0.4, C9: an unauthenticated request and a tenant B session for one of A's orders receive on-chain fields only, with no proofs, hold reasons, explanations or ledger references |
| T40 | Demo issuers and limits | A demo issuer signs only for its own milestones; demo proof and submission limits apply |
| T41 | Treasury view | Cash, Committed and Free as defined; Committed equals `committedOf`; reserve unchanged by escrow; a linked obligation is settled and returns a floor update |
| T42 | Ledger and bank desk | `MilestoneReleased` and `OrderRefunded` events reconcile with ledger rows; a missing row shows a mismatch |
| T43 | Integration on Anvil | The full E6 sequence through the service |
| T44 | Web: milestone split | 20/40/40 with the remainder on the last milestone; the sum equals the total for fuzzed totals |
| T45 | Web: funding transaction | MultiSend payload is `approve(exact total)` then `createOrder`; the delegatecall target is the pinned MultiSendCallOnly; a different API value is refused; issuers and condition defaults come from the bundled build (v0.4, C1) |
| T46 | Web: typed data | `MilestoneProof` and `ReleaseAuthorization` digests equal the contract fixtures |
| T47 | Web: waive and refund | The Safe transaction targets the pinned TradeEscrow with locally encoded calldata and is sent by the owner key; an API response that carries a `to` or `data` field is ignored (v0.4, C1) |
| T48 | v0.4, C5: a valid proof during a bank freeze; a milestone 3 proof before milestone 2 is mined; a refund while a milestone is open | `WAITING`, then released after `bankUnfreeze` with a fresh authorization and no owner action; `WAITING`, then released after the earlier release; open milestones end with `OrderNotActive` |
| T49 | v0.4, C7: preflight always fails `BadSignature`; one `policyVersion` bump; three `PolicyVersionMismatch` failures in a row | `HELD` `ReleaseFailed:BadSignature` after one attempt, one ledger row per transition; one re-sign then `RELEASED`; `HELD` after two re-signs |
| T50 | v0.4, V1: the owner revokes the Authorizer, then a valid proof arrives; the owner restores it | No signature is requested; `WAITING` with `AuthorizerNotCurrent` and one ledger row; released after the restore |
| T51 | v0.4, C6: a fake chain whose latest block runs 2 s behind wall time | A demo "valid" proof uses `issuedAt = max(order.createdAt, latest block timestamp)` and verifies (it failed `BadProofTime` under wall time) |
| T52 | v0.4, C10: `make deploy` on 31337; the merge script given a file that changes an existing key | `tradeEscrow` exists in `deployments/31337.json`; the merge fails and writes nothing |
| T53 | v0.4, C10: deployments file without `tradeEscrow` | `GET /api/tradeflow/config` returns `enabled: false`; TradeFlow endpoints return 503 `TradeFlowDisabled`; all built tests pass unchanged |
| T54 | v0.4, C2: schema check of `evidence-84532.json` | E6b and E6e carry `requestId`, a workflow with `PROOF_VERIFIED`, `RELEASE_SIGNED` and `RELEASED`, `ledgerRef` rows, and a release sent from the Executor; E6c carries a `MILESTONE_HELD` row with `ConditionNotMet` before the forced-submit hash |

### Execution evidence plan

Rejected transactions must be broadcast to produce a hash. viem estimates gas before sending and refuses transactions that would revert, so attack scenarios are sent with a fixed gas limit. On 84532 they were sent by `service/scripts/evidence_84532.py` with EIP-1559 fees and a fixed limit of 800,000 gas. `script/Attack.s.sol` sends the same calls with legacy pricing and a 1,500,000 gas limit, which needs more ETH than the testnet roles hold, so it is used on Anvil. The full record, including setup and cleanup transactions, workflow states and ledger references, is `deployments/evidence-84532.json`.

| # | Scenario | Tx hash |
|---|---|---|
| E1 | Normal allocation: reserve kept, surplus deposited (first deposit, owner Approval) | [0x94b96907…](https://sepolia.basescan.org/tx/0x94b9690755fae93712ebb11dcf7a8d9c0095019493184e62b3e869943a68f68f) |
| E2 | Risk shock: depeg injected, vault quarantined, Exit Agent redeems (reduces vault risk, not asset risk) | [0x7023601d…](https://sepolia.basescan.org/tx/0x7023601da934f3471bf0bca2f2ba1ddbc8b4dbedd5d923a27206be98b97044da), [0x4c312b16…](https://sepolia.basescan.org/tx/0x4c312b1649b19743acf61b60016ba43751d1a56d1b76acbf9dceeb565e0b7428), [0x8f73300b…](https://sepolia.basescan.org/tx/0x8f73300bc28a76ee7a4ea74b601f98d8a4986039506ae6e80e7e6def570547a8), [0xef0405bb…](https://sepolia.basescan.org/tx/0xef0405bb86f711cb020d42b2c8e394fbf1c90b14c31e9291bfdb570e1e07a1be) |
| E3 | Obligation shock: invoice approved, floor updated on-chain, agent rebalances to cover | [0x0de6d291…](https://sepolia.basescan.org/tx/0x0de6d291f83eb68492ca697a1c109fc4690c45de4ed8b25a213f15859645fd93), [0xab44d6da…](https://sepolia.basescan.org/tx/0xab44d6dac64e4c33f52ef118dc032991cb9cc182ee9c4976e2269adafe227fce) |
| E4a | Attack: DAR with amount changed after signing (reverted `BadSignature`) | [0xdac68e93…](https://sepolia.basescan.org/tx/0xdac68e9309a186f0cb6420ec21e3556b9b3efb64c2a3c483500079df595cc3d6) |
| E4b | Attack: replayed DAR (reverted `NonceUsed`) | [0x431c79c3…](https://sepolia.basescan.org/tx/0x431c79c39fceaabacc3eb4c635be663dbe61001d5d9a542faf7a7f069ea3c5c7) |
| E4c | Attack: prompt injection requesting an external transfer | No transaction can express it (receiver is fixed to the Safe); refusal recorded in the ledger (request `req_872a5923cbdd4956`, flags `addressInMessage`, `crossClient`, `overrideInstructions`) |
| E4d | Conditions changed: deposit signed, price moved out of band, submitted (reverted `PriceOutOfBand`) | [0x53939b60…](https://sepolia.basescan.org/tx/0x53939b6089bc14ab92a6b7b32d08fc2a539d105e34199c2d86f03609e327acba) |
| E5 | Bank freezes and revokes; agent deposit reverts `Frozen`; Exit Agent redeem still executes | [0x2c033ba9…](https://sepolia.basescan.org/tx/0x2c033ba9997f0abbff177ea3672cfd09e71d00977c2a893d8d0aadf208b24799), [0xdf111f38…](https://sepolia.basescan.org/tx/0xdf111f382bf5716d26347c6010344355188ae8abafe9bc50d7edf451c4728a66) |
| E6a | TradeFlow [Design v0.3]: the reference Safe funds an order of 1,000 test USDC (200 / 400 / 400) through MultiSendCallOnly: `approve` and `createOrder` in one owner-signed Safe transaction | TBD |
| E6b | Milestone 1 (index 0, handed to carrier): carrier proof posted to the service; `PROOF_VERIFIED`, release signed by the Authorizer process, submitted by the Executor; the supplier receives 200. Recorded with `requestId`, workflow and `ledgerRef` (v0.4, C2) | TBD |
| E6c | Milestone 2 (index 1, arrived): sensor proof with a maximum of 9.40 °C against the 2.00 to 8.00 °C condition, posted to the service. The service writes `MILESTONE_HELD` with `ConditionNotMet` and requests no release. Then a release signed with the Authorizer key by the evidence script, standing in for a compromised or faulty agent, is submitted anyway: mined and reverted `ConditionNotMet` (forced submit labelled "script-signed") | TBD |
| E6d | Milestone 2 resolved: the owner waives after a survey (`waive`, an owner-signed Safe transaction); the supplier receives 400 (v0.4, C2: waive only) | TBD |
| E6e | Milestone 3 (index 2, quality accepted): surveyor proof posted to the service after the unfreeze; `PROOF_VERIFIED`, new authorization from the Authorizer process, submitted by the Executor; the supplier receives 400; the order is completed. Recorded with `requestId`, workflow and `ledgerRef` (v0.4, C2) | TBD |
| E6f | Attack: a valid milestone 3 authorization, signed with the Authorizer key by the evidence script, with the amount changed after signing; sent by the attacker role (reverted `BadSignature`; labelled "script-signed", as an attack row) | TBD |
| E6g | Bank freeze: a valid milestone 3 release, signed with the Authorizer key by the evidence script, submitted while the buyer Safe is bank-frozen (reverted `Frozen`; labelled "script-signed"); the bank then unfreezes | TBD |

E6 run order: E6a, E6b, E6c, E6d, E6f, E6g, E6e, so both attacks target milestone 3 before it is paid. The unfreeze bumps `policyVersion`, so E6e needs a fresh authorization. E6 runs on the reference treasury, whose owner key the team holds. It runs as phase 2 of the evidence script, as E1 to E5 did: the hosted service is stopped so that nonces do not collide, and the script starts the five processes locally against 84532 with the same keys. The settlement rows E6b and E6e therefore go through the Proof Verifier, the Authorizer process and the Executor, and the evidence file records their `requestId`, workflow states and `ledgerRef` rows, as for E1 (v0.4, C2; checked by T54). The supplier is a fresh address generated by the script and recorded in the evidence file. If any E6 settlement row has to be recorded before the Proof Verifier and `/sign-release` exist, it is labelled "contract path, script-signed" and does not claim agent execution.

### Delivery plan and cut line

Task completion (40%) is judged on transaction hashes, so evidence comes before extras. The v0.2 plan is complete:

| v0.2 must have | Status | v0.2 stretch | Status |
|---|---|---|---|
| Module and registry with tests C1 to C25, R1 to R4 | Done (plus C26 to C32, R5 to R11, D1, D2) | Fuzz tests F1, F2 | Done |
| Deterministic pipeline, Authorizer, Exit Agent, keeper | Done | LangGraph instead of a plain state machine | Not adopted |
| Owner Approval signing, bank freeze and revoke | Done | Full AgentDojo adaptation (curated set A5 is must-have) | Not done; A5 done |
| E1 to E5 tx hashes | Done | Baseline comparisons, CVXPY optimiser | Not done |
| Business pages and a read-only Bank Risk Desk | Done, plus the multi-tenant app | Bank Approval signing in the UI | Done |

Remaining plan (dates in UTC+8):

| Date | Work | Exit criterion |
|---|---|---|
| 17 Oct 2026 | This document (v0.3, then v0.4); TradeEscrow and Foundry tests T1 to T35; the web floor-update fix (C1, W6) | `forge test` green; W6 green |
| 18 Oct 2026 | Fixes to built code from the tribunal: owner transaction rule (C1, W7), supervisor secrets (C3, M12), `AuthorizerNotCurrent` for DARs (V1, A13), `make deploy` and the rollback tag (C10, T52). Then cut-line steps 2 and 3: Proof Verifier, `/sign-release`, minimal API and the Executor release path; TradeEscrow on 31337 and 84532; E6 through phase 2 of the evidence script. Then the Trade page if time allows | E6 hashes in `evidence-84532.json`, passing T54 |
| 18 Oct 2026, end of day | **Code freeze** | No feature code after this point |
| 19 Oct 2026 | Evidence sync to the web and docs, demo video, final document; fixes to existing behaviour only | |
| 20 Oct 2026, 23:59 | Submission deadline | |

**Cut line (reordered in v0.4, C2).** TradeFlow work is ordered so that each step stands alone: (1) TradeEscrow with tests T1 to T35; (2) the Proof Verifier with admission (C4), the Authorizer `/sign-release` with the V1, C6 and C8 checks, a minimal API (proof submission, demo proofs, order read) and the Executor release path with its workflow callback (C7); (3) deployment on 84532 and E6 through phase 2 of the evidence script, so that E6b and E6e go through the Executor with `requestId`, workflow and `ledgerRef`; (4) the Trade page; (5) the LLM explanation. If E6 must be recorded before step 2 is done, the settlement rows are labelled "contract path, script-signed". If TradeFlow is not done at the freeze, it ships as design plus tests only: this specification and the tests that exist, with no claim of a TradeFlow deployment and every E6 row marked "not recorded". The treasury core and its evidence do not depend on TradeFlow: AegisModule, PolicyRegistry and the deployed addresses do not change. After the freeze, the hosted service changes only by rollback to the `aegis-treasury:pre-tradeflow` image (v0.4, C10).

### Known limitations

| Limitation | Impact | Planned improvement |
|---|---|---|
| Vaults and price feed are mocks | Yield and risk numbers are illustrative | Adapters to real ERC-4626 vaults and Chainlink feeds after audit |
| Single stable asset, single feed | Depeg exits reduce vault risk, not asset risk | Per-vault feeds, multi-asset reserve |
| Authorizer and Exit keys are server keys, shared by all tenants | Compromise is bounded per tenant but reaches every tenant at once; rotation needs one owner transaction per tenant | HSM or MPC signing; per-tenant or per-cohort signer keys |
| Risk thresholds are heuristics | Not calibrated against historical incidents | Backtest on historical depeg and liquidity events |
| Obligations are self-reported | Wrong input gives a wrong reserve | Import from invoicing or accounting systems |
| Custom module instead of audited permission modules | More custom code to trust | Adopt Zodiac Roles when the action set grows |
| Contracts not audited | Not suitable for real funds | External audit before any mainnet use |
| LLM provider availability | Copilot unavailable during outages | Plans, reserve logic and exits run without the LLM |
| LLM access through a proxy signed in with a team account | Acceptable for a demo, not for production data handling | Provider API key under a data processing agreement |
| Tenant keys are browser burner keys | Script injection on the site, or a leaked key file, gives control of that test treasury | Testnet only; an injected wallet is already supported for the owner; institutional custody in production |
| The module address in onboarding comes from the API config | Onboarding targets are pinned (v0.4, C1), but the module address inside `enableModule` is read from the config, so a compromised API host could still point new tenants at a malicious module | Compare the whole onboarding config with the bundled deployments file and refuse a mismatch |
| One host, one SQLite file | No high availability. An outage stops the agent, not the funds: the owner keeps full control of the Safe and can redeem from the vaults directly | Managed database and a second host |
| Mock market admin key | The DEPLOYER key can move the mock price and block vault redemptions for every tenant | Real vaults and feeds have no such admin |
| Proof issuers are trusted [Design v0.3] | A lying or compromised issuer, or one colluding with the supplier, can trigger a payment to the fixed supplier | k-of-n issuers, issuer registry with revocation, dispute window |
| Release needs the buyer's Authorizer [Design v0.3] | The buyer side (or a long bank freeze) can stall until the deadline and then refund; the supplier has no guaranteed payout | Record proven milestones on-chain so a refund cannot cover them; arbitration |
| Demo issuers are server keys [Design v0.3] | The demo proves the authorization path, not real document or sensor verification. The API process alone can obtain releases for demo-issued milestones (v0.4, C3) | TradeTrust verification and signed gateway data; ZK proofs where they reduce disclosure |
| EOA issuers only [Design v0.3] | Contract-wallet issuers (EIP-1271) cannot sign proofs | Add EIP-1271 support |
| No on-chain dispute process [Design v0.3] | A disagreement ends in a waiver or a refund | Arbitration module or a licensed escrow partner |
| Token blocklists [Design v0.3] | With real USDC, a blocklisted supplier makes every release revert; funds return only by refund after the deadline | Check the payee before funding; owner-approved payee change |
| Fixed three milestones [Design v0.3] | Other order structures need a new contract version | Variable milestone count |
| Regulation | On-chain settlement is possible only where stablecoin payments are allowed; Indonesia is excluded | Trade Intelligence Mode with bank or licensed PSP settlement |

---

## Changes

### Changes from v0.3 (design tribunal)

The design tribunal on v0.3 (`docs/design-tribunal-v0.3/REVIEW.md`, details in `verifier-round2.md`) returned NOT READY with three High and eight Medium confirmed findings. v0.4 applies the recommended change for each one. None changes the TradeEscrow contract interface. Finding N1 (the buyer can stall a release and refund after the deadline) was rejected as a finding; it stays a documented limitation, unchanged.

| Finding | Severity | Change in v0.4 | Section |
|---|---|---|---|
| C1. The owner key sends API-supplied calldata, so an API-host compromise can drain a Safe | High | The API returns parameters only. The web encodes the floor update, the funding batch, `waive` and `refund` against addresses pinned from the bundled deployments file; the send function refuses unpinned targets and any Safe `execTransaction` it did not build; issuers and condition defaults come from the bundled build; the `resolution` endpoint is removed; blast-radius claims corrected. The floor-update fix to built code is being implemented in the web | 02 Key decisions, Multi-tenant, TradeFlow; 03 Floor synchronisation; 04 Blast radius, Protection, Threats; 05 W6, W7, T45, T47, Known limitations |
| C2. The E6 plan cannot show agent-executed settlement | High | Cut line reordered: Proof Verifier, `/sign-release` and minimal API come before E6. E6b and E6e go through the Executor in phase 2 of the evidence script, with `requestId`, workflow and `ledgerRef`. E6c records `MILESTONE_HELD` before the forced submit. E6d is a waive only. Rows recorded earlier are labelled "contract path, script-signed" | 05 Evidence, Delivery plan, T54 |
| C3. Demo issuer keys and `INTERNAL_TOKEN` reach processes that must not hold them | Medium | Issuer keys owned by the API only; `INTERNAL_TOKEN` only for the API, Authorizer and Exit Agent; supervisor `SECRETS` and `OWNED` change; M12 extended; the demo blast radius states that the API process alone can obtain releases for demo-issued milestones | 01 mechanism 5; 02 Demo issuers; 04 Blast radius; 05 M12, Known limitations |
| C4. Anyone can force a milestone into HELD with an unsigned proof | High | Admission checks first: unsigned, mismatched or oversized submissions get 4xx with no ledger row and no state change; only issuer-signed proofs can hold; 1 MB document cap; separate rate budget for rejects | 02 Off-chain flow, API; 03 State machine, algorithm 7; 04 Threats; 05 T36 |
| C5. Transient conditions become terminal holds | Medium | New `WAITING` state for `Frozen`, `OutOfOrder` and `AuthorizerNotCurrent`, checked again on `PolicyChanged` and `MilestoneReleased`; `OrderNotActive` terminal reason | 02 Off-chain flow; 03 State machine, algorithm 7; 05 T48 |
| C6. `issuedAt` and "now" have no time base | Medium | Issuers set `issuedAt = max(order.createdAt, latest block timestamp)`; every off-chain time comparison uses the latest block timestamp | 02 Time base, Authorizer checks; 03 algorithm 7; 05 T51 |
| C7. No terminal failure state or retry bound for a failed release | Medium | New `RELEASE_FAILED` state; the Executor reports results to the workflow; at most two automatic re-signs for `PolicyVersionMismatch`, `Expired`, or `NonceUsed` without an event; otherwise `HELD` `ReleaseFailed:<selector>` | 02 Off-chain flow; 03 State machine; 05 T49 |
| C8. Owner confirmation of a late release is not verifiable by the Authorizer | Medium | Owner EIP-712 `ReleaseConfirmation(orderId, index, proofHash, expiry)` in the TradeEscrow domain, verified by the Authorizer for late releases and for corrected proofs after a hold; off-chain only, no contract change | 02 Owner release confirmation, Authorizer checks, API; 03 State machine; 05 T37 |
| C9. The public order view exposes off-chain data of every tenant | Medium | Public view returns on-chain fields only; the full view needs an owner or bank session of the buyer | 02 API; 04 Threats; 05 T39 |
| C10. Freeze-day rollout can break the built service and has no rollback | Medium | `make deploy` runs both scripts and the merge on 31337; a merge script asserts that old keys are unchanged; tag `aegis-treasury:pre-tradeflow` and roll back by retagging (the rollback section is to be added to `deploy/tencent/README.md`); TradeFlow is optional at runtime (`enabled: false`) | 02 Deployment artifact; 05 Deployment, Delivery plan, T52, T53 |
| V1. The release path never checks that the signer is the buyer's current Authorizer | Medium | The Authorizer checks `registry.authorizer(buyer)` equals its own address before signing a release or a DAR; reason `AuthorizerNotCurrent`, which puts a milestone in `WAITING` | 02 Components, Authorizer checks; 03 algorithm 7; 05 A13, T37, T50 |

Open gaps carried from the tribunal, not findings: how judges read script-signed hashes (G-C2), the CVM clock offset against Base Sepolia (G-C6), whether a 120 s authorization can expire behind the serial Executor queue (G-C7), whether the merge leaves `deployments/84532.json` byte-identical apart from new keys (G-C10, checked by T52), owner gas for TradeFlow on the burner budget, and the owner ruling on the supplier payout guarantee (G-N1).

### Changes from v0.2

| Change | Reason | Section |
|---|---|---|
| Product renamed to Porthmos; on-chain and API identifiers unchanged, listed once | Team decision; the identifiers are bound to deployed bytecode, signatures, Safe addresses and URLs | Header |
| Build status labels [Built] and [Design v0.3] | Keep built and designed parts apart | Header, all sections |
| Positioning: AI trade treasury with conditional settlement; TradeFlow is the first module; the treasury core is the engine | Master context v1.2 | 01 |
| Target users: importer finance or treasury manager (primary, Singapore first), supplier (secondary), bank risk officer (overseer) | Master context v1.2 | 01 |
| Fifth mechanism (conditional settlement with split authority) added as design; related products named | Honest novelty claim | 01 |
| Multi-tenant architecture as built: roles, onboarding sequence, activation checks, isolation, attacks, abuse limits, hosting, LLM | Implemented per `docs/MULTI-TENANT.md` v2 and v2.1 | 02, 04, 05 |
| Five processes, not three; the keeper is a service process | Matches the build | 02, 05 |
| LLM: `claude-haiku-5-5` through CLIProxyAPI, deterministic fallback | Production setup | 02, 05 |
| Agent framework: plain Python state machine | LangGraph was not adopted | 02 |
| TradeFlow design: TradeEscrow state, structs, EIP-712 field order, functions, check order, errors, events, state machines, off-chain flow, API, treasury view, tests T1 to T47, evidence E6a to E6g, threats | New module with no change to the deployed contracts | 02, 03, 04, 05 |
| Shared operator key blast radius for many tenants | New multi-tenant risk | 04 |
| AegisModule text matched to the code: the event carries the Safe and the tier; redeem checks the op and requires a prior deposit (C26); Approval policy version check; `register` row in the role matrix; oracle age is tightenable | Accuracy | 04 |
| Evidence method: recorded with `evidence_84532.py` (EIP-1559, 800,000 gas) instead of `Attack.s.sol` | The testnet roles lacked the ETH that `Attack.s.sol`'s legacy pricing needs | 05 |
| Live links, deployed addresses, deployment steps for the hosted service, test counts and status, recorded hashes | Filled after deployment | 05 |
| Test IDs C26 to C32, R5 to R11, D1, D2, A11, A12, M1 to M12, I1 to I8, W1 to W5 | Tests that exist in the repository | 05 |
| Delivery plan with the 18 Oct 2026 code freeze and the TradeFlow cut line | Remaining time | 05 |
| Known limitations: multi-tenant and TradeFlow rows | New surfaces | 05 |

### Changes from v0.1

The design tribunal review of v0.1 returned NOT READY with one Critical and fifteen Medium findings. v0.2 addressed each one.

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
| Tests and evidence missed state-bound checks; reverts not broadcastable | Medium | Tests C14 to C25, E4d, fixed-gas attack transactions | 05 |
| Pending deposit could re-enter a stressed vault | Medium | On-chain quarantine, planner exclusion, cooldown | 03, 04; C24 |
| Tools had no tenant binding | Medium | Session-bound tools; separate bank role | 02, 03, 04; A5 |
| Bank desk trusted an editable ledger | Medium | Hash-chained ledger, reconciliation against events | 02, 04; A10 |
| No evidence-first cut line | Medium | Must-have vs stretch; day-4 checkpoint | 05 Delivery plan |

Gaps from the review that v0.2 closed: oracle keeper and heartbeat (60 s, `maxOracleAge` 180 s), DAR and Approval expiry (120 s, 24 h), whether a bank freeze stops exits (it does not), and traceability to the Topic F wording (section 01).

---

## References

- PACE: Policy-Attested Contract Execution for Safe AI Agents in DeFi, arXiv 2608.17220
- Signing the Transaction but Not the Decision: Whisper Attacks and a Binding Defense for AP2, arXiv 2609.11757
- Real AI Agents with Fake Memories (CrAIBench), arXiv 2503.16248
- AgentDojo, arXiv 2406.13352, github.com/ethz-spylab/agentdojo
- Aumo: aumo.finance, github.com/cryptoduke01/aumo
- kpk agent-powered vaults on Morpho, chainwire.org, 13 Nov 2025
- Safe smart account, modules and MultiSendCallOnly: docs.safe.global; github.com/safe-global/safe-smart-account (v1.4.1 deployment addresses)
- Zodiac Roles Modifier: github.com/gnosisguild/zodiac-modifier-roles
- ERC-4626 Tokenized Vault Standard; EIP-712 Typed Structured Data Signing; EIP-5792 Wallet Call API; Chainlink AggregatorV3Interface
- HSBC and Ant Digital AI-agent tokenised-deposit test, 9 Oct 2026
- TradeTrust (IMDA Singapore); DCSA electronic bill of lading standards
- Trade escrow and settlement: Tazapay, Escrow.com, Surecomp RIVO, Circle Payments Network, WaveBL
- Topic F entries reviewed: github.com/Nostidus4/TreasuryPilot, github.com/sucsage/agentic-wallet, github.com/Khawpuneiei/ReceivableOS
- Market sources from the team's feasibility analysis: WTO, BPS, Asian Development Bank, Bank Indonesia, OJK, Singapore MTI and SingStat, MAS
- CLIProxyAPI (OpenAI-compatible proxy), image `eceasy/cli-proxy-api:v8.0.29`
- Project documents: `docs/INTERFACES.md` (v1), `docs/MULTI-TENANT.md` (v2.1), `docs/IDEA-merged.md` (master context v1.2), `deploy/tencent/README.md`
