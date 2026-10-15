# AEGIS web: design notes (taste skill run)

## Inventory (things only AEGIS has)
- Name: aegis = the protective shield; tagline "Know when to earn, when to protect, and when not to act."
- The DAR (Decision Authorization Record) and the owner Approval: EIP-712 records with exact fields.
- Seven gates: intent, deterministic plan, policy check, simulation, signature, on-chain guard, execute/reject.
- Numbers: 10,000 USDC treasury, reserve floor 4,500, autoCap 1,000, dailyCap 5,000, bankLimit 3,000,
  maxOracleAge 180 s, heartbeat 60 s, DAR expiry 120 s, approval 24 h, quarantine 24 h, peg trigger 1.0%,
  liquidity trigger 1.2x position, min out 99.5%.
- Typed errors: BadSignature, NonceUsed, PriceOutOfBand, Frozen, StaleOracle, ReserveFloorBreached ...
- Tiers T0..T4 and who signs.
- The bank freeze: only the bank can lift its own freeze; exits still run.
- The hash-chained ledger.
- Printed things of its world: the safe (Safe account), the vault time lock, the ledger book, the cheque/record.
- Incidents: Freysa (Nov 2024, ~$47k), Lobstar Wilde (Feb 2026, ~$440k), Bankr (May 2026).

## Argument (landing)
0 hero: AEGIS runs a business treasury and knows when not to act -> time lock photo, live swatch nav, "Open the treasury"
1 intro (black): agents lost money on valid transactions -> three incidents
2 list (white): the reserve comes first -> obligations as poster lines summing to 4,500
3 how-it-works (blue): every action passes seven gates -> the gates as one bar, widths by real duration
4 showcase (surface): what is signed is a record you can read -> DAR / Approval / Exit / Rejection sheets
5 features (red): it leaves first when risk rises -> three triggers, pinned heading, real pictures + clip
6 proof (black): attacks fail on-chain with typed errors -> error tiles
7 stats (white): set an amount, see who must sign -> the live tier figure (live thing)
8 about (navy): only the bank can lift its freeze -> vault door masked in its circle
9 cta (blue): one deposit waits for the owner -> "Approve"
10 footer: name returns; credits

## Direction
colour-chapters (seed 1474189985). Chapter colour = system meaning:
blue act/execute (Copilot), red protect/reject (Risk), black hold/record (Audit), navy bank (Bank desk), white/surface treasury.
Redraws: section:about -> about-shaped-portrait-panel (no team; content is the bank freeze). Added features-pinned-heading-passing-rows for the protect chapter (argument needed it).
Treatment: all photographs greyscale.

## Idea
On this page, the vault time lock (authority that still waits until conditions hold) becomes the colour chapters:
each colour is one verdict a decision record can get: executed, protected, held, frozen.
Competitor test: Aumo has receipts, but not obligation floors, state-bound DARs with these typed errors, or a bank freeze.

## Live thing
Tier figure: slide a deposit amount into Vault A; the page reads the live treasury and policy and shows the tier
(T2/T3/T4), who must sign, and whether the contract would revert (ReserveFloorBreached, DailyCapExceeded, Frozen).

## QA fixes (15 Oct, after the design QA report in docs/design/aegis-web-qa-101526)
Argument order now: 0 hero (two actions: "See the on-chain proof", "Try it as owner or bank") -> 1 intro (black)
-> 6 proof (black, moved up as "Refused by the contract", with the real Base Sepolia facts) -> 2 list -> 3 gates
(pin scrubbed over 1.5 screens) -> 4 showcase -> 5 features (blocks in a 2 x 2 grid beside the pinned heading)
-> 7 stats -> 8 about -> 9 cta -> 10 footer. Landing at 1440 x 900: about 10.4 screens (was 17.6).

Proof honesty: a refusal is "on Base Sepolia" only when the evidence file holds its mined, reverted transaction.
Until then it says "scheduled" and names its contract test. src/lib/proof.ts is the one source.

Breakpoints:
- 1360: below it the wordmark drops "Treasury" and the mode chip drops "(recorded run)".
- 1100: app header collapses to the Menu drawer (Overview, five pages, Terms); landing hero rail widens to 3/12;
  gates become the stacked list; Copilot single column, with the decision inspector first while an approval waits.
- 900 / 760: phone hero (actions under the lede), refusal board 2 columns, statement sizes step down.
- 600: the Audit ledger becomes stacked rows (time, outcome, what happened), the whole row opens it.
- 480: signed-record sheets stack field name over value.

Entry and roles: a seat chooser (owner, bank officer, just look) on the first app page visit and from the hero.
Header: "Viewing as: Owner" chip next to a neutral "Replay (recorded run)" chip; never red, never "signed in"
in Replay. Live: wallet + personal_sign of the service session message, role from the PolicyRegistry.

Live and replay together: the hero rail follows the chain strip. Chain answers -> chain values, "Base Sepolia now";
chain fails -> every swatch "Replay" and the strip says "Base Sepolia unreachable, showing replay".

Plain language: error codes, tiers and terms are buttons that disclose their meaning on tap, click or keyboard
(no title tooltips); a "Terms" glossary dialog sits in the header and the footer.

Inspector warnings kept on purpose: card-rows (the refusal board is a reference grid of distinct typed errors,
each with its own proof status) and size-count (the data-ui record sheets and tables keep interface sizes).
