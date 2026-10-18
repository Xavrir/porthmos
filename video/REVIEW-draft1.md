# Porthmos demo video: review of draft 1

Reviewed: `video/film/out/porthmos-launch.mp4` (1920x1080, 3:00) and `porthmos-launch-square.mp4` (1080x1080, 0:45), 2026-10-18.
Criteria: the official judging criteria are not on this machine. This review uses typical fintech hackathon criteria with assumed weights: problem and market 20%, working demo 30%, technical depth and innovation 25%, security and feasibility 15%, presentation 10%.
Working files (frames, contact sheets, OCR, earshot JSON): `/tmp/claude-1000/-home-xavrir/fa4670d3-d0cf-44a7-8e79-66f2698650aa/scratchpad/review/`. Stills below are under `.../review/beats/` (1080p) and `.../review/phone/` (390 px wide).

## Verdict

The craft is finals level: strong hook, one clear visual system, a real architecture section, and real on-chain refusals. But it is **not submittable as is**. A judge will see a labelled placeholder at 2:04 inside a frame that says "LIVE · real transactions", and the happy path (agent proposes, owner signs, contract executes) never completes on screen. Fix those two, add one positioning line in the first 15 s, and raise the mix by 6.6 dB. That is about 4 to 5 hours of work and it moves the film from "good trailer" to "credible winner". You use only 3:00 of 5:00, so you have room to add proof and still be short.

## Scorecard

| Criterion (weight) | Score | Why |
|:-|:-:|:-|
| Problem and market (20%) | 6/10 | The cold open hook is sharp and the staged-payment pain is clear (0:25 to 0:38). But the words "agent wallet" and "cross-border" never show on screen, there is no market size or customer evidence, and the "agents are talked into bad transfers" claim has no source. |
| Working demo (30%) | 5/10 | Real onboarding (0:38 to 0:58) and a real Copilot reply are shown. But no agent action executes on screen: 1:17 is a dashboard stand-in, 2:04 to 2:12 is a placeholder, and TradeFlow (2:18 to 2:33) is a motion-graphic rebuild, not the product UI. Only about 55 s of the 180 s is real product footage. |
| Technical depth and innovation (25%) | 8/10 | The 1:25 to 1:45 diagram is the best part for judges: LLM holds no key, typed DEPOSIT/REDEEM module, 5 split keys, tier ladder. Policy-check overlay (1:13) is clear. Loses points for jargon ("DARs", "Not representable") and the old name "AegisModule" with no note. |
| Security and feasibility (15%) | 7/10 | Four real reverts with hash, block and error (1:54 to 2:04) are excellent proof. The freeze/exit beat that should close the section is a placeholder. Test count on screen (648) does not match the repo (685). |
| Presentation (10%) | 7/10 | Beautiful type, palette and pacing, cuts land on the beat. Against it: mix is 6.6 dB too quiet, 8 text cards are too short to read, product UI is unreadable on a phone, no voice and no team presence (team card is 4 s). |

## Timing table

| Section | Time | Seconds | Share | Mainly serves | Note |
|:-|:-|-:|-:|:-|:-|
| Cold open + reveal | 0:00 to 0:25 | 25 | 14% | Presentation, problem | No product definition until 0:21 |
| Problem | 0:25 to 0:38 | 13 | 7% | Problem | No market or customer numbers |
| 01 Create a treasury | 0:38 to 0:58 | 20 | 11% | Demo | Real footage, good speed ramp |
| 02 Copilot | 0:58 to 1:25 | 27 | 15% | Demo, tech | Action card never shown legibly; 1:17 stand-in |
| 03 How it works | 1:25 to 1:45 | 20 | 11% | Tech | Strong |
| 04 Try to break it | 1:45 to 2:12 | 27 | 15% | Security | 8 s of placeholder |
| 05 TradeFlow | 2:12 to 2:38 | 26 | 14% | Demo | 6 s real UI, 20 s graphics |
| Proof montage | 2:38 to 2:50 | 12 | 7% | Feasibility | Cards too short |
| Outro (logo, URL, team) | 2:50 to 3:00 | 10 | 6% | Team, ask | Team 4 s, ask is a 2 s small line |

