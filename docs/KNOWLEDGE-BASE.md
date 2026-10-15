# AEGIS Treasury: talking knowledge base

Use this to talk about the project in demos, judge Q&A, and chats with teammates. Every answer is written to be said aloud. Facts here are confirmed from our repo and docs; anything not built is marked as not built.

## One-liner

AEGIS Treasury is an AI treasury agent for businesses that hold stablecoins. It keeps enough cash for upcoming bills, puts the rest to work in approved vaults, and every move it makes is checked and enforced by a smart contract, not by the AI. A bank risk officer can watch every agent and freeze it.

Tagline: Know when to earn, when to protect, and when not to act.

## The competition

We built it for the 2026 Shenzhen International FinTechathon, International Track, Topic F: Agent Wallet. Hosts are the Shenzhen University-WeBank Institute of FinTech with Tsinghua PBCSF. Judging: task completion 40 percent (judged on real on-chain transaction hashes), security and compliance 30 percent, innovation and interaction 30 percent, plus a 0 to 5 bonus. Deadline is 20 October 2026, 23:59 Beijing time, which is 22:59 WIB.

## The team

The original AEGIS concept came from Stanley: the obligation-aware reserve, state-bound authorization, the decision ledger, and the Stress Lab demo. We merged it with our own treasury agent research, which added the bank risk desk, the Exit Agent design taken from kpk, and the Safe-based wallet. The team is Rizky (Alvido), Stanley, and Aarief.

## What problem it solves

So basically, a business holding stablecoins has two bad options. Leave the cash idle and lose yield, or put it to work and risk not having cash when payroll or a supplier invoice is due. On top of that, risk changes fast: a stablecoin can lose its peg or a vault can run out of liquidity, and nobody watches that all day. AI agents could do this work, but giving an AI a wallet is dangerous today.

## Why AI agents with wallets are dangerous

Agents have already lost real money. Freysa was talked into a transfer in November 2024, about 47 thousand dollars. Lobstar Wilde made a unit error in February 2026, about 440 thousand dollars, with no attacker involved. Bankr executed encoded instructions relayed by another agent in May 2026. In every case the transaction itself was valid. The decision behind it was not. That is the gap we close: we make the contract check the decision, not just the signature.

## Who uses it

Two sides. The business owner or finance staff sets the bills calendar and limits, chats with the agent, and approves big moves. The bank risk officer sets limits per client, sees every client's agent, risk score and audit log, approves escalations, and has a kill switch. Our pitch target for WeBank judges is SMEs and digital businesses holding stablecoins or tokenised deposits for cross-border operations.

## Core principle

The LLM proposes, deterministic code decides, and the smart contract enforces. The AI never holds a key and never picks which Safe it acts on. It can only make a plan more conservative, never loosen a limit. If the LLM is down, everything still works in rule-based mode.

## How it works, step by step

First, the owner enters upcoming obligations like payroll and vendor bills. The reserve engine calculates how much cash must stay liquid. Then the risk engine scores each vault, with no AI involved. The planner splits only the spare cash between vaults within caps. The AI turns the request into an action card and explains it. A policy check and a simulation run before anything is signed. The Authorizer signs a short-lived authorization, and the on-chain module checks everything again before the money moves. Every action and every refusal goes into a hash-chained ledger that the bank desk sees live.

## The reserve formula

Required reserve is the largest cumulative shortfall of obligations minus reliable inflows over the planning horizon, which is 30 days by default, plus a buffer. The buffer is the bigger of 500 USDC or 10 percent of total obligations. Taking the worst point in the horizon means an early big payment is covered even if money comes in later. Deployable capital is the liquid balance minus the reserve minus fees.

## What is new compared to what exists

Three things together. First, obligation-aware reserve enforced on-chain: the reserve floor lives in the contract, so the agent physically cannot invest money that is needed for bills. Second, state-bound authorization: the signature covers the exact action plus the policy version, a price band and a short expiry, so if conditions change before execution the contract refuses it. Third, a bank oversight side with freeze and revoke, where exits always stay allowed. Risk scoring, rebalancing, caps and receipts on their own are not new; Aumo already has them, so we do not claim them.

## Competitors

