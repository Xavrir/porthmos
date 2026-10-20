# FinTechathon 2026: Topic F Idea

**Track:** 2026 Shenzhen FinTechathon, International Track, Topic F (Agent Wallet)
**Deadline:** 20 Oct 2026, 23:59 Beijing time (22:59 WIB). Registration and submission close together.
**Working name:** to be decided

## One line

An AI treasury agent that manages a family's tokenised-deposit balance on-chain, with a bank risk desk that sets the rules, watches every move, and can stop the agent.

## The problem

AI agents are starting to hold and move money, but most agent wallets only check the transaction (amount, receiver, limit). If the agent is tricked or makes a mistake, the transaction still looks valid and goes through. Real losses already happened:

- Freysa (Nov 2024): a user talked the agent into sending 13.19 ETH (about $47k).
- Lobstar Wilde (Feb 2026): a unit error sent $440k to a stranger.
- Grok and Bankr (May 2026): Morse-code prompts drained wallets.

Banks also have no view or control over what an AI agent does with a customer's money.

## The idea

The agent manages money, it does not only spend it. It splits a family's balance between a savings vault and a term-deposit vault, rebalances when conditions change, and withdraws automatically when it sees risk (depeg, low liquidity, stale price feed). It explains every step in chat.

The LLM only proposes and explains. Fixed, auditable logic makes the money decisions, and on-chain rules make sure the agent cannot go outside its limits, even if the LLM is fooled.

## Two sides

| Side | Who | What they do |
|---|---|---|
| Family | A parent | Sets the goal in chat (for example "keep 3 months of expenses safe, put the rest in term deposits"), approves large moves, reads the agent's explanations |
| Bank | A risk officer | Sets the agent's on-chain policy (allowed vaults, limits, daily budget), sees the risk score and audit log for each agent, approves escalations, uses the kill switch |

## How one action works

1. The parent gives a goal in chat.
2. The LLM turns it into a typed intent: asset, amount, from, to, purpose.
3. The rule engine (no AI) checks the intent: limits, allowlist, look-alike addresses.
4. The transaction is simulated to see the real balance changes before signing.
5. The Safe executes it on-chain through the agent's limited role.
6. The Exit Agent watches the price feed and liquidity, and withdraws automatically if a risk rule triggers.
7. Every step is logged, and the bank desk sees it live.

## Security

| Threat | Defence |
|---|---|
| Prompt injection (in chat or in outside data) | The LLM never signs. Outside data is treated as data. Optional LlamaFirewall check. |
| Induced transfer to an attacker | Zodiac Roles allowlist on-chain. The contract rejects unknown receivers. |
| Overspending, privilege escalation | Safe allowance module (daily cap) and per-role permissions |
| Unit or amount error | Simulation before signing shows the real balance change |
| Look-alike address (address poisoning) | Similarity check against known counterparties |
| A compromised agent | Bank kill switch revokes the agent's role |

Bonus: an on-chain decision record (from the PACE paper, Aug 2026). Each transaction must carry a hash that links the user intent, the simulation result and the exact transaction data. The contract rejects transactions without a matching record.

## What we reuse

| Source | What we take | Licence or status |
|---|---|---|
| kpk agent-powered vaults on Morpho (Nov 2025) | Rebalancing Agent and Exit Agent design, fixed logic with limited permissions | Design only |
| Safe "AI agent with spending limit" guide | Agent as a spender with a daily allowance | Deployed contracts on testnets |
| Zodiac Roles Modifier | On-chain role permissions for the agent | LGPL-3.0, used unchanged |
| HSBC and Ant Digital test (9 Oct 2026) | Framing: agent payments on tokenised deposits, bank runs risk checks | Design only |
| Theoriq AlphaVault | "Policy cage": the AI proposes only inside hard limits | Design only |
| PACE paper (arXiv 2608.17220) | Decision record idea | Idea only, we write our own text |
| coinbase/agentkit | Agent loop with wallet tools | Check the LICENSE file first |
| LlamaFirewall (PurpleLlama) | Prompt-injection detection | Check the Meta licence first |
| AgentDojo, CrAIBench | Attack test cases for the security report | MIT / research |

