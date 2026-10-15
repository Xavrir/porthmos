# Design QA Report: AEGIS Treasury web

**Date**: 15 Oct 2026
**Reviewer**: Claude (Design QA skill), independent reviewer
**Target**: https://aegis-treasury-eta.vercel.app (Replay mode, live chain strip on Base Sepolia)
**Scope**: all 6 routes plus 404 at 1440x900, 1024x768, 768x1024, 414x896 and 375x812; keyboard only; `prefers-reduced-motion`; axe-core (WCAG 2.2 A/AA + best practice) on every page. Tools: Playwright (Chromium), @axe-core/playwright, Base Sepolia RPC for receipts.
**References**: `web/.taste-skill/notes.md`, design-taste-frontend skill, `docs/TECHNICAL-DOCUMENT.md` §01.

## Executive summary

| Severity | Count |
|---|---|
| Critical | 0 |
| High | 6 |
| Medium | 8 |
| Low | 7 |
| **Total** | **21** |

**Overall assessment: needs work before judging.** The craft is high and the automated accessibility scan is clean (0 axe violations on 7 pages, LCP 0.43 s, CLS 0.001). The risks are about trust and clarity for a judge with 2 to 5 minutes: the "Refused on-chain" claim has no real refused transaction behind it, live and replay numbers conflict on the first screen, the key proof sits 13 screens down, and the tablet layouts clip. The demo flows work, but some states do not update after an action.

## Key findings

1. The "Refused on-chain" claim has no real reverted transaction behind it (AEG-01).
2. Live and replay numbers conflict on the first screen (AEG-02).
3. The landing is 17.6 screens long, and the proof starts at 74% depth (AEG-05).
4. The tablet layouts at 768 and 1024 px overflow or clip (AEG-03, AEG-04).
5. There is no entry or role flow. Visitors are silently "Owner (replay)" (AEG-07).

## Task walkthrough (first-time visitor, expert estimate, not user-test data)

| Task | Time | Result | Friction |
|---|---|---|---|
| T1 What and for whom | ~15 s | Pass | The H1 "Know when not to act" says nothing by itself. The sub-line answers the question ("AI agent that runs a business's stablecoin treasury"). The bank is not mentioned above the fold. |
| T2 Real on-chain refusal | 2 to 3 min | **Fail** | Tiles are 13 screens down. A click opens Audit filtered to a row with an illustrative hash. The real hashes on Audit are all successes. |
| T3 Bank freeze | ~75 s | Pass | Bank section CTA, then gate, then "View as the bank officer", then Freeze, then Confirm. The confirm step is good. To see the effect, the visitor must switch identity and open Copilot; no hint says so. |
| T4 Approve as owner | ~45 s desktop, ~90 s phone | Pass with issues | The approval is about 1,600 px below the fold (desktop) and at y = 4,612 of 4,772 (phone). The "Waiting for you" counter stays at 1 after approval. |
| T5 Reserve amount and why | ~20 s | Pass | The Treasury hero, reserve bar and one-line formula are clear. |
| T6 Live or replayed | ~30 s | Confusing | The red "Replay mode" chip and the "Live from Base Sepolia" strip show different numbers side by side. |
| T7 Back to overview; Bank desk | ~10 s | Pass | Bank desk is reachable in one click. The way home is only the wordmark; nothing is labelled "Overview". |

## Detailed issues

### High

**AEG-01. "Refused on-chain" has no real refused transaction.** Location: Landing `#refused`, Audit "Recorded on Base Sepolia". Expected: at least one typed revert (BadSignature, NonceUsed, PriceOutOfBand, Frozen) that a visitor can open on Basescan. Actual: the tile references are "Replay ledger" or "Contract test". The linked rows show `illustrative` hashes. E4a, E4b, E4d and E5 are "Pending". All 9 recorded hashes are successful transactions. Impact: bank judges will test this claim first, and an overclaim costs credibility. Recommendation: record E4a, E4b, E4d and E5 as mined, failed transactions (submit with a manual gas limit so the revert is mined) and link each tile straight to Basescan. Until then, rename the section "Refused by the contract" and badge each tile "on-chain" or "contract test". Evidence: `05-audit-badsignature-illustrative.png`, `04-audit-full-1440.png`.