Aumo is the closest: a live autonomous stablecoin treasury with guardrails and decision receipts, but no obligation-aware reserve, no state-bound authorization and no bank side. Giza ARMA was an AI yield optimiser with session keys and wound down in February 2026. kpk vaults on Morpho have deterministic exit agents, and we reused that exit idea. Coinbase Agentic Wallets and Safe give spending limits but no financial intelligence. The PACE paper binds intent, policy and calldata; we add risk-state and obligation binding in a working system. Most other hackathon agent wallets are payment wallets that spend money; we manage assets.

## Structural containment

The agent can only do two typed actions: deposit into an approved vault, or redeem from a vault back to the Safe. The receiver is hard-coded to the Safe. So a prompt injection that says send funds to my address cannot even be expressed as a transaction. We do not detect and block attacker transfers, they are impossible by construction.

## The authorization (DAR)

DAR means Decision Authorization Record. It is an EIP-712 signed struct with the Safe, the operation, the vault, the amount, minimum output, policy version, a price band, the tier, the approval hash, a random nonce, an expiry, and an evidence hash. The Authorizer signs it, or the Exit key for redeems. Expiry is 120 seconds, which is shorter than the 180 second oracle age limit, so an authorization never outlives the market data it was planned on. Any change to the amount breaks the signature, a reused nonce is refused, and a price outside the band is refused.

## Approval tiers

T1 Protective: any redeem back to the Safe, signed by the Authorizer or the Exit key. T2 Routine: a deposit up to the auto cap into a vault we already used, Authorizer only. T3 Material: above the auto cap, or the first deposit into a vault, needs the owner's signed Approval too. T4 Escalated: above the bank limit, needs both the owner and the bank. The contract derives the minimum tier itself, so the signer cannot downgrade it. Owner and bank Approvals expire after 24 hours.

## Default limits in the demo

Auto cap 1,000 USDC. Daily cap 5,000 USDC, counted per UTC day. Bank limit 3,000 USDC. Reserve floor in the reference treasury 4,500 USDC. Max price band width 0.02. Max oracle age 180 seconds, with the keeper updating the price every 60 seconds. Quarantine cooldown 24 hours.

## Exit Agent

The Exit Agent is deterministic, no AI. Any one trigger fires a protective redeem and quarantines the vault: the price moves more than 1 percent off the peg, the oracle is older than 180 seconds, or the vault's releasable liquidity drops below 1.2 times our position. It redeems in parts if liquidity is thin. Honest limit: with one stablecoin and one feed, a depeg exit reduces the vault risk, not the exposure to the coin itself.

## Bank risk desk

The bank can freeze a treasury, revoke the Authorizer, remove a vault, and tighten caps, but never loosen them. Freezes stop deposits only. Redeems back to the Safe stay allowed, because a freeze during a depeg must not trap money in a failing vault. Only the bank can lift its own freeze, and only the owner can add vaults or set the Authorizer. That split came out of our design review, where an early version let the bank key rotate the Authorizer.

## Keys and blast radius

Each role has its own key: Authorizer, Exit key, Executor, Keeper, owner and bank. The Executor only submits transactions; anyone can submit, the signatures give authority. If the Exit key leaks, the worst case is money moving back into the Safe. If the Authorizer leaks, it is still limited by the caps, tiers, the reserve floor and the typed actions. Next step for production would be HSM or MPC signing.

## Tech stack

Contracts in Solidity with Foundry: AegisModule as a Safe module, PolicyRegistry, mock USDC, a mock Chainlink price feed, and two mock ERC-4626 vaults. Safe v1.4.1 and OpenZeppelin 5.4. Backend is one Python service with FastAPI, raw JSON-RPC, and SQLite with a hash-chained ledger, split into five processes: API, Authorizer, Exit Agent, Executor and Keeper. Frontend is React, Vite, TypeScript, viem and wagmi, with GSAP for animation, deployed on Vercel. Chain is Base Sepolia.

## Why a custom module instead of Zodiac Roles

We planned Zodiac Roles first. In the end a small custom Safe module was simpler to reason about, because we needed state-bound checks like the policy version, the price band and the reserve floor that a generic role allowlist does not do. The tradeoff is more custom code to trust, so it needs an audit before real money. If the action set grows, Zodiac Roles is the next step.

