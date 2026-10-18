"""Extended cut of the soundtrack (3:50) for the final film, built from the 3:00 arrangement. Deterministic.

    .venv/bin/python extend.py

The 3:00 music bed (music.build) is lengthened by repeating whole bars at bar boundaries (INSERTS, in 3:00 time),
so every downbeat stays on the 120 BPM grid. The SFX are laid fresh at their 3:50 times (EVENTS), then the same
duck, gates and master as build.py run on the result. Writes out/soundtrack.wav, out/music.wav, out/sfx.wav and
cues.json (in 3:50 time).
"""
import json
import os
import sys

import numpy as np
import soundfile as sf

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import build  # noqa: E402
import grid  # noqa: E402
import music  # noqa: E402
import sfx_build  # noqa: E402
from synth import SR, n_of  # noqa: E402

LENGTH = 230.0
BASE_DOWNBEATS = grid.downbeats()
END_SILENT = 229.6
QUIETER_FROM = 186.0
QUIETER_DB = -1.5
SEAM = 0.012

# (insert point in 3:00 time, copy start, copy end): each copies whole bars of the 3:00 music to the insert point.
INSERTS = [
    (82.0, 74.0, 82.0),
    (125.0, 109.0, 125.0),
    (125.0, 121.0, 125.0),
    (166.0, 162.0, 166.0),
    (170.0, 87.0, 101.0),
    (176.0, 172.0, 176.0),
]

SECTIONS = {
    'cold_open': (0.0, 12.0), 'reveal': (12.0, 25.0), 'problem': (25.0, 38.0), 'treasury': (38.0, 58.0),
    'copilot': (58.0, 93.0), 'how': (93.0, 113.0), 'break': (113.0, 160.0), 'tradeflow': (160.0, 186.0),
    'proof': (186.0, 202.0), 'ask': (202.0, 216.0), 'outro': (216.0, 230.0),
}

EVENTS = [e for e in grid.EVENTS if e[0] < 25.0 and e[1] not in ('tag_tick', 'chip_click')] + [
    (19.0, 'tag_tick', 'ui_tick', -17.0, 'tagline types'),
    (21.5, 'chip_click', 'ui_click', -14.0, 'Live on Base Sepolia chip'),
    *[e for e in grid.EVENTS if 25.0 <= e[0] < 58.0],
    (58.0, 'act_title', 'act_title', -8.0, '02 / Ask in plain words'),
    (64.0, 'card_slide', 'slide', -14.0, 'agent reply: 1,000 USDC into Vault B, tier 2'),
    (66.5, 'executed_ding', 'ding', -14.0, 'tier 2 deposit executed'),
    (70.5, 'card_slide', 'slide', -14.0, 'tier 3 approval card'),
    (75.5, 'confirm_click', 'ui_click', -12.0, 'owner signs the approval'),
    (78.0, 'executed_ding', 'ding', -13.0, 'tier 3 deposit executed'),
    (86.0, 'lang_tick', 'ui_tick', -16.0, 'asked in Indonesian'),
    (93.0, 'act_title', 'act_title', -8.0, '03 / How it works'),
    (95.0, 'diagram_tick', 'diagram_tick', -12.0, 'Safe, AegisModule, PolicyRegistry'),
    (100.0, 'diagram_tick', 'diagram_tick', -12.0, 'Copilot, policy engine, authorizer, executor'),
    (105.0, 'diagram_tick', 'diagram_tick', -12.0, 'five service processes'),
    (108.0, 'diagram_tick', 'diagram_tick', -12.0, 'tier ladder'),
    (113.0, 'act_title', 'act_title', -8.0, '04 / Try to break it'),
    (118.0, 'held_stamp', 'stamp', -5.0, 'HELD'),
    (123.5, 'refusal_stamp', 'stamp', -4.0, 'BadSignature'),
    (128.5, 'refusal_stamp', 'stamp', -4.0, 'NonceUsed'),
    (133.5, 'refusal_stamp', 'stamp', -4.0, 'PriceOutOfBand'),
    (138.5, 'refusal_stamp', 'stamp', -4.0, 'Frozen'),
    (147.5, 'freeze_toggle', 'toggle', -12.0, 'bank confirms the freeze'),
    (156.5, 'exit_ding', 'ding', -13.0, 'exit executes while frozen'),
    (160.0, 'act_title', 'act_title', -8.0, '05 / Pay on proof'),
    (166.0, 'release_ding', 'ding', -13.0, '200 USDC released'),
    (172.0, 'held_stamp', 'stamp_soft', -6.0, 'milestone 2 HELD'),
    (178.0, 'complete_ding', 'ding', -12.0, 'Order completed'),
    (186.0, 'proof_riser', 'riser', -6.0, 'riser apex into the proof montage'),
    (186.0, 'number_slam', 'slam', -3.0, '9 contracts'),
    (189.0, 'number_slam', 'slam', -3.0, '15 scenarios'),
    (192.5, 'number_slam', 'slam', -3.0, 'tests'),
    (197.0, 'number_slam', 'slam', -3.0, '0 ways to send money out'),
    (202.0, 'card_cut', 'card_cut', -10.0, 'who it is for'),
    (202.5, 'ask_tick', 'ui_tick', -16.0, 'for'),
    (204.5, 'ask_tick', 'ui_tick', -16.0, 'live'),
    (206.5, 'ask_tick', 'ui_tick', -16.0, 'team'),
    (208.5, 'ask_tick', 'ui_tick', -16.0, 'looking for'),
    (216.0, 'logo_sting', 'logo_sting', -5.0, 'logo returns'),
    (221.0, 'cta_tick', 'ui_tick', -16.0, 'CTA URL'),
    (225.0, 'team_tick', 'ui_tick', -16.0, 'team card'),
]


