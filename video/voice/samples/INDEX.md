# Voice samples: V02 and V23

`samples.mp3` plays a, b, c in that order with 1 s of silence between them. Each sample is V02, 0.8 s of silence, then V23, normalized to -16 LUFS (EBU R128).

All samples use the cleaned reference, temperature 0.8, one take per sentence with 0.35 s between sentences, and a formant-preserving stretch (rubberband R3, at most 1.15x) toward 140 wpm. The stretch is necessary because this voice speaks at 155 to 180 wpm unstretched, whatever the `cfg_weight` (0.2 to 0.5 tested).

| Sample | Exaggeration | cfg_weight | Pace (wpm) V02 / V23 | Stretch V02 / V23 | Similarity to reference | Realness (earshot) | Clipped-recording hint |
|:-|-:|-:|-:|-:|-:|-:|-:|
| a | 0.35 | 0.50 | 140 / 140 | 1.15 / 1.15 | 0.923 | 0.81 | +2.1 (weak) |
| b | 0.50 | 0.45 | 138 / 140 | 1.00 / 1.11 | 0.933 | 0.86 | +1.9 (tentative) |
| c | 0.65 | 0.40 | 141 / 140 | 1.15 / 1.10 | 0.927 | 0.84 | +2.2 (weak) |

- **a**: The calmest read. All words are correct, but it needs the full 1.15x stretch on both lines, so it has the most time-stretch processing. The similarity score is the lowest of the three.
- **b (pick)**: The middle setting; earshot tags it "voice-over narration". All words are correct, V02 needs no stretch, and it has the highest similarity and realness scores. V23's first sentence took 3 tries because the first two takes were too fast.
- **c**: The most animated read. earshot tags it as "a woman speaking" rather than "voice-over narration". The ASR heard "Portmos", which suggests a weaker "th" in Porthmos. Its first sentence also needed re-rolls for pace.

How these were judged: transcripts from a local speech recognizer (every word correct in all three), speaker-embedding cosine against the reference (Chatterbox voice encoder), and `earshot describe` / `realness`. The reference itself tags "distorted clipped recording" at +3.4 (it has 16 clipped samples), so the weak hint in the samples comes from the source. These are measurements; listen before you approve. Stress on "PORTH-mos" cannot be confirmed by a recognizer.

Full render: `gen.py --setting b`. To swap, run `gen.py --setting a --lines all` (or `c`).

Note: the full render (`out/b/`) uses the same takes logic but edits each line to its slot: sentence pauses from 0.2 to 0.6 s and stretch up to 1.25x, picked per line to stay at or under 148 wpm and inside the slot where possible (`timing.json` records both values per line).