## Testing

47 Foundry tests, including fuzz and invariant tests for containment and the reserve floor. 111 backend unit tests and 8 integration tests on a local chain, including a two-tenant end-to-end run where tenant B sees nothing of tenant A, and a bank freeze that blocks deposits while the exit still works. The website went through a UX review with 21 issues, all fixed, and 0 accessibility violations.

## On-chain evidence

All contracts are deployed on Base Sepolia, and all eight scenarios are recorded with real transaction hashes. E1 normal allocation. E2 depeg, where the Exit Agent quarantines the vault and redeems. E3 a new invoice that updates the reserve floor on-chain, then the agent rebalances. E4a amount changed after signing, refused with BadSignature. E4b replayed authorization, refused with NonceUsed. E4c prompt injection, which cannot even become a transaction. E4d price moved out of the signed band, refused with PriceOutOfBand. E5 bank freeze: the agent's deposit is refused with Frozen, and the exit redeem still goes through. The refused attacks are mined, so anyone can open them on Basescan and see the revert. The website links every proof.

## Is it a real app or a demo

It is a real app. Anyone can open aegis-treasury-eta.vercel.app, click Create your treasury, and get their own treasury on Base Sepolia in about a minute: an owner key and a bank key are generated in the browser, our faucet sends test ETH, and the treasury gets 100,000 test USDC. About 13 real transactions set it up. Then they can run the agent, approve plans, freeze it from the bank seat, and try attacks that the contract refuses on-chain. The backend runs on our own server. The contracts did not need any change, because every rule is already stored per treasury. It is testnet only: the contracts are not audited and the vaults are mocks.

## Is it just an LLM wrapper

No. The LLM is the smallest part. It parses the request and explains decisions. The reserve, risk, planning, policy check, simulation and signing are fixed code, and the contract enforces the final rules. You can turn the LLM off and the treasury still runs safely.

## Is it just a frontend

No. There are smart contracts on Base Sepolia, a backend with five processes and separate keys, and the website. The website is just the window into it.

## What the AI model is

The agent uses an OpenAI-compatible API, so the model is swappable. In production we run Claude Haiku 5.5 behind a proxy on our server. If the model fails or times out after 20 seconds, that request falls back to the rule-based mode.

## Known limits, said honestly

Vaults and the price feed are mocks, so yield and risk numbers are illustrative. One stablecoin and one feed only. Authorizer and Exit keys are server keys, so the next step is HSM or MPC. Risk thresholds are heuristics, not backtested yet. Obligations are self-reported, so wrong input gives a wrong reserve; the next step is importing from accounting systems. The contracts are not audited, so no real money.

## Why this matters for a bank like WeBank

Banks are starting to test AI agents with tokenised deposits, like the HSBC and Ant test. The missing piece is control: the bank needs to see what an agent does with a client's money and stop it. AEGIS gives the bank a desk with live risk scores, the audit trail and a kill switch, while the contract guarantees the client's bills are always covered.

## Short answers for common judge questions

What happens if the AI is tricked? It can only propose. A bad plan fails the policy check, and even a signed bad action fails the contract because only typed actions to the Safe exist.

What if prices move after signing? The DAR has a price band, a policy version and a 120 second expiry, so the contract refuses it and the agent replans.

Can the bank steal funds? No. The bank can freeze, revoke and tighten, not move money or add vaults.

What if your server goes down? Funds stay in the Safe. Anyone can submit a valid exit, and the owner keeps full control of the Safe.

How is this different from Aumo? Aumo manages yield with guardrails. We add bills-aware reserve enforced on-chain, authorization bound to the current state, and a bank oversight side.

## Indonesian quick version

AEGIS itu AI treasury agent buat bisnis yang pegang stablecoin. Dia nyisihin cash buat tagihan yang mau jatuh tempo, sisanya diinvest ke vault yang udah di-approve, dan semua transaksi dicek sama smart contract, bukan sama AI. Bank juga bisa pantau dan freeze agent-nya. Bedanya sama yang udah ada: reserve buat tagihan dijaga on-chain, authorization-nya terikat ke kondisi pasar saat itu, dan ada sisi bank buat oversight.