By weight: demo gets 73 s (41%) but only about 55 s of that is real UI; security 27 s (15%) fits; tech 20 s plus overlays fits; problem and market 13 s of real content against a 20% weight is short; team and ask about 6 s (3%) is the weakest. Winning demos usually spend 10 to 20 s on "who we are and what we ask for".

## 10-second test (0:00 to 0:15)

Fail. At 0:15 a stranger knows "an agent sent all USDC somewhere bad" and sees a logo forming. They cannot say what Porthmos is or who it is for. At 0:25 they read "Pay suppliers on proof. Keep the rest of the cash safe and earning." but still not "agent wallet" or "importer treasury". The script's VO line ("Porthmos is an agent wallet for trade treasuries") has no on-screen equivalent. Stills: `beats/t0009.0.png`, `beats/t0023.0.png`.

## Top changes, ranked by judging impact per hour

1. **Replace the R6 placeholder (2:04 to 2:12).** What: record R6 (bank seat freeze, then exit succeeds) and run `sync-media.mjs`. If there is no time, cut the placeholder and use the explorer-card style already in the film: a "Frozen" card then the real exit tx (`0xdf111f38...`, block 48,158,300, Success, which is already baked in tiny type under the placeholder). Why: the text "R6 placeholder / swap in video/footage/R6 (see README)" in a frame badged "LIVE · real transactions" reads as unfinished and undermines every other "real" claim. Effort: 1 h record, or 30 min for the card fallback. Still: `beats/t0126.0.png`.

2. **Show the happy path execute (1:13 to 1:21).** What: re-record R2 so Confirm leads to Executed with a tx hash and a BaseScan link. Use a deposit at or below the 1,000 autoCap (the "Deposit 800 into Vault B" chip, tier 2) so one click executes, and keep the 5,000 tier-4 card as the "bigger moves need signatures" example. Why: the film's thesis is "agent proposes, code decides, contract enforces", and the third step has no proof. Also the stand-in shows Vault B at 3,000 right after a 5,000 proposal; a careful judge sees the numbers do not match. Effort: 1.5 to 2 h with a synced treasury. Stills: `beats/t0069.0.png`, `beats/t0078.0.png`.

3. **Say what it is in the first 15 s.** What: add a line under PORTHMOS at 0:16 to 0:25: "The agent wallet for cross-border trade treasuries." Hold the tagline to at least 4 s fully visible. Why: the 10-second test fails today; judges score the first impression. Effort: 20 min.

4. **Make the action card the hero of 02 (1:08 to 1:24).** What: replace the 5 s of a long LLM paragraph (1:08 to 1:13) with a zoom on the real action card: "All 13 policy checks pass", "Approve and sign as owner", and the EIP-712 record (safe, op 0 DEPOSIT, vault, maxAmount). Today it only appears at 1:20 to 1:24, cropped at the right edge ("Change the am...") and under the "Speaks your language" headline. Also reconcile the overlay (11 checks listed at 1:16) with the UI ("All 13 policy checks"). Why: this card is the agent-wallet product; it is the one screen judges will remember. Effort: 45 min (footage exists in R3). Stills: `beats/t0076.5.png`, `beats/t0083.0.png`.

5. **Fix the mix: +6.6 dB.** What: earshot critique verdict "needs work", 20 of 23 metrics in range, 1 critical. Integrated loudness is -20.6 LUFS against a -16 to -9 range. Raise to about -14 LUFS with a true-peak limiter at -1 dBTP; bring the ending (2:42 to 3:00) down 1.4 LU relative to the body. Optional: the layers at 1:56 to 2:00 and 2:04 to 2:08 score as code-synthesized (p_real 0.11 and 0.14); 0:10.0 and 2:53.2 get no sound. Why: a quiet film on a judge's laptop feels weaker than the one before it. Effort: 15 min.

