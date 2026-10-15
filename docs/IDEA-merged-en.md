# AEGIS Treasury (merged idea)

**Track:** 2026 Shenzhen FinTechathon, International Track, Topic F (Agent Wallet)
**Deadline:** 20 Oct 2026, 23:59 Beijing time (22:59 WIB)
**Sources merged:** Stanley's AEGIS Treasury blueprint (Notion) + our treasury agent research (IDEA.md)

## One line

An obligation-aware AI treasury agent that keeps enough cash for upcoming payments, puts the rest to work within risk limits, and executes on-chain only when its authorization still matches current conditions, with a bank risk desk that oversees every agent.

Tagline (Stanley): Know when to earn, when to protect, and when not to act.

## What comes from where

| Part | From Stanley (AEGIS) | From our research |
|---|---|---|
| Core user | Treasury managers with real payment obligations | Reframed for WeBank judges: SMEs and digital businesses holding stablecoins or tokenised deposits for cross-border operations |
| Obligation-aware reserve engine | Yes, the main differentiator | Kept as is |
| State-bound authorization | Yes (intent + calldata + risk state + expiry) | Backed by two 2026 papers (PACE, "Signing the Transaction but Not the Decision") |
| Decision ledger and audit | Yes | Kept as is |
| Stress Lab demo | Yes (normal, risk shock, obligation shock, attack) | Kept as is |
| Exit / protective action | Risk-triggered protective action | Copy kpk's deterministic Exit Agent triggers (oracle staleness, liquidity stress, price divergence) |
| Second side: bank risk desk | Not in AEGIS | Added: bank officer sets policy, sees all client agents, approves escalations, kill switch |
| Wallet and on-chain guard | Custom smart treasury account | Use Safe + allowance module + Zodiac Roles where possible, add a small custom guard only for state-bound checks |
| Framing | DeFi yield vaults | Say "tokenised deposit" and "term deposit vault"; pitch risk control, not yield |
| Sponsor fit | Not in AEGIS | Main evidence on Base Sepolia, plus FISCO BCOS deployment if time allows |
| Evidence | Metrics vs baselines | Add attack suites (AgentDojo, CrAIBench) and the 4 demo flows with tx hashes |

## The problem

1. **Idle cash vs payment needs.** Businesses holding stablecoins either leave cash idle or put too much to work and then cannot pay salaries and vendors on time.
2. **Risk changes fast.** Price pegs, liquidity and protocol health change, and nobody watches them all day.
3. **AI agents with wallets are unsafe.** Agents can be tricked (prompt injection), make unit errors, or act on stale data. Real losses: Freysa ($47k, Nov 2024), Lobstar Wilde ($440k, Feb 2026), Grok and Bankr (May 2026).
4. **No accountability.** A successful transaction does not show why it was allowed, under whose mandate, or under which risk conditions.
5. **Banks have no view** of what an AI agent does with a client's money.

## Two sides

| Side | Who | What they see and do |
|---|---|---|
| Business | Owner or finance staff | Set the mandate and the obligation calendar (payroll, vendors), chat with the agent, approve large actions, read decision records |
| Bank | Risk officer | Set policy per client (allowed vaults, limits, reserve rules), see risk score and audit log for every agent, approve escalations, kill switch |

## How it works

Principles (Stanley): AI proposes, deterministic systems calculate. Policies authorize, smart contracts enforce. Every transaction is verifiable. Safety over yield.

1. **Mandate and obligations.** The business enters upcoming payments and limits. Obligations come from approved data, never guessed by the AI.
2. **Reserve engine.** Required reserve = the largest cumulative shortfall of obligations minus reliable inflows over the planning horizon, plus a buffer. Deployable capital = liquid balance minus reserve minus fees.
3. **Risk engine (no AI).** Scores each vault by peg, liquidity, utilisation and concentration.
4. **Allocation.** Splits only the deployable capital between vaults, within caps.
5. **AI agent.** One supervisor LLM with deterministic tools. It turns requests into a structured action card and explains decisions. Like Aumo's design, it can only make the plan more conservative, never loosen a limit.
6. **Policy check and simulation.** A fixed policy verifier checks the action. A simulation shows the real balance change.
7. **State-bound authorization.** A signed record binds intent, exact calldata, the risk-state version, the obligation version, a nonce and an expiry. If conditions change before execution, the record is invalid and the action is held.
8. **On-chain guard.** The Safe and the guard contract check the exact transaction and the record, then execute or reject.
9. **Exit Agent.** On a depeg, liquidity stress or stale oracle, it withdraws to the reserve automatically, within its role.
10. **Decision ledger.** Every action, and every rejection, is logged with its evidence, and the bank desk sees it live.

## Security

| Threat | Defence |
|---|---|
| Prompt injection | The LLM never signs. Outside data is data. Optional LlamaFirewall check. |
| Induced transfer to an attacker | Zodiac Roles allowlist. The guard rejects unknown receivers. |
| Changed calldata | The record binds exact calldata. Any change is rejected on-chain. |
| Replay or stale authorization | Nonce and expiry in the record. Risk-state version must match. |
| Overspending, privilege escalation | Safe allowance (daily cap) and role permissions |
| Unit or amount error | Simulation before signing |
| Compromised agent | Bank kill switch revokes the role. Emergency pause. |

