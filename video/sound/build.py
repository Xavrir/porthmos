"""Build the whole Porthmos soundtrack: music bed, SFX, mix, master, cues.json. Deterministic (fixed seeds).

    .venv/bin/python build.py

Writes out/music.wav and out/sfx.wav (stems at the master gain, before the limiter), out/soundtrack.wav (final mix,
180.0 s, 48 kHz stereo 24-bit, about -14 LUFS, true peak <= -1 dBTP), sfx/*.wav and cues.json.
"""
import json
import os
import sys

import numpy as np
import pyloudnorm as pyln
import soundfile as sf
from scipy import ndimage, signal

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import grid  # noqa: E402
import music  # noqa: E402
import sfx_build  # noqa: E402
from synth import SR, n_of  # noqa: E402

from earshot.forge import fx  # noqa: E402

TARGET_LUFS = -14.0
CEILING_DB = -1.3
MUSIC_LUFS = -16.0
SFX_GAIN_DB = 0.0
DUCK_DB = 4.0
SILENCE = (10.0, 10.5)
END_SILENT = 179.6


def lufs(x):
    return pyln.Meter(SR).integrated_loudness(x)


def true_peak_db(x):
    up = signal.resample_poly(x, 4, 1, axis=0)
    return 20 * np.log10(np.abs(up).max() + 1e-12)


def duck_from(sfx):
    env = ndimage.maximum_filter1d(np.abs(sfx).max(axis=1), n_of(0.03))
    env = ndimage.uniform_filter1d(env, n_of(0.02))
    rel = np.exp(-1 / (0.25 * SR))
    out = signal.lfilter([1 - rel], [1, -rel], env)
    out = np.maximum(out, env * 0.0)
    level = np.clip(out / 0.25, 0, 1)
    return 10 ** (-DUCK_DB * level / 20)


def gates(n):
    t = np.arange(n) / SR
    g = np.ones(n)
    r = n_of(0.015)
    i0, i1 = n_of(SILENCE[0]), n_of(SILENCE[1])
    g[i0 - r:i0] = np.linspace(1, 0, r)
    g[i0:i1] = 0.0
    g[i1:i1 + r] = np.linspace(0, 1, r)
    g[t >= END_SILENT] = 0.0
    tail = (t > 177.5) & (t < END_SILENT)
    g[tail] *= np.clip((END_SILENT - t[tail]) / (END_SILENT - 177.5), 0, 1) ** 1.3
    return g[:, None]


def master(mix):
    gain = 1.0
    for _ in range(6):
        y = fx.limit(mix * gain, ceiling_db=CEILING_DB, lookahead=0.003, release=0.12, true_peak=True)
        err = TARGET_LUFS - lufs(y)
        if abs(err) < 0.05:
            break
        gain *= 10 ** (err / 20)
    return y, gain


def cues(events):
    bars = grid.bars()
    return {
        'length_s': grid.LENGTH, 'sample_rate': SR, 'bpm': grid.BPM, 'beat_s': grid.BEAT,
        'meter': [{'from': s, 'beats_per_bar': bpb, 'bars': c, 'section': sec} for s, bpb, c, sec in grid.LAYOUT],
        'note': '120 BPM, every beat on a 0.5 s multiple. Four 2/4 bars (0:24, 0:37, 1:24, 2:11) shift the bar phase '
                'so the hard cuts and act titles fall on downbeats.',
        'sections': [{'name': k, 'start': a, 'end': b} for k, (a, b) in grid.SECTIONS.items()],
        'act_titles': {'01': 38.0, '02': 58.0, '03': 85.0, '04': 105.0, '05': 132.0},
        'hard_cuts': [7.0, 12.0, 25.0, 29.0, 33.0, 38.0, 58.0, 85.0, 105.0, 132.0, 158.0, 170.0],
        'silence': {'start': SILENCE[0], 'end': SILENCE[1]},
        'tense_hold': {'start': music.HOLD[0], 'end': music.HOLD[1]},
        'fade_to_silence_by': END_SILENT,
        'downbeats': [round(b['t'], 3) for b in bars],
        'beats': grid.beats(),
        'events': events,
    }


def main():
    out = os.path.join(HERE, 'out')
    os.makedirs(out, exist_ok=True)
    print('music ...', flush=True)
    m, _ = music.build(out)
    print('sfx ...', flush=True)
    s, events = sfx_build.build()
    n = n_of(grid.LENGTH)
    m, s = m[:n], s[:n]
    m = m * 10 ** ((MUSIC_LUFS - lufs(m)) / 20)
    m = m * duck_from(s)[:, None]
    s = s * 10 ** (SFX_GAIN_DB / 20)
    g = gates(n)
    mix = (m + s) * g
    final, gain = master(mix)
    final *= g
    assert len(final) == n
    sf.write(os.path.join(out, 'soundtrack.wav'), final, SR, subtype='PCM_24')
    stems = {'music': m * g * gain, 'sfx': s * g * gain}
    peak = max(np.abs(x).max() for x in stems.values())
    stem_gain = min(1.0, 0.999 / peak)
    for name, x in stems.items():
        sf.write(os.path.join(out, f'{name}.wav'), x * stem_gain, SR, subtype='PCM_24')
    print(f'stems: music + sfx = the mix before the limiter, at {20 * np.log10(stem_gain):+.2f} dB')
    with open(os.path.join(HERE, 'cues.json'), 'w') as f:
        json.dump(cues(events), f, indent=1)
    print(f'soundtrack: {len(final) / SR:.3f} s, {lufs(final):.2f} LUFS, true peak {true_peak_db(final):.2f} dBTP, '
          f'master gain {20 * np.log10(gain):+.2f} dB')


if __name__ == '__main__':
    main()