6. **Fix the reading-time violations (rule: 1.2 s + 0.3 s per word, fully visible).** Use some of the spare 2 minutes. Effort: 30 to 45 min.

   | Time | Text | Words | Needs | Has |
   |:-|:-|-:|-:|-:|
   | 0:22 | Keep the rest of the cash safe and earning. | 9 | 3.9 s | 3.0 s |
   | 0:22 | Shenzhen FinTechathon 2026 · Topic F: Agent Wallet (chip) | 7 | 3.3 s | 3.0 s, and tiny |
   | 0:27 | Shipped. Arrived. Inspected. | 3 | 2.1 s | 1.75 s |
   | 1:54 to 2:04 | Each refusal card (hash, status, block, error, reason) | about 12 | 4.8 s | 2.5 s |
   | 2:35.5 | The supplier is fixed. The amounts are fixed. Proof does the rest. | 12 | 4.8 s | 2.5 s |
   | 2:41 | 15 recorded scenarios. Every one on BaseScan. | 7 | 3.3 s | 2.75 s |
   | 2:47 | 0 ways for the agent to send money out + "Next: audit, real vaults, a bank pilot" | 16 | 6.0 s | 2.25 s |
   | 2:52 | The agent proposes. Code decides. The contract enforces. | 8 | 3.6 s | about 1.0 s |
   | 2:56 | Team card (4 handles, track line, 2 URLs) | about 12 | 4.8 s | 3.0 s, then 1.3 s dead air |

   The refusal cards are the most important: they are your best evidence and each gets 2.5 s. Give them 3.5 to 4 s each.

7. **Correct the stale facts.** What: change 648 to 685 (106 contract, 390 service, 19 integration, 170 web) at 2:44; re-record or reframe 0:53 to 0:58 so the red "Reserve floor 0.00 / Schedule needs 500.00" is not on screen (punch in on Total balance, or use the post-fix take, which at 1:17 already shows "500.00 Matches schedule"). Why: the headline at 0:55 says "Your rules. On-chain." while the UI shows a red warning that the rule is not on-chain; a judge who checks the repo finds a different test count. Effort: 30 min. Still: `beats/t0055.0.png`.

8. **Add a 15 to 20 s "who, why us, the ask" beat before the outro.** What: one card with the customer (mid-sized importer paying foreign suppliers in stages), one market or pain number with a source, the team with roles (not only handles), and the ask ("Looking for a bank pilot partner"). Why: the "Next" line is 7 small words for 2 s; most winning hackathon videos close with a team and a clear ask, and fintech judges (often bank people) want the bank pilot spelled out. Effort: 1 h.

## Claims vs proof

| Claim (time) | Proof on screen? |
|:-|:-|
| Agents with wallets make valid but bad transfers (0:00 to 0:10) | No. No source or incident named. |
| Treasury in a minute, 13 real transactions (0:38 to 0:53) | Partly. Real signup UI and a counter; one tx hash visible but tiny. No total time shown. |
| Your Safe. Your rules. On-chain. (0:53) | Contradicted. Reserve floor 0.00 with a red "Schedule needs 500.00". |
| The agent proposes (1:08) | Yes. Real Copilot reply, 5,000 USDC into Vault B, tier 4. |
| Deterministic code decides (1:13) | Partly. Film overlay with 11 checks; UI says 13. The real "Inspect the decision" panel is not shown. |
| The contract enforces (1:17) | No. Dashboard stand-in; Vault B 3,000 does not match the 5,000 proposal. |
| Speaks your language (1:21) | Yes. Indonesian reply with real balances. |
| LLM never holds a key; keys split across 5 processes (1:32 to 1:41) | Diagram only. Acceptable for a "how it works" section. |
| Bigger moves need a human signature (1:41) | Yes, indirectly: the 1:23 approval panel shows "Waiting for signature". |
| HELD, not representable (1:50) | Yes. Real reply, but the HELD stamp covers the reply text that explains why. |
| Every one refused on-chain (1:54 to 2:04) | Yes. Hash, block, Fail, error name for E4a, E4b, E4d, E5. Strongest proof in the film. |
| Frozen for the agent, exits always open (2:04) | No. Placeholder. |
| Pay on proof: release, hold at 9.40 °C, waive, complete (2:18 to 2:33) | Partly. Real tx hashes and blocks under each milestone, but in about 14 px type, inside a graphic. The product's own order page is not shown. |
| 9 contracts, 15 scenarios, 648 tests (2:38 to 2:47) | Numbers only; 648 is stale. |
| 0 ways for the agent to send money out (2:47) | Supported by 1:50 and the typed module in the diagram. |
| Live at porthmos.vercel.app (2:53) | URL shown; no address of the deployed contracts. |

