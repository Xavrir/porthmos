# AEGIS Treasury web

React + Vite + TypeScript front end for AEGIS Treasury (FinTechathon 2026, Topic F). It reads the AEGIS service API (`docs/INTERFACES.md` §2) and `deployments/<chainId>.json` (§1.6), and signs EIP-712 approvals with an injected wallet, or with the public Anvil demo keys on chain 31337 only.

Pages: Landing (story and live system), Treasury, Copilot, Risk, Audit, Bank desk.

## Run

Node 20.19 or later.

```bash
cd web
npm install
npm run dev          # http://localhost:5173, proxies /api to http://localhost:8787
```

`predev` and `prebuild` copy `../deployments/*.json` (31337 and 84532) into `public/deployments/`. Copies are kept in `public/deployments/` too (re-included by `web/.gitignore`, since the repo root ignores those file names), so a build without the parent folder still has them.

| Variable | Default | Use |
|---|---|---|
| `AEGIS_API_TARGET` | `http://localhost:8787` | Where the dev and preview servers proxy `/api` |
| `VITE_API_URL` | empty (same origin) | Build-time API origin for a static deployment |
| `VITE_RPC_URL_31337` | `http://127.0.0.1:8545` | RPC for demo-identity transactions on Anvil |
| `VITE_RPC_URL_84532` | `https://sepolia.base.org` | Base Sepolia RPC |
| `VITE_CHAIN_ID` | `31337` | Chain to assume if `/api/health` omits `chainId` |
| `VITE_TARGET_CHAIN_ID` | `84532` in `.env.production` | Any value other than `31337` drops the demo-keys chunk from the build. `npm run dev` does not read `.env.production`, so local 31337 work keeps the demo identities |

## Build and checks

```bash
npm run build        # tsc -b, then vite build into dist/
npm run lint         # eslint, then tsc -b
npm run preview      # serve dist/ with the same /api proxy
```

## Recorded evidence

```bash
npm run evidence:sync    # regenerates src/replay/evidence.ts from ../deployments/evidence-84532.json
```

Run it whenever the evidence file changes, then commit the regenerated `src/replay/evidence.ts` (the Vercel build does not run it). The script maps each receipt-verified transaction to a replay "slot" by scenario and label (`scripts/sync-evidence.mjs`, `RULES`). A replay row shows a real hash, linked to `https://sepolia.basescan.org/tx/<hash>`, only when it states the same fact as the recorded transaction:

| Scenario | Shown as recorded | Still illustrative |
|---|---|---|
| E1 | Deposit 2,000.00 into Vault B (tier 3), at its real block and time (14 Oct 17:16:54 UTC), with the real darHash and evidenceHash | The DAR and Approval signatures (illustrative keys; the Approval fields are the real ones) |
| E2 (Depeg button) | Quarantine of Vault A, then Vault B | The exit redeems: the recorded exits were 500.00 and 900.18, which do not match the replay positions |
| E3 (New invoice button) | `setReserveFloor(8,499.70)` and the 1,099.82 redeem from Vault B | The second leg from Vault A that replay needs to cover its larger shortfall |
| E4c | Listed with its request id in the Audit evidence panel (no transaction exists) | |
| E4a, E4b, E4d, E5 | Scheduled (see below) | All, until recorded |

