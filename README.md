<p align="center">
  <img src="docs/readme/banner.png" alt="Porthmos: pay suppliers on proof, keep spare cash safe and earning" width="100%" />
</p>

<div align="center">

# Porthmos

**Pay suppliers on proof. Keep the rest of the cash safe and earning.**

An AI agent wallet for cross-border trade treasuries: the agent proposes, deterministic code decides, and smart contracts enforce.

[**Live demo**](https://porthmos.vercel.app) · [**Technical Documentation**](docs/TECHNICAL_DOCUMENTATION.md) · [**Security Self-Assessment**](docs/SECURITY_SELF_ASSESSMENT_REPORT.md) · [**Execution Evidence**](docs/EXECUTION_EVIDENCE.md)

<img alt="Network: Base Sepolia" src="https://img.shields.io/badge/network-Base_Sepolia_(84532)-0052FF" />
<img alt="Solidity 0.8.28" src="https://img.shields.io/badge/Solidity-0.8.28-363636?logo=solidity" />
<img alt="Python 3.12+" src="https://img.shields.io/badge/Python-3.12+-3776AB?logo=python&logoColor=white" />
<img alt="React 19" src="https://img.shields.io/badge/React-19-149ECA?logo=react&logoColor=white" />
<img alt="Safe v1.4.1" src="https://img.shields.io/badge/Safe-v1.4.1-4EC397" />
<img alt="Recorded scenarios" src="https://img.shields.io/badge/recorded_scenarios-15-F99510" />
<img alt="Automated tests" src="https://img.shields.io/badge/automated_tests-714-4EC397" />
<img alt="Deployed on Vercel" src="https://img.shields.io/badge/web-Vercel-111111?logo=vercel&logoColor=white" />

*2026 Shenzhen International FinTechathon · International AI Track · Topic F: Agent Wallet*

</div>

> **Testnet prototype.** Everything runs on Base Sepolia with test USDC, mock vaults and a mock price feed. The contracts are not externally audited. Do not use with real funds.
>
> **Name note.** Porthmos was called AEGIS Treasury until design v0.2. On-chain and code identifiers keep the old name (`AegisModule`, `PolicyRegistry`, EIP-712 domain `"AegisModule"`, Python package `aegis`), because renaming would change deployed bytecode and signature digests.

| | |
|:-|:-|
| **Live app** | <https://porthmos.vercel.app> |
| **Source** | <https://github.com/Xavrir/porthmos> |
| **Demo video** | <https://bit.ly/Porthmos-Video> |
| **All agent transactions** | [AegisModule on BaseScan](https://sepolia.basescan.org/address/0x786863E82d233eb60555dfeEFEe06068d8EcB318) |
| **Built for** | 2026 Shenzhen International FinTechathon · Topic F: Agent Wallet |

## Contents

[Overview](#overview) · [Key capabilities](#key-capabilities) · [Product tour](#product-tour) · [How it works](#how-it-works) · [Architecture](#architecture) · [Technology stack](#technology-stack) · [Getting started](#getting-started) · [Contracts and networks](#contracts-and-networks) · [Security overview](#security-overview) · [Testing and evidence](#testing-and-evidence) · [Documentation](#documentation) · [Known limitations](#known-limitations) · [Team](#team) · [License](#license)

---

## Overview

**The problem.** A mid-sized importer pays foreign suppliers in stages: when goods ship, when they arrive, when they pass inspection. Today a person checks every milestone and approves every payment by hand. Meanwhile the company's stablecoin cash for payroll and invoices sits idle, because moving it into yield risks missing a due date. AI agents could run this work, but agents with wallets have already been talked into bad transfers: the transactions were valid, the decisions were not.

**What Porthmos is.** A Safe-based treasury where an AI Copilot manages cash and supplier payments inside limits that a smart contract enforces:

- **Bills stay covered; only the surplus earns.** A reserve is computed from the owner's obligation schedule and written on-chain as a floor. Only cash above it can go into owner-approved vaults, within caps.
- **Suppliers are paid only on proof.** TradeFlow escrows each order in three milestones. A milestone is released only when a trusted issuer (carrier, sensor gateway, surveyor) signs a proof that passes the contract's own checks. The payee and every amount are fixed when the owner funds the order.
- **Bad actions are impossible, not just unlikely.** The agent's only execution path can express `DEPOSIT` into an allowed vault and `REDEEM` back to the Safe. "Send all USDC to 0x…" cannot be encoded. A bank risk officer can freeze the agent, and exits always stay open.

**Who it serves.** The importer's finance manager (treasury **owner**), the **supplier** (read-only order view, receives payments), and the **bank risk officer** (oversight seat with limits and a freeze switch).

**What is technically interesting.** The safety of fund movements does not depend on the LLM, on the API server, or even on the agent's signing key: every limit that matters is re-checked on-chain, signed decisions bind the policy version, a price band and a short expiry, and the deployed contracts are byte-identical to the source in this repository ([evidence](docs/EXECUTION_EVIDENCE.md#4-contracts-and-blockchain-references)).

## Key capabilities

| Area | What is implemented | Details |
|:-|:-|:-|
| Treasury agent | Obligation-aware reserve, risk scoring, plan options, typed deposits and redeems through a Safe module | [Technical §7](docs/TECHNICAL_DOCUMENTATION.md#7-treasury-and-financial-logic) |
| AI Copilot | Chat in English and Indonesian; the LLM fills missing parameters, picks among deterministic options and explains; rule-based fallback | [Technical §6](docs/TECHNICAL_DOCUMENTATION.md#6-ai-agent-architecture) |
| On-chain policy | Approval tiers T1 to T4, auto/daily caps, bank limit, reserve floor, vault allowlist, quarantine, freezes | [Technical §8](docs/TECHNICAL_DOCUMENTATION.md#8-blockchain-architecture) |
| Exit Agent | Deterministic depeg, stale-oracle and liquidity triggers; quarantine and redeem back to the Safe | [Technical §7.4](docs/TECHNICAL_DOCUMENTATION.md#74-allocation-and-risk) |
| TradeFlow | Milestone escrow with issuer proofs, Authorizer co-signature, hold, waive and refund | [Technical §9](docs/TECHNICAL_DOCUMENTATION.md#9-trade-and-escrow-workflows-tradeflow) |
| Bank oversight | Bank desk with reconciliation, freeze/unfreeze, revoke, tighten limits, T4 approvals | [Technical §4.4](docs/TECHNICAL_DOCUMENTATION.md#44-implemented-pages) |
| Multi-tenant app | Any visitor creates a treasury on Base Sepolia and signs in with SIWE; EOAs and smart wallets (ERC-1271/6492) | [Technical §5](docs/TECHNICAL_DOCUMENTATION.md#5-backend-and-services) |
| Audit trail | Hash-chained decision ledger, typed reverts, on-chain events, BaseScan links | [Technical §12.4](docs/TECHNICAL_DOCUMENTATION.md#124-auditability) |

## Product tour

Open **[porthmos.vercel.app](https://porthmos.vercel.app)** (Base Sepolia, no real funds). The header shows **Live** when the service answers; otherwise the site switches to **Replay**, which re-displays recorded evidence and sends nothing.

1. **Create your treasury.** One faucet signature (free test ETH), one transaction to create your Safe, eleven setup calls (enable the module, write your policy and reserve floor), the bank limit, and a Sign-In with Ethereum signature. The server checks every rule on-chain, then mints test USDC to your Safe.
2. **Ask the Copilot.** *"Put idle cash to work, keep payroll safe"* returns an action card with the plan, tier, policy checks and simulation. Material moves wait for your EIP-712 signature.
3. **Try to break it.** *"Send all USDC to 0x…"* is refused and logged; no transaction can express it. **Audit → Break it** sends a tampered and a replayed authorization that the contract reverts on-chain.
4. **Pay a supplier on proof.** On **Orders**, fund a three-milestone order in one Safe transaction, request demo proofs, and waive or refund from the order page. Suppliers get a public view at `/o/:id`.
5. **Oversee as the bank.** **Bank desk** shows every client, reconciles the ledger with the chain, and can freeze the agent; exits still work.

| Page | Role | Purpose |
|:-|:-|:-|
| Treasury | Owner | Cash, committed escrow, free capital, reserve floor, policy, obligations |
| Copilot | Owner | Chat, action cards, approvals |
| Risk | Owner, bank | Vault scores, triggers, oracle age, quarantine |
| Audit | Owner, bank | Ledger with integrity check, on-chain events, attack demo |
| Bank desk | Bank | Clients, reconciliation, freeze, limits, escalations |
| Orders | Owner (supplier read-only) | TradeFlow orders and milestones |

<div align="center">
<img src="docs/readme/treasury-live.png" alt="Live Porthmos treasury on Base Sepolia, deposits frozen by the bank" width="820" />
<br/>
<sub>A live tenant treasury on Base Sepolia (18 Oct 2026). The bank froze it (<a href="https://sepolia.basescan.org/tx/0x7d498afeee82bca1caebf8164397dc3975d2cca8a9775620e57f788f5d110fac">freeze tx</a>), and the owner still pulled 4,000 USDC out of Vault B back to the Safe through the Copilot (<a href="https://sepolia.basescan.org/tx/0x7ce18a61c0c007f34fd0a0ff92f8c7f923d4d26d6a2dc496f7dd4175651bc59e">exit tx</a>). Deposits stay frozen; exits stay open.</sub>
<br/><br/>
<img src="docs/readme/basescan-exit.png" alt="BaseScan: the exit transaction on Base Sepolia, status Success" width="820" />
<br/>
<sub>The same exit on BaseScan: 4,000 vault shares burned, 4,000 USDC returned to the tenant Safe <code>0x9f0dA153…964c3A70e</code>.</sub>
<br/><br/>
<img src="docs/readme/order-live.png" alt="Live TradeFlow order on Base Sepolia with three milestones" width="820" />
<br/>
<sub>A 1,000 USDC TradeFlow order split 200 / 400 / 400, funded by the tenant Safe in one owner-signed transaction (<a href="https://sepolia.basescan.org/tx/0x516b003630e1235227805dc3dc5d74abe02d46509e9a2523f742edb3dca6666c">funding tx</a>).</sub>
</div>

## How it works

<p align="center">
  <img src="docs/readme/decision-flow.png" alt="One request end to end: ask, plan, check, sign, enforce, record, with four checks and the approval tiers" width="100%" />
</p>

**One request, end to end.** The owner asks in chat. A rule parser decides whether the message is a question or an instruction; the LLM may only fill missing parameters. Deterministic code computes the reserve, scores the vaults and builds plan options; the LLM may pick the default, a smaller option or hold, and anything larger escalates to the owner's signature. The service runs policy checks and a simulation. A separate **Authorizer** process re-derives everything from its own chain reads and signs a short-lived **Decision Authorization Record (DAR)**. Anyone can submit it; the **Executor** usually does. `AegisModule` re-checks every condition on-chain and reverts with a typed error if any no longer holds. Without an LLM, the Copilot runs in rule-based mode and every check still applies.

| Responsibility | AI (LLM) | Deterministic service | Smart contract |
|:-|:-|:-|:-|
| Understand the request | Fills missing parameters | Classifies question vs instruction | – |
| Decide what to do | Picks an option at or below the default, or holds | Reserve, risk, plan options, validation, simulation | – |
| Authorize | – | Authorizer re-verifies and signs | Verifies signatures and the required tier |
| Enforce | – | – | Caps, floor, allowlist, oracle, expiry, nonce, freezes |
| Explain | Wording (checked by a reply guard) | Facts and fallback template | Events and typed reverts |

**Approval tiers** (derived on-chain; a DAR can raise its tier, never lower it):

| Tier | When | Who signs |
|:-|:-|:-|
| T1 Protective | Any `REDEEM` back to the Safe | Authorizer or Exit key |
| T2 Routine | `DEPOSIT` up to `autoCap` into a vault already used | Authorizer |
| T3 Material | Above `autoCap`, first deposit into a vault, or an LLM choice above the default | Authorizer + owner (EIP-712 Approval) |
| T4 Escalated | Above `bankLimit` | Authorizer + owner + bank |
| Blocked | Any transfer out, any other receiver, any vault the owner did not add | Not representable |

<p align="center">
  <img src="docs/readme/tradeflow.png" alt="TradeFlow order 1 on Base Sepolia: 1,000 USDC paid 200 / 400 / 400 on proof, with a held cold-chain milestone" width="100%" />
</p>

**TradeFlow.** A milestone release needs two signatures that the contract checks: the issuer's `MilestoneProof` and the Authorizer's `ReleaseAuthorization` (separate EIP-712 domain `TradeEscrow`). The contract checks the proof's conditions itself (document hash, temperature range) and pays only the fixed amount, only to the fixed supplier, only in order. The owner can waive a held milestone or refund after the deadline.

## Architecture

<p align="center">
  <img src="docs/readme/architecture.png" alt="Porthmos architecture: people and issuers, the five-process service with one key each, and the Base Sepolia contracts" width="100%" />
</p>

<details>
<summary>Text version (Mermaid)</summary>

```mermaid
flowchart LR
  Owner["Owner wallet<br/>(importer)"]
  Bank["Bank risk officer"]
  Web["Web app<br/>React + viem<br/>encodes owner transactions itself"]

  subgraph Service["Porthmos service · one container, five processes"]
    API["api<br/>FastAPI, sessions, workflow"]
    Copilot["Copilot<br/>LLM, holds no key"]
    Core["Deterministic core<br/>reserve, risk, planner,<br/>policy check, simulator"]
    Verifier["Proof verifier"]
    Auth["authorizer<br/>signs DARs and releases"]
    Exit["exit_agent<br/>redeem only"]
    Exec["executor<br/>pays gas, no authority"]
    Keeper["keeper<br/>refreshes test oracle"]
    Ledger[("Hash-chained<br/>decision ledger")]
  end

  subgraph Chain["Base Sepolia"]
    Safe["Safe<br/>(one per tenant)"]
    Module["AegisModule<br/>typed DEPOSIT / REDEEM"]
    Registry["PolicyRegistry<br/>caps, tiers, floor, freezes"]
    Vaults["Vault A / Vault B"]
    Escrow["TradeEscrow<br/>3 milestones per order"]
    Supplier["Supplier<br/>(fixed at funding)"]
  end

  Issuers["Proof issuers<br/>carrier, sensor, surveyor<br/>(EIP-712 MilestoneProof)"]

  Owner ==> Web
  Bank ==> Web
  Web ==>|chat, approvals| API
  API ==> Copilot
  Copilot ==>|picks a plan option| Core
  Core ==>|validated plan| Auth
  Issuers ==>|signed proof| Verifier
  Verifier ==>|verified| Auth
  Auth ==>|signed DAR or release auth| Exec
  Exit ==>|redeem-only DAR| Exec
  Exec ==> Module
  Exec ==> Escrow
  Module ==> Registry
  Module ==>|exec from module| Safe
  Safe ==> Vaults
  Owner ==>|owner-signed Safe tx| Safe
  Safe ==>|funds order| Escrow
  Escrow ==>|release| Supplier
  Escrow ==> Registry
  Keeper ==> Chain
  API ==> Ledger
```

</details>

Each process loads only its own key (`service/aegis/supervisor.py`). Component responsibilities, trust boundaries and sequence diagrams: [Technical Documentation §2](docs/TECHNICAL_DOCUMENTATION.md#2-system-architecture).

## Technology stack

| Layer | Tools |
|:-|:-|
| Contracts | Solidity 0.8.28, Foundry, OpenZeppelin 5.4, Safe v1.4.1 (module + MultiSendCallOnly), EIP-712 |
| Service | Python 3.12+, FastAPI, Pydantic, SQLite (WAL), uv; raw JSON-RPC with batching |
| AI | Any OpenAI-compatible endpoint (production configuration: `claude-haiku-5-5` via CLIProxyAPI), with a rule-based fallback |
| Web | React 19, Vite 8, TypeScript 6, viem 2, wagmi 3, TanStack Query, SIWE (EIP-4361), ERC-1271 / ERC-6492, EIP-6963 wallets, WalletConnect |
| Hosting | Web on Vercel; service in Docker on a Tencent Cloud VM behind Caddy (TLS) |
| Testing | Foundry (unit, fuzz, invariants), pytest (+ Anvil integration), Vitest, ESLint |
| Network | Base Sepolia (84532); Anvil (31337) for local work |

## Getting started

**Prerequisites:** [Foundry](https://getfoundry.sh) (a 1.8.x nightly; the vendored forge-std needs it, see [Technical §14.1](docs/TECHNICAL_DOCUMENTATION.md#141-prerequisites)), [uv](https://docs.astral.sh/uv/), Node.js 20.19 or later. On chain 31337 every role falls back to the public Anvil test keys, so no `.env` is needed.

```bash
# terminal 1: local chain
cd service
make install          # uv sync
make anvil            # anvil with 2 s blocks

# terminal 2: contracts + the five service processes
cd service
make deploy           # Deploy.s.sol, DeployTradeEscrow.s.sol, merge into deployments/31337.json
make dev              # api, authorizer, exit_agent, executor, keeper (logs in service/var/log/)

# terminal 3: web app
cd web
npm install
npm run dev           # http://localhost:5173, proxies /api to http://localhost:8787
```

**No chain at all?** `make dev-fake` in `service/` runs the API with an in-memory chain and all workers in one process.

**Expected behaviour:** the web app opens on the landing page; **Create your treasury** walks through onboarding against Anvil; the header shows **Live**.

**Common setup issues**

| Symptom | Cause and fix |
|:-|:-|
| One Foundry test fails decoding `vm.lastCallGas()` | Foundry too old (1.5.1-stable, 1.6.0); install a 1.8.x nightly |
| `UnicodeDecodeError` in service tests on Windows | Run with `PYTHONUTF8=1` (Forge artifacts are UTF-8) |
| `make` or `bash` missing on Windows | Run the commands inside the Makefile targets directly, or use WSL |
| Integration tests fail with `StaleOracle` on a re-run | They need a freshly started Anvil and a fresh `make deploy` |
| The site shows **Replay** | The API at `VITE_API_URL` did not answer `/api/health` |

Hosted deployment: [`deploy/tencent/README.md`](deploy/tencent/README.md). Service processes, API and agent tools: [`service/README.md`](service/README.md). Web configuration: [`web/README.md`](web/README.md).

## Contracts and networks

**Base Sepolia testnet (chain ID 84532).** There is no mainnet deployment. Deployment block 48114516; TradeEscrow block 48204293. Source: [`deployments/84532.json`](deployments/84532.json). The deployed runtime bytecode of the Porthmos contracts and mocks matches a `forge build` of this repository byte for byte ([verification](docs/EXECUTION_EVIDENCE.md#4-contracts-and-blockchain-references)).

| Contract | Address |
|:-|:-|
| AegisModule | [`0x786863E82d233eb60555dfeEFEe06068d8EcB318`](https://sepolia.basescan.org/address/0x786863E82d233eb60555dfeEFEe06068d8EcB318) |
| PolicyRegistry | [`0xE6E9A49870C16F544F1adFB79003E4Df59055F2a`](https://sepolia.basescan.org/address/0xE6E9A49870C16F544F1adFB79003E4Df59055F2a) |
| TradeEscrow | [`0x009ca6F11b24fE0bAb9dE3EBb5dAb9e15f95ce76`](https://sepolia.basescan.org/address/0x009ca6F11b24fE0bAb9dE3EBb5dAb9e15f95ce76) |
| Reference Safe | [`0x2E1c2be3dD6BAa59344EdC6ee6A93D68e2295a0F`](https://sepolia.basescan.org/address/0x2E1c2be3dD6BAa59344EdC6ee6A93D68e2295a0F) |
| MockUSDC (test asset) | [`0x5C02E17b299d7BC9d5Af31128306a8E05e62BE63`](https://sepolia.basescan.org/address/0x5C02E17b299d7BC9d5Af31128306a8E05e62BE63) |
| MockPriceFeed | [`0x3e9eB7a3B431a3df26135B54C7dcC61149F1fda6`](https://sepolia.basescan.org/address/0x3e9eB7a3B431a3df26135B54C7dcC61149F1fda6) |
| Vault A (mock ERC-4626) | [`0xBEf3507AF91BB2cac0c18fa65Bf68D45f1B44F3d`](https://sepolia.basescan.org/address/0xBEf3507AF91BB2cac0c18fa65Bf68D45f1B44F3d) |
| Vault B (mock ERC-4626) | [`0x7CAB5C889D4925834837dd5562Dd644Fd63d1D4a`](https://sepolia.basescan.org/address/0x7CAB5C889D4925834837dd5562Dd644Fd63d1D4a) |
| MultiSendCallOnly (canonical Safe v1.4.1) | [`0x9641d764fc13c8B624c04430C7356C1C7C8102e2`](https://sepolia.basescan.org/address/0x9641d764fc13c8B624c04430C7356C1C7C8102e2) |

Reference policy: auto cap 1,000 USDC, daily cap 5,000 USDC, bank limit 3,000 USDC, initial reserve floor 4,500 USDC, maximum price band width 0.02, maximum oracle age 180 s. Hosted API: `https://aegis-api.150-109-23-187.sslip.io/api/health`.

## Security overview

| Guarantee | How | Enforced by | Shown by |
|:-|:-|:-|:-|
| No funds out of the treasury through the agent | Only typed `DEPOSIT` and `REDEEM`; the receiver is always the Safe | AegisModule | Invariant F1; E4c |
| Policy limits hold even if the agent is wrong | `autoCap`, `dailyCap`, `bankLimit`, reserve floor, vault allowlist, tiers | AegisModule, PolicyRegistry | E1, E3; tests C8 to C13 |
| A human approves material moves | Owner (and bank for T4) sign EIP-712 Approvals that bound the amount | AegisModule | E1 |
| Decisions expire with their data | DAR binds policy version, oracle freshness (180 s) and a price band; expiry 120 s | AegisModule | E4d |
| Tampering and replay fail | EIP-712 over every field; random nonces in a used-set | AegisModule, TradeEscrow | E4a, E4b, E6f |
| The bank can stop the agent, not trap funds | Freezes block deposits and releases; redeems and refunds still pass | AegisModule, TradeEscrow | E5, E6g |
| Suppliers are paid only on a passing proof | Conditions checked on-chain; payee and amounts fixed at funding | TradeEscrow | E6c |
| Chat injection goes nowhere | No key in the LLM path; transfer requests are held and logged | Service, AegisModule | E4c |
| One leaked key has a bounded blast radius | Each process loads only its own key; the Exit key can only redeem to the Safe | Service, AegisModule | Key table in the Technical Documentation |

**Trust boundaries.** The browser and the LLM are untrusted; the API host is trusted but its compromise is bounded on-chain; the contracts are the enforcement layer. The [Security Self-Assessment Report](docs/SECURITY_SELF_ASSESSMENT_REPORT.md) lists 16 findings (no Critical; one High in the web onboarding path, open with a recommended fix), the controls matrix and what is needed before real-money use. This is a self-assessment, not a third-party audit.

## Testing and evidence

Measured on 20 Oct 2026 at commit `1c19881` ([details](docs/EXECUTION_EVIDENCE.md#10-test-execution-matrix)):

| Suite | Command | Result |
|:-|:-|:-|
| Contracts | `cd contracts && forge test` | **106 passed** (unit, fuzz, invariants) with Foundry 1.8.6-nightly |
| Service | `cd service && uv run pytest` | **412 passed**; 20 integration tests skipped without a chain |
| Service integration | `make anvil`, `make deploy`, then `make test-integration` | **19 of 20 passed** on Windows; the E6 dry run fails only at a POSIX-only cleanup step |
| Web | `cd web && npm test` | **176 passed** (21 files); lint and build clean |

**On-chain evidence.** Every hash below is recorded in [`deployments/evidence-84532.json`](deployments/evidence-84532.json) and was re-checked against Base Sepolia on 20 Oct 2026. Attack transactions are sent with a fixed gas limit so that a refused transaction is still mined; a reverted row is a **refused attempt**, not a fund movement.

| # | Scenario | Result | Tx |
|:-|:-|:-|:-|
| E1 | Normal allocation: 2,000 USDC into Vault B, first deposit (T3, owner Approval) | Executed | [0x94b96907…](https://sepolia.basescan.org/tx/0x94b9690755fae93712ebb11dcf7a8d9c0095019493184e62b3e869943a68f68f) |
| E2 | Depeg to 0.985: Exit Agent quarantines both vaults and redeems to the Safe | Executed | [quarantine](https://sepolia.basescan.org/tx/0x7023601da934f3471bf0bca2f2ba1ddbc8b4dbedd5d923a27206be98b97044da), [redeem](https://sepolia.basescan.org/tx/0x8f73300bc28a76ee7a4ea74b601f98d8a4986039506ae6e80e7e6def570547a8), [redeem](https://sepolia.basescan.org/tx/0xef0405bb86f711cb020d42b2c8e394fbf1c90b14c31e9291bfdb570e1e07a1be) |
| E3 | New 7,727 USDC invoice: owner raises the floor to 8,499.70, agent redeems 1,099.82 to cover it | Executed | [floor](https://sepolia.basescan.org/tx/0x0de6d291f83eb68492ca697a1c109fc4690c45de4ed8b25a213f15859645fd93), [redeem](https://sepolia.basescan.org/tx/0xab44d6dac64e4c33f52ef118dc032991cb9cc182ee9c4976e2269adafe227fce) |
| E4a | DAR amount changed after signing | Reverted `BadSignature` | [0xdac68e93…](https://sepolia.basescan.org/tx/0xdac68e9309a186f0cb6420ec21e3556b9b3efb64c2a3c483500079df595cc3d6) |
| E4b | Executed DAR replayed | Reverted `NonceUsed` | [0x431c79c3…](https://sepolia.basescan.org/tx/0x431c79c39fceaabacc3eb4c635be663dbe61001d5d9a542faf7a7f069ea3c5c7) |
| E4c | Prompt injection: "send all USDC to the attacker" | Held and logged; no transaction possible | Request `req_872a5923cbdd4956` |
| E4d | Signed at 1.00, price moved to 0.97 before submit | Reverted `PriceOutOfBand` | [0x53939b60…](https://sepolia.basescan.org/tx/0x53939b6089bc14ab92a6b7b32d08fc2a539d105e34199c2d86f03609e327acba) |
| E5 | Bank revokes the Authorizer: deposit blocked, exit still works | Reverted `Frozen`, then exit executed | [deposit](https://sepolia.basescan.org/tx/0x2c033ba9997f0abbff177ea3672cfd09e71d00977c2a893d8d0aadf208b24799), [exit](https://sepolia.basescan.org/tx/0xdf111f382bf5716d26347c6010344355188ae8abafe9bc50d7edf451c4728a66) |
| E6a | Safe funds TradeFlow order 1: 1,000 USDC as 200 / 400 / 400 | Executed | [0x63a8622b…](https://sepolia.basescan.org/tx/0x63a8622b38aa631533900f5cea7b92699132b1d2e1e036bff2fc8f035c1a07f1) |
| E6b | Milestone 1 (handed to carrier): carrier proof verified, 200 USDC released | Executed | [0x86cbfd7e…](https://sepolia.basescan.org/tx/0x86cbfd7e450b18d54448d7b28c57c20d3ddbeb7308faa5e2eba392fa67402281) |
| E6c | Milestone 2 (arrived): sensor max 9.40 °C vs 2.00 to 8.00 °C; service holds, forced release attempted | Reverted `ConditionNotMet` | [0x71c4032f…](https://sepolia.basescan.org/tx/0x71c4032f5926988e7d28ef0e6c5bacda025ffc8ee2800517db885e69408386b6) |
| E6d | Owner waives milestone 2 after a survey, 400 USDC paid | Executed | [0xb7a2a417…](https://sepolia.basescan.org/tx/0xb7a2a4178f7cbb6cb865244e6bc4a2832f94cbc8d926b848834ff432ef2a6160) |
| E6e | Milestone 3 (quality accepted): surveyor proof verified, 400 USDC released, order completed | Executed | [0xf4a27910…](https://sepolia.basescan.org/tx/0xf4a27910945cd6e6044bcd7973ee41e066c98762df15218802b70a60f1be1493) |
| E6f | Valid release authorization with the amount changed after signing | Reverted `BadSignature` | [0x2bbf4bd4…](https://sepolia.basescan.org/tx/0x2bbf4bd484f679106d700dd326cb3f6b87052de7b8db709a9884f35a142e0bf5) |
| E6g | Valid release submitted while the bank froze the buyer Safe | Reverted `Frozen` | [0x0411d80b…](https://sepolia.basescan.org/tx/0x0411d80b31157943150ca5702082dc157afc855da5edad13b4e6ac4bce448a9c) |

In E6c, E6f and E6g the evidence script signs the release with the Authorizer key itself, to stand in for a compromised or faulty agent; the contract refuses each one. **Replay mode** in the web app only re-displays these recorded results; it never initiates a transaction.

## Documentation

| Document | What it covers |
|:-|:-|
| [**Technical Documentation**](docs/TECHNICAL_DOCUMENTATION.md) | Architecture, components, AI agent design, treasury logic, contracts, TradeFlow, cryptography, data model, deployment, testing, implementation status |
| [**Security Self-Assessment Report**](docs/SECURITY_SELF_ASSESSMENT_REPORT.md) | Threat model, contract/AI/oracle/web assessment, controls matrix, 16 findings with severity and status, residual risks |
| [**Execution Evidence**](docs/EXECUTION_EVIDENCE.md) | Every recorded transaction with decoded results, classification, reproduction steps, test matrix, demo guide |
| [Design specification v0.7](docs/TECHNICAL-DOCUMENT.md) | The team's detailed design: check orders, test IDs, design-review history |
| [Interface spec](docs/INTERFACES.md), [Multi-tenant spec](docs/MULTI-TENANT.md) | Implementation-time specifications |
| [`contracts/`](contracts/README.md), [`service/`](service/README.md), [`web/`](web/README.md), [`deploy/tencent/`](deploy/tencent/README.md) | Component guides |

```
contracts/      Solidity: AegisModule, PolicyRegistry, TradeEscrow, mocks; Foundry tests and deploy scripts
service/        Python service (package `aegis`): core, agent, procs, tradeflow, api, scripts, tests
web/            React app: landing, onboarding, Treasury, Copilot, Risk, Audit, Bank desk, Orders
deployments/    deployed addresses (84532, 31337) and the recorded evidence
deploy/tencent/ container, compose file and Caddy site block for the hosted API
docs/           final documents, design specification and specs
video/          demo film sources (not part of the runtime)
brand/          logo files
```

## Known limitations

This is a testnet build. Read it as a working prototype, not a product ready for real money.

| Today | Next |
|:-|:-|
| Vaults and the price feed are mocks, so yield and risk numbers are illustrative | Adapters to real ERC-4626 vaults and Chainlink feeds |
| Contracts are not externally audited | External audit before any mainnet use |
| Authorizer and Exit keys are server keys shared by all tenants (bounded per tenant on-chain) | HSM or MPC signing, per-tenant signer keys |
| Demo proof issuers are server keys, so the demo proves the authorization path, not real document or sensor checks | TradeTrust document verification, signed sensor gateways, k-of-n issuers with revocation |
| Web onboarding takes contract addresses from the API (Security finding PRT-01) | Pin them to the bundled deployments file, as TradeFlow already does |
| No on-chain dispute process; a held milestone ends in a waiver or a refund | Dispute window and arbitration |
| Fixed three milestones per order; obligations entered by the owner | Variable milestones; import from invoicing and accounting systems |
| One host and one SQLite file; an outage stops the agent, not the funds | Managed database and a second host |
| No CI pipeline; the test results above are from local runs | CI running all three suites |
| On-chain settlement only where stablecoin payments are allowed (Indonesia is excluded) | Settlement through a bank or licensed payment provider |

The full list, with impact and recommendations: [Security Self-Assessment §14](docs/SECURITY_SELF_ASSESSMENT_REPORT.md#14-residual-risks-and-recommendations).

## Team

| Name | GitHub |
|:-|:-|
| Stanley Nathanael Wijaya | [@StyNW7](https://github.com/StyNW7) |
| Rizky Mirzaviandy Priambodo | [@Xavrir](https://github.com/Xavrir) |
| Aarief Fawwaz Satriahutama | [@aarieffawwaz](https://github.com/aarieffawwaz) |
| Hansel Mitchell Tumanggor | [@HanselMitchell](https://github.com/HanselMitchell) |

Built for the **2026 Shenzhen International FinTechathon**, International AI Track, Topic F: Agent Wallet.

**Acknowledgments.** Built on [Safe](https://github.com/safe-global/safe-smart-account) v1.4.1, [OpenZeppelin Contracts](https://github.com/OpenZeppelin/openzeppelin-contracts) 5.4, [Foundry](https://getfoundry.sh), [viem](https://viem.sh) and [wagmi](https://wagmi.sh), FastAPI, and CLIProxyAPI. Design references include the PACE paper (policy-attested contract execution), AgentDojo, kpk's exit agents on Morpho and TradeTrust; see [Technical Documentation §18](docs/TECHNICAL_DOCUMENTATION.md#18-references-and-further-documentation) and the [design specification references](docs/TECHNICAL-DOCUMENT.md#references).

## License

No open-source license has been granted. All rights reserved by the authors; this repository is a hackathon submission. Vendored libraries under `contracts/lib/` keep their own licenses.
