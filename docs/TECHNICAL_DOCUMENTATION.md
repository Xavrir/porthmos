# Porthmos: Technical Documentation

**2026 Shenzhen International FinTechathon · International AI Track · Topic F: Agent Wallet**

| | |
|:-|:-|
| Product | Porthmos (named AEGIS Treasury up to design v0.2) |
| Document | Technical Documentation, audited edition |
| Audit date | 20 October 2026 |
| Repository revision | `main` at `1c19881`. The audit changed documentation only; no source code was modified ([§17.4](#174-audit-scope-and-changes)) |
| Network | Base Sepolia testnet (chain ID 84532); Anvil (31337) for local work |
| Companion documents | [Security Self-Assessment Report](SECURITY_SELF_ASSESSMENT_REPORT.md) · [Execution Evidence](EXECUTION_EVIDENCE.md) · [Design specification v0.7](TECHNICAL-DOCUMENT.md) |

This document describes what the repository implements, as verified by reading the source and running the test suites on 20 October 2026. Every claim points to a file. Where the code and an earlier document disagree, this document follows the code. Status labels used throughout:

| Label | Meaning |
|:-|:-|
| **Implemented & Verified** | Source exists, automated tests pass, and (where relevant) a Base Sepolia transaction shows it |
| **Implemented** | Source exists and is tested, but no independent on-chain or live evidence |
| **Partial** | Some of the described behaviour exists; the gap is stated |
| **Mock / Simulation** | Stands in for a real-world dependency (vaults, price feed, proof issuers) |
| **Recorded Replay** | The web app's offline mode, which replays recorded data and sends nothing |
| **Not Implemented** | Roadmap only |

## Contents

1. [Executive technical overview](#1-executive-technical-overview)
2. [System architecture](#2-system-architecture)
3. [Technology stack and repository structure](#3-technology-stack-and-repository-structure)
4. [Frontend architecture](#4-frontend-architecture)
5. [Backend and services](#5-backend-and-services)
6. [AI agent architecture](#6-ai-agent-architecture)
7. [Treasury and financial logic](#7-treasury-and-financial-logic)
8. [Blockchain architecture](#8-blockchain-architecture)
9. [Trade and escrow workflows (TradeFlow)](#9-trade-and-escrow-workflows-tradeflow)
10. [Cryptography and verification](#10-cryptography-and-verification)
11. [Data model](#11-data-model)
12. [Security architecture](#12-security-architecture)
13. [Infrastructure and deployment](#13-infrastructure-and-deployment)
14. [Installation and local development](#14-installation-and-local-development)
15. [Testing strategy](#15-testing-strategy)
16. [Engineering trade-offs](#16-engineering-trade-offs)
17. [Current implementation status](#17-current-implementation-status)
18. [References and further documentation](#18-references-and-further-documentation)

---

## 1. Executive technical overview

### 1.1 Purpose

Porthmos is an agent wallet for the treasury of a cross-border trading company. It does two jobs:

1. **Treasury management.** It keeps enough stablecoin cash in the company's Safe to cover approved upcoming payments (payroll, supplier invoices), and moves only the surplus into owner-approved yield vaults, within on-chain limits. It pulls funds back when a vault or the price feed looks unsafe.
2. **Proof-based supplier payment (TradeFlow).** A buyer escrows a trade order in three milestones (handed to carrier, arrived, quality accepted). Each milestone is paid to a supplier address fixed at funding, only when a trusted issuer's signed proof passes checks that the contract itself performs.

A bank risk officer has a separate seat with read access, limit-tightening powers and a freeze switch.

### 1.2 Implemented scope

| Area | What exists | Status |
|:-|:-|:-|
| Smart contracts | `AegisModule` (Safe module, typed `DEPOSIT`/`REDEEM`), `PolicyRegistry` (per-Safe policy and roles), `TradeEscrow` (milestone escrow), mocks for USDC, a Chainlink-style feed and ERC-4626 vaults | Implemented & Verified (Base Sepolia) |
| Service | Python FastAPI service split into five processes: API, Authorizer, Exit Agent, Executor, Keeper | Implemented & Verified |
| AI Copilot | Chat assistant that parses requests, picks among deterministic plan options and explains outcomes; LLM optional | Implemented & Verified (tests); live LLM use not re-verified in this audit |
| Multi-tenant app | Any visitor can create a Safe-based treasury on Base Sepolia, sign in with SIWE, and use it | Implemented & Verified (on-chain tenant transactions) |
| Web app | React app: landing, sign-in/sign-up, Treasury, Copilot, Risk, Audit, Bank desk, Orders | Implemented; hosted at porthmos.vercel.app |
| Offline replay | In-browser replay of recorded evidence when the API is unreachable | Recorded Replay |

### 1.3 Architecture in one paragraph

An owner chats with the Copilot in the web app. The service turns the request into an intent with a rule parser (an LLM may fill only missing parameters), builds plan options with deterministic code, lets the LLM pick an option that is at most as risky as the default, then runs policy checks and a simulation. A separate **Authorizer** process re-derives everything from its own chain reads and signs a short-lived EIP-712 **Decision Authorization Record (DAR)**. Anyone can submit the DAR; the **Executor** usually does. `AegisModule` re-checks every condition on-chain and can only deposit into an allowed vault or redeem back to the Safe, so a transfer to a third party cannot be expressed. TradeFlow uses a second contract, `TradeEscrow`, where a release needs both an issuer's `MilestoneProof` and the Authorizer's `ReleaseAuthorization`.

### 1.4 Core engineering problems addressed

| Problem | Approach | Where |
|:-|:-|:-|
| An LLM can be talked into a bad transfer | The LLM holds no key and never produces calldata; the on-chain action set has no transfer | `service/aegis/agent/`, `contracts/src/AegisModule.sol` |
| A signed decision can outlive the facts behind it | The DAR binds policy version, a price band, oracle freshness and a 120 s expiry | `AegisModule._executionChecks` |
| Investing cash that is needed for bills | Required reserve computed from the obligation schedule and written on-chain as `reserveFloor` | `service/aegis/core/reserve.py`, `PolicyRegistry.setReserveFloor` |
| A freeze must not trap funds | Freezes block deposits and releases; redeems and refunds stay open | `AegisModule.redeem`, `TradeEscrow.refund` |
| Paying a supplier before delivery | Release needs an issuer proof whose conditions the contract checks, plus the Authorizer | `TradeEscrow.release` |
| A compromised API host tricking the owner key | The web encodes owner transactions itself against bundled, pinned addresses (sign-up is the open exception, Security finding PRT-01) | `web/src/lib/txguard.ts` |

---

## 2. System architecture

### 2.1 High-level architecture

```mermaid
flowchart LR
  subgraph Users
    Owner["Owner<br/>(importer finance)"]
    Bank["Bank risk officer"]
    Supplier["Supplier<br/>(public order view)"]
  end

  subgraph Web["Web app (React, Vercel)"]
    UI["Pages: Treasury, Copilot, Risk,<br/>Audit, Bank desk, Orders"]
    Guard["txguard: encodes owner and bank<br/>transactions against pinned addresses"]
    Replay["ReplayApi<br/>(offline, recorded data)"]
  end

  subgraph Service["Porthmos service (Python, one container, five processes)"]
    API["api: FastAPI, sessions, workflow,<br/>Copilot, Proof Verifier, onboarding"]
    Auth["authorizer: AUTHORIZER_KEY<br/>re-verifies, signs DARs and releases"]
    Exit["exit_agent: EXIT_KEY<br/>quarantine + redeem-only DARs"]
    Exec["executor: EXECUTOR_KEY<br/>submits, pays gas, no authority"]
    Keep["keeper: KEEPER_KEY<br/>refreshes mock price"]
    DB[("SQLite (WAL)<br/>ledger, workflow, tenants")]
  end

  LLM["OpenAI-compatible LLM endpoint<br/>(optional)"]

  subgraph Chain["Base Sepolia (84532)"]
    Safe["Safe v1.4.1<br/>(one per tenant)"]
    Module["AegisModule"]
    Registry["PolicyRegistry"]
    Escrow["TradeEscrow"]
    Vaults["MockVault A / B<br/>(ERC-4626)"]
    Feed["MockPriceFeed"]
    USDC["MockUSDC"]
  end

  Owner --> UI
  Bank --> UI
  Supplier --> UI
  UI -->|HTTPS + session header| API
  UI --> Guard
  Guard -->|owner / bank signed tx| Safe
  Guard -->|owner / bank signed tx| Registry
  API -->|parse, select, explain| LLM
  API -->|internal token| Auth
  Exit -->|internal token| API
  API --> DB
  Auth --> Exec
  Exit --> Exec
  Exec -->|deposit / redeem| Module
  Exec -->|release| Escrow
  Module -->|reads| Registry
  Module -->|reads| Feed
  Module -->|execTransactionFromModule| Safe
  Safe --> Vaults
  Safe -->|approve + createOrder| Escrow
  Escrow -->|reads| Registry
  Keep -->|poke| Feed
```

The diagram is grounded in `service/aegis/supervisor.py` (processes and key ownership), `service/aegis/api/app.py` (endpoints), `web/src/lib/txguard.ts` (browser transaction guard) and `contracts/src/*.sol`.

### 2.2 Component responsibilities

| Component | Responsibility | Key files | Trust level |
|:-|:-|:-|:-|
| Web app | UI, browser-held tenant keys, SIWE sign-in, EIP-712 approval signing, owner/bank transaction encoding | `web/src/` | Untrusted client; the server re-checks every input |
| API process | HTTP API, sessions, Copilot workflow, deterministic core, Proof Verifier, onboarding faucet, attack demo, ledger | `service/aegis/api/`, `workflow.py`, `core/`, `tradeflow/` | Trusted code; holds the faucet, attacker, admin and demo issuer keys |
| Authorizer | Re-verifies a proposed DAR or release from its own chain reads; signs only if every check passes | `service/aegis/procs/authorizer.py` | Trusted; on-chain power bounded by `AegisModule` and `TradeEscrow` |
| Exit Agent | Watches risk triggers for every served tenant; quarantines and signs redeem-only DARs | `service/aegis/procs/exit_agent.py` | Trusted; on-chain limited to redeem-to-Safe and quarantine |
| Executor | Submits signed DARs and releases; pays gas | `service/aegis/procs/executor.py` | No authority; cannot alter a signature |
| Keeper | Refreshes the mock price every 60 s | `service/aegis/procs/keeper.py` | Test infrastructure only |
| `AegisModule` | Typed `DEPOSIT`/`REDEEM`, tier derivation, signature, oracle, cap and floor checks, execution through the Safe | `contracts/src/AegisModule.sol` | Trust anchor |
| `PolicyRegistry` | Per-Safe policy, role matrix, freezes, quarantine, `policyVersion` | `contracts/src/PolicyRegistry.sol` | Trust anchor |
| `TradeEscrow` | Milestone escrow with fixed payee and amounts | `contracts/src/TradeEscrow.sol` | Trust anchor; no admin, no pause, no upgrade |
| Safe v1.4.1 | Custody; the owner keeps full control | canonical deployment | Trust anchor (external, audited by Safe) |

### 2.3 System and trust boundaries

```mermaid
flowchart TB
  subgraph B1["Boundary 1: browser (untrusted)"]
    K["Burner owner and bank keys<br/>localStorage aegis.wallet.v1"]
    W["Injected / smart wallet (optional)"]
  end
  subgraph B2["Boundary 2: API host (trusted, single container)"]
    P1["api"]
    P2["authorizer"]
    P3["exit_agent"]
    P4["executor"]
    P5["keeper"]
  end
  subgraph B3["Boundary 3: external services"]
    L["LLM provider via proxy"]
    R["Base Sepolia RPC"]
  end
  subgraph B4["Boundary 4: chain (enforcement)"]
    C["AegisModule, PolicyRegistry,<br/>TradeEscrow, Safe"]
  end
  B1 -->|"HTTPS, session token, SIWE signatures"| B2
  B1 -->|"signed transactions (txguard)"| B4
  B2 -->|"chat text, facts (quoted data)"| B3
  B2 -->|"signed DARs and releases"| B4
```

The security argument does not rest on boundary 2 or 3 being honest for fund containment: the contract checks in boundary 4 hold even if the LLM, the API process or the Authorizer key is compromised. See [§12](#12-security-architecture) and the [Security Self-Assessment](SECURITY_SELF_ASSESSMENT_REPORT.md).

### 2.4 On-chain versus off-chain responsibilities

| Responsibility | On-chain (enforced) | Off-chain (service) |
|:-|:-|:-|
| What actions exist | Only `DEPOSIT` to an allowed vault and `REDEEM` to the Safe; escrow pays only the fixed supplier or refunds the buyer | Plan options, intent parsing |
| Limits | `autoCap`, `dailyCap`, `bankLimit`, `reserveFloor`, `maxBandWidth`, `maxOracleAge`, vault allowlist, quarantine, freezes | Same limits re-checked before signing; LLM budget and chat rate limits |
| Approval tier | Derived by `AegisModule.requiredTier`; a DAR can raise it, never lower it | Proposal Validator raises an above-default choice to T3 |
| Human approval | Owner (T3) and bank (T4) EIP-712 `Approval` signatures verified on-chain | Workflow waits in `AWAITING_APPROVAL` |
| Freshness | DAR expiry, price band, oracle age, policy version | Final revalidation and final `eth_call` before submission |
| Milestone conditions | Proof signature, issuer, time window, document hash and temperature range | Same checks run first (admission and verification), plus deadlines and owner confirmations |
| Audit trail | `AegisExecuted`, `PolicyChanged`, `OrderCreated`, `MilestoneReleased`, `OrderRefunded` events; typed revert errors | Hash-chained decision ledger; bank desk reconciles ledger rows against events |

### 2.5 Data flow: one Copilot request

```mermaid
sequenceDiagram
  autonumber
  actor O as Owner (web)
  participant A as API (workflow)
  participant L as LLM (optional)
  participant C as Deterministic core
  participant Z as Authorizer
  participant X as Executor
  participant M as AegisModule
  participant S as Safe

  O->>A: POST /api/agent/chat "deposit 1,000 USDC into Vault B"
  A->>A: rule parser classifies (question / polite / imperative)
  A->>L: fill missing parameters only (optional)
  A->>C: load state (one block), reserve, risk, plan options
  A->>L: choose option id or hold (optional)
  A->>C: validate (only more conservative), policy tier, simulate (module.check + eth_call)
  alt tier T3 or T4
    A-->>O: action card, waits in AWAITING_APPROVAL
    O->>A: owner (and bank) EIP-712 Approval signature
  end
  A->>A: FINAL_REVALIDATION (reload, replan, re-simulate)
  A->>Z: sign request (DAR + evidence + schedule)
  Z->>Z: re-derive plan, tier, min-out, price band from its own reads
  Z-->>A: DAR signature
  A->>X: queue submission
  X->>M: deposit(dar, sigs, approval)
  M->>M: re-check tier, signatures, freezes, oracle, caps, floor
  M->>S: approve, vault.deposit(receiver = Safe), approve(0)
  M-->>X: AegisExecuted event (or typed revert)
  A-->>O: ledger row + explanation
```

---

## 3. Technology stack and repository structure

### 3.1 Technologies and versions

| Layer | Technology | Version (from manifests) |
|:-|:-|:-|
| Contracts | Solidity, Foundry | solc 0.8.28 (`contracts/foundry.toml`), EVM `cancun`, optimizer 200 runs |
| Contract libraries | OpenZeppelin Contracts, Safe Smart Account, forge-std | 5.4.0, 1.4.1, 1.17.0 (vendored in `contracts/lib/`) |
| Service | Python, FastAPI, Pydantic, Uvicorn, httpx, eth-account, eth-abi | Python ≥ 3.12 (container: 3.13.15), FastAPI ≥ 0.143.1, Pydantic ≥ 2.14.1 (`service/pyproject.toml`, `service/uv.lock`) |
| Service tooling | uv, pytest, pytest-asyncio | uv lockfile; pytest ≥ 9.1.1 |
| Storage | SQLite (WAL mode) | standard library `sqlite3` |
| Web | React, React Router, TanStack Query, viem, wagmi, GSAP | React 19.3, React Router 7.18, viem 2.57, wagmi 3.7 (`web/package.json`) |
| Web tooling | Vite, TypeScript, Vitest, ESLint | Vite 8.3, TypeScript 6.0, Vitest 4.1, ESLint 10.12 |
| Wallets | EIP-6963 injected wallets, Coinbase Smart Wallet, WalletConnect | `@coinbase/wallet-sdk` 4.4.0, `@walletconnect/ethereum-provider` 2.25.0 |
| LLM | Any OpenAI-compatible `/chat/completions` endpoint | Production configuration: `claude-haiku-5-5` through the CLIProxyAPI container `eceasy/cli-proxy-api:v8.0.29` |
| Hosting | Vercel (web); Docker Compose on a Tencent Cloud VM behind Caddy (API) | `web/vercel.json`, `deploy/tencent/` |

No continuous integration is configured (see [§15.4](#154-continuous-integration)).

### 3.2 Repository layout

```
contracts/            Foundry project
  src/                AegisModule, PolicyRegistry, TradeEscrow, MockUSDC, MockPriceFeed, MockVault, interfaces/
  test/               unit, fuzz and invariant tests (9 suites)
  script/             Deploy.s.sol, DeployTradeEscrow.s.sol, Attack.s.sol
  lib/                vendored forge-std, openzeppelin-contracts, safe-smart-account
service/              Python package `aegis`
  aegis/core/         state, reserve, risk, planner, actions, validator, policy, simulator, pipeline
  aegis/agent/        intent parser, Copilot agent, tools, LLM client
  aegis/procs/        authorizer, exit_agent, executor, keeper
  aegis/tradeflow/    proof verifier, checks, milestone workflow, explanations, demo issuers, typed data
  aegis/chain/        RPC client (batched), in-memory fake chain, ABIs, Safe helpers, ERC-6492
  aegis/api/          FastAPI app and TradeFlow routes
  scripts/            dev runner, Base Sepolia evidence script, deployment merge, submission diagnosis
  tests/              unit tests and Anvil integration tests (tests/integration)
web/                  React + Vite app
  src/pages/          Landing, SignIn, SignUp, Treasury, Copilot, Risk, Audit, Bank, Orders, Order
  src/lib/            API client, txguard, SIWE, onboarding runner, EIP-712, TradeFlow encoders, keys
  src/replay/         offline replay of recorded evidence
  scripts/            deployment sync, evidence sync, browser QA scripts, mock API/chain
deployments/          deployed addresses (84532, 31337) and the recorded evidence file
deploy/tencent/       Dockerfile, docker-compose.yml, Caddy site block, environment template
docs/                 this document set, design specification v0.7, interface specs, archive/
video/                demo film sources (not part of the runtime)
design-samples/       visual design explorations (not part of the runtime)
brand/                logo files
```

### 3.3 Important entry points

| Entry point | Purpose |
|:-|:-|
| `python -m aegis {api,authorizer,exit_agent,executor,keeper,all}` | `service/aegis/__main__.py`; `all` runs the supervisor |
| `service/aegis/api/app.py:create_app` | All HTTP routes except TradeFlow (`service/aegis/api/tradeflow.py`) |
| `contracts/script/Deploy.s.sol` | Deploys mocks, registry and module; creates and configures the reference Safe |
| `contracts/script/DeployTradeEscrow.s.sol` | Deploys TradeEscrow (and MultiSendCallOnly on Anvil only) |
| `service/scripts/evidence_84532.py` | Records the Base Sepolia evidence file |
| `web/src/main.tsx`, `web/src/App.tsx` | Web entry and routes |

### 3.4 Configuration and dependency management

- **Contracts:** dependencies are vendored under `contracts/lib/` (no git submodules). Remappings in `contracts/remappings.txt`.
- **Service:** `uv` with a committed `uv.lock`; configuration only from environment variables, read in `service/aegis/config.py`. Keys are read at the point of use by `load_key`, so each process loads only its own key. Public Anvil keys are a fallback on chain 31337 only.
- **Web:** npm with a committed `package-lock.json`; build-time variables `VITE_API_URL`, `VITE_TARGET_CHAIN_ID`, `VITE_WALLETCONNECT_PROJECT_ID` (`web/.env.production`, which contains no secrets). `predev`/`prebuild` copy `deployments/*.json` into `web/public/deployments/`, which the build bundles as the pinned address set.

---

## 4. Frontend architecture

### 4.1 Framework, routing and state

- **Framework:** React 19 with Vite; TypeScript strict build (`tsc -b`).
- **Routing** (`web/src/App.tsx`): `/` landing; `/signin`, `/signup`; behind the `RequireSession` guard: `/treasury`, `/copilot`, `/risk`, `/audit`, `/bank`, `/orders`, `/orders/:id`; the public supplier view `/o/:id`.
- **State:** TanStack Query for server data (`web/src/lib/queries.ts`, `web/src/lib/tradeflow/queries.ts`); React context for the data source and identity (`web/src/lib/source.tsx`, `web/src/lib/identity.tsx`); `localStorage` only for browser keys (`aegis.wallet.v1`) and UI preferences.

### 4.2 API integration and data source selection

`web/src/lib/source.tsx` probes `GET /api/health`. If the service answers, the app uses the HTTP client (`web/src/lib/api/http.ts`). If it does not, or if the visitor chooses replay, it switches to `ReplayApi` (`web/src/replay/engine.ts`), an in-browser implementation of the same interface that replays the recorded Base Sepolia evidence (`web/src/replay/evidence.ts`, generated from `deployments/evidence-84532.json`). Replay mode is labelled "Replay" in the header and **sends no transactions and holds no keys**; approvals either reuse a recorded signature or are marked simulated.

Streaming: the Copilot uses `POST /api/agent/chat/stream` (Server-Sent Events, parser in `web/src/lib/api/sse.ts`) and falls back to the plain endpoint only before a stream is accepted, so a message is never sent twice.

### 4.3 Authentication and wallet interfaces

| Feature | Implementation |
|:-|:-|
| Browser keys | Owner and bank burner keys generated in the browser (`web/src/lib/keys.ts`); download/import as a JSON file; testnet only |
| Wallet connect | Own wallet picker: EIP-6963 injected wallets, Coinbase Smart Wallet, WalletConnect (`web/src/lib/wallets.ts`, `components/wallet/`) |
| Sign-In with Ethereum | EIP-4361 messages built in `web/src/lib/siwe.ts`; the exact text is shown before signing |
| Smart-wallet signatures | Accepted server-side through ERC-1271 and ERC-6492 (`service/aegis/sigverify.py`, `chain/erc6492.py`) |
| Owner transactions | Encoded locally and checked by `web/src/lib/txguard.ts` before any send; the sign-up steps are the exception (see [§12.3](#123-safe-transaction-execution-in-the-browser)) |

### 4.4 Implemented pages

| Page | What it shows or does | Role |
|:-|:-|:-|
| Treasury | Balances, reserve floor vs required reserve, Cash / Committed / Free figures, policy, obligations, floor-update signing | Owner |
| Copilot | Chat with streamed replies, action cards with plan, tier, checks and simulation, approval signing, confirm/cancel | Owner |
| Risk | Per-vault risk scores, triggers, quarantine, oracle age | Owner, bank |
| Audit | Hash-chained ledger with integrity status, on-chain events with BaseScan links, "Break it" attack demo | Owner, bank |
| Bank desk | Client list, reconciliation, freeze/unfreeze, revoke Authorizer, tighten caps, remove vault, set bank limit, T4 approvals | Bank |
| Orders / Order | TradeFlow order list, create order (Safe + MultiSendCallOnly), milestone timeline, demo proofs, waive, refund; public supplier view `/o/:id` | Owner; supplier read-only |
| Sign up | Guided onboarding: faucet, Safe creation, module enable, eleven setup calls, bank limit, activation | Visitor |

**User roles.** The implemented roles are **owner**, **bank** and a read-only **supplier** view. There is no separate importer/exporter account system and no super-admin dashboard; "importer" and "exporter" are the commercial personas that map to the owner and the supplier. Market scenarios (depeg, liquidity, stale oracle) on Base Sepolia require an operator `X-Aegis-Admin` token and are not exposed as a UI role.

### 4.5 Error handling and accessibility

- Plain-language error mapping for chain, wallet and API errors (`web/src/lib/onboard/errors.ts`), including every custom contract error.
- The transaction guard throws `RefusedTx` with the reason and "Nothing was sent".
- Accessibility: skip link, `prefers-reduced-motion` support (`web/src/lib/motion.ts`), and a browser QA script using axe (`web/scripts/qa/axe.js`). A recorded UX review is in `docs/design/aegis-web-qa-101526/`. Accessibility was **not re-tested** in this audit.

---

## 5. Backend and services

### 5.1 Process model

`python -m aegis all` (`service/aegis/supervisor.py`) starts five processes, restarts any that exit (backoff 1 s to 30 s), and gives each only the secrets it owns:

| Process | Secrets it receives | Loop / port |
|:-|:-|:-|
| `api` | `ADMIN_KEY`, `DEPLOYER_KEY`, `ATTACKER_KEY`, `LLM_API_KEY`, `ADMIN_TOKEN`, `INTERNAL_TOKEN`, `ISSUER_*_KEY` | HTTP 8787 |
| `authorizer` | `AUTHORIZER_KEY`, `INTERNAL_TOKEN` | HTTP 127.0.0.1:8788 (internal only) |
| `exit_agent` | `EXIT_KEY`, `INTERNAL_TOKEN` | 1 s tick, acts every 5 blocks |
| `executor` | `EXECUTOR_KEY` | 1 s tick |
| `keeper` | `KEEPER_KEY` | pokes every 60 s |

This mapping is tested in `service/tests/test_multitenant.py` (M12).

### 5.2 API surface

All routes are in `service/aegis/api/app.py` and `service/aegis/api/tradeflow.py`. Every tenant-scoped route takes the Safe from the session, never from the request body.

| Group | Routes | Auth |
|:-|:-|:-|
| Health and market | `GET /api/health`, `/api/oracle`, `/api/market` | Public |
| Sign-in | `GET /api/auth/nonce`, `GET /api/auth/roles`, `POST /api/session` | Public, rate-limited; SIWE required off Anvil |
| Treasury | `GET /api/treasury`, `/api/obligations`, `POST /api/obligations`, `POST /api/obligations/{id}/settle`, `GET /api/risk` | Session (owner writes) |
| Copilot | `POST /api/agent/chat`, `POST /api/agent/chat/stream`, `GET /api/requests/{id}`, `POST .../approval`, `.../deny`, `.../correct`, `GET /api/approvals/pending` | Owner (approvals: owner or bank) |
| Audit | `GET /api/ledger`, `/api/events`, `/api/alerts`, `/api/stream` (SSE) | Session |
| Bank | `GET /api/bank/clients` | Bank |
| Onboarding | `GET /api/onboard/config`, `POST /api/onboard/fund`, `GET /api/onboard/status`, `POST /api/onboard/activate` | Public, signed and rate-limited |
| Demo | `POST /api/tenant/attack`, `POST /api/demo/scenario` | Owner; market scenarios need `X-Aegis-Admin` on 84532 |
| TradeFlow | `GET /api/tradeflow/config`, `/orders`, `/orders/{id}`, `POST .../proofs`, `.../proofs/demo`, `.../confirm`, `.../link` | Mixed (see [§9.4](#94-tradeflow-api)) |
| Internal | `POST /internal/quarantine` | `X-Aegis-Internal` token |

### 5.3 Validation

- Request bodies are Pydantic models; amounts are parsed by `service/aegis/units.py` into raw integer units.
- Addresses are checked with `eth_utils.is_address`; SIWE messages are parsed strictly and must re-serialize byte for byte (`service/aegis/siwe.py`).
- The workflow state machine (`service/aegis/workflow.py`) only allows the transitions listed in its `TRANSITIONS` table, so no path reaches `DAR_SIGNED` without `POLICY_CHECKED`, `SIMULATED` and `FINAL_REVALIDATION`.
- Errors are returned as `{error, detail}` with a code (`WorkflowError`), for example `SessionRequired`, `OwnerOnly`, `CrossClientRefused`, `RateLimited`, `BadOnboardingState`.

### 5.4 Business logic modules

| Module | Role |
|:-|:-|
| `core/state.py` | State Analyzer: balances, vault positions, `maxRedeem`, oracle, policy, all read at one pinned block |
| `core/reserve.py` | Reserve Engine ([§7.2](#72-reserve-and-deployable-capital)) |
| `core/risk.py` | Risk Engine: per-vault score and hard exit triggers |
| `core/planner.py` | Allocation Planner: plan options, default option, hold reasons |
| `core/actions.py` | Action Builder: typed DAR fields, min-out, evidence hash |
| `core/validator.py` | Proposal Validator: "only more conservative" rule |
| `core/policy.py` | Policy Verifier: off-chain mirror of tier and cap checks |
| `core/simulator.py` | `module.check` view plus `eth_call` of the vault calls |
| `workflow.py` | Persisted request state machine, approvals, submissions, reconciliation |
| `ledger.py` | Hash-chained decision ledger and reconciliation against events |
| `onboarding.py`, `tenants.py`, `sessions.py` | Multi-tenant onboarding, tenant store, SIWE sessions |
| `limits.py` | Rate limits and budgets |
| `attacks.py`, `market.py` | Per-tenant refused-attack demo; admin market scenarios on the mocks |

### 5.5 Database access and asynchronous processing

SQLite in WAL mode (`service/aegis/db.py`) is shared by the API, Exit Agent, Executor and Keeper; the Authorizer keeps its own database of signed nonces. Asynchronous work uses polling loops and a `submissions` table: the API inserts a pending submission, the Executor claims it with an atomic `UPDATE ... WHERE status='pending'`, sends it and records the result; the API then applies results to the workflow and reconciles against chain events. The Exit Agent self-submits an exit if the Executor has not included it within 3 blocks.

### 5.6 External integrations

| Integration | Purpose | Failure behaviour |
|:-|:-|:-|
| Base Sepolia JSON-RPC | All chain reads and sends; reads are batched and pinned to one block (`service/aegis/chain/rpc.py`) | Errors surface as holds or retries; no action on missing data |
| LLM endpoint | Intent filling, option selection, explanation wording | Any error or a 20 s timeout makes the request deterministic; the LLM is skipped for 30 s after an error |
| Vercel | Static web hosting | If the API is down the web switches to replay |

---

## 6. AI agent architecture

### 6.1 What "agent" means in this codebase

Porthmos has **one LLM-assisted component, the Copilot**, plus deterministic worker processes that are called agents for their role:

| Component | Uses an LLM? | Can sign or send? |
|:-|:-|:-|
| Copilot (`service/aegis/agent/agent.py`, `intent.py`, `tools.py`) | Optional: parse, select, explain | No key; produces only an option ID and optional reductions |
| Verification Agent (`service/aegis/tradeflow/explain.py`) | Optional: explanation of a verified or held milestone | No; proposes one next action from a fixed set |
| Exit Agent (`service/aegis/procs/exit_agent.py`) | No | Holds the Exit key: quarantine and redeem-to-Safe only |
| Authorizer (`service/aegis/procs/authorizer.py`) | No | Holds the Authorizer key; signs only after deterministic re-verification |

It is a single deterministic workflow with bounded LLM assistance, not a free-form multi-agent system.

### 6.2 Orchestration of a chat turn

`Workflow.chat` (`service/aegis/workflow.py`) runs a persisted state machine:

```mermaid
stateDiagram-v2
  [*] --> REQUEST_RECEIVED
  REQUEST_RECEIVED --> INTENT_PARSED
  INTENT_PARSED --> NEEDS_CLARIFICATION
  NEEDS_CLARIFICATION --> INTENT_PARSED
  INTENT_PARSED --> STATE_LOADED
  STATE_LOADED --> RISK_EVALUATED
  RISK_EVALUATED --> PLAN_OPTIONS_BUILT
  PLAN_OPTIONS_BUILT --> OPTION_SELECTED
  OPTION_SELECTED --> HELD
  OPTION_SELECTED --> PROPOSAL_VALIDATED
  PROPOSAL_VALIDATED --> POLICY_CHECKED
  POLICY_CHECKED --> POLICY_REJECTED
  POLICY_CHECKED --> SIMULATED
  SIMULATED --> SIM_FAILED
  SIMULATED --> AWAITING_APPROVAL
  SIMULATED --> FINAL_REVALIDATION
  AWAITING_APPROVAL --> APPROVED
  AWAITING_APPROVAL --> APPROVAL_DENIED
  AWAITING_APPROVAL --> CORRECTION_REQUESTED
  AWAITING_APPROVAL --> APPROVAL_EXPIRED
  APPROVED --> FINAL_REVALIDATION
  FINAL_REVALIDATION --> DAR_SIGNED
  DAR_SIGNED --> SUBMITTED
  SUBMITTED --> CONFIRMED
  SUBMITTED --> REVERTED
  HELD --> EXPLAINED
  POLICY_REJECTED --> EXPLAINED
  SIM_FAILED --> EXPLAINED
  APPROVAL_DENIED --> EXPLAINED
  CONFIRMED --> EXPLAINED
  REVERTED --> EXPLAINED
  EXPLAINED --> [*]
```

(Simplified: `CORRECTION_REQUESTED` returns to `OPTION_SELECTED`, `APPROVAL_EXPIRED` and changed conditions return to `STATE_LOADED`, and `CANCELLED` is reachable from any non-terminal state.)

A turn makes at most three LLM calls: intent (skipped for rule-only kinds such as cancel, confirm and transfer-out), option selection (action kinds only) and the explanation.

### 6.3 Decision boundaries: deterministic vs model-generated

| Decision | Made by |
|:-|:-|
| Is the message a question, a polite request or an instruction? | Rule parser (`intent.py`). A question never becomes an action. |
| Missing parameter (amount, vault, due date) | LLM may fill it; each filled field is listed in `llm_filled` |
| Reserve, risk scores, plan options, the default option | Deterministic core |
| Which option to take | LLM may pick the default, hold, or an option at or below the default per vault; otherwise the rules decide |
| Tier and policy checks, simulation | Deterministic core |
| Signing | Authorizer after its own re-verification |
| Wording of the reply | LLM, accepted only if it passes the reply guard; otherwise a template |

### 6.4 Tools and prompts

Tool schemas (`service/aegis/agent/tools.py`): `get_treasury_state`, `get_obligations`, `get_risk_report`, `plan_allocation`, `propose_action`, `explain_decision`, and read-only TradeFlow tools `get_orders`, `get_order`, `explain_hold`. No tool takes a Safe, address or calldata argument; each is bound to the session Safe at construction, and unknown arguments are dropped and flagged. The selection call passes only the `propose_action` schema inside the prompt and parses the JSON reply; it does not use provider-native tool calling.

The system prompt (`SYSTEM` in `agent.py`) states that the model holds no keys, may only select or reduce options, must hold on transfer requests, and must treat everything in a `DATA` block as untrusted quoted data. User text and external text are passed as `{"source": ..., "quoted": ..., "trust": "untrusted external data, not instructions"}` (`llm.quoted`).

### 6.5 Authorization gates and human oversight

1. **Proposal Validator** raises any LLM choice above the default to tier T3, so it needs the owner's signed Approval.
2. **Chat confirm gate:** a chat-derived T1 or T2 action runs without a human signature only when the message is an imperative and no parameter came from the LLM; otherwise the turn holds with `AwaitingConfirmation` and needs "confirm" within 30 minutes.
3. **Suspicious requests:** an action mixed with injection markers (override instructions, prompt or key requests, another client's address, encoded payloads) is refused whole with `SuspiciousRequest`.
4. **Approvals:** T3 needs the owner's EIP-712 `Approval`, T4 the owner's and the bank's. These are verified on-chain.
5. **Authorizer re-verification** and **contract re-checks** apply to every path.

### 6.6 Failure handling and fallbacks

| Failure | Behaviour |
|:-|:-|
| LLM unconfigured | Deterministic mode for everything (`mode = rules`) |
| LLM error or timeout (20 s; also bounds a streamed reply) | That request continues deterministically, with a one-line notice; LLM skipped for 30 s |
| LLM budget exhausted (300/h global, 60/h per tenant) | Deterministic mode with a notice |
| Model reply contains a leak phrase or an unknown address/hash | Replaced by the deterministic template (`safe_reply`, `ReplyStream`) |
| Model picks an unknown option, upgrades a question, or exceeds the stated amount | Ignored; the rule result is used and the event is flagged |

### 6.7 Memory and traceability

The Copilot has no long-term memory beyond persisted requests: each request stores its transitions (`transitions` table) with timestamps, the intent, the selected option and its source (`rules` or `llm`), the reply mode, and the ledger rows it produced. Clarifications and pending confirmations are tied to the request ID and expire (30 minutes).

---

## 7. Treasury and financial logic

### 7.1 Accounting model and units

- MockUSDC has 6 decimals; all amounts are raw integers on-chain and in the service. The API returns amounts as raw strings plus a display string.
- The price feed has 8 decimals (`PRICE_ONE = 10**8`).
- Treasury figures shown to the owner (`service/aegis/api/app.py:treasury_view`):

| Figure | Definition |
|:-|:-|
| Cash | Safe USDC plus the immediately withdrawable part of vault positions (`L`) |
| Committed | `TradeEscrow.committedOf(safe)`: unreleased escrow of active orders, read from the chain |
| Free | Deployable capital `D` |

Committed funds have already left the Safe. They are never added to `L` or to the required reserve, and the module cannot touch them (it acts only on funds held by the Safe).

### 7.2 Reserve and deployable capital

Implemented in `service/aegis/core/reserve.py`:

```
R_required = max over t in [now, now + H] of max(0, Σ outflows(≤ t) − Σ confirmed inflows(≤ t)) + B
B          = max(B_min, b × Σ outflows in the horizon)       H = 30 days, B_min = 500 USDC, b = 10 %
D          = max(0, L − R_required − F)                        F = fee reserve (0 by default)
```

Overdue unsettled obligations count at `now`; at equal timestamps outflows apply before inflows. `scheduleHash` is the keccak-256 of the canonical unsettled schedule.

### 7.3 Reserve floor synchronisation

When the owner adds or settles an obligation, the API returns the new floor and schedule hash, and the web encodes `PolicyRegistry.setReserveFloor(safe, ceil(R_required), scheduleHash)` for the owner to sign. Before every plan the planner compares the on-chain floor with `R_required`; if the floor is lower it holds with `FloorOutOfSync`. On-chain, `AegisModule` refuses any deposit that would leave the Safe's USDC below `reserveFloor` (`ReserveFloorBreached`). Onboarding writes the empty-schedule reserve (500 USDC) as the first floor, so a new tenant starts in sync.

### 7.4 Allocation and risk

- **Risk score** (`core/risk.py`): weighted 0 to 1 score, weights 0.4 peg, 0.3 liquidity, 0.2 utilisation, 0.1 concentration (configuration, not calibrated).
- **Hard exit triggers:** peg deviation above 1 %, oracle older than `maxOracleAge` (180 s), releasable vault liquidity below 1.2 × the position. Any trigger makes the Exit Agent quarantine the vault and redeem.
- **Planner** (`core/planner.py`): greedy by risk-adjusted net yield, per-vault cap 60 % of `D`, minimum trade 50 USDC, hysteresis 5 %, quarantined vaults excluded.

### 7.5 Invariants

| Invariant | Enforced by | Tested by |
|:-|:-|:-|
| Funds leave the Safe through the agent path only to an owner-allowed vault, and come back only to the Safe | `AegisModule` builds calldata with `receiver = Safe` | `test/invariant/ContainmentInvariant.t.sol` (fuzzed adversary holding bank, Authorizer, Exit and Executor keys) |
| Safe USDC never ends below `reserveFloor` after a deposit | `AegisModule._executionChecks` | `test/invariant/ReserveFloorInvariant.t.sol` |
| Escrow balance equals `escrowedTotal` and the sum of unreleased active orders | `TradeEscrow` accounting | `test/invariant/TradeEscrowInvariant.t.sol` (T32) |
| No double payment; payees only supplier or buyer | `TradeEscrow.release/waive/refund` | T33, T34 |
| `committedOf[buyer]` equals unreleased funds | `TradeEscrow` | T35 |

### 7.6 Reconciliation

The bank desk (`GET /api/bank/clients`) runs `ledger.reconcile` per client: it matches `CONFIRMED` / `EXIT_CONFIRMED` ledger rows with `AegisExecuted` events and TradeFlow ledger rows with `MilestoneReleased` / `OrderRefunded` events, and reports mismatches. The ledger itself is hash-chained (`row_hash = sha256(canonical row + prev_hash)`), and `GET /api/ledger` returns an integrity result.

### 7.7 Exceptional conditions and disputes

There is no on-chain dispute process. A held milestone ends in an owner waiver, a late release with an owner `ReleaseConfirmation`, or a refund after the pending milestone's deadline. Depeg and liquidity shocks trigger the Exit Agent; with one stable asset and one feed, an exit reduces vault-specific risk, not exposure to the asset itself.

---

## 8. Blockchain architecture

### 8.1 Networks and deployed contracts

Base Sepolia (84532). Addresses from [`deployments/84532.json`](../deployments/84532.json); every address was checked to hold code on 20 Oct 2026, and the Porthmos contracts' runtime bytecode matches the local build of this revision ([Execution Evidence §4](EXECUTION_EVIDENCE.md#4-contracts-and-blockchain-references)).

| Contract | Address | Kind |
|:-|:-|:-|
| AegisModule | `0x786863E82d233eb60555dfeEFEe06068d8EcB318` | Porthmos |
| PolicyRegistry | `0xE6E9A49870C16F544F1adFB79003E4Df59055F2a` | Porthmos |
| TradeEscrow | `0x009ca6F11b24fE0bAb9dE3EBb5dAb9e15f95ce76` | Porthmos (deployed at block 48204293) |
| MockUSDC | `0x5C02E17b299d7BC9d5Af31128306a8E05e62BE63` | Mock (6 decimals) |
| MockPriceFeed | `0x3e9eB7a3B431a3df26135B54C7dcC61149F1fda6` | Mock (8 decimals) |
| Vault A / Vault B | `0xBEf3507AF91BB2cac0c18fa65Bf68D45f1B44F3d` / `0x7CAB5C889D4925834837dd5562Dd644Fd63d1D4a` | Mock ERC-4626 |
| Reference Safe | `0x2E1c2be3dD6BAa59344EdC6ee6A93D68e2295a0F` | Safe proxy (evidence treasury) |
| SafeL2, SafeProxyFactory, MultiSendCallOnly | `0x29fcB4…C762`, `0x4e1DCf…ec67`, `0x9641d7…02e2` | Canonical Safe v1.4.1 |

There is no mainnet deployment.

### 8.2 Contract interactions

- `AegisModule` is enabled on each tenant Safe. It reads `PolicyRegistry` and `MockPriceFeed`, and acts through `execTransactionFromModuleReturnData` with `Operation.Call` only.
- `TradeEscrow` reads `PolicyRegistry` (owner, authorizer, exit key, freezes, policy version) and moves only MockUSDC.
- Owners call `PolicyRegistry` directly from their key, and the Safe calls `TradeEscrow` through an owner-signed `execTransaction` (delegatecall to `MultiSendCallOnly` for funding).

### 8.3 Access control (PolicyRegistry role matrix)

Every policy change increments `policyVersion[safe]` and emits `PolicyChanged`.

| Function | Owner | Bank | Exit key |
|:-|:-|:-|:-|
| `register(safe, owner, bank)` | Once; caller must be the sole owner of a threshold-1 Safe, or the Safe itself | – | – |
| `addVault`, `setAuthorizer`, `setExitKey`, `setReserveFloor`, `ownerFreeze/Unfreeze`, `clearQuarantine` (after 24 h) | Yes | – | – |
| `setBankLimit`, `bankFreeze/Unfreeze` | – | Yes | – |
| `removeVault`, `revokeAuthorizer` (bank revoke also sets bank freeze) | Yes | Yes | – |
| `setAutoCap`, `setDailyCap`, `setMaxBandWidth`, `setMaxOracleAge` | Any value | Only lower | – |
| `quarantine(safe, vault)` | Yes | Yes | Yes |

### 8.4 Authorization and signatures

`AegisModule` verifies EIP-712 signatures in domain `{name: "AegisModule", version: "1", chainId, verifyingContract: module}`:

- **DAR** signed by `registry.authorizer(safe)` (deposits) or by the Authorizer or the Exit key (redeems). The Exit key is refused for deposits.
- **Approval** signed by `registry.owner(safe)` (T3) and also `registry.bank(safe)` (T4); `dar.approvalHash` must equal the Approval's struct hash.
- Signatures are recovered with OpenZeppelin `ECDSA.tryRecover` (rejects malleable high-s signatures); a zero address is never accepted.

### 8.5 Approval tiers

`requiredTier(safe, vault, amount)` is derived on-chain; the DAR's declared tier can only raise it.

| Tier | Condition | Signatures |
|:-|:-|:-|
| T1 Protective | Any `REDEEM` to the Safe | Authorizer or Exit key |
| T2 Routine | `DEPOSIT` ≤ `autoCap` into a vault the Safe used before | Authorizer |
| T3 Material | `DEPOSIT` > `autoCap`, or the first deposit into a vault | Authorizer + owner Approval |
| T4 Escalated | `DEPOSIT` > `bankLimit` (if non-zero) | Authorizer + owner + bank Approvals |
| Not representable | Any transfer out, any other receiver, any vault the owner did not add | – |

### 8.6 Execution lifecycle and revert behaviour

**Deposit checks, in order** (`_depositChecks`, `_approvalChecks`, `_executionChecks`): op is `DEPOSIT` → no owner/bank freeze → vault not quarantined → `policyVersion` matches → vault allowed → Authorizer signature → for T3/T4 the Approval (presence, signers, hash, fields, `maxAmount`, policy version, expiry, nonce) → DAR expiry → DAR nonce unused → oracle fresh (`updatedAt` not zero, not in the future, age ≤ `maxOracleAge`) → price in `[priceLow, priceHigh]` → band width ≤ `maxBandWidth` → balance after deposit ≥ `reserveFloor` → today's deposits + amount ≤ `dailyCap`. Then: mark nonces used, `approve(vault, amount)`, `vault.deposit(amount, receiver = Safe)`, `approve(vault, 0)`, measure shares, require shares ≥ `minOut`, set `everDeposited`, emit `AegisExecuted`.

**Redeem checks:** signer is Authorizer or Exit key → op is `REDEEM` → not expired → nonce unused → the Safe has deposited into the vault before (`everDeposited`) and holds at least `amount` shares. Freezes, allowlist, policy version and oracle are deliberately **not** checked. Then `vault.redeem(shares, receiver = Safe, owner = Safe)`, measure assets, require ≥ `minOut`, emit `AegisExecuted`.

Every failure reverts with a typed custom error (for example `BadSignature`, `NonceUsed`, `Frozen`, `PriceOutOfBand`, `StaleOracle`, `ReserveFloorBreached`, `MissingApproval`, `ExecutionFailed`). `check(dar, approval)` is a view that runs the same checks except signatures, used by the simulator.

### 8.7 Events and confirmations

| Event | Emitted by | Used for |
|:-|:-|:-|
| `AegisExecuted(safe, darHash, op, vault, assets, shares, tier, evidenceHash)` | `AegisModule` | Reconciliation, audit view |
| `PolicyChanged(safe, version, selector)`, `Quarantined(safe, vault, by)` | `PolicyRegistry` | Re-checking waiting milestones, audit |
| `OrderCreated`, `MilestoneReleased`, `OrderRefunded` | `TradeEscrow` | Order state, reconciliation |

The Executor waits up to 60 s for a receipt; the workflow reconciles an executed submission against `AegisExecuted` events after 90 s if no receipt was recorded.

---

## 9. Trade and escrow workflows (TradeFlow)

### 9.1 Order model

One order has one buyer (a registered Safe), one supplier fixed at creation, MockUSDC as the token, and exactly three milestones, each with its own amount, issuer, proof kind, conditions and deadline:

| Index | Milestone | Proof kind | Demo issuer (stand-in for) | Demo condition |
|:-|:-|:-|:-|:-|
| 0 | Handed to carrier | `HANDOVER` | Demo carrier (eBL / TradeTrust document) | Document hash required |
| 1 | Arrived | `ARRIVAL` | Demo reefer sensor gateway (IoT) | Document hash; temperature 2.00 to 8.00 °C; ≥ 1 sample |
| 2 | Quality accepted | `QUALITY` | Demo surveyor | Document hash required |

The web computes the 20/40/40 split in integer units and adds any remainder to the last milestone.

### 9.2 Escrow lifecycle

```mermaid
stateDiagram-v2
  [*] --> ACTIVE: createOrder (buyer Safe funds total)
  ACTIVE --> ACTIVE: release or waive of milestone 0 or 1
  ACTIVE --> COMPLETED: release or waive of milestone 2
  ACTIVE --> REFUNDED: refund after the pending milestone's deadline
  COMPLETED --> [*]
  REFUNDED --> [*]
```

- **Funding** (`createOrder`): one owner-signed Safe transaction that delegatecalls Safe `MultiSendCallOnly` v1.4.1 to batch `MockUSDC.approve(escrow, total)` and `TradeEscrow.createOrder(...)`. The escrow pulls exactly `total` and checks its balance change, so no allowance is left. The agent never funds orders.
- **Release** (`release`): anyone may submit; needs the issuer's `MilestoneProof` signature and the Authorizer's `ReleaseAuthorization`. Pays exactly the milestone amount, only to the fixed supplier, only in order.
- **Waive** (`waive`): buyer Safe only, not while frozen; pays the fixed amount to the supplier with `waived = true`.
- **Refund** (`refund`): buyer Safe only, after the pending milestone's deadline; returns all unreleased funds to the buyer Safe. Freezes do not block refunds.

### 9.3 Milestone verification (off-chain) and release (on-chain)

The Proof Verifier (`service/aegis/tradeflow/verifier.py`, `milestones.py`, `checks.py`) runs two stages:

1. **Admission** (fails with 4xx, writes nothing): order exists and is active; milestone not paid; `orderId`, `index` and `kind` match; the signature recovers to the milestone issuer; an uploaded document is ≤ 1 MB and hashes to `docHash`.
2. **Verification:** next unpaid milestone (else `WAITING: OutOfOrder`), not frozen (else `WAITING: Frozen`), the Authorizer is current (else `WAITING: AuthorizerNotCurrent`), `createdAt ≤ issuedAt ≤ latest block time` (else `HELD: BadProofTime`), conditions hold (else `HELD: ConditionNotMet`), pending deadline not passed unless the owner confirmed (else `HELD: DeadlinePassed`).

Only a fully verified proof leads to a `/sign-release` request. The Authorizer re-runs these checks against its own reads and `TradeEscrow.checkRelease`, and requires an owner `ReleaseConfirmation` after a deadline or a prior hold. On-chain, `TradeEscrow._releaseChecks` repeats the binding checks: active order, next index, no freeze, proof fields, issuer signature, proof time, conditions, Authorizer signature (not the Exit key), authorization fields equal to the milestone, policy version, expiry, nonce.

Off-chain milestone states: `AWAITING_PROOF → PROOF_RECEIVED → PROOF_VERIFIED → RELEASE_SIGNED → RELEASE_SUBMITTED → RELEASED`, with `WAITING` (transient, re-checked on `PolicyChanged` and `MilestoneReleased`), `HELD`, `RELEASE_FAILED` (at most two automatic re-signs), `WAIVED` and `REFUNDED`.

### 9.4 TradeFlow API

| Route | Caller | Purpose |
|:-|:-|:-|
| `GET /api/tradeflow/config` | Public | Enabled flag and addresses; the web refuses to act if they differ from its bundled values |
| `GET /api/tradeflow/orders` | Owner or bank session | Orders of the session's Safes |
| `GET /api/tradeflow/orders/{id}` | Anyone | Public view: on-chain fields only; full view (proofs, hold reasons, ledger refs) needs the buyer's owner or bank session |
| `POST /api/tradeflow/orders/{id}/proofs` | Anyone, rate-limited | Submit a signed proof (and optional document) |
| `POST .../proofs/demo` | Owner | Ask a demo issuer to sign a valid, out-of-range or corrected proof |
| `POST .../confirm` | Owner | Owner `ReleaseConfirmation` for a late release or a corrected proof |
| `POST .../link` | Owner | Settle the obligation the order pays and return the new floor |

TradeFlow is optional at runtime: without `tradeEscrow` in the deployments file the routes return `503 TradeFlowDisabled`.

### 9.5 Buyer and supplier relationship

The supplier is any address the owner enters (in the demo, a third browser key). It cannot be the buyer, the escrow or the token, and it cannot be an issuer of its own milestones (`BadIssuer`). The supplier has a read-only public order page; submission of a proof or a release is permissionless, but the payee is fixed, so a front-run copy pays the same supplier the same amount.

---

## 10. Cryptography and verification

| Primitive | Use | Implementation |
|:-|:-|:-|
| secp256k1 ECDSA | All on-chain and off-chain signatures | OpenZeppelin `ECDSA.tryRecover`; `eth-account` in Python; viem in the web |
| EIP-712 typed data | DAR, Approval (`AegisModule` domain); MilestoneProof, ReleaseAuthorization, ReleaseConfirmation (`TradeEscrow` domain) | Contracts; `service/aegis/eip712.py`, `service/aegis/tradeflow/typed.py`; `web/src/lib/eip712.ts`; digest equality tested (`Eip712.t.sol`, `TradeEscrowEip712.t.sol`, `tradeflow.test.ts`) |
| EIP-4361 (SIWE) | Sessions and tenant activation | `service/aegis/siwe.py`, `web/src/lib/siwe.ts` |
| EIP-191 personal_sign | Faucet request message (`AEGIS onboarding …`, max age 5 min) | `service/aegis/onboarding.py` |
| ERC-1271 / ERC-6492 | Smart-contract wallet signatures (deployed and counterfactual) | `service/aegis/sigverify.py`, `chain/erc6492.py` |
| keccak-256 | Schedule hash, document hash, struct hashes | Contracts and service |
| SHA-256 | Decision ledger hash chain | `service/aegis/ledger.py` |

**Replay protection.** DAR and Approval nonces are random 256-bit values in a per-Safe used-set (`usedNonce[safe][nonce]`), shared by DARs and Approvals; release nonces have their own per-buyer set in `TradeEscrow`. EIP-712 domains bind chain ID and contract address. DARs expire after 120 s (less than the 180 s oracle age), Approvals after 24 h, release authorizations after 120 s; every policy change bumps `policyVersion`, which invalidates in-flight DARs, Approvals and release authorizations. The Authorizer also records every nonce it signed.

**Oracle and proof attestations.** The price feed is a mock that the keeper refreshes; freshness and a bounded price band are checked on-chain. Milestone proofs are attestations by trusted issuer keys; the contract checks the signed summary (document hash, temperature range and sample count), not the underlying document or sensor data.

**Zero-knowledge proofs: Not Implemented.** No circuit, prover or verifier exists in the repository. Nothing in this system should be read as a ZK proof; hashes and signatures here are ordinary commitments and attestations.

---

## 11. Data model

### 11.1 Off-chain entities (SQLite, `service/aegis/db.py`)

| Table | Contents | Lifecycle |
|:-|:-|:-|
| `tenants` | Served Safes (reference and activated), owner, bank, mint state | Created at activation; reloaded by every process every 3 s |
| `sessions`, `auth_nonces` | SIWE sessions (12 h) and single-use nonces (10 min) | Expire |
| `obligations` | Owner-entered outflows and confirmed inflows | Added, settled |
| `requests`, `transitions` | Copilot requests and every state transition | Persisted per request |
| `submissions` | Signed DARs and releases queued for the Executor | `pending → claimed → sent → confirmed / reverted / failed` |
| `ledger` | Hash-chained decision ledger (`prev_hash`, `row_hash`) | Append-only by code |
| `risk_triggers`, `alerts` | Exit triggers and alerts | Append |
| `faucet_drips`, `rate_events` | Faucet history and rate-limit counters (IPs stored as salted SHA-256) | Append, windowed |
| `tf_orders`, `tf_milestones`, `tf_proofs`, `tf_transitions`, `tf_confirmations` | TradeFlow off-chain state | Per order |
| `signed_dars`, `signed_releases` | Authorizer's own record of signed nonces (separate database file) | Append |

### 11.2 On-chain state

`PolicyRegistry`: per-Safe roles, caps, floor, schedule hash, freezes, allowlist, quarantine and `policyVersion`. `AegisModule`: `everDeposited`, `usedNonce`, daily deposit counter. `TradeEscrow`: orders, milestone terms and statuses, `committedOf`, `escrowedTotal`, release nonces.

### 11.3 Synchronisation and integrity

The chain is the source of truth for balances, policy and escrow state; the service reads it at one pinned block per snapshot. Off-chain data that the chain also records is reconciled (ledger vs events). Off-chain-only data (obligations, chat history, proofs and documents' hashes) is protected only by the service's database and the ledger hash chain, which detects editing of a row but not a rewrite of the whole chain by someone controlling the host (see the Security report, finding PRT-04).

---

## 12. Security architecture

This section summarises the design; the assessment, findings and residual risks are in the [Security Self-Assessment Report](SECURITY_SELF_ASSESSMENT_REPORT.md).

### 12.1 Enforcement layers

```mermaid
flowchart LR
  L1["1 Rule parser + confirm gate<br/>(questions never act)"] --> L2["2 Proposal Validator<br/>(only more conservative)"]
  L2 --> L3["3 Policy check + simulation"]
  L3 --> L4["4 Human Approval<br/>(T3 owner, T4 owner + bank)"]
  L4 --> L5["5 Authorizer re-verification<br/>(own chain reads)"]
  L5 --> L6["6 AegisModule / TradeEscrow<br/>on-chain checks"]
```

Layers 1 to 5 are defence in depth; layer 6 holds on its own.

### 12.2 Wallet and key responsibilities

| Key | Holder | Worst case if compromised |
|:-|:-|:-|
| Owner | Visitor's browser key or wallet | Full control of their own Safe (self-custody; out of scope) |
| Bank | Visitor's second browser key or wallet | Freeze, tighten, revoke; cannot move funds or block redeems and refunds |
| Authorizer | Authorizer process (shared by all tenants) | T2 deposits within each tenant's caps, floor and used vaults; signing releases still needs a valid issuer proof |
| Exit key | Exit Agent (shared) | Redeem to the Safe and quarantine: availability impact, no loss |
| Executor, Keeper | Their processes | Gas only |
| Demo issuers, faucet/admin (mock owner), attacker | API process | Demo releases to the owner-chosen supplier; mock market manipulation; test ETH |
| LLM | No key | Wrong proposals that downstream layers reject or escalate |

### 12.3 Safe transaction execution in the browser

`web/src/lib/txguard.ts` guards every transaction a browser key sends once the treasury exists:

- Targets must be the bundled `PolicyRegistry` or `AegisModule`, or the session Safe; nothing carries ETH.
- A Safe transaction must be `execTransaction` with no gas refund, the owner's pre-validated signature, and one of exactly three shapes (fund order via the pinned MultiSendCallOnly, waive, refund), re-encoded and compared byte for byte.
- The reserve floor update takes only the floor and schedule hash from the API and encodes `setReserveFloor` itself.
- **Exception: onboarding.** The sign-up runner (`web/src/lib/onboard/runner.ts`) takes the Safe factory, singleton, module, registry and vault addresses from `GET /api/onboard/config`, and its senders (`onboard/signers.ts`) do not pass through `txguard`. A compromised API host could therefore point a new treasury at a module it controls. This is an open finding with a recommended fix: [Security report PRT-01](SECURITY_SELF_ASSESSMENT_REPORT.md#prt-01-onboarding-addresses-taken-from-the-api-without-pinning-high-open).

### 12.4 Auditability

Every decision, hold, refusal and execution writes a ledger row; executions emit events with measured amounts; reverts are typed. The Audit page shows integrity status and BaseScan links; the bank desk reconciles ledger and chain.

---

## 13. Infrastructure and deployment

### 13.1 Environments

| Environment | Chain | Service | Web |
|:-|:-|:-|:-|
| Local | Anvil 31337 (`anvil --block-time 2`) | `make dev` (five processes) or `make dev-fake` (in-memory chain) | `npm run dev` on port 5173 |
| Hosted testnet | Base Sepolia 84532 | Docker Compose on a Tencent Cloud VM: `https://aegis-api.150-109-23-187.sslip.io` | Vercel: `https://porthmos.vercel.app` |
| Mainnet | Not deployed | – | – |

**Availability observed during this audit (20 Oct 2026, ~12:45 UTC):** the web app answered HTTP 200; the API host refused connections on port 443, so the web app would fall back to replay mode. See [Execution Evidence §12](EXECUTION_EVIDENCE.md#12-demo-and-replay-guide).

### 13.2 Containerisation

`deploy/tencent/Dockerfile` builds one image (Python 3.13.15 slim, uv, `uv sync --frozen --no-dev`) that runs `python -m aegis all` as a non-root user with a health check. `deploy/tencent/docker-compose.yml` runs it with a read-only root filesystem, all capabilities dropped, `no-new-privileges`, a 512 MB limit and the port published on `127.0.0.1` only, next to a CLIProxyAPI container reachable only on the compose network. An existing Caddy terminates TLS and proxies with `flush_interval -1` for Server-Sent Events (`deploy/tencent/Caddyfile.aegis`).

### 13.3 Deployment workflow

1. Contracts: `forge script script/Deploy.s.sol --rpc-url $RPC_URL --broadcast` (role keys in the environment), then `DeployTradeEscrow.s.sol`, then `service/scripts/merge_deployment.py`, which refuses to change any existing key.
2. Service: copy the build context, create `aegis.env` from `deploy/tencent/aegis.env.example` (root-owned, mode 600), `docker compose up -d --build`, add the Caddy block, check `/api/health`. Details: [`deploy/tencent/README.md`](../deploy/tencent/README.md).
3. Web: Vercel builds `web/` (`npm run build`), bundling `deployments/*.json`.

### 13.4 Configuration (names only)

Chain: `CHAIN_ID`, `RPC_URL`, `PUBLIC_RPC_URL`, `EXPLORER_URL`, `DEPLOYMENTS_PATH`, `DEPLOY_BLOCK`. Keys: `AUTHORIZER_KEY`, `EXIT_KEY`, `EXECUTOR_KEY`, `KEEPER_KEY`, `DEPLOYER_KEY` / `ADMIN_KEY`, `ATTACKER_KEY`, `ISSUER_CARRIER_KEY`, `ISSUER_SENSOR_KEY`, `ISSUER_SURVEYOR_KEY`. Service secrets: `INTERNAL_TOKEN`, `ADMIN_TOKEN`, `IP_HASH_SALT`. Behaviour: `ALLOWED_ORIGINS`, `SIWE_DOMAINS`, `REQUIRE_SESSION_SIG`, `DEMO_MODE`, `TRUST_PROXY`, `ONBOARDING_OPEN`, `LIMIT_*`, `TENANT_*`. LLM: `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL`, `LLM_TIMEOUT`. Web: `VITE_API_URL`, `VITE_TARGET_CHAIN_ID`, `VITE_WALLETCONNECT_PROJECT_ID`, `VITE_RPC_URL_84532`.

### 13.5 External services

Base Sepolia RPC (publicnode for the server, `sepolia.base.org` for browsers), the LLM provider behind CLIProxyAPI, Vercel, and the Tencent Cloud VM. Canonical Safe v1.4.1 contracts on Base Sepolia.

---

## 14. Installation and local development

### 14.1 Prerequisites

| Tool | Version | Notes |
|:-|:-|:-|
| Foundry | 1.8.x nightly (audited with 1.8.6-nightly `bbc7910`) | The vendored forge-std 1.17.0 needs a Foundry build that returns the newer `vm.lastCallGas()` struct; 1.5.1-stable fails one test. See [§15.3](#153-results-of-the-20-oct-2026-audit-run) |
| uv | Any recent | Installs Python ≥ 3.12 dependencies from `uv.lock` |
| Node.js | ≥ 20.19 | npm with `package-lock.json` |

### 14.2 Start-up order (local Anvil)

```bash
# 1. chain
anvil --block-time 2                    # or: cd service && make anvil

# 2. contracts and deployments/31337.json
cd service
make install                            # uv sync
make deploy                             # Deploy.s.sol, DeployTradeEscrow.s.sol, merge

# 3. the five service processes (logs in service/var/log/)
make dev                                # needs bash; on chain 31337 every key falls back to the public Anvil keys

# 4. web
cd ../web
npm install
npm run dev                             # http://localhost:5173, proxies /api to :8787
```

No chain at all: `cd service && make dev-fake` runs the API with an in-memory chain and all workers in one process. Environment variable names are listed in `service/.env.example` (public Anvil keys only) and `deploy/tencent/aegis.env.example` (placeholders).

On Windows without `make` and `bash`, run the commands inside each Makefile target directly (for example `uv run python -m aegis api`) or use WSL.

### 14.3 Tests

```bash
cd contracts && forge test                                   # unit, fuzz, invariant
cd service   && uv run pytest -m "not integration"            # unit tests
cd service   && RPC_URL=http://127.0.0.1:8545 uv run pytest -m integration   # needs Anvil + make deploy
cd web       && npm test && npm run lint && npm run build
```

On Windows, set `PYTHONUTF8=1` for the service commands once `contracts/out` exists: `aegis/chain/abi.py` reads the Forge artifacts with the platform's default encoding. To re-check the Base Sepolia evidence read-only, see [Execution Evidence §2](EXECUTION_EVIDENCE.md#2-reproducibility-information).

---

## 15. Testing strategy

### 15.1 Frameworks and locations

| Suite | Framework | Location | Categories |
|:-|:-|:-|:-|
| Contracts | Foundry (`forge test`), fuzz 256 runs, invariants 64 runs × depth 40 | `contracts/test/` | Unit (module, registry, escrow, funding, EIP-712), fuzz, invariants (containment, reserve floor, escrow) |
| Service unit | pytest | `service/tests/*.py` | Core algorithms, workflow, Copilot safety (147 cases, most parameterised), SIWE, multi-tenancy, TradeFlow, RPC batching, streaming, reconciliation |
| Service integration | pytest `-m integration` against Anvil | `service/tests/integration/` | End-to-end deposits, attacks, exits, two tenants, smart wallets, TradeFlow E6 sequence, Copilot |
| Web | Vitest | `web/src/**/*.test.ts(x)` | txguard, EIP-712 digests, TradeFlow encoders, onboarding runner, SIWE, SSE parser, keys, formatting |
| Browser QA (manual) | Playwright-based scripts | `web/scripts/qa/` | Flows, wallet, axe accessibility, screenshots |
| On-chain evidence | Python script | `service/scripts/evidence_84532.py` | Recorded testnet transactions (re-verified by the auditor, see Execution Evidence) |

### 15.2 Reproducibility

Contract, service-unit and web tests are hermetic. Integration tests snapshot Anvil and revert afterwards, and skip themselves when no chain or no fresh deployment is present. The evidence check reads only public chain data.

### 15.3 Results of the 20 Oct 2026 audit run

Run on Windows 11, Node 24.21, Python 3.12.10, uv 0.13.3, Foundry as noted. Full commands and outputs: [Execution Evidence §10](EXECUTION_EVIDENCE.md#10-test-execution-matrix).

| Suite | Result |
|:-|:-|
| Contracts | **All pass with Foundry 1.8.6-nightly** (`bbc7910`, 20 Oct 2026): 106 tests reported, which are 109 test functions (Foundry 1.8 reports the four TradeEscrow invariants as one campaign). With Foundry 1.5.1-stable and 1.6.0-nightly, 108 of 109 pass: `test_T1_createOrderThroughSafeMultiSendCallOnly` reverts at its gas-logging line, because those builds return an older `vm.lastCallGas()` struct than the vendored forge-std 1.17.0 expects |
| Service unit | **412 passed, 20 skipped** (the integration tests). On Windows this needs `PYTHONUTF8=1` once `contracts/out` exists; without it 17 tests in `test_rpc_batching.py` fail with `UnicodeDecodeError` while reading Forge artifacts (Security report PRT-12). A clean checkout without `contracts/out` is not affected |
| Service integration | **19 of 20 pass** in one run against a freshly started Anvil (1.8.6-nightly) after the three deploy steps (with `PYTHONUTF8=1`). `test_e6_dry_run_on_anvil` sends every E6 transaction with the expected outcome but then fails at cleanup on Windows, because `scripts/evidence_84532.py` calls `os.killpg`, which exists only on Linux and macOS (expected to pass there; not run here). The suite needs a fresh chain: re-running it on the same Anvil fails with `StaleOracle`, as the fixture's skip message warns |
| Web | **176 passed** in 21 files (with `contracts/out` present; without it 175 pass and the forge-ABI comparison test is skipped); ESLint and `tsc -b` clean; production build succeeds; `npm audit --omit=dev`: 0 vulnerabilities |

### 15.4 Continuous integration

No CI workflow exists in the repository; all results above come from local runs. A recommended workflow would run `forge test` with a Foundry 1.8.x nightly (pinned), `uv run pytest -m "not integration"`, and `npm run lint`, `npm test` and `npm run build` in `web/`.

### 15.5 Coverage limitations

- No line-coverage measurement is configured for any suite.
- Integration tests need Anvil and a fresh deployment; they are not in CI.
- No end-to-end browser test runs automatically; the QA scripts are manual.
- The financial replay against baselines and an AgentDojo-style injection benchmark are not done.
- No gas or latency benchmark suite exists; the Copilot latency figures in the design specification are the team's own measurements, not re-measured here.

---

## 16. Engineering trade-offs

| Decision | Chosen | Alternative | Reason (from code and design spec) |
|:-|:-|:-|:-|
| Wallet | Safe + custom module | Custom wallet; Zodiac Roles | Safe is audited and keeps custody with the owner; two typed actions make transfers inexpressible, which an allowlist of calldata does not |
| Permission scoping | Typed `DEPOSIT`/`REDEEM` with the receiver hard-coded | Arbitrary calldata plus allowlist | Parsing free-form calldata is attack surface |
| Approve handling | Exact approve, deposit, approve(0) in one call | Standing approval | A vault bug cannot drain the Safe through a leftover allowance |
| Human approval | Humans sign an `Approval` envelope; the Authorizer signs the final DAR later | Humans sign the DAR | Market data must be bound at execution time |
| Oracle binding | Freshness + price band | Exact round | Rounds change every minute; exact binding would expire every approval |
| Freeze semantics | Freezes stop deposits and releases only | Freeze everything | A freeze during a depeg must not trap funds |
| Escrow | Separate `TradeEscrow` contract | New action in the module | No change to deployed contracts; the module's "receiver is the Safe" rule stays absolute |
| Release authority | Issuer proof + Authorizer | Issuer only / Authorizer only / owner each time | Neither one external key nor the agent alone can pay |
| Service shape | One Python service, five processes, one SQLite file | Microservices, managed DB | Fits a 512 MB VM; keys still separated per process; no high availability |
| Multi-tenancy | Shared contracts and shared operator keys, everything keyed by Safe | Per-tenant deployment or keys | No redeploy; evidence stays valid; one operator-key leak reaches all tenants (bounded per tenant) |
| Agent framework | Plain Python state machine | LangGraph, multi-agent chat | Persisted, inspectable state and human pauses |

**External trust assumptions:** the Safe contracts, the Base Sepolia sequencer and RPC providers, the LLM provider (for wording only), the demo issuer keys (for TradeFlow truthfulness), and the operator who holds the shared server keys and the mock admin key.

---

## 17. Current implementation status

### 17.1 Feature matrix

| Feature | Status | Evidence |
|:-|:-|:-|
| Typed deposit/redeem through a Safe module | Implemented & Verified | Foundry tests; E1, E3 |
| On-chain tiers T1 to T4 with owner and bank Approvals | Implemented & Verified (T3 on-chain; T4 by tests only) | C11 to C14; E1 |
| Reserve floor from obligations | Implemented & Verified | A1, A7; E3 |
| Signature tampering, replay, stale price refusals | Implemented & Verified | C3, C5, C16; E4a, E4b, E4d |
| Bank freeze and revoke with exits open | Implemented & Verified | C19, C20, R3; E5; tenant freeze + exit on 18 Oct 2026 |
| Exit Agent (depeg, staleness, liquidity) | Implemented & Verified (depeg on-chain) | A8, A9; E2 |
| Prompt-injection containment | Implemented & Verified (no transaction is representable; ledger record) | A5, A14; E4c (ledger-only evidence) |
| TradeFlow escrow, proof-gated release, waive, refund | Implemented & Verified (refund by tests only) | T1 to T35; E6a to E6g |
| Multi-tenant onboarding with SIWE and smart wallets | Implemented & Verified (tests; live tenant transactions) | M1 to M12, `test_siwe.py`; tenant Safe `0x9f0dA153…964c3A70e` |
| Copilot with optional LLM | Implemented (LLM path tested with test doubles; live LLM not re-verified in this audit) | A4, A12, A14 to A16 |
| Hash-chained ledger and bank reconciliation | Implemented | A10, T42 |
| Offline replay mode in the web | Recorded Replay | `web/src/replay/` |
| Real vaults, real price feeds | Mock / Simulation | MockVault, MockPriceFeed |
| Real proof issuers (eBL, IoT, surveyors) | Mock / Simulation | Server-held demo issuer keys |
| Dispute and arbitration | Not Implemented | – |
| ZK proofs | Not Implemented | – |
| Mainnet deployment, audit | Not Implemented | – |

### 17.2 External integrations

Base Sepolia (live), canonical Safe v1.4.1 (live), LLM via CLIProxyAPI (configured in the hosted service; not reachable from this audit), Vercel (live). No bank, payment provider, TradeTrust, IoT or accounting integration exists.

### 17.3 Known limitations

The full list with impact and planned improvements is in [Security Self-Assessment §14](SECURITY_SELF_ASSESSMENT_REPORT.md#14-residual-risks-and-recommendations). The most important: mocks for vaults, price feed and issuers; unaudited custom contracts; shared server keys across tenants; a single host and SQLite file; browser-held testnet keys; no dispute process; fixed three milestones; obligations entered by hand.

### 17.4 Audit scope and changes

The 20 Oct 2026 audit changed **documentation only**. No contract, service, web, configuration or test file was modified, so the hosted website, the service and the deployed contracts behave exactly as at commit `1c19881`.

| Change | Files |
|:-|:-|
| New final documents | `docs/TECHNICAL_DOCUMENTATION.md`, `docs/SECURITY_SELF_ASSESSMENT_REPORT.md`, `docs/EXECUTION_EVIDENCE.md` |
| Rewritten repository homepage | `README.md` |
| Reading guide added to the design specification; stale facts corrected in the knowledge base | `docs/TECHNICAL-DOCUMENT.md`, `docs/KNOWLEDGE-BASE.md` |
| Superseded drafts moved, unchanged, to an archive | `docs/archive/` (specification v0.1 to v0.6, concept notes, first design review) |

Issues found in the code during the audit are recorded as findings with recommended fixes in the [Security Self-Assessment Report §10](SECURITY_SELF_ASSESSMENT_REPORT.md#10-security-findings).

---

## 18. References and further documentation

**Project documents**

- [Security Self-Assessment Report](SECURITY_SELF_ASSESSMENT_REPORT.md) · [Execution Evidence](EXECUTION_EVIDENCE.md)
- [Design specification v0.7](TECHNICAL-DOCUMENT.md): check orders, test IDs (C1 to C32, R1 to R11, A1 to A16, M1 to M12, T1 to T54), design-review history
- [Interface spec v1](INTERFACES.md) and [Multi-tenant spec v2.1](MULTI-TENANT.md): implementation-time specifications
- [Knowledge base](KNOWLEDGE-BASE.md): talking points for demos
- Component guides: [`contracts/README.md`](../contracts/README.md), [`service/README.md`](../service/README.md), [`web/README.md`](../web/README.md), [`deploy/tencent/README.md`](../deploy/tencent/README.md)
- [`docs/archive/`](archive/): earlier specification versions, concept notes and design reviews

**Code locations for the main claims**

| Claim | Location |
|:-|:-|
| Agent cannot transfer out | `contracts/src/AegisModule.sol` (`_executeDeposit`, `_executeRedeem`) |
| Tier derivation | `AegisModule.requiredTier` |
| Freezes do not block exits | `AegisModule._redeemChecks`, `TradeEscrow.refund` |
| Proof-gated release | `TradeEscrow._releaseChecks`, `_conditionsMet` |
| LLM bounded to options | `service/aegis/core/validator.py`, `service/aegis/agent/agent.py:select` |
| Authorizer re-verification | `service/aegis/procs/authorizer.py` |
| Per-process key isolation | `service/aegis/supervisor.py` |
| Browser transaction guard | `web/src/lib/txguard.ts` |

**Standards used:** EIP-712, EIP-4361 (SIWE), EIP-191, ERC-1271, ERC-6492, ERC-4626, ERC-20, EIP-6963, EIP-5792 (wallet batch calls, when the wallet supports them), Chainlink `AggregatorV3Interface`, Safe v1.4.1 modules and `MultiSendCallOnly`.