**AEG-02. Live strip and replay data conflict on the first screen.** Location: Landing hero and chain strip. Expected: one clear data source per number, or labelled pairs. Actual: replay shows 10,005.58 USDC and peg 1.0001 (26 s). The live strip shows 10,000.00 USDC and price 1.0000 (2 h). When the RPC is blocked, the strip keeps the heading "Live from Base Sepolia" over "replay values". Impact: T6 fails, and the data looks inconsistent. Recommendation: title the strip "Base Sepolia right now (real chain)" and the swatches "Replay scenario". Put one line under the hero: "You are watching a recorded run. The bar below is the real chain." Change the strip heading when it falls back. Evidence: `01-landing-hero-1440.png`.

**AEG-03. The app header overflows at 768 px.** Location: all app pages at 768x1024. Expected: no horizontal scroll. Actual: scrollWidth is 838 px. The identity button is clipped and "Bank desk" wraps onto two lines. Impact: tablet visitors get a sideways-scrolling page and lose the role control. Recommendation: switch to the Menu layout below about 900 px, or hide the address and use "Replay"/"Owner" short labels as on phone. Evidence: `06-header-overflow-768.png`.

**AEG-04. The refusal board clips at 768 and 1024 px.** Location: Landing `#refused`. Expected: tiles reflow. Actual: a 4-column grid runs past the viewport (right edge 1,051 px at 1024, 862 px at 768). Names and descriptions are cut ("PriceOutOfBanc", "Amount edited from 900.0"). Impact: the key proof is unreadable on laptops with small windows and on tablets. Recommendation: use `grid-template-columns: repeat(auto-fit, minmax(220px, 1fr))` and allow the long error names to wrap. Evidence: `07-refused-board-clipped-768.png`, `08-refused-board-clipped-1024.png`.

**AEG-05. The landing is too long for a 2 to 5 minute visit.** Location: Landing. Expected: the claim, the proof and the try-it path within about 3 screens. Actual: 17.6 screens. The gates pin takes 6.5 screens. The proof is at 74% depth. With reduced motion the page is 12,844 px. Impact: most judges will not reach the proof, tier lab or bank freeze. Recommendation: put a proof row directly under the hero (3 Basescan-linked facts: "deposit executed", "attack reverted", "exit during freeze"). Cut the gates pin to about 2 screens or make it a static strip. Add hero CTAs for "Try as business owner" and "Try as bank officer". Evidence: `02-landing-scroll-1-1440.png`, `03-landing-scroll-2-1440.png`.

**AEG-06. Copilot state goes stale after a freeze or an approval.** Location: Copilot decision inspector and hero. Expected: the checks and counters reflect the current state. Actual: after a bank freeze, the owner clicks approve. The result reads "the contract would revert Frozen", but the check list above it still shows "Pass notFrozen, No freeze". After a successful approval, "Waiting for you: 1, 1,250.00 into Vault B" stays while "Last state" says confirmed. Impact: the freeze story (T3) contradicts itself on screen. Recommendation: re-run the checks and invalidate the pending-approvals query after each sign, deny or bank action. Mark failed checks in red. Evidence: `09-approve-while-frozen-stale-checks.png`, `10-copilot-after-approve-counter.png`.

### Medium

**AEG-07. There is no entry or role flow.** Location: global header, Bank desk gate, Copilot. Actual: every visitor defaults to "Owner (replay) 0x01c3…1663". The switch is a popover, and the bank gate says "You are signed in as owner". In Copilot, a bank viewer gets a red error "switch to the owner identity" with no button to do it. Recommendation: see "Entry and login recommendation" below. Evidence: `15-bank-gate-owner.png`, `18-identity-panel-bank-in-copilot.png`.