## Legibility

At 1080p, headlines, the policy-check overlay, the refusal cards and the TradeFlow milestone cards are all readable. The raw product UI is borderline: the Copilot reply (1:08) is about 18 px and readable; the signup steps (0:45), dashboard secondary numbers (1:17) and approval record (1:23) are 11 to 13 px and hard to read without a pause. On a phone (390 px wide) only the headlines survive; every product UI string, all tx hashes and the test-count chips are unreadable (`phone/p0069.0.png`, `phone/p0139.0.png`). The key items need a zoom or a callout: the action card (1:08), the Executed tx hash (1:17 after the fix), the HELD reply text (move the stamp off the text, 1:50), and the milestone tx hashes (2:18 to 2:33).

## Structure vs winning demo videos

| Element | Present? |
|:-|:-|
| Hook and problem | Yes, strong |
| What it is, for whom (one sentence) | No (change 3) |
| Live demo of the main flow, end to end | No, the execute step is missing (change 2) |
| How it works | Yes, strong |
| Proof (on-chain, tests) | Yes, strong; partly stale |
| Team | 4 s, handles only |
| Ask and next steps | 2 s small line |

## Other things that could cost points

- Square cut (`porthmos-launch-square.mp4`) ends at 0:45 on small signup UI, with no logo, URL or end card. Fine for socials only if you add a 2 s end card.
- Old name "AegisModule" in the diagram (1:32) and in the EIP-712 record (1:23) with no explanation. Add a small "(Porthmos module, deployed as AegisModule)" or accept it.
- Jargon a non-crypto judge will not decode: "DARs" (1:32), "Not representable" (1:50), "ConditionNotMet", "bandWidth". Short plain labels help.
- Grammar in the counter chip at 0:45: "1 real transactions".
- The Copilot suggestion chip "Send all USDC to 0x14dC79964da2..." is visible in every Copilot shot. A judge may read the 1:45 attack as a canned button. The typed attack at 1:45 is better; keep the typing visible.
- The R6 placeholder and TradeFlow graphics both sit under or near the "LIVE · real transactions" badge. Only put that badge on real footage.
- No voice and no captions. Music-only works for a launch trailer, but a demo judged on technical depth often benefits from a calm 60 to 90 word VO over 02 and 04. Optional, about 1 to 2 h.
- README still says "Demo video (coming soon)". Update the link when the video is uploaded.

## Key stills cited

- `beats/t0009.0.png` (cold open end), `beats/t0023.0.png` (tagline, chips)
- `beats/t0045.5.png` (signup steps, "1 real transactions")
- `beats/t0055.0.png` (red "Schedule needs 500.00")
- `beats/t0069.0.png` (Copilot proposal), `beats/t0076.5.png` (11-check overlay), `beats/t0078.0.png` (1:17 stand-in), `beats/t0083.0.png` (cropped action card, "All 13 policy checks")
- `beats/t0099.0.png` (architecture), `beats/t0111.0.png` (HELD stamp covers the reply), `beats/t0115.0.png` (refusal card)
- `beats/t0126.0.png` (R6 placeholder), `beats/t0134.0.png` (create order), `beats/t0145.0.png` (milestone HELD 9.40 °C)
- `phone/p0069.0.png`, `phone/p0139.0.png` (phone legibility)
- Contact sheets: `sheet0.png`, `sheet1.png`, `sheet2.png`; earshot result: `earshot.json`; OCR timing: `ocr.tsv`
