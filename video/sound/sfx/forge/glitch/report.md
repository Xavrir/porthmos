# forge glitch: 'a short digital glitch stutter with bit-crushed noise bursts that speed up and cut off'

**Asked:** recipe `glitch`, target 'a short digital glitch stutter with bit-crushed noise bursts that speed up and cut off', alternatives: 'static noise', 'a camera shutter', 'a zipper', 'a typewriter'; 0 reference recording(s); critic v2, mode designed.

**Budget:** strategy `es`, 64 critic-scored candidates (pop 12, 5 generations), no pre-screen, reps 1, tone weight 1.0, seed 41.
Took 0.2 min for the search: 60 renders, 60 scored (305.9 scored / min, 305.9 rendered / min; render 0.46 s, measurements 0.31 s, critic 10.99 s).

## Search

| gen | best total | this gen best | this gen median | passes | best tone dB | sigma | note |
|---|---|---|---|---|---|---|---|
| 1 | 3.88 | 3.88 | 1.84 | 5/12 | - | 0.220 |  |
| 2 | 5.73 | 5.73 | 2.92 | 9/12 | - | 0.144 |  |
| 3 | 5.73 | 4.46 | 2.81 | 8/12 | - | 0.094 |  |
| 4 | 5.73 | 4.47 | 3.31 | 9/12 | - | 0.061 |  |
| 5 | 5.73 | 4.30 | 3.15 | 7/12 | - | 0.040 |  |

## Picks

Chosen by a fixed rule: the strongest candidates whose parameters and sound differ (passing first), each re-rendered on 2 new seeds for the robust columns.

### glitch_01 (glitch_01.wav)
- critic: PASS total 5.73: match z +5.73 (best alternative +2.13); p_real 0.06 (not required: designed); sounds like: a digital glitch, a stutter glitch transition, a cheap synthesized beep; clean (no artifact or polish flag)
- robust (2 new seeds): mean 5.41, min 5.21, sd 0.20, pass rate 1.00
- AudioSet (held out, decided nothing): [('Speech', 0.195), ('Sound effect', 0.172), ('Single-lens reflex camera', 0.087)]
- params: `{"dur": 0.77166, "crackle": 0.21571, "crackle_rate": 43.9514, "crackle_hp": 5451.4356, "crackle_db": -24.18443, "grid0": 0.04516, "grid1": 0.02415, "accel": 0.63704, "gate": 0.61426, "swell": 1.19853, "bits": 4.15081, "srate": 1844.4907, "tonal": 0.84493, "tone_f": 1107.98111, "fm": 0.47875, "slices": 2, "repeat": 0.33014, "rev": 0.48004, "pitch_step": -1.18236, "low_db": -29.29591, "decay": 1.1713, "lvl_jit": 7.60636, "floor_db": -55.403, "width": 0.44689, "hp": 654.22483, "bright": 5.57234, "drive": 1.65446, "end_tail": 0.00422, "pattern": 71, "skip": 0.35674, "accent_db": 8.7845}` seed 122000485

### glitch_02 (glitch_02.wav)
- critic: PASS total 4.53: match z +4.64 (best alternative +1.47); p_real 0.78 (not required: designed); sounds like: crisp hi-hats, a squishy wet squelch, a distorted clipped recording; clean (no artifact or polish flag); study targets: stereo corr 0.45 (target -0.3..0.4)
- robust (2 new seeds): mean 3.76, min 3.54, sd 0.22, pass rate 1.00
- AudioSet (held out, decided nothing): [('Scrape', 0.182), ('Crack', 0.099), ('Crushing', 0.085)]
- params: `{"dur": 0.45027, "crackle": 0.22246, "crackle_rate": 129.74599, "crackle_hp": 3475.05534, "crackle_db": -18.79715, "grid0": 0.02639, "grid1": 0.02389, "accel": 1.09058, "gate": 0.93706, "swell": 4.50341, "bits": 8.87706, "srate": 10172.1472, "tonal": 0.19222, "tone_f": 2090.28157, "fm": 5e-05, "slices": 3, "repeat": 0.89127, "rev": 0.08846, "pitch_step": 0.28422, "low_db": -17.98819, "decay": 2.27017, "lvl_jit": 6.59056, "floor_db": -55.79037, "width": 0.79748, "hp": 539.11613, "bright": -4.28421, "drive": 10.6604, "end_tail": 0.01674, "pattern": 183, "skip": 0.25944, "accent_db": 11.96291}` seed 1461113580


## Files

- WAVs: glitch_01.wav, glitch_02.wav
- compare.png: each pick next to its nearest reference (spectrograms, envelopes, 1/3-octave balance)
- audition.wav + audition.txt: made, ref, made, ref ... peak-matched
- report.json: everything above plus the whole search history