**AEG-08. The plain-language help is only in hover tooltips.** Location: tier chips, error codes, `illustrative` chips (`title` attributes); Copilot and Audit copy. Actual: the help text that exists (the `ERRORS[…].plain` copy, tier names) cannot be reached on touch or by keyboard. DAR, EIP-712, nonce, calldata, ERC-4626, eth_call and check IDs such as `notQuarantined` appear without a gloss. Recommendation: show a short plain label next to each code ("BadSignature: record was edited after signing", "T3: owner must sign"). Add an inline glossary popover with button triggers. Evidence: `21-copilot-full-1440.png`, `25-audit-row-open-linked.png`.

**AEG-09. The chapter rail creates 9 invisible focus stops before the header.** Location: Landing, `nav.chapter-rail` (opacity 0 over the hero). Actual: Tab 2 to 10 focus 6x22 px links that cannot be seen. They come before the wordmark and "Open the treasury". The skip link is half off-screen when focused. Impact: fails WCAG 2.4.7 (Focus Visible) and 2.4.3 (Focus Order). Recommendation: set `visibility:hidden` or `inert` while the rail is hidden, move it after the hero in the DOM, and put the skip link fully on screen. Evidence: `11-invisible-focus-chapter-rail.png`.

**AEG-10. The mobile approval is far down and clipped.** Location: Copilot at 375 px. Actual: "Approve with the recorded owner signature" is `nowrap` and clipped ("pprove … signatu"). It sits at y = 4,612 below the whole chat. The "Waiting for your signature" summary button does not scroll to it at any width. Recommendation: let the label wrap or shorten it to "Approve (recorded signature)". Make the summary button scroll to the approval and move focus there. On mobile, put the pending approval before the chat. Evidence: `12-mobile-approve-clipped-375.png`.

**AEG-11. The mobile Audit ledger hides its key column.** Location: Audit at 375 and 414 px. Actual: an 8-column table scrolls sideways, and "What happened" is off-screen. The row-expand target is 18x32 px. Recommendation: below 600 px, render rows as stacked cards (time, outcome, what happened) and make the whole row the expand target. Evidence: `13-mobile-audit-table-375.png`.

**AEG-12. Treasury reserve labels mislead after a change.** Location: Treasury hero. Actual: after "Settle" on Payroll, the hero shows "Reserve floor 4,500.00, Matches the schedule (2,100.00)" and Deployable jumps to 7,855.58 while the floor on-chain is still 4,500. Settle and Add give no confirmation message. Recommendation: say "Covers the schedule (needs 2,100.00)". Compute Deployable from the on-chain floor, or show both. Add a `role=status` line after each action. Evidence: `20-treasury-settle-matches-label.png`.

**AEG-13. A reload resets the replay state but keeps the role.** Location: global. Actual: after a bank freeze, a reload or a direct link shows "Not frozen" while the viewer stays "Bank officer". Recommendation: keep the scenario state in sessionStorage, or show "Demo state: base run · Reset" in the mode panel.

**AEG-14. The record sheet clips on phones.** Location: Landing `#records` at 375 and 414 px. Actual: the Decision Authorization Record is about 200 px wider than the viewport, and its values are cut off. Recommendation: stack field name over value below 480 px. Evidence: `14-mobile-record-sheet-clipped-375.png`.

### Low

