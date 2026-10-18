# Porthmos product footage: recording scripts

Records the R-clips of `video/SCRIPT.md` against the local production build, with a scripted mouse and keyboard.

## Setup

```sh
cd web
npx vite build --mode production --outDir /tmp/porthmos-dist --emptyOutDir   # uses web/.env.production
npx vite preview --outDir /tmp/porthmos-dist --port 4173 --strictPort --host localhost
```

The live API allows `http://localhost:4173` for CORS and `localhost:*` for SIWE. Chromium is `/usr/bin/chromium` and
Playwright is loaded from the mise install (override with `CHROME_PATH` and `PLAYWRIGHT_PATH`).

## Run

```sh
cd video/footage/record
node record.mjs R1          # sign-up on a fresh profile, once only
node record.mjs R1C         # continue an interrupted sign-up in the same profile
node record.mjs R2 R3 R4    # Copilot clips, one owner session
node record.mjs R7 R8       # create an order, dashboard B-roll
node record.mjs R7E6        # the recorded E6 order in demo (replay) mode, no wallet
node build.mjs              # copies the newest takes to footage/, writes manifest.json and contact-sheet.png
node smoke.mjs              # pipeline check: opens the wallet picker only
```

To keep an older take, name its folder in `takes/selected.json`, for example `{"R2": "R2-2026-10-18T06-01-00-000Z"}`.

## How it works

- **Wallet.** `lib.mjs` reads `.secrets/my-test-wallet.env` at runtime and signs in Node with viem. The page sees an
  EIP-1193 provider announced over EIP-6963 as "Porthmos Test Wallet", bridged with `page.exposeBinding`. It answers
  `personal_sign`, `eth_signTypedData_v4` and `eth_sendTransaction` (signed locally, sent to publicnode), refuses
  batching (`wallet_getCapabilities`), and proxies reads to the RPC. Like an extension, it exposes no account until
  the page asks. It only sends to the Safe proxy factory, the PolicyRegistry and the treasury Safe, never with value,
  and each run has a transaction cap. Every sent hash goes to `state/tx-log.jsonl`. The key is never logged.
- **Capture.** CDP `Page.startScreencast` (JPEG q96, every frame) at a 1920x1080 viewport, scale 1. Headless frames
  come at CSS pixel size, so a 110% zoom would only be upscaled; 1x gives native pixels. Frames are joined by their
  timestamps into constant 30 fps H.264 (CRF 16, yuv420p).
- **Cursor.** Headless capture has no OS pointer, so a cursor and click ripple are drawn in the page as a top-layer
  popover that stays above modal dialogs. Moves are eased curves of about 600 ms; typing is 40 to 70 ms per key.
- **Theme.** `porthmos.theme` is set to `dark` before each page loads.

`state/` (gitignored) holds the browser profile with the bank seat key, `recovery-bank-seat.json` after R1, the
treasury address, logs and the transaction log.
