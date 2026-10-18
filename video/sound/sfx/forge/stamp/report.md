# forge stamp: 'a heavy rubber stamp slammed down on paper on a desk, a deep thud'

**Asked:** recipe `stamp`, target 'a heavy rubber stamp slammed down on paper on a desk, a deep thud', alternatives: 'a kick drum', 'a door slam', 'a gunshot', 'a hand clap', 'a cardboard box dropped'; 0 reference recording(s); critic v2, mode designed.

**Budget:** strategy `es`, 128 critic-scored candidates (pop 12, 10 generations), no pre-screen, reps 1, tone weight 1.0, seed 12.
Took 0.8 min for the search: 120 renders, 120 scored (147.9 scored / min, 147.9 rendered / min; render 0.78 s, measurements 1.16 s, critic 46.72 s).

## Search

| gen | best total | this gen best | this gen median | passes | best tone dB | sigma | note |
|---|---|---|---|---|---|---|---|
| 1 | 2.58 | 2.58 | 0.90 | 0/12 | - | 0.220 |  |
| 2 | 2.58 | 2.21 | 1.44 | 0/12 | - | 0.182 |  |
| 3 | 2.58 | 2.36 | 1.89 | 0/12 | - | 0.151 |  |
| 4 | 2.58 | 2.46 | 1.59 | 1/12 | - | 0.125 |  |
| 5 | 2.68 | 2.68 | 1.90 | 1/12 | - | 0.103 |  |
| 6 | 2.69 | 2.69 | 1.75 | 0/12 | - | 0.085 |  |
| 7 | 3.07 | 3.07 | 2.33 | 4/12 | - | 0.071 |  |
| 8 | 3.11 | 3.11 | 2.65 | 5/12 | - | 0.058 |  |
| 9 | 3.11 | 3.11 | 2.68 | 7/12 | - | 0.048 |  |
| 10 | 3.11 | 3.01 | 2.45 | 5/12 | - | 0.040 |  |

## Picks

Chosen by a fixed rule: the strongest candidates whose parameters and sound differ (passing first), each re-rendered on 2 new seeds for the robust columns.

### stamp_01 (stamp_01.wav)
- critic: PASS total 3.11: match z +3.39 (best alternative +3.17); p_real 0.18 (not required: designed); sounds like: a snare hit, a kick drum, a punchy impact hit; clean (no artifact or polish flag)
- robust (2 new seeds): mean 3.05, min 2.89, sd 0.16, pass rate 1.00
- AudioSet (held out, decided nothing): [('Sound effect', 0.257), ('Clang', 0.158), ('Bang', 0.096)]
- params: `{"body_f": 180.82418, "body_drop": 0.068, "body_tau": 0.03123, "desk_f": 258.83037, "desk_db": -10.48968, "desk_tau": 0.07077, "slap_db": -14.77157, "slap_f": 1430.7798, "slap_ms": 20.64864, "clack_db": -22.92717, "clack_f": 3075.77278, "sub_db": -23.34479, "sub_f": 42.10017, "sub_tau": 0.18661, "sat": 3.94862, "rt60": 0.2856, "wet": 0.22888, "length": 0.61336}` seed 1893105216

### stamp_02 (stamp_02.wav)
- critic: PASS total 3.11: match z +3.34 (best alternative +3.07); p_real 0.04 (not required: designed); sounds like: a snare hit, a punchy impact hit, a kick drum; clean (no artifact or polish flag)
- robust (2 new seeds): mean 3.12, min 3.00, sd 0.12, pass rate 1.00
- AudioSet (held out, decided nothing): [('Sound effect', 0.317), ('Bang', 0.206), ('Drum', 0.125)]
- params: `{"body_f": 167.14122, "body_drop": 0.10552, "body_tau": 0.03213, "desk_f": 318.46675, "desk_db": -10.83036, "desk_tau": 0.06322, "slap_db": -15.56304, "slap_f": 1824.7923, "slap_ms": 27.46694, "clack_db": -28.93257, "clack_f": 3299.93365, "sub_db": -21.29022, "sub_f": 39.20805, "sub_tau": 0.17493, "sat": 1.0334, "rt60": 0.44852, "wet": 0.1921, "length": 0.61821}` seed 2114172697


## Files

- WAVs: stamp_01.wav, stamp_02.wav
- compare.png: each pick next to its nearest reference (spectrograms, envelopes, 1/3-octave balance)
- audition.wav + audition.txt: made, ref, made, ref ... peak-matched
- report.json: everything above plus the whole search history