def new_time(t):
    return t + sum(b - a for at, a, b in INSERTS if at <= t)


def splice(x):
    """x: the 3:00 bed. Returns the 3:50 bed with INSERTS applied. Each part after the first starts SEAM early, and
    that pre-roll is crossfaded (equal power) under the end of the previous part, so the length is exact."""
    seam = n_of(SEAM)
    fade_in = np.sin(np.linspace(0, np.pi / 2, seam))[:, None]
    fade_out = np.cos(np.linspace(0, np.pi / 2, seam))[:, None]
    spans = []
    cur = 0
    for at in sorted({i[0] for i in INSERTS}):
        spans.append((cur, n_of(at)))
        spans += [(n_of(a), n_of(b)) for at2, a, b in INSERTS if at2 == at]
        cur = n_of(at)
    spans.append((cur, len(x)))
    out = x[spans[0][0]:spans[0][1]].copy()
    for i0, i1 in spans[1:]:
        pre = x[i0 - seam:i0]
        out[-seam:] = out[-seam:] * fade_out + pre * fade_in
        out = np.concatenate([out, x[i0:i1]])
    return out


def gates(n):
    t = np.arange(n) / SR
    g = np.ones(n)
    r = n_of(0.015)
    i0, i1 = n_of(build.SILENCE[0]), n_of(build.SILENCE[1])
    g[i0 - r:i0] = np.linspace(1, 0, r)
    g[i0:i1] = 0.0
    g[i1:i1 + r] = np.linspace(0, 1, r)
    g[t >= END_SILENT] = 0.0
    tail = (t > LENGTH - 2.5) & (t < END_SILENT)
    g[tail] *= np.clip((END_SILENT - t[tail]) / (END_SILENT - (LENGTH - 2.5)), 0, 1) ** 1.3
    lower = 10 ** (QUIETER_DB / 20)
    g *= np.where(t < QUIETER_FROM - 1, 1.0, np.where(t >= QUIETER_FROM, lower, 1 + (lower - 1) * (t - QUIETER_FROM + 1)))
    return g[:, None]


def cues(events):
    downbeats = {round(new_time(d), 3) for d in BASE_DOWNBEATS}
    shift = 0.0
    for at, a, b in INSERTS:
        start = at + shift
        downbeats |= {round(start + k * 2.0, 3) for k in range(int((b - a) / 2))}
        shift += b - a
    downbeats = sorted(downbeats)
    return {
        'length_s': LENGTH, 'sample_rate': SR, 'bpm': grid.BPM, 'beat_s': grid.BEAT,
        'note': '3:50 extended cut of the 3:00 arrangement: whole bars repeated at bar boundaries (extend.py INSERTS, '
                'in 3:00 time), so every beat stays on a 0.5 s multiple.',
        'sections': [{'name': k, 'start': a, 'end': b} for k, (a, b) in SECTIONS.items()],
        'act_titles': {'01': 38.0, '02': 58.0, '03': 93.0, '04': 113.0, '05': 160.0},
        'hard_cuts': [7.0, 12.0, 25.0, 29.0, 33.0, 38.0, 58.0, 93.0, 113.0, 160.0, 186.0, 202.0, 216.0],
        'silence': {'start': build.SILENCE[0], 'end': build.SILENCE[1]},
        'tense_hold': {'start': new_time(music.HOLD[0]), 'end': new_time(music.HOLD[1])},
        'fade_to_silence_by': END_SILENT,
        'downbeats': downbeats,
        'inserts_3m00_time': [{'at': at, 'copy_from': a, 'copy_to': b} for at, a, b in INSERTS],
        'events': events,
    }


def main():
    out = os.path.join(HERE, 'out')
    os.makedirs(out, exist_ok=True)
    print('music ...', flush=True)
    m, _ = music.build(out)
    m = m[:n_of(grid.LENGTH)]
    m = splice(m)
    n = n_of(LENGTH)
    assert abs(len(m) - n) <= 2, (len(m), n)
    m = np.pad(m, ((0, max(0, n - len(m))), (0, 0)))[:n]
    print('sfx ...', flush=True)
    grid.LENGTH = LENGTH
    grid.EVENTS = sorted(EVENTS, key=lambda e: e[0])
    s, events = sfx_build.build()
    m = m * 10 ** ((build.MUSIC_LUFS - build.lufs(m)) / 20)
    m = m * build.duck_from(s)[:, None]
    s = s * 10 ** (build.SFX_GAIN_DB / 20)
    g = gates(n)
    mix = (m + s) * g
    final, gain = build.master(mix)
    final *= g
    sf.write(os.path.join(out, 'soundtrack.wav'), final, SR, subtype='PCM_24')
    stems = {'music': m * g * gain, 'sfx': s * g * gain}
    peak = max(np.abs(x).max() for x in stems.values())
    stem_gain = min(1.0, 0.999 / peak)
    for name, x in stems.items():
        sf.write(os.path.join(out, f'{name}.wav'), x * stem_gain, SR, subtype='PCM_24')
    with open(os.path.join(HERE, 'cues.json'), 'w') as f:
        json.dump(cues(events), f, indent=1)
    print(f'soundtrack: {len(final) / SR:.3f} s, {build.lufs(final):.2f} LUFS, '
          f'true peak {build.true_peak_db(final):.2f} dBTP, master gain {20 * np.log10(gain):+.2f} dB')


if __name__ == '__main__':
    main()
