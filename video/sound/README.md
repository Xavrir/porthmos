# Porthmos launch film: soundtrack

The whole soundtrack is made in code: no downloaded music, samples or recordings. The music bed is synthesized
with numpy / numba. The SFX come from [earshot](https://github.com/Leonxlnx/earshot) forge recipes (physical and
designed synthesis), and earshot is also used to listen to and check the result.

## Build

```bash
cd video/sound
uv venv --python 3.12 .venv
uv pip install --python .venv/bin/python torch --index-url https://download.pytorch.org/whl/cpu
uv pip install --python .venv/bin/python "earshot @ git+https://github.com/Leonxlnx/earshot@ce9c5251189a5b612592a382a8f9e6abeb7cd2df"

.venv/bin/python build.py        # about 1 minute, no models, no network
```

`build.py` writes:

| file | what |
|:-|:-|
| `out/soundtrack.wav` | final mix: 180.0 s, 48 kHz stereo 24-bit, -14.0 LUFS integrated, true peak -1.3 dBTP |
| `out/music.wav`, `out/sfx.wav` | stems at the master gain, before the limiter (music + sfx = the mix before limiting) |
| `out/music_stems/*.wav` | music bus parts (kick, drums, bass, pads, keys, vox, fx, reverb), for diagnosis |
| `sfx/*.wav` | every SFX source, one file per sound (pitched / multi-take sounds get `_1`, `_2`, ...) |
| `cues.json` | tempo map, downbeats, beats, sections and every SFX event, for syncing the picture |

The build is deterministic (fixed seeds). Two builds give byte-identical files.

## Extended cut (3:50)

`extend.py` builds the soundtrack for the final 3:50 film from this 3:00 arrangement: it repeats whole bars of the
music bed at bar boundaries (`INSERTS`, in 3:00 time), lays every SFX at its 3:50 time (`EVENTS`), lowers the ending
1.5 dB from 3:06, then ducks, gates and masters exactly like `build.py`. It writes `out/soundtrack.wav` (230.0 s,
about -14.3 LUFS, -1.3 dBTP), the stems and `cues.json` in 3:50 time. Run it after `build.py` when the film is the
3:50 cut: `.venv/bin/python extend.py`.

## Files

| file | role |
|:-|:-|
| `grid.py` | the tempo map and the SFX event list: the single source of truth for every time |
| `synth.py` | DSP building blocks (PolyBLEP oscillators from earshot, a time-varying SVF, reverb IRs, ping-pong delay, sidechain curves, FM) |
| `music.py` | the music: instruments, the arrangement on the grid, the mix bus |
| `sfx_build.py` | renders every SFX source and lays the events onto the SFX stem |
| `forge_sfx.py` | offline step: searches the hero SFX with `earshot forge` and stores the winners in `forged.json` |
| `recipes/stamp.py` | a forge recipe for the refusal stamp (earshot has no stamp recipe) |
| `forged.json` | recipe, parameters and seed of each forged sound; `build.py` re-renders from it without models |
| `check.py` | the earshot listening pass: measure, timeline, sheet, critique, realness, describe / match per SFX |

Run `forge_sfx.py` again only when a recipe or a target changes (about 30 to 60 s per sound; it loads the earshot
models, about 1.1 GB, cached in `.earshot/`). Run `check.py` after a build (about 3 minutes): it writes
`out/checks/*.json` and `out/sheet.png`. When `../film/out/porthmos-launch.mp4` exists, `check.py` passes it as
`--video` to the timeline, sheet and critique.

## Tempo map

120 BPM, so a beat every 0.5 s and every time in SCRIPT.md (also 1:56.5 and 2:01.5) is on a beat. No constant tempo
can put all the hard cuts on downbeats (0:25 to 0:29 is 4 s but 0:33 to 0:38 is 5 s), so four 2/4 bars move the bar
phase by one second:

| 2/4 bar | effect |
|:-|:-|
| 0:24 | downbeats move to 0:25, 0:27, 0:29, 0:31, 0:33 (the three problem cards) |
| 0:37 | downbeats move to 0:38 (act 01) and stay through 0:58 (act 02) |
| 1:24 | downbeats move to 1:25 (act 03), 1:45 (act 04) |
| 2:11 | downbeats move to 2:12 (act 05), 2:38 (proof montage), 2:50 (logo) |

Each 2/4 bar is a stop or a snare-roll pickup, so the phase change sounds like an edit, not a stumble.

## Music

D minor, dark minimal future garage. Chords (one per bar): Dm9, Bbmaj9, Gm9, Am7 (main) and Bbmaj9, F/A, Gm9, Am7
(lift); A7b9 on pickups; Ebmaj7/D for the tension hold; Dadd9 to resolve at the logo. Parts: 2-step and four-on-the-floor
drums with 16th swing and humanized timing, sub bass with glides, a reese bass in the break and the proof montage,
supersaw pads sidechained to the kick and filtered per section, offbeat FM electric-piano stabs, a pluck arpeggio,
formant "vocal" chops, a bell motif (the logo theme at 0:16, 1:25 and 2:50.5), water texture, risers, crashes, a hall
and a plate reverb, ping-pong delays, light tape wow / flutter, saturation and hiss.

| time | section | music |
|:-|:-|:-|
| 0:00 to 0:12 | cold open | low drone and water; cluster swell at 0:04; hard cut at 0:07 to one low note; silence 0:10.0 to 0:10.5; reversed chord swell into the drop |
| 0:12 to 0:25 | reveal | the drop (crash, kick, open pads), half-time drums, bell motif at 0:16 |
| 0:25 to 0:38 | problem | restrained 2-step (rim, then clap), about 3 dB under |
| 0:38 to 0:58 | treasury | full 2-step, arpeggio, stabs |
| 0:58 to 1:25 | Copilot | lift progression, stabs, vocal chops |
| 1:25 to 1:45 | how it works | light groove (kick on 1, rim, shaker), 8th arpeggio, snare roll and riser into 1:45 |
| 1:45 to 2:12 | try to break it | builds: reese opens, four-on-the-floor from 1:53, toms; stop at 2:11 |
| 2:12 to 2:38 | TradeFlow | steady groove; tense hold 2:24 to 2:30 (Ebmaj7/D, drums out); back at 2:30; riser 2:34 to 2:38 |
| 2:38 to 2:50 | proof | loudest part; kick and crash with each number slam |
| 2:50 to 3:00 | outro | Dadd9 and Bbmaj9 pads, bell motif, low D; fade to silence at 2:59.6 |

## Mix and master

The music bus is set to -16 LUFS and ducks up to 4 dB under loud SFX. Then a look-ahead true-peak limiter
(earshot `fx.limit`, ceiling -1.3 dBTP) and a gain loop to -14 LUFS integrated. Gates force the half second of silence
at 0:10 and silence after 2:59.6.

## SFX

| sound | source |
|:-|:-|
| bass hit, glitch, stamp, slam | `earshot forge` searches in designed mode (`forged.json`); the stamp uses `recipes/stamp.py` |
| everything else | earshot sound bank (forge v2 finals), aimed with its knobs: seed, pitch (D-minor notes), `dur`, `apex` |

`cues.json` gives, for each event, the cue time, the sound, its file, and the sync point (`onset` or `peak`): the cue
time is where that point lands. `starts_at` is where the file starts in the mix.