Do not copy code from Aegis V5, Sup Wallet or Latinum: they have no licence. Do not copy from competitor entries.

## Why the judges should like it

- It covers all three parts of the Topic F brief: asset management, transaction execution, risk control.
- Known competitors all build payment wallets or x402 wallets. None manages assets.
- Past WeBank FinTechathon winners (2022 to 2025) used sponsor technology (FATE, FISCO BCOS), built trust and privacy systems instead of DeFi, and often had two sides (user and bank). We match this.
- It mirrors real 2026 bank work (HSBC and Ant, Mastercard Agent Pay, JPMorgan Kinexys).

## Framing rules

- Say "tokenised deposit" and "term deposit", not "yield" or "DeFi".
- Pitch it as risk control, not as a way to earn money.
- Keep on-chain execution at the centre of the demo, so it is clearly Topic F and not Topic A (personal finance).
- Mention that the contracts are Solidity and can also run on FISCO BCOS, WeBank's chain.

## Demo (real testnet transaction hashes)

Chain: Base Sepolia (public, judges can verify). FISCO BCOS deployment if time allows.

1. Normal rebalancing executed by the agent
2. Mock depeg event: the Exit Agent withdraws within one block
3. Attack: a prompt injection asks to send funds to an attacker, and the contract rejects it
4. The bank officer presses the kill switch, and the agent's role is revoked

## 6-day scope

Build only this:

- 2 mock vaults (savings, term deposit) and 1 mock stable token
- 1 mock price feed we can move to trigger a depeg
- Safe with allowance module and Zodiac Roles for the agent
- Agent: chat, intent, rule engine, simulation, execution, Exit Agent
- 1 family chat page and 1 bank dashboard page

| Day | Work |
|---|---|
| 1 | Contracts (mock token, vaults, price feed), Safe and Zodiac setup on Base Sepolia |
| 2 | Agent loop, intents, rule engine, simulation |
| 3 | Exit Agent, bank dashboard, kill switch |
| 4 | Attack tests, decision record (bonus), collect tx hashes |
| 5 | Technical doc, security self-assessment, execution evidence |
| 6 | Deck (10 min), demo video (5 min), submit |

## Submission checklist

- [ ] Registration email to fintechathon@ican-x.com (form, passport bio-page image, proof of enrolment)
- [ ] Technical document
- [ ] Presentation deck, up to 10 minutes
- [ ] Demo video, up to 5 minutes
- [ ] Source code with README, deployment steps and tests
- [ ] Security self-assessment
- [ ] Execution evidence: real testnet transaction hashes

## Risks

- Hardest build of all our options. It needs at least one person who knows Solidity and viem.
- The vaults are mock, so the numbers are artificial. Pitch it as a risk-control demo.
- Each part already exists. Our value is the combination: AI explainer, fixed rules, on-chain limits and a bank oversight side.
- Private competitor entries are unknown. Check GitHub again before submitting.

## Sources

- kpk agent-powered vaults: https://chainwire.org/2025/11/13/kpk-launches-agent-powered-vaults-on-morpho/
- Safe AI agent with spending limit: https://docs.safe.global/home/ai-agent-quickstarts/agent-with-spending-limit
- Zodiac Roles Modifier: https://github.com/gnosisguild/zodiac-modifier-roles
- HSBC and Ant Digital test: https://www.prnewswire.com/apac/news-releases/ant-digital-technologies-and-hsbc-announce-successful-ai-agent-micropayment-technical-verification-test-302903333.html
- Theoriq AlphaVault: https://chainwire.org/2025/12/05/theoriq-launches-alphavault-with-ai-powered-active-management/
- PACE: https://arxiv.org/abs/2608.17220
- Signing the Transaction but Not the Decision: https://arxiv.org/abs/2609.11757
- Lobstar Wilde loss: https://www.kucoin.com/news/flash/ai-agent-lobstar-wilde-loses-440-000-in-solana-transfer-error
- Bankr wallets hacked: https://cointelegraph.com/news/bankr-disables-transactions-after-14-wallets-hacked
- Past FinTechathon winners: https://fintechathon.g-ican.com/#/past/2025
- Official rules: https://fintechathon.g-ican.com/#/rule
