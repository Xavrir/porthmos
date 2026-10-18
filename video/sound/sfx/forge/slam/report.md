# forge impact: 'a deep cinematic boom impact with a punchy attack'

**Asked:** recipe `impact`, target 'a deep cinematic boom impact with a punchy attack', alternatives: 'an explosion', 'thunder', 'a door slam', 'a kick drum'; 0 reference recording(s); critic v2, mode designed.

**Budget:** strategy `es`, 96 critic-scored candidates (pop 12, 8 generations), no pre-screen, reps 1, tone weight 1.0, seed 21.
Took 0.5 min for the search: 96 renders, 96 scored (200.6 scored / min, 200.6 rendered / min; render 5.86 s, measurements 2.78 s, critic 20.06 s).

## Search

| gen | best total | this gen best | this gen median | passes | best tone dB | sigma | note |
|---|---|---|---|---|---|---|---|
| 1 | 3.50 | 3.50 | 2.06 | 9/12 | - | 0.220 |  |
| 2 | 3.99 | 3.99 | 2.20 | 4/12 | - | 0.172 |  |
| 3 | 3.99 | 3.94 | 2.66 | 6/12 | - | 0.135 |  |
| 4 | 3.99 | 3.88 | 3.19 | 8/12 | - | 0.106 |  |
| 5 | 3.99 | 3.83 | 3.31 | 11/12 | - | 0.083 |  |
| 6 | 4.00 | 4.00 | 3.38 | 11/12 | - | 0.065 |  |
| 7 | 4.00 | 3.85 | 3.42 | 9/12 | - | 0.051 |  |
| 8 | 4.04 | 4.04 | 3.58 | 11/12 | - | 0.040 |  |

## Picks

Chosen by a fixed rule: the strongest candidates whose parameters and sound differ (passing first), each re-rendered on 2 new seeds for the robust columns.

### impact_01 (impact_01.wav)
- critic: PASS total 4.04: match z +4.33 (best alternative +3.05); p_real 0.84 (not required: designed); sounds like: a deep cinematic boom, a cinematic hit with a long tail, a big drum hit; polish: bumpy tail (+6 dB re-rise)
- robust (2 new seeds): mean 4.24, min 4.14, sd 0.10, pass rate 1.00
- AudioSet (held out, decided nothing): [('Explosion', 0.409), ('Bang', 0.321), ('Burst, pop', 0.313)]
- params: `{"pre": 1.2, "pre_level": 0.26062, "crack": 2.0, "crack_f": 1163.09091, "crack_ms": 4.61939, "debris": 0.95111, "blast": 0.02146, "blast_f": 2371.37469, "blast_tau": 0.14454, "body_f0": 172.57467, "body_f1": 48.74461, "drop_tau": 0.04511, "body_tau": 0.17296, "body_attack": 0.04408, "modes": 0.2887, "body": 1.2, "drive": 0.85029, "sub": 0.27145, "sub_f": 32.65069, "sub_semis": 12.88275, "sub_tau": 1.46417, "shell": 0.54432, "shell_lo": 256.95971, "roll": 1.01844, "roll_cut": 146.25359, "roll_hold": 2.61954, "roll_fall": 0.59424, "roll_rate": 1.51354, "roll_depth": 0.06313, "grain_rate": 18.14336, "grain_depth": 0.2772, "air": 0.0072, "air_f": 3306.30123, "hall_wet": 0.47482, "hall_rt": 6.0, "hall_damp": 0.61218, "width": 0.40136, "gate": 1.6, "gate_ms": 34.89566, "floor_db": -70.18595, "snap": 0.72346, "hall_tone": 6199.41194, "sheen": 1.32654, "sheen_ms": 4.69391, "sheen_f": 6119.32281, "pre_shape": 0, "gate_fall": 0.20167, "gate_db": 2.81522, "air_div": 0.65018, "grain_sharp": 4.17791, "air_q": 1.0775, "sheen_top": 8405.11723, "top": 14704.63157, "plate": 0.8025, "plate_f": 165.58226, "plate_tau": 1.28475, "scatter": 0.26296, "scatter_s": 2.12733, "grain_jit": 0.98524, "boom": 1.22565, "boom_f0": 83.79395, "boom_f1": 67.61128, "boom_drop": 0.14168, "boom_tau": 0.9, "boom_att": 0.00778, "boom_drive": 0.31493, "roll_in": 0.25073}` seed 1008905363

### impact_02 (impact_02.wav)
- critic: PASS total 4.00: match z +4.00 (best alternative +1.77); p_real 0.83 (not required: designed); sounds like: a cinematic hit with a long tail, a deep cinematic whoosh, a reverse cymbal swell; clean (no artifact or polish flag)
- robust (2 new seeds): mean 3.86, min 3.83, sd 0.02, pass rate 1.00
- AudioSet (held out, decided nothing): [('Bang', 0.45), ('Sound effect', 0.418), ('Music', 0.097)]
- params: `{"pre": 1.02179, "pre_level": 0.41113, "crack": 1.90648, "crack_f": 1100.97274, "crack_ms": 5.9725, "debris": 0.98803, "blast": 0.0, "blast_f": 3000.0, "blast_tau": 0.1013, "body_f0": 144.21481, "body_f1": 50.74227, "drop_tau": 0.04491, "body_tau": 0.16069, "body_attack": 0.01641, "modes": 0.20783, "body": 0.9287, "drive": 0.79699, "sub": 0.25804, "sub_f": 30.26826, "sub_semis": 10.35169, "sub_tau": 0.99134, "shell": 0.64009, "shell_lo": 260.0, "roll": 0.59627, "roll_cut": 181.16579, "roll_hold": 2.85448, "roll_fall": 0.63059, "roll_rate": 2.02152, "roll_depth": 0.0, "grain_rate": 18.36634, "grain_depth": 0.48367, "air": 0.04155, "air_f": 2500.0, "hall_wet": 0.37873, "hall_rt": 4.83101, "hall_damp": 0.63359, "width": 0.51267, "gate": 1.6, "gate_ms": 34.96282, "floor_db": -70.0, "snap": 0.71857, "hall_tone": 6591.87426, "sheen": 1.03137, "sheen_ms": 4.51949, "sheen_f": 5724.97307, "pre_shape": 0, "gate_fall": 0.18496, "gate_db": 1.38784, "air_div": 0.68467, "grain_sharp": 4.69528, "air_q": 1.2408, "sheen_top": 10397.13078, "top": 12933.86666, "plate": 0.7649, "plate_f": 223.68528, "plate_tau": 0.85803, "scatter": 0.46172, "scatter_s": 1.86195, "grain_jit": 0.92284, "boom": 1.31651, "boom_f0": 80.0, "boom_f1": 70.0, "boom_drop": 0.15, "boom_tau": 0.41833, "boom_att": 0.00358, "boom_drive": 0.28907, "roll_in": 0.27036}` seed 155342370


## Files

- WAVs: impact_01.wav, impact_02.wav
- compare.png: each pick next to its nearest reference (spectrograms, envelopes, 1/3-octave balance)
- audition.wav + audition.txt: made, ref, made, ref ... peak-matched
- report.json: everything above plus the whole search history
