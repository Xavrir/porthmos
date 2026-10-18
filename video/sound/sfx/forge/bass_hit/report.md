# forge subdrop: 'a deep low sub bass hit, a dark cinematic boom'

**Asked:** recipe `subdrop`, target 'a deep low sub bass hit, a dark cinematic boom', alternatives: 'a kick drum', 'an explosion', 'thunder', 'a low hum'; 0 reference recording(s); critic v2, mode designed.

**Budget:** strategy `es`, 64 critic-scored candidates (pop 12, 5 generations), no pre-screen, reps 1, tone weight 1.0, seed 31.
Took 0.2 min for the search: 60 renders, 60 scored (327.9 scored / min, 327.9 rendered / min; render 0.38 s, measurements 0.74 s, critic 9.86 s).

## Search

| gen | best total | this gen best | this gen median | passes | best tone dB | sigma | note |
|---|---|---|---|---|---|---|---|
| 1 | 3.68 | 3.68 | 2.77 | 5/12 | - | 0.220 |  |
| 2 | 3.68 | 3.58 | 2.62 | 3/12 | - | 0.144 |  |
| 3 | 3.87 | 3.87 | 3.17 | 8/12 | - | 0.094 |  |
| 4 | 3.87 | 3.78 | 3.32 | 9/12 | - | 0.061 |  |
| 5 | 3.95 | 3.95 | 3.56 | 11/12 | - | 0.040 |  |

## Picks

Chosen by a fixed rule: the strongest candidates whose parameters and sound differ (passing first), each re-rendered on 2 new seeds for the robust columns.

### subdrop_01 (subdrop_01.wav)
- critic: PASS total 3.95: match z +3.96 (best alternative +3.47); p_real 0.08 (not required: designed); sounds like: a sub bass drop, a deep sub bass, a kick drum; clean (no artifact or polish flag)
- robust (2 new seeds): mean 3.20, min 2.95, sd 0.25, pass rate 1.00
- AudioSet (held out, decided nothing): [('Sound effect', 0.148), ('Music', 0.125), ('Electronic music', 0.097)]
- params: `{"f0": 128.43292, "f1": 37.37482, "glide": 0.4736, "glide_curve": 1.20355, "bloom": 0.02533, "hold": 0.32308, "decay_db": 68.20614, "length": 2.93481, "harm": 0.00785, "harm_lp": 650.0, "click": 0.21171, "click_f": 3432.97866, "click_ms": 2.09727, "thump": 0.7954, "grit": 0.97736, "width": 0.14711, "room": 0.08121}` seed 988545677

### subdrop_02 (subdrop_02.wav)
- critic: PASS total 3.87: match z +3.87 (best alternative +3.33); p_real 0.36 (not required: designed); sounds like: a sub bass drop, a deep sub bass, a kick drum; clean (no artifact or polish flag)
- robust (2 new seeds): mean 3.73, min 3.69, sd 0.04, pass rate 1.00
- AudioSet (held out, decided nothing): [('Music', 0.18), ('Sound effect', 0.175), ('Electronic music', 0.114)]
- params: `{"f0": 97.16314, "f1": 37.26714, "glide": 0.34422, "glide_curve": 1.34471, "bloom": 0.01465, "hold": 0.3586, "decay_db": 85.75944, "length": 2.46566, "harm": 0.05098, "harm_lp": 481.69256, "click": 0.22766, "click_f": 3918.49316, "click_ms": 3.56323, "thump": 0.72428, "grit": 0.96644, "width": 0.21274, "room": 0.09167}` seed 1601121790


## Files

- WAVs: subdrop_01.wav, subdrop_02.wav
- compare.png: each pick next to its nearest reference (spectrograms, envelopes, 1/3-octave balance)
- audition.wav + audition.txt: made, ref, made, ref ... peak-matched
- report.json: everything above plus the whole search history