The refusals E4a (`BadSignature`), E4b (`NonceUsed`), E4d (`PriceOutOfBand`) and E5 (`Frozen`) can only be recorded after the 24-hour vault quarantine from E2 ends (chain time 15 Oct 17:18 UTC; the script reads the time from the evidence file's `failures`). Until then the landing "Refused by the contract" section, the Audit evidence panel, the Audit `?error=` banner and the Copilot decision view say that no reverted transaction exists yet and name the contract test that proves each refusal (`src/lib/proof.ts`: C3, C5, C16, C19, plus C8, C9, C12, C18, C24 for the test-only ones; 47 Foundry tests in `contracts/test`). Replay ledger rows for these refusals read "Refused in replay" and show no transaction.

The refusal slots (`e4a`, `e4b`, `e4d`, `e5-deposit`) accept only a mined, reverted transaction (`expected` is not `success` and `receiptStatus` is 0), so a setup transaction in the same scenario can never stand in for a refusal. Once the attack phase is recorded, `npm run evidence:sync` is enough: the tiles link straight to Basescan ("Reverted on Base Sepolia, block N"), the hero proof list adds the first reverted attack, and the "scheduled" wording disappears. To try a file without touching the real one: `EVIDENCE_SOURCE=/path/evidence.json EVIDENCE_TARGET=/tmp/evidence.ts npm run evidence:sync`.

In the E3 scenario the invoice amount is derived from the recorded floor (8,499.70 is 1.1 × 7,727.00 of outflows, so the invoice is 7,727.00 minus the replay's other obligations). When E4a to E5 are recorded, run the sync again. Their rows link automatically only if the slot rules match their labels; check the script's output line listing the recorded slots, and the amounts of the matching replay rows.

The Audit page has a "Recorded on Base Sepolia" panel that lists every scenario and transaction from the evidence file with Basescan links, whatever the mode.

## Deploying to Vercel

`vercel.json` sets the Vite framework, `npm run build`, output `dist`, and an SPA rewrite to `/index.html` for every path except `assets/`, `media/`, `deployments/` and the favicon. Set the Vercel project root to `web`.

## API address

The service address is chosen in this order: `?api=<url>` in the page address (saved in `localStorage` as `aegis.api`; `?api=` with no value clears it), then the saved value, then `VITE_API_URL` at build time, then the same origin. The neutral "Replay (recorded run)" chip in the top bar is also the settings control: it shows why the site is in Replay, the demo state ("recorded base run" or "changed by you", with "Reset demo"), and has a "Connect live service" field, prefilled with `http://localhost:8787`, plus "Switch to replay" and "Forget this address" when live.

For a presenter running the service on the same laptop as an https Vercel page: Chrome allows `http://localhost` from an https page, but the service must answer CORS for the Vercel origin, allow the `X-Aegis-Session` and `Content-Type` request headers, and answer Chrome's Private Network Access preflight with `Access-Control-Allow-Private-Network: true`.

## Modes

On a static host with no API address configured, the site starts in Replay without calling anything. On localhost, or with an address configured, it first calls `GET /api/health` (2.5 s timeout). Only a JSON body with `ok: true` (or `status: "ok"`) counts as live, so an SPA rewrite that answers `/api/health` with HTML cannot pass as a service.

- **Live**: the service answered `ok`. Data comes from the API; `/api/stream` is read with a `fetch` stream so the `X-Aegis-Session` header can be sent (EventSource cannot set headers). A session is opened with `POST /api/session` for the chosen identity.
- **Replay**: no service is configured, the service did not answer, or `?mode=replay` is in the URL. The whole API, including the event stream, runs inside the browser from recorded fixtures (`src/replay/`). The top bar shows a neutral "Replay (recorded run)" chip that explains this and can retry the live service. `?mode=live` forces a live probe. The choice is kept for the browser session.

Replay presents the Base Sepolia deployment (`deployments/84532.json`): Safe, module, registry, vaults and role addresses are real and link to Basescan. Transaction hashes come from the recorded evidence where a row matches it (see "Recorded evidence"); every other hash is an illustrative placeholder, shown unlinked with an "illustrative" tag.

Replay fixtures, all consistent with each other:

- A 10,000 USDC treasury for the sample client Harbour Lane Imports: 5,800.36 in the Safe, 2,204.42 in Vault A, 2,000.80 in Vault B, reserve floor 4,500.00 (payroll 2,400, suppliers 900, rent 500, hosting 200, buffer 500), policy v13.
- History from 13 to 15 Oct (times shown in UTC+8; "now" is 15 Oct 14:00): a first 1,500.00 deposit into Vault A, a prompt injection that could not become an action (E4c), `BadSignature` (E4a), `NonceUsed` (E4b), `PriceOutOfBand` (E4d), a hold, E1 (2,000.00 into Vault B, recorded), a bank freeze drill with a `Frozen` deposit and an exit that still ran (E5), and one tier 3 deposit of 1,250.00 into Vault B waiting for the owner. Only the recorded rows match chain time; the 13 Oct setup and attack rows predate the real deployment block and are narrative.
- Records for these actions carry real EIP-712 signatures over the Base Sepolia domain (chain 84532, the deployed module), made once with public test keys by a fixture script; `src/replay/recorded.ts` holds the output and no keys. They are labelled illustrative, because they are not the deployment's role keys. The page recovers every signer in the browser and compares it with the key that signed the record, so the tampered record genuinely fails. Records created live in Replay (for example after a correction) are shown as not signed, because Replay holds no keys.
- Stress lab scenarios: `depeg`, `liquidity`, `stale`, `obligation`, `restore`, played as a sequence of stream events.
- Four more sample bank clients, including one with a tier 4 escalation (Kestrel Components) and one whose ledger disagrees with the chain (Tidewater Logistics).

Replay keeps its scenario state for the browser tab: every change (a freeze, an approval, a settled obligation, a scenario) is saved in `sessionStorage` (`aegis.replay-state`, versioned, written in try/catch) next to the chosen seat (`aegis.seat`), so a reload or a direct link shows the same state and the same seat. "Reset demo" in the Replay panel, or the Restore scenario on Risk, returns to the recorded base run. A blocked storage simply means the state lasts for the page.

The landing hero rail and the chain strip under it share one source: when Base Sepolia answers, the rail shows the chain's values (Safe plus vault positions, reserve floor, freezes, policy version, price) and says "Base Sepolia now"; the Copilot and Audit swatches have no chain equivalent and say "Replay". When the RPC fails, the strip heading reads "Base Sepolia unreachable, showing replay" and every swatch says "Replay".

## Seats and sign-in

There is no password. The first visit to an app page (and the hero's "Try it as owner or bank") opens a seat chooser: "Business owner", "Bank risk officer", "Just look (read-only)". The header shows the seat and the mode side by side ("Viewing as: Owner ▾" and "Replay"), and a page that needs another seat shows an inline "Switch to …" (Bank desk gate, Copilot chat, the approval panel, owner-only Treasury actions).

- **Replay seat**: the chooser sets a viewpoint with no keys, kept in `sessionStorage` with the scenario state. The copy says "viewing as". Approvals use the recorded illustrative signature where one exists (the waiting 1,250.00 deposit and the Kestrel tier 4 escalation), or are submitted as simulated and marked so.
- **Live wallet**: connecting a wallet (wagmi, injected) reads `owner(safe)` and `bank(safe)` from the PolicyRegistry; the owner gets the owner seat, the bank gets the bank seat, any other wallet is read-only ("This wallet holds no AEGIS role"). If the registry cannot be read, the page falls back to `deployment.roles` and says so; the service checks the registry again. "Sign in" signs the service's session message with `personal_sign` (`src/lib/session.ts`, byte for byte the format in `service/README.md`: `AEGIS session`, role, checksummed address, chainId, ISO `issuedAt`) and posts `{role, address, signature, issuedAt}` to `/api/session`. Only after that does the header say "Signed in as".
- **Local test keys** (owner = Anvil account 1, bank = Anvil account 2). Shown only when the chain is 31337, and loaded only from `src/lib/demo/keys.ts` through a dynamic import. They sign the same session message. With `VITE_TARGET_CHAIN_ID` set to another chain the import is folded away at build time, so the keys are not in the bundle. These are the public Foundry test keys and must never hold value.

## Contract with the service

Endpoints, workflow states, tiers and error names are typed in `src/lib/types.ts` and `src/lib/vocabulary.ts` with the exact names from `docs/INTERFACES.md`. The HTTP client is `src/lib/api/http.ts`; the replay engine implements the same `AegisApi` interface (`src/lib/api/contract.ts`).

Shapes INTERFACES.md leaves open, which the web assumes and the service should confirm:

| Endpoint | Assumed shape |
|---|---|
| `GET /api/health` | `{ ok, chainId?, llm?, demo? }` |
| `POST /api/session` | `{ token, role, safe? }` |
| `GET /api/treasury` | `balances: { safeUsdc, total, vaults[{ address, name, shares, assets, everDeposited?, quarantined? }] }`, `reserve: { required, onchainFloor, inSync, scheduleHash?, buffer? }`, `deployable`, `fees?`, `depositedToday?`, `policy: { autoCap, dailyCap, bankLimit, frozen{owner,bank}, version, maxBandWidth?, maxOracleAge?, authorizerRevoked? }` |
| `GET /api/risk` | an array, or `{ vaults: [...] }`; each vault adds `address`, `name`, `position?`; `triggers` are strings |
| `GET /api/oracle` | `price` as an amount object or raw 8-decimal string; optional `history[{ t, price }]` |
| `GET /api/requests/{id}` | `{ id, createdAt, message, origin, state, history[{ state, at, note? }], actionCard?, dar?, approvals?, txHash?, revertReason?, explanation?, options? }` |
| `GET /api/approvals/pending` | array of `{ requestId, role, safe, client?, actionCard, createdAt, expiresAt }` |
| `GET /api/ledger`, `/api/events` | arrays (or `{ rows }`, `{ events }`); ledger rows carry `seq`, `kind`, `state`, `summary`, `prevHash`, `rowHash`, optional `txHash`, `revertReason`, `amount`, `tier`; bank sessions add `?safe=` to read another client |
| `GET /api/bank/clients` | array of `{ safe, name, riskScore, frozen, pendingEscalations, mismatches, total?, authorizerRevoked? }` |
| `GET /api/stream` | SSE with `event: <type>` and JSON `data`, or a JSON `{ type, data }` payload; types `state`, `ledger`, `risk`, `oracle`, `execution`, `policy`, `treasury`, `notice` |

Bank freeze, unfreeze and revoke have no API endpoint, so in live mode the bank desk sends `bankFreeze`, `bankUnfreeze` and `revokeAuthorizer` to the PolicyRegistry from the bank identity. The floor update after an obligation change is sent as returned by `POST /api/obligations` (`floorUpdate`), or rebuilt from `reserve.scheduleHash`.

## Design

Direction: "Colour chapters" from the `design-taste-frontend` skill (seed 1474189985, notes in `.taste-skill/`). Each chapter colour is a verdict and a page: blue acts (Copilot), red protects (Risk), black records and holds (Audit), navy is the bank (Bank desk), white is the treasury. One typeface (Albert Sans, self-hosted through `@fontsource`), square corners, no gradients, no resting shadows.

The Stress lab runs in Replay (scenarios play in the browser) and, live, only on chain 31337.

The landing page follows the skill fully. The five app pages keep its type, palette and spacing but use dashboard patterns: tables, chips, panels.

Photographs and footage are from open collections, shown in greyscale, credited in the landing footer, and none shows AEGIS or its users:

| File | Source | Licence |
|---|---|---|
| `public/media/time-lock-yale.jpg` | "Time lock", ArnoldReinhold, Wikimedia Commons | CC BY-SA 4.0 |
| `public/media/time-lock-brass.jpg` | "Time lock (4602596296)", plenty.r. from Frankfurt am Main | CC BY-SA 2.0 |
| `public/media/safe-patent-1826.jpg` | Jesse Delano's patent drawing for a safe, US Patent Office | Public domain |
| `public/media/safe-patent-1836.jpg` | James Matthews' patent drawing for a safe, US Patent Office | Public domain |
| `public/media/vault-door.jpg` | "Bank vault door", mapimaging (shown cropped to the door) | CC BY-SA 4.0 |
| `public/media/clock-mechanism.webm` and `.mp4` | "Montreal Clock Tower clock mechanism", Andy Mabbett | CC BY-SA 4.0 |

### Motion

GSAP (free, including SplitText and ScrollTrigger). The landing page loads its motion module (`src/pages/landingMotion.ts`, about 26 kB gzipped with the plugins) by dynamic import after fonts are ready; app pages use GSAP core only. Everything runs in one `gsap.matchMedia` context that reverts on unmount, and animates transform, opacity and clip-path only.

- Hero: SplitText masked line rise on load (a 2.5 s fallback shows the headline if the module never arrives), and a scroll-linked scale and drift on the time-lock photo.
- Live chain strip under the hero: reads Base Sepolia from the browser with viem (`src/lib/chain/live.ts`): Safe USDC balance, vault positions and quarantine flags, registry floor, freezes and policy version, price feed answer and age, latest block, recent `AegisExecuted` events from the module (getLogs in chunks of 200 blocks or fewer, cached in sessionStorage, polled every 15 s while the tab is visible). Its heading is "Base Sepolia right now (real chain)". Numbers count when they change. If the RPC fails the heading becomes "Base Sepolia unreachable, showing replay" and the values carry a "Replay values" tag.
- Seven gates: the one pinned section, desktop only (1101 px and wider), scrubbed over 1.5 screens of scroll. Scroll scrubs through the gates; a rail fills, gate names rise line by line, the colour field steps, and the last gate splits into Execute (the recorded E1 transaction) and Reject (`BadSignature`). Below 1101 px, or with reduced motion, the gates are a stacked list of coloured blocks with plain entrances.
- Reserve rows stagger in, the reserve bar fills with scaleX, and the two figures count up once. Incidents enter as a batch and the key sentence draws a 5 px bar. Refusal tiles enter in batches (opacity and a short rise; the names are never scrambled). Record fields reveal line by line and a tampered record flips to a red `BadSignature`.
- "It leaves first" and the bank panel each make one hard colour cut at a scroll point (white to red; open blue to frozen navy) with a word reveal; the vault door turns shut with the scroll.
- A 6 px chapter rail at the left edge (wide screens) takes the ink of the chapter under it. It is a pointer convenience only: `aria-hidden`, out of the tab order, and inert while hidden over the hero.
- App pages: figures count on change, the Copilot gate chain animates each gate as its state arrives, new Audit rows slide in, and the Bank desk deposits chip flips when a freeze changes.
- No smooth-scroll library: native scrolling keeps keyboard, anchor links and reduced motion intact.

`prefers-reduced-motion: reduce` turns all of this off: no pin, no hidden states, the headline shows at once, and the video stays paused.

## Screenshots

`screenshots/` holds full-page captures of every page at 1440 and 375 px in Replay mode, three flow captures (recorded owner approval executed, depeg handled, bank freeze), reduced-motion captures of the landing page (`landing-reduced-motion-*.jpg`), and the pinned seven-gates scene as a frame sheet (`gates-pin-frames.jpg`) and a short recording (`gates-pin-scroll.webm`). A static full-page capture shows the pinned scene's scroll distance as an empty band; the frames show what a visitor sees. `screenshots/report.json` records console errors (none), horizontal overflow (none) and unrevealed content (none) for each capture.