## Closest competitors and how we differ

| Product | What it already does | Our difference |
|---|---|---|
| Aumo (live on X Layer, MIT code) | Autonomous stablecoin treasury, risk-adjusted yield, on-chain guardrails, decision receipts, LLM can only be more conservative | Obligation-aware reserve, state-bound authorization, bank oversight side |
| Giza ARMA (wound down Feb 2026) | AI yield optimiser with session keys | Obligations first, verifiable authorization |
| kpk vaults on Morpho | Deterministic rebalancing and exit agents | AI explanation layer, obligations, bank desk |
| Coinbase Agentic Wallets, Safe | Spending limits, permissions | Financial intelligence on top |
| PACE (paper) | Intent, policy and calldata binding | Adds risk-state and obligation binding, tested in a working system |
| Hackathon competitors (Leash, agentic-wallet, xizo13, edxzh) | Payment and x402 wallets | We manage assets, they spend |

Do not claim risk scoring, rebalancing, caps or receipts as new: Aumo already has them. The new part is obligations + state-bound authorization + bank oversight, proven with numbers.

## Demo (real Base Sepolia tx hashes)

1. **Normal:** reserve kept, the rest allocated
2. **Risk shock:** mock depeg, the Exit Agent withdraws to the reserve
3. **Obligation shock:** a new bill arrives, the agent rebalances to cover it
4. **Attack:** changed calldata, replayed or expired record, and a prompt injection, all rejected on-chain
5. **Bank:** the officer presses the kill switch, and the agent's role is revoked

## Evidence and metrics

Compare against baselines: idle cash, naive highest-APY, static allocation, and authorization without risk-state binding.

| Area | Metric |
|---|---|
| Finance | Obligation coverage, liquidity shortfall, net return after cost |
| Risk | Response time to a risk event, exposure concentration |
| Security | Unauthorized execution rate, replay and stale rejection rate, attack suite results |
| Reliability | Authorized execution success, false rejections |
| Explainability | Evidence completeness per decision |

## 6-day scope

Stanley's target stack is large (React, NestJS, LangGraph, CVXPY, PostgreSQL, Redis, Foundry and more). For 6 days, cut it to:

- **Contracts:** Foundry. Mock USDC, 2 mock ERC-4626 vaults, mock price feed, guard contract. Safe + Zodiac Roles from existing deployments.
- **Backend:** one Python service (agent, reserve engine, risk engine, policy verifier, simulation) with SQLite or PostgreSQL.
- **Frontend:** React + viem. Two pages for the business (overview with chat, decisions and audit) and one bank desk page.
- **Optimiser:** simple rules with caps first. CVXPY only if time allows.
- Skip Redis, BullMQ, NestJS and multi-chain.

| Day | Work |
|---|---|
| 1 | Contracts, Safe and Zodiac setup, deploy to Base Sepolia |
| 2 | Reserve engine, risk engine, policy verifier, simulation |
| 3 | Agent and action cards, state-bound authorization, guard checks |
| 4 | Exit Agent, bank desk, Stress Lab, collect tx hashes, attack tests |
| 5 | Technical document, security self-assessment, execution evidence |
| 6 | Deck, demo video, submit |

## Submission notes

- Six deliverables per the official rules document. Note: the rules document says the demo video is optional, but the official website lists it as required. Make it.
- Registration by email to fintechathon@ican-x.com, subject "International Track Registration – Team Name – Team Leader Name". Send early, confirmation takes up to 48 hours.

## Open decisions

- **Name.** "Aegis Protocol V5" is an existing agent-firewall project from the Chainlink hackathon 2026. Keep AEGIS or rename?
- **Target user.** Web3 startups and DAOs (Stanley) or SMEs and digital businesses with tokenised deposits (better for WeBank judges)?
- **Reuse Aumo code?** It is MIT, so allowed with credit, but reusing the closest competitor's code weakens the innovation claim. Suggest: read it for design, write our own.
- **Who builds the contracts?** At least one person must know Solidity and viem.

## Sources

- Stanley's AEGIS blueprint: https://stanley-n-wijaya.notion.site/FinTechathon-2026-3f973555b71f80519d41feb367d69e89
- Aumo: https://aumo.finance/ and https://github.com/cryptoduke01/aumo
- kpk agent vaults: https://chainwire.org/2025/11/13/kpk-launches-agent-powered-vaults-on-morpho/
- Safe AI agent with spending limit: https://docs.safe.global/home/ai-agent-quickstarts/agent-with-spending-limit
- Zodiac Roles: https://github.com/gnosisguild/zodiac-modifier-roles
- PACE: https://arxiv.org/abs/2608.17220
- Signing the Transaction but Not the Decision: https://arxiv.org/abs/2609.11757
- HSBC and Ant tokenised-deposit agent test: https://www.prnewswire.com/apac/news-releases/ant-digital-technologies-and-hsbc-announce-successful-ai-agent-micropayment-technical-verification-test-302903333.html
- Aegis Protocol V5: https://chain.link/hack-26/projects/aegis-protocol-v5
- Past FinTechathon winners: https://fintechathon.g-ican.com/#/past/2025
