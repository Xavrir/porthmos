# Porthmos Landing Page: Style Reference and Spec

Research date: 2026-10-17. Scope: style only (layout system, type, colour use, motion, interaction, imagery). Do not copy code, copy, logos, illustrations or other assets from any reference site.

## 1. Decision

**Winner: Sui** (https://www.sui.io/)
Award: Awwwards Site of the Day, 23 Jun 2026, score 7.38 (https://www.awwwards.com/sites/sui). Credits on Awwwards: HOLOGRAPHIK, AKKA Studio.

**Runner-up: Due** (https://www.opendue.com/)
Award: Awwwards Site of the Day, 10 Jan 2024, score 7.38 (https://www.awwwards.com/sites/due).

Why Sui wins (5 lines):
1. Its page tells our exact type of story in visual form: autonomous agents that must obey rules, settlement that is all or nothing, policy that moves with the money. The layout was built to explain rules and flows, not to show off a mascot.
2. Readability is strong where it matters: one 90px line on black in the hero, then a 78px black-on-white statement. A banker gets the message in 5 seconds.
3. The palette is structural (black, white, cool greys, ONE accent fill colour). We can replace the accent with our green and add orange as a second signal without fighting the system.
4. Every signature effect is cheap to rebuild: a canvas streak burst, CSS stripes, SVG wireframe cards on a scroll rail, mono labels, a word reveal, an accordion. No custom 3D asset pipeline.
5. It reads as top-tier web3 (mono labels, terminal-tree lists, live on-chain counter, square buttons) and it is recent (2026 SOTD) and built on the same tools we use (GSAP 3.15, ScrollTrigger, SplitText, Lenis).

## 2. Candidates and sources

Galleries: Godly now redirects to recent.design; Land-book and Lapa Ninja returned HTTP 403 to our fetcher; One Page Love's crypto tag returned 404. All verified candidates therefore come from the Awwwards Sites of the Day archive (2023-05 to 2026-10, 1,240 entries parsed) and Awwwards site pages. Every URL below returned HTTP 200 on 2026-10-17 unless noted.

| # | Site | Live URL | Award (Awwwards) | Score | Category |
|---|---|---|---|---|---|
| 1 | Sui | https://www.sui.io/ | SOTD 23 Jun 2026, /sites/sui | 7.38 | L1, AI agents, settlement |
| 2 | Sharplink | https://www.sharplink.com/ | SOTD 27 Aug 2026, /sites/sharplink | 7.38 | ETH treasury (institutional) |
| 3 | EverSwap | https://everswap.com/ | SOTD 22 Jun 2026, /sites/everswap | 7.58 | DeFi protocol |
| 4 | Apechain | https://apechain.com/ | SOTD 6 Jun 2026, /sites/apechain | 7.25 | L2/L3 chain |
| 5 | Hashgraph Ventures | https://hashgraphvc.com/ | SOTD 1 Jun 2026, /sites/hashgraph-ventures | 7.50 | Crypto VC |
| 6 | Razorpay Sprint 26 | https://razorpay.com/sprint/26 | SOTD 26 May 2026, /sites/razorpay-sprint-26 | 7.42 | Payments fintech |
| 7 | Moto Finance | https://www.moto-card.com/ | SOTD 24 Sep 2026, /sites/moto-finance | 7.30 | Fintech card |
| 8 | Tresmares Capital | https://www.tresmarescapital.com/ | SOTD 12 Jun 2026, /sites/tresmares-capital | 7.25 | Institutional finance (Santander-backed) |
| 9 | Hut 8 | https://www.hut8.com/ | SOTD 28 Oct 2025, /sites/hut-8 | 7.63 | Bitcoin/AI infrastructure |
| 10 | Walrus | https://www.walrus.xyz/ | SOTD 18 Sep 2025, /sites/walrus | 7.29 | Decentralized storage |
| 11 | MetaMask | https://metamask.io/ | SOTD 13 Aug 2025, /sites/metamask | 7.39 | Wallet |
| 12 | Avalanche | https://www.avax.network (redirects to avalanche.com; may differ from the awarded build) | SOTD 26 Jul 2025, /sites/avax-network-1 | 7.33 | L1 |
| 13 | BlueYard Capital | https://blueyard.com/ | SOTD 22 May 2025, /sites/blueyard-capital | 7.61 | Crypto VC |
| 14 | New Layer Capital | https://nlc.obys.agency/ | SOTD 11 Apr 2025, /sites/new-layer-capital | 7.53 | Bitcoin VC |
| 15 | Jeton | https://www.jeton.com/ | SOTD 27 Jan 2025, /sites/jeton | 7.55 | eWallet fintech |
| 16 | Clear Street | https://www.clearstreet.io/ | SOTD 5 Dec 2024, /sites/clear-street | 7.44 | Institutional brokerage |
| 17 | Reown | https://reown.com/ | SOTD 12 Oct 2024, /sites/reown | 7.14 | Onchain UX (WalletConnect) |
| 18 | Walbi | https://walbi.com/ | SOTD 30 Sep 2024, /sites/walbi | 7.28 | AI crypto trading agents |
| 19 | Due | https://www.opendue.com/ | SOTD 10 Jan 2024, /sites/due | 7.38 | Blockchain cross-border payments |
| 20 | Ledger Brandbook | https://brand.ledger.com/ | SOTD 20 Nov 2025, /sites/ledger-brandbook | 7.19 | Wallet brand site |
| 21 | ChainGPT Labs | https://labs.chaingpt.org/ | SOTD 30 Nov 2024, /sites/chaingpt-labs | 7.35 | Web3 incubator |
| 22 | MatrixPay | https://matrixpay.eu/ | Nominee 11 Oct 2025, /sites/matrixpay-next-gen-payments | n/a | B2B payments |

Excluded as not live: Navigate (SOTD 16 Apr 2025, 7.93, nvg8.io returns HTTP 525), Spaace (no response), OTSea (domain now parked).

Hero triage sheets of all live candidates: `screens/triage-heroes-1.jpg`, `screens/triage-heroes-2.jpg`.

## 3. Top 10: observations and scores

Captured with the Playwright CLI (system Chromium, headless) at 1440x900 and 390x844, hero plus scroll positions every viewport height. Cookie banners: we clicked "Reject"/"Decline" where present; Clear Street offers only "OK", so its banner stays in frame. The 390 captures use a desktop user agent.

Scores are 1 to 5. Readability = can a banker read the key message in 5 seconds, with real contrast. Fit = fit with green/orange and the trade, shipping and proof story. Build = can we approximate it in 1 day with React + GSAP.

| Site | Impact | Web3 feel | Readability | Fit | Build | Total | Motion and notes |
|---|---|---|---|---|---|---|---|
| **Sui** | 5 | 5 | 4 | 5 | 4 | **23** | Looping streak burst (fixed layer), white curtain slides over it, logo marquee, SplitText reveals, pinned stripe wipe with scroll snap, scroll rail with alternating wireframe cards, ASCII text art, hover accordion, live TVL counter, animated bar field in footer. GSAP 3.15 + ScrollTrigger + SplitText + CustomEase + Lenis, Webflow. Weak point: 10 to 12px mono labels. |
| **Due** | 4 | 3 | 5 | 4 | 5 | **21** | White page, giant bold caps headline, pinned word stack that grows (PAY, SEND, RECEIVE...) in blue, pill buttons, rounded card trio (black/blue/grey), dotted globe corridor, country marquee. Webflow, 19 videos, no GSAP. Stock photography heavy. |
| Reown | 4 | 4 | 4 | 3 | 5 | 20 | Huge rounded "pill" containers, bento cards in blue, orange and green, mono UI type (KH Teka Mono). Mostly static, CSS transitions. Bento uses orange next to green, which is our banned pair. |
| Sharplink | 5 | 4 | 4 | 4 | 2 | 19 | Institutional blue gradients, chrome 3D renders (Three.js), topographic line hero, small narrow caps buttons, editorial 2-column grid, huge cropped wordmark footer. Needs a custom 3D render pipeline. |
| Walrus | 3 | 4 | 4 | 3 | 4 | 18 | Black page, centered headings, glassy 3D icons, product card pair, FAQ rows. Pleasant but generic. |
| MetaMask | 5 | 5 | 4 | 2 | 2 | 18 | Ultra-bold display type, mascot that travels between sections, colour-block bento, many 3D props. Highly brand-specific; consumer tone. |
| Tresmares Capital | 4 | 1 | 5 | 3 | 4 | 17 | White, light grotesk, red serif numerals, red geometric shapes over plant photography, stat grid. Best "bank" tone, no web3 feel. |
| Clear Street | 3 | 2 | 4 | 3 | 3 | 15 | Electric indigo, floating dashboard UI, glass shard renders, scroll-told problem story over photos. Consent wall covers 25% of the fold. |
| Hut 8 | 5 | 2 | 3 | 3 | 1 | 14 | Scroll-driven 3D journey through white isometric infrastructure with lime traces. Very close to a "port" metaphor but needs a full 3D scene. |
| EverSwap | 5 | 3 | 2 | 3 | 1 | 14 | Preloader on dark green, painted landscape flythrough, thin serif display. Beautiful, but text sits on busy art and the art is hand-painted. |

**Runner-up paragraph (Due):** Due is the safest alternative. It is a blockchain payments company with a white, high-contrast page, very large bold caps headlines, and a pinned "growing word stack" that lists verbs one by one as you scroll. That pattern would map well onto our milestone verbs (LOCK, SHIP, PROVE, VERIFY, RELEASE). It is the most readable site in the set and very easy to build. It lost because it feels like a fintech rather than a web3 product, it relies on stock photos and video, and its blue accent and rounded pill style give us less room to show on-chain proof.

## 4. Annotated screenshots

All paths are relative to this folder.

### Winner (Sui), `winner-sui/`

| File | What to look at |
|---|---|
| `01-hero-burst.jpg` | Hero: centered one-line H1 (90px, white), 16px subline, two square buttons that touch (blue fill + white fill). Full-bleed radial streak burst behind. Nav: 72px, logo left, links with small boxed "+" glyphs, square blue CTA right. |
| `02-hero-burst-3s-later.jpg` | Same fold about 3s later. The burst is a looping ambient animation (15.7% of pixels change in 1.5s). No cursor reaction was observed. |
| `03-curtain-logo-marquee.jpg` | White section scrolls up OVER the fixed hero (curtain). Grey logo marquee. Mono chip label on #E0E2E6 above the statement. |
| `04-statement-paragraph.jpg` | 78px black statement on white, line-height 1.1, tracking -0.05em. The last sentence lands as a punchline. |
| `05-rules-list-icon-tiles.jpg` | List rows on #F4F5F7: 44px item text, 1px dashed separators, small accent icon tile at the far right of each row. |
| `06-stripe-wipe-transition.jpg` | Full-bleed vertical stripe field (barcode) in accent shades. Pinned and snapped between white and black sections. |
| `07-stack-heading-over-stripes.jpg` | Stripes fade to black from the center while the next 90px heading appears. |
| `08-stack-rail-card-01.jpg` | Scroll rail: dotted vertical line at center, white square progress marker, first step card attached to the rail. |
| `09-stack-rail-cards-alternating.jpg` | Cards alternate left and right of the rail. Each card: mono "01 Label" header, wireframe isometric drawing, footer row with a tree connector to a product name. Active drawing lights up in the accent. |
| `10-stack-card-06-ascii-start.jpg` | Last card, and the start of an ASCII text shape below it. |
| `11-ascii-to-white-columns.jpg` | ASCII shape (repeated mono text) dissolves into a white two-column section. |
| `12-two-column-lists-cta.jpg` | Two columns, 44px titles, rows with small accent square bullets on #F4F5F7, one centered accent CTA. |
| `13-industry-heading-cards.jpg` | Black section, 90px centered heading (word reveal), then dark cards. |
| `14-industry-tree-list-cards.jpg` | Dark cards (#131518) with icon row, tree-list bullets ("└─"), full-width accent action bar at the card foot. |
| `15-start-accordion-active-row.jpg` | Accordion rows (60px). Active row: dark fill, accent icon tile slides in at left, full-width accent CTA bar appears. |
| `16-live-counter-media-grid.jpg` | Live on-chain counter (69px numerals) with mono uppercase caption, inside a media grid. |
| `17-mono-tree-footer.jpg` | Footer: mono uppercase column heads with "/" suffix, tree-style link lists, animated accent bar field at the bottom. |
| `18-mobile-hero.jpg`, `19-mobile-statement.jpg`, `20-mobile-stack-cards.jpg` | 390px: hero H1 66.5px on two lines; statement about 30px; rail cards become a single column with the same mono headers. |

### Other top-10 sites, `screens/<site>/`

Each folder has `1440-0-hero.jpg`, `1440-1-scroll.jpg` (1 viewport down), `1440-2-scroll.jpg` (middle), `1440-3-scroll.jpg` (near the end), `390-0-hero.jpg`, `390-1-scroll.jpg`, `390-2-scroll.jpg`. Folders: `sui`, `due`, `sharplink`, `reown`, `walrus`, `metamask`, `hut8`, `tresmares`, `everswap`, `clearstreet`. Notable frames: `due/1440-2-scroll.jpg` (card trio), `sharplink/1440-1-scroll.jpg` (institutional chart card), `hut8/1440-2-scroll.jpg` (isometric infrastructure), `everswap/1440-0-hero.jpg` (preloader on dark green).

## 5. Measured facts about the winner (computed styles)

- Fonts: TWK Everett 400/700 (display and body), TWK Everett Mono 400/500 (labels, footer). Inter is loaded but not used on visible text.
- H1/H2 display: 90px / 90px line-height / 400 / letter-spacing -5.85px (-0.065em) for H1, -5.4px (-0.06em) for H2.
- Statement: 78px / 85.8px / 400 / -3.9px (-0.05em), colour #000 on #FFF.
- Accordion titles: 60px / 66px / -3px (-0.05em). Column titles: 44px / 48.4px / -2.2px. List rows (H3): 44px / 48.4px / -1.76px (-0.04em).
- Body: 18px / 25.2px / -2%. Base body 16px / 20px, colour #6C7584 on black.
- Mono chip: 12px / 12px / -0.36px, colour #000 on #E0E2E6, padding 6px, radius 0. Mono micro caption: 10px uppercase. Footer heads: 14px uppercase +0.245px.
- Counter: 69px / 75.9px / -2.98px.
- Buttons: 14px / 14px, padding 14px 26.25px, radius 0, transition 0.2s. Primary #298DFF with white text (3.31:1, below AA; we fix this).
- Colours in use: #000000, #FFFFFF, #6C7584 (muted), #131518, #222529, #343940 (dark surfaces), #4B515B (1px borders), #F4F5F7 and #E0E2E6 (light surfaces), accent #298DFF.
- Layout: content container max 1400px; intro wrapper max 1890px with 80px side padding; narrower text measures at 1050px and 900px. Section top padding 184 to 210px. Nav 72px tall, no blur.
- Mobile: H1 66.56px / 59.9px / -2.66px (-0.04em).
- Easing curves found in CSS (by count): cubic-bezier(0.645, 0.045, 0.355, 1) x65, (0.455, 0.03, 0.515, 0.955) x29, (0.215, 0.61, 0.355, 1) x18, (0, 0.4, 0.25, 1) x15, (0.16, 1, 0.3, 1) x14.
- Libraries: GSAP 3.15.0, ScrollTrigger, SplitText, CustomEase, InertiaPlugin, Lenis, lottie-web 5.13, Webflow. A fixed full-viewport canvas wrapper plus 6 per-card canvases (about 400x270) on the rail, and a 1440x520 canvas in the footer.
- Scroll: a sticky "overlap" wrapper creates the curtain effect. Wheel input between y=2100 and y=3232 snaps once (the stripe wipe is pinned and snapped).

## 6. The Porthmos spec

### 6.1 Principles

1. Black and white do the structural work. Green is the ONE fill accent (actions, active states, "verified"). Orange is the signal colour (refused attacks, freeze, warnings, the "arc"). They never touch as text and background.
2. One big idea per viewport. Display type is large, light weight (400), tightly tracked.
3. Proof over decoration: mono labels, tx hashes, tree lists and live counters are the "web3" texture. Every number shown must be real (Base Sepolia).
4. Square geometry: radius 0 on buttons, cards, chips and icon tiles. 1px lines.

### 6.2 Grid and spacing

- Container: max-width 1400px, centered. Outer padding: 80px at 1280px and wider, 40px from 768px to 1279px, 16px below 768px. No horizontal page scroll.
- Columns: 12 columns, 24px gutter (desktop); 8 columns, 20px gutter (tablet); 4 columns, 16px gutter (mobile).
- Text measures: display headings max 1050px; statement paragraph max 1240px; body max 560px.
- Spacing scale (px): 4, 8, 12, 16, 24, 32, 48, 64, 96, 128, 184. Section padding: 184px top and bottom on desktop, 128px on tablet, 96px on mobile. Card padding 24px (mobile 16px). List row height: 64px desktop, 56px mobile.
- Nav: 72px desktop, 60px mobile. Transparent over the hero, solid black (#000) after 80px of scroll. No backdrop blur.

### 6.3 Section sequence (their rhythm mapped to our content)

| # | Our section | Background | Pattern taken from Sui | Content and components |
|---|---|---|---|---|
| 1 | Hero | black, fixed canvas | Hero burst + centered H1 + touching button pair | One-line promise (our own words, about payment released only on verified proof). 16px subline. Buttons: "Open the demo" (green fill, black text) + "See refused attacks" (white fill, black text). Small mono chip under the buttons: "Live on Base Sepolia". |
| 2 | The problem | white curtain over the fixed hero | Curtain + marquee + mono chip + 78px statement + rules list with icon tiles | Marquee = proof ticker of real tx hashes and block numbers (mono 12px, grey), NOT partner logos. Mono chip label. Statement paragraph on the importer/supplier trust gap. Then 5 guarantee rows (44px) with green icon tiles: locked in contract, released per verified milestone, obligations reserved first, only free cash invested, bank can freeze any agent. |
| 3 | How a milestone payment works | stripe wipe, then black | Stripe wipe + 90px heading + scroll rail with alternating step cards | 6 cards on the rail: 01 Lock funds, 02 Ship, 03 Submit proof, 04 Verify, 05 Release milestone, 06 Agent invests free cash. Each card: mono header, SVG wireframe drawing, footer row with tree connector to the contract or function name. |
| 4 | Live on-chain proof | black | ASCII shape + dark tree-list cards + live counter | Text-mask shape (our shield outline filled with repeated short tx hashes). Then 3 dark cards: "Refused: release without proof", "Refused: agent over-invests reserved cash", "Refused: unauthorized withdraw". Each: orange "REFUSED" chip (black text), tree list of what was attempted, full-width action bar "View on BaseScan". Counter row: escrowed amount, milestones released, attacks refused (live reads). |
| 5 | The bank desk | white | Two-column lists + one centered CTA | Left "What the risk officer sees", right "What the risk officer can do". Rows on #F2F5F3 with small square bullets. Signature interaction: freeze toggle demo (see 6.7). One centered CTA "Open the bank desk". |
| 6 | The agent | black | 90px word-reveal heading + dark cards | Heading about the agent's rule (cash for obligations first). Under it: a single horizontal stacked bar (reserved for obligations vs free cash invested) with mono labels and live values, then 2 dark cards with tree lists of the agent's policy. |
| 7 | Pricing and CTA | black | Hover accordion rows + footer bar field | 3 or 4 rows (60px): Pilot, Bank partner, Enterprise, Talk to us. Active row reveals price or terms text and a full-width green action bar. Footer: mono uppercase column heads with "/" suffix, tree-style link lists, animated green bar field (container skyline) at the bottom, small orange arc as the only orange element. |

### 6.4 Type

Sui's fonts are commercial (Weltkern TWK Everett / Everett Mono). Use free Google Fonts:

- Display and body: **Geist** (closest free match to Everett's neutral, slightly geometric grotesk). Fallback: Inter Tight.
- Mono: **Geist Mono** (pairs like Everett with Everett Mono). Fallback: JetBrains Mono.
- Load weights: Geist 400, 500, 700; Geist Mono 400, 500. Use `font-feature-settings: "tnum"` on all numbers.

| Role | Desktop size / line-height | Mobile (390) | Weight | Tracking | Case | Colour |
|---|---|---|---|---|---|---|
| Display XL (hero, section openers) | 88px / 1.0 | clamp(48px, 15vw, 64px) / 0.95 | 400 | -0.055em (mobile -0.04em) | Sentence | white on black |
| Statement | 72px / 1.1 | 32px / 1.12 | 400 | -0.05em (mobile -0.035em) | Sentence | black on white |
| Row title (accordion, guarantees) | 56px / 1.1 and 44px / 1.1 | 28px / 1.15 | 400 | -0.045em | Sentence | context |
| Column title | 44px / 1.1 | 28px / 1.15 | 400 | -0.05em | Sentence | context |
| Counter numerals | 64px / 1.1 | 40px / 1.1 | 400 | -0.04em | n/a, tabular | white |
| Body L | 18px / 1.45 | 17px / 1.45 | 400 | -0.01em | Sentence | context |
| Body | 16px / 1.5 | 16px / 1.5 | 400 | 0 | Sentence | context |
| Button | 15px / 1 | 15px / 1 | 500 | -0.005em | Sentence | context |
| Mono label / chip | 13px / 1.2 | 12px / 1.2 | 400 | -0.02em | Sentence | context |
| Mono caption | 12px / 1.3 | 12px / 1.3 | 500 | +0.06em | UPPERCASE | muted |
| Mono tx hash | 13px / 1.4 | 12px / 1.4 | 400 | 0 | as-is, truncate middle (0x12ab...9f0c) | muted or green |

Readability rules (stricter than Sui): no text under 12px; no body text under 16px; muted text only from the colour table below; headings never over the moving burst without the 40% black radial scrim at the center.

### 6.5 Colour roles

Brand: green #4EC397, orange #F99510. They have almost equal luminance (orange on green is 1.03:1). Never place one on the other for text or meaning. White on green is 2.19:1 and white on orange is 2.25:1: never use white text on either. Use black text on both.

Tokens (put these in `tokens.ts` or as CSS custom properties):

| Token | Hex | Role |
|---|---|---|
| ink.0 | #000000 | Page base, dark sections, text on fills |
| ink.1 | #111413 | Dark cards |
| ink.2 | #1C211F | Active row, raised dark surface |
| line | #38403C | 1px decorative borders and rail on dark (decorative only) |
| lineStrong | #6B7570 | Borders that carry meaning (inputs, toggles, focus fallback) |
| muted | #8C9691 | Secondary text on dark |
| paper | #FFFFFF | Light sections |
| paper.2 | #F2F5F3 | List rows on light |
| chip | #E0E6E3 | Mono chip background on light |
| mutedLight | #56605B | Secondary text on light |
| green | #4EC397 | Primary fill: buttons, icon tiles, active bar, progress marker, "verified" chip; green text on dark |
| green.deep | #137452 | Green TEXT on light backgrounds (links, "verified" word) |
| green.tint | #DDF3EA | Selected row on light |
| orange | #F99510 | Signal: "REFUSED"/"FROZEN" chips (black text), orange text on dark, the arc |
| orange.deep | #A65800 | Orange TEXT on white only |
| orange.tint | #FFE7C7 | Warning row on light (black text only) |

WCAG contrast for every pair we use (AA: 4.5 normal text, 3.0 large text 24px+ or 19px bold, 3.0 UI components):

| Text / element | Background | Ratio | Result | Use |
|---|---|---|---|---|
| #FFFFFF | #000000 | 21.00 | AAA | Display and body on dark |
| #FFFFFF | #111413 | 18.53 | AAA | Text in dark cards |
| #FFFFFF | #1C211F | 16.32 | AAA | Text in active rows |
| #8C9691 muted | #000000 | 6.89 | AA | Secondary text on dark |
| #8C9691 muted | #111413 | 6.08 | AA | Secondary text in cards |
| #8C9691 muted | #1C211F | 5.35 | AA | Secondary text in active rows |
| #4EC397 green | #000000 | 9.58 | AAA | Green labels, hashes, numbers on dark |
| #4EC397 green | #111413 | 8.45 | AAA | Green text in cards |
| #4EC397 green | #1C211F | 7.44 | AAA | Green text in active rows |
| #F99510 orange | #000000 | 9.33 | AAA | Orange text on dark (refused, frozen) |
| #F99510 orange | #111413 | 8.24 | AAA | Orange text in cards |
| #F99510 orange | #1C211F | 7.25 | AAA | Orange text in active rows |
| #000000 | #4EC397 green | 9.58 | AAA | Primary button label, verified chip |
| #111413 | #4EC397 green | 8.45 | AAA | Icon glyph in green tile |
| #000000 | #F99510 orange | 9.33 | AAA | REFUSED / FROZEN chip |
| #000000 | #FFFFFF | 21.00 | AAA | Statement and body on light |
| #000000 | #F2F5F3 | 19.13 | AAA | List rows on light |
| #000000 | #E0E6E3 | 16.60 | AAA | Mono chip on light |
| #000000 | #DDF3EA | 18.08 | AAA | Selected row on light |
| #000000 | #FFE7C7 | 17.51 | AAA | Warning row on light |
| #56605B mutedLight | #FFFFFF | 6.52 | AA | Secondary text on light |
| #56605B mutedLight | #F2F5F3 | 5.94 | AA | Secondary text in rows |
| #137452 green.deep | #FFFFFF | 5.76 | AA | Green links on light |
| #137452 green.deep | #F2F5F3 | 5.24 | AA | Green text in rows |
| #137452 green.deep | #DDF3EA | 4.96 | AA | Green text on selected row |
| #A65800 orange.deep | #FFFFFF | 5.23 | AA | Orange text on white |
| #A65800 orange.deep | #F2F5F3 | 4.76 | AA | Orange text in rows |
| #6B7570 lineStrong | #000000 | 4.40 | Passes 3.0 (UI) | Toggle and input borders on dark |
| #6B7570 lineStrong | #111413 | 3.89 | Passes 3.0 (UI) | Toggle borders in cards |

Forbidden pairs (measured): #F99510 on #4EC397 1.03; #FFFFFF on #4EC397 2.19; #FFFFFF on #F99510 2.25; #4EC397 on #FFFFFF 2.19; #F99510 on #FFFFFF 2.25; #A65800 on #FFE7C7 4.36 (fails for small text). #38403C line is 1.97 on black: decorative only, never the only cue.

Accent budget per viewport: green fills no more than about 10% of the area (buttons, tiles, one bar). Orange appears only where something was refused, frozen or warned, plus the footer arc.

### 6.6 Motion

Global: Lenis smooth scroll (lerp 0.1, wheelMultiplier 1). GSAP 3.13+ (all plugins, including SplitText, are free) with ScrollTrigger. Register eases: `CustomEase.create("pmInOut", "0.645,0.045,0.355,1")` (Sui's most used curve, same as power2.inOut) and `CustomEase.create("pmOut", "0.16,1,0.3,1")` (same as expo.out). All motion stops under `prefers-reduced-motion: reduce`: show final states, render one static burst frame, no pinning.

| # | Animation | Trigger | Duration | Easing | What moves | GSAP / implementation |
|---|---|---|---|---|---|---|
| M1 | Hero streak burst | page load, loops | continuous; one zoom cycle about 3s | linear per frame | About 700 radial streaks fly outward from a dark center; colours from #4EC397 to #137452 to white at 20% alpha; 1 in 40 streaks orange | Canvas 2D in a fixed full-viewport layer; requestAnimationFrame; DPR capped at 2; pause when the hero is out of view (IntersectionObserver). |
| M2 | Hero intro | load, after fonts ready | 0.9s, stagger 0.08s | pmOut | H1 words rise 40% and fade in; subline, then buttons, fade up 12px | `SplitText(h1,{type:"words"})`, `gsap.from(words,{yPercent:40,opacity:0,stagger:0.08,duration:0.9,ease:"pmOut"})`. |
| M3 | Curtain | scroll | tied to scroll | none | White section slides over the fixed hero; burst dims to 30% and scales to 1.12 | CSS: hero `position:fixed`, next section `position:relative; z-index:1; background:#fff`. `gsap.to(canvas,{opacity:0.3,scale:1.12,scrollTrigger:{trigger:"#problem",start:"top bottom",end:"top top",scrub:true}})`. |
| M4 | Proof ticker | always | 40s per loop | linear | Row of tx hashes moves left; pauses on hover | Duplicate the row once; `gsap.to(track,{xPercent:-50,duration:40,ease:"none",repeat:-1})`. |
| M5 | Statement reveal | statement top at 80% of viewport | 1.0s, stagger 0.06s per line | pmOut | Each line slides up from a mask | `SplitText(p,{type:"lines",mask:"lines"})`, `from(lines,{yPercent:100,stagger:0.06,duration:1})`, `scrollTrigger:{start:"top 80%",once:true}`. |
| M6 | Guarantee rows | each row top at 85% | 0.6s, stagger 0.05s | pmOut | Row text fades up 16px, dashed rule draws left to right, icon tile scales 0.6 to 1 | `ScrollTrigger.batch(rows,{onEnter:...})`; rule is `scaleX` from 0 with `transform-origin:left`. |
| M7 | Stripe wipe | section enters top | pinned for 100% of viewport height | scrub | 40 vertical stripes in green shades (random widths 4 to 60px) slide horizontally at different speeds, then the center fades to black and the 88px heading fades in | Pin the section (`pin:true,end:"+=100%",scrub:0.6`), timeline: stripes `xPercent` by -20 to 20, `backgroundPosition`; then a radial black mask `opacity` 0 to 1, heading `opacity` and `y` 24 to 0. Optional `snap:1`. Mobile: no pin, 60vh static stripes with a 1s autoplay fade. |
| M8 | Milestone rail | section scroll | scrub | none for marker, pmInOut for card state | White square marker travels down the dotted rail; each card slides up 60px and fades in; the active card's SVG strokes draw and its key shape fills green | Marker: `gsap.to(marker,{y:railHeight,scrollTrigger:{trigger:rail,start:"top center",end:"bottom center",scrub:true}})`. Per card: `ScrollTrigger.create({trigger:card,start:"top 70%",end:"bottom 40%",toggleClass:"is-active"})`; strokes via `stroke-dashoffset` over 1.2s. |
| M9 | ASCII shield | section enters | 1.6s | steps(12) | Characters of the shield text mask scramble from random glyphs to hashes, then hold | Canvas or pre element; scramble with a small custom loop (no paid plugin needed). |
| M10 | Heading word reveal (agent, proof) | heading top at 75% | 0.9s, stagger 0.05s | pmOut | Words rise from masks; muted words turn white one by one while scrubbing | SplitText words + `scrub:true` colour tween from #8C9691 to #FFFFFF. |
| M11 | Live counters | counter enters | 1.4s | power2.out | Number counts from 0 to the live value; then ticks on each new on-chain event | `gsap.to(obj,{val:target,onUpdate:render})`; poll Base Sepolia every 15s. |
| M12 | Freeze toggle | click | 0.35s | pmInOut | Agent row changes from green "ACTIVE" chip to orange "FROZEN" chip; row tint changes; a mono log line types in | Plain CSS transitions plus a GSAP timeline. |
| M13 | Accordion rows | hover (desktop), tap (mobile) | 0.4s | pmInOut | Row background to ink.2; green icon tile slides in from the left (x -24 to 0); title shifts right 56px; description and full-width green action bar expand (height auto) | `gsap.to(row,{height:"auto"})` or CSS grid-rows 0fr to 1fr. Only one row open. |
| M14 | Footer bar field | footer in view | continuous | sine.inOut | 120 vertical green bars change height like a skyline of container stacks; one orange arc above | Canvas 2D; heights from summed sine waves; pause when not visible. |
| M15 | Micro-interactions | hover/focus | 0.2s | pmInOut | Buttons: fill darkens (green to #3FAE84), arrow glyph moves 4px right. Nav links: boxed "+" rotates 45 degrees. Focus: 2px green outline, 2px offset | CSS transitions only. |

### 6.7 Signature interactions to recreate

1. **Milestone rail (M8).** The core of the page. It turns "conditional settlement" into something you scroll through: one card per step, the marker shows where the money is, and the active card lights green. Step 05 "Release" should show the amount moving from the contract to the supplier, as a mono line.
2. **Stripe wipe (M7).** The one "wow" transition between the light explanation and the dark proof world. Use only green shades; let one thin orange stripe pass through at 60% progress as a hint of the refused-attack section.
3. **Hover accordion with action bar (M13)** for pricing and final CTAs.
4. **Our own addition, the freeze toggle (M12).** In the bank desk section, a real-looking agent row with an "Agent: ACTIVE" chip and a "Freeze" button. Pressing it switches to "FROZEN" (orange chip, black text) and prints a mono log line with a tx hash. Wire it to the demo contract if available; otherwise label it "Simulation".

### 6.8 Components

- Buttons: radius 0, height 48px, padding 0 24px, 15px/500. Primary: green fill, black text. Secondary: white fill, black text. On light sections, secondary is black fill, white text. Primary and secondary sit edge to edge with no gap (Sui pattern), each min 160px wide. Mobile: full-width, stacked, 52px tall.
- Mono chip: 12 to 13px Geist Mono, padding 6px 8px, radius 0. Light: #E0E6E3 bg, black text. Status chips: green bg + black text (VERIFIED, ACTIVE), orange bg + black text (REFUSED, FROZEN).
- Icon tile: 40px square, green fill, 20px glyph in #111413 (1.5px stroke icons, for example Lucide).
- Dark card: ink.1 background, 1px `line` border, 24px padding, header row with icon and mono label, footer action bar 44px tall in green with black text.
- Tree list: Geist Mono 13px, each item prefixed with "└─ " in muted colour, item text white (dark) or black (light).
- Rail: 1px dotted line (`line` colour, 2px dash, 6px gap) at the column center; marker 8px white square.

### 6.9 Imagery approach (instead of their assets)

- No photography, no 3D renders, no stock video.
- Hero: the procedural streak burst (M1), drawn in code.
- Step cards: hand-built SVG wireframe isometrics on a 30 degree grid, 1px strokes in `line` colour with the active element filled green: contract vault (Lock), container on a ship deck (Ship), document with a seal (Proof), checkmark shield (Verify), crane lowering a container to a truck (Release), two stacked bars (Agent). Ship, crane and container echo our logo; the orange arc from the logo appears only as a thin stroke on the Release card.
- Proof section: real tx hashes, block numbers and BaseScan links as the visual texture.
- ASCII shield: our shield outline used as a text mask, filled with short hashes.
- Logo: use `brand/porthmos-mark.png` as delivered, small (32px) in the nav and footer. Do not recolour it or put it on green or orange.

### 6.10 Build notes (1 day, React)

- Stack: React + Vite, GSAP 3.13+ with ScrollTrigger and SplitText, Lenis, Canvas 2D (no Three.js needed). Fonts from Google Fonts (Geist, Geist Mono) with `display=swap`.
- Order of work: tokens and type (1h), static sections with real copy (3h), M1 + M3 hero (1.5h), M8 rail (1.5h), M7 wipe (1h), M11/M12 live data and freeze (1h), M13 + footer (0.5h), mobile pass and reduced motion (0.5h).
- Performance: one canvas animating at a time; pause off-screen; total JS for motion under 120 KB gzip.

## 7. Do NOT copy

- Sui's name, droplet logo, wordmark, and any Sui product names (Walrus, Seal, Nautilus, DeepBook, SuiNS, Move).
- Any of Sui's text. This includes the hero line, the "rules" paragraph and its closing sentence about trusting rules instead of agents, list items such as "All-or-nothing settlement" and "Policy-enforced assets", the "Start building / coding / earning / connecting" rows, and the footer headings. Their message is close to ours, so write ours fresh and review it for echoes.
- Sui's accent blue #298DFF and its exact stripe composition. Rebuild the stripes in our greens with our own widths and timing.
- The hero burst video or canvas output, their isometric card illustrations, their ASCII "Move on Sui" art, and the footer bar-field asset. Draw our own.
- TWK Everett and TWK Everett Mono font files (commercial licence). Use Geist and Geist Mono.
- Partner logo marquee and the TVL figure. Show only our own real on-chain data; do not imply partners we do not have.
- From the runner-up and others: Due's globe and "MONEY BEYOND BORDERS" style headline wording, MetaMask's fox and display face, Sharplink's chrome renders, EverSwap's painted landscapes, Hut 8's 3D scene.

## 8. Method and files

- Candidate discovery: Awwwards SOTD archive pages 1 to 40 parsed (titles, tags, dates), then Awwwards site pages for award, score and live URL; live check with curl on 2026-10-17.
- Screenshots: Playwright CLI client (`playwright-core/lib/tools/cli-client/cli.js`, `run-code`) with system Chromium at `/usr/bin/chromium`.
- Computed styles: `getComputedStyle` on headings, paragraphs, buttons, mono labels; `document.fonts`; stylesheet scan for `cubic-bezier`; library detection on `window`.
- Files: `winner-sui/` (20 annotated frames), `screens/<site>/` (7 frames each for the top 10), `screens/triage-heroes-*.jpg`, this spec.