**AEG-15.** Every route, including 404, has the document title "AEGIS Treasury". Use "Bank desk · AEGIS" and similar.
**AEG-16.** The Audit "Link / Linked" cell is blue like a hyperlink but is not one. Use "Chain OK" in neutral or green text. Evidence: `25-audit-row-open-linked.png`.
**AEG-17.** Touch targets are below 44 px: Copy (42x28), wordmark on app pages (51x27), Copilot suggestion chips (40 high), "Inspect the decision" (36 high), Treasury checkbox (20x20). The mobile menu does not close on Escape.
**AEG-18.** Approval uses an Approve/Deny/Correct tab set (`role=tab` with no tabpanel and no arrow keys) plus a second "Approve with…" submit button, so "Approve" appears twice. Use radio buttons, or three direct action buttons.
**AEG-19.** Status chip casing is mixed ("policy changed" next to "Confirmed", "Reverted").
**AEG-20.** The Replay indicator uses the red "protect/reject" chapter colour, which reads as an error. Use a neutral or amber chip with the text "Replay (recorded run)".
**AEG-21.** Error names on the refusal board animate through scrambled glyphs ("FrozeO", "PriceOugOfBand") for about 1 to 2 s. This is unreadable during the effect. Keep it short, or animate only opacity.

## Specification gaps

`notes.md` does not define tablet breakpoints, the header collapse width, the mobile order of Copilot panels, the entry/role states, or how replay and live values appear together.

## Positive observations

- 0 axe violations on all 7 pages. Landmarks, a skip link and a logical heading tree (one H1 per page) are present. The visible focus ring is 2 px on every control.
- `prefers-reduced-motion` is respected fully: the gates pin is removed, the clock video pauses, and the page shrinks by 3,000 px (`24-reduced-motion-landing.png`).
- Performance: LCP 0.43 s, CLS 0.001, 1.8 MB including a 0.9 MB video. There are no console errors and no failed requests on any page.
- The phone layouts for the landing hero, the menu (56 px targets, clear active underline) and the refusal tiles are good (`22-mobile-menu-375.png`, `23-landing-375.png`).
- The Bank freeze has a two-step confirm, and the copy for what the bank cannot do is precise. The Copilot prompt-injection answer is excellent plain language (`26-copilot-ask-attack.png`).
- The Treasury page answers T5 in one view: amount, formula, calendar and policy.

## Entry and login recommendation

A password login would be wrong for this product, and it would add a step that judges do not need. Make the wallet the login, and keep guest access open:

1. **Seat chooser, no wallet needed.** On the first visit to any app page (and from two hero CTAs), show one panel with three choices: "Business owner", "Bank risk officer", "Just look (read-only)". Each choice has one sentence about what that seat can do. In Replay this sets the viewpoint; remember it in sessionStorage. This replaces the silent default to Owner.
2. **Clear header chip.** Replace the hex-labelled button with "Viewing as: Owner ▾ · Replay". Put the switch control in the chip, and put the address inside the panel. Inline "Switch to bank officer" or "Switch to owner" buttons go where a page needs the other seat (Bank gate, Copilot chat).
3. **Wallet as login for Live.** "Connect wallet" signs a SIWE (EIP-4361) message to bind the service session. The role comes from the PolicyRegistry: the owner address gets Owner, the bank address gets Bank, and any other address gets read-only with the message "This wallet holds no AEGIS role". Never ask for a username or password.
4. **Keep the 31337 demo identities out of public builds.** They are gated already. Name them "Local test keys" in local builds only.
5. **Copy.** Say "viewing as" in Replay and "signed in as" only after a wallet signature.

## Recommendations (priority order)

1. Record the refusals on-chain or relabel them, and add a proof row under the hero (AEG-01, AEG-05).
2. Label live and replay values explicitly (AEG-02).
3. Fix the tablet and phone layouts (AEG-03, AEG-04, AEG-10, AEG-11, AEG-14).
4. Ship the seat chooser and the "Viewing as" chip (AEG-07).
5. Refresh the state after actions, show plain labels inline, and fix the rail focus (AEG-06, AEG-08, AEG-09, AEG-12).

## Next steps

- [ ] Fix the High issues, then repeat this QA at 768, 1024 and 375 px.
- [ ] Add the breakpoint and entry-flow rules to `web/.taste-skill/notes.md`.
