# Porthmos launch film

A 3:50 launch film (1920x1080, 30 fps) built in [HyperFrames](https://github.com/heygen-com/hyperframes), plus a 1080x1080 cut of 0:00 to 0:45 with a 5 s end card (0:50 total). Script: `../SCRIPT.md`. Music and SFX timing: `../sound/cues.json` (3:50 time, written by `../sound/extend.py`).

Requires Node 22+ and FFmpeg. All fonts (Inter, JetBrains Mono, both OFL, licences in `assets/fonts/`), GSAP, the chain data and the facts are local, so a render makes no network requests.

## Commands

Run from `video/film/`.

```bash
(cd ../sound && .venv/bin/python extend.py)   # 3:50 soundtrack + cues (only after a sound change)
node scripts/sync-media.mjs          # footage + soundtrack into assets/, writes data/media.js and data/facts.js
npx hyperframes@0.8.169 lint
npx hyperframes@0.8.169 preview      # Studio preview

npx hyperframes@0.8.169 render --quality delivery --no-browser-gpu -o out/porthmos-launch.mp4
npx hyperframes@0.8.169 render -c compositions/square.html --quality delivery --no-browser-gpu -o out/porthmos-launch-square.mp4
node scripts/mux-audio.mjs out/porthmos-launch.mp4
node scripts/mux-audio.mjs out/porthmos-launch-square.mp4 50
```

Always run `mux-audio.mjs` after a render. HyperFrames' own audio mix comes out about 6.6 dB under the mastered soundtrack (-20.6 instead of -14 LUFS), so the script replaces the audio track with the mastered WAV (video stream copied). Result: -14.3 LUFS integrated, -1.1 dBTP.

Keep `--no-browser-gpu`: on this laptop the GPU path picks the Intel iGPU and corrupts the ASCII sea layer. The team photos live in the gitignored `assets/team/`, so a fresh clone renders the team card without faces.

Test counts and the other proof numbers live in `data/facts.json`. Edit it, run `sync-media.mjs`, then render. Real chain values are baked by `python3 scripts/bake-chain.py` (read-only RPC, no transactions) into `data/chain.json` / `data/chain.js`.

## Swapping footage

`scripts/sync-media.mjs` reads `../footage/manifest.json`, copies each clip the film uses to `assets/footage/<name>.mp4` and crops the 28 px "Test mode" banner (crop, then scale back up with the aspect kept). A clip that is missing gets a plain night-coloured stand-in, and `data/media.js` marks it as missing. A new take of an existing clip only needs a re-sync. Changing which part plays is one `<video>` element in the scene file:

- `data-start` / `data-duration`: where the clip sits in the scene (scene-local seconds).
- `data-media-start`: the in-point in the source. Use the `marks` in the manifest.
- `data-automation` with a `rate` lane: the speed ramp, `{t: seconds into the clip, v: speed}`, speed 0.1 to 10.
- Zoom: `FX.zoom(...)` keys in the scene script, `{ at, dur, scale, fx, fy }` (focal point as a fraction of the screen).

Clips in use: R1-intro and R1 (act 3), R2, R2-T3-approve and R3 (act 4), R4, R6-freeze and R6-exit (act 5), R7 (act 6). If `R6-exit.mp4` is missing, act 5 shows an explorer card for the real E5 exit transaction instead.

## Scene map

| Time | Act | File | Content |
|:-|:-|:-|:-|
| 0:00 | 0 Cold open | `compositions/act0-cold-open.html` | Typed agent line, orange glitch, "The transaction was valid." / "The decision was not." |
| 0:12 | 1 Reveal | `compositions/act1-reveal.html` | ASCII strait, mark rises, PORTHMOS, "The agent wallet for cross-border trade treasuries." (0:17.8), tagline, chips |
| 0:25 | 2 Problem | `compositions/act2-problem.html` | Three kinetic cards on 0:25, 0:29, 0:33 |
| 0:38 | 3 Create a treasury | `compositions/act3-treasury.html` | R1-intro, R1 ramped to the dashboard, zoom on the 100,000.00 balance |
| 0:58 | 4 Copilot | `compositions/act4-copilot.html` | R2: exact prompt, tier 2 executes (0x6e3c3172...). R2-T3-approve: approval card, "All 12 policy checks pass", owner signs, executed (0xf0b198f4...). R3 in Indonesian |
| 1:33 | 4b How it works | `compositions/act4b-how-it-works.html` | Architecture diagram, key split, tier ladder |
| 1:53 | 5 Try to break it | `compositions/act5-break-it.html` | R4 injection held, four refusal cards (5 s each), R6-freeze with the freeze tx, R6-exit with the exit tx |
| 2:40 | 6 TradeFlow | `compositions/act6-tradeflow.html` | R7 create order, milestone timeline: released 2:46, HELD 9.40 °C at 2:52, completed 2:58 |
| 3:06 | 7 Proof | `compositions/act7-proof.html` | 9 / 15 / tests (from facts.json) / 0, "Next" line |
| 3:22 | 7b Who it's for | `compositions/act7b-ask.html` | Who it is for, what is live, team, what we are looking for |
| 3:36 | 8 Outro | `compositions/act8-outro.html` | Logo and tagline, URL, team card |
| square 0:45 | end card | `compositions/sq-end.html` | Mark, positioning line, URL |

Shared pieces: `index.html` (root, sea layer, soundtrack), `compositions/square.html` (square root), `lib/sea.js` (the sign-in sea from `web/src/auth/sea.ts`, driven by timeline time), `lib/fx.js` (typing, glitch, stamps, zoom), `lib/timing.js` (sea opacity and sea events), `lib/film.css` (tokens, browser frame, chips, stamps).

## Where the numbers come from

- Every tx hash, block and status on screen: `data/chain.json`, from Base Sepolia receipts. The four refusals are also replayed with `eth_call` at their parent block, and the revert selector matches the error name.
- "All 12 policy checks pass": the app's own line in the R2-T3-approve clip (a tier-3 deposit runs 12 checks; tier 4 adds `bankConfigured` for 13).
- 9 contracts, 15 scenarios, test counts: `data/facts.json`.
- Tier ladder: the README tier table. Per-process keys: `service/aegis/supervisor.py`.
