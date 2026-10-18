"""The music bed: dark minimal future garage in D minor at 120 BPM, arranged on grid.py.

    python music.py            # writes out/music_raw.wav (unmastered music bus) and out/music_stems/*.wav
"""
import os
import sys

import numpy as np
import soundfile as sf

import grid
from synth import (FORMANTS, SR, butter, convolve, duck_curve, env_adsr, fm_note, hz, ir, n_of, noise, pan2,
                   pingpong, place, saw, shelf, svf, tanh_sat, tvec)

N = n_of(grid.LENGTH)
STEP = grid.BEAT / 4
SWING = 0.028
HERE = os.path.dirname(os.path.abspath(__file__))

CHORDS = {
    'Dm9': (38, [50, 57, 60, 64, 65]),
    'Bbmaj9': (34, [46, 53, 57, 60, 62]),
    'Gm9': (31, [43, 50, 53, 57, 58]),
    'Am7': (33, [45, 52, 55, 60, 62]),
    'Fmaj7/A': (33, [45, 53, 57, 60, 64]),
    'Asus': (33, [45, 52, 57, 62, 64]),
    'A7b9': (33, [45, 52, 55, 58, 61]),
    'Eb/D': (38, [51, 55, 58, 62, 69]),
    'Dadd9': (38, [50, 57, 62, 64, 65, 69]),
}
P1 = ['Dm9', 'Bbmaj9', 'Gm9', 'Am7']
P2 = ['Bbmaj9', 'Fmaj7/A', 'Gm9', 'Am7']
TRADE = ['Bbmaj9', 'Fmaj7/A', 'Gm9', 'Am7', 'Bbmaj9', 'Fmaj7/A', 'Eb/D', 'Eb/D', 'Eb/D', 'Bbmaj9', 'Fmaj7/A',
         'Gm9', 'A7b9']
PROGRESSIONS = {
    'cold_open': ['Dm9'] * 6, 'reveal': P1, 'reveal_pickup': ['Asus'], 'problem': P1, 'problem_pickup': ['A7b9'],
    'treasury': P1, 'copilot': P2, 'copilot_pickup': ['A7b9'], 'how': P1, 'break': P1, 'break_stop': ['A7b9'],
    'tradeflow': TRADE, 'proof': ['Dm9', 'Bbmaj9', 'Gm9', 'Am7', 'Dm9', 'A7b9'],
    'outro': ['Dadd9', 'Dadd9', 'Bbmaj9', 'Bbmaj9', 'Dadd9'],
}
HOLD = (144.0, 150.0)

MOTIF = [(0.0, 69, 0.5), (0.5, 74, 0.5), (1.0, 76, 0.5), (1.5, 77, 1.0), (2.5, 76, 0.5), (3.0, 72, 0.5),
         (3.5, 74, 2.5)]
VOX_PHRASE = [(2, 74, 2, 'a'), (6, 72, 2, 'o'), (10, 69, 5, 'a'), (18, 72, 2, 'e'), (22, 74, 2, 'o'),
              (26, 77, 4, 'a'), (34, 76, 2, 'o'), (38, 74, 2, 'a'), (42, 72, 5, 'o'), (52, 69, 2, 'a'),
              (56, 67, 2, 'o'), (58, 69, 5, 'a')]


def chord_bars():
    out = []
    count = {}
    for b in grid.bars():
        sec = b['section']
        k = count.get(sec, 0)
        count[sec] = k + 1
        prog = PROGRESSIONS[sec]
        out.append({**b, 'chord': prog[k % len(prog)], 'k': k, 'dur': b['beats'] * grid.BEAT})
    return out


def step_time(bar_t, s, swing=SWING):
    return bar_t + s * STEP + (swing if s % 2 == 1 else 0.0)


# ------------------------------------------------------------------------------------------------ drums
def kick(r, vel=1.0, tight=1.0):
    n = n_of(0.55)
    t = tvec(n)
    f = 47 + 105 * np.exp(-t / (0.028 * tight)) + 60 * np.exp(-t / 0.004)
    ph = 2 * np.pi * np.cumsum(f) / SR
    body = np.sin(ph) * np.exp(-t / 0.32) * np.minimum(1, t / 0.0015)
    body *= np.where(t > 0.38, np.exp(-(t - 0.38) / 0.04), 1.0)
    click = butter(noise(n, r), 'highpass', 3000) * np.exp(-t / 0.0035) * 0.22
    return vel * tanh_sat(body + click, 4.0) * 0.95


def clap(r, vel=1.0):
    n = n_of(0.6)
    t = tvec(n)
    e = np.zeros(n)
    for k, tk in enumerate((0.0, 0.0085, 0.017)):
        m = t >= tk
        e[m] += np.exp(-(t[m] - tk) / 0.0045) * (0.8 + 0.1 * k)
    m = t >= 0.024
    e[m] += np.exp(-(t[m] - 0.024) / 0.11)
    nz = butter(butter(noise(n, r), 'highpass', 900), 'lowpass', 6500)
    body = np.sin(2 * np.pi * 188 * t) * np.exp(-t / 0.045) * 0.5
    snap = butter(noise(n, r), 'highpass', 4000) * np.exp(-t / 0.012) * 0.3
    return vel * tanh_sat(nz * e * 0.6 + body + snap, 3.0) * 0.6


HAT_PARTIALS = np.array([205.3, 304.4, 369.6, 522.7, 540.0, 800.0]) * 1.82


def hat(r, vel=1.0, decay=0.035):
    n = n_of(min(1.2, decay * 7))
    t = tvec(n)
    metal = sum(np.sign(np.sin(2 * np.pi * f * t + r.uniform(0, 6.28))) for f in HAT_PARTIALS)
    src = 0.55 * metal / 6 + noise(n, r) * 0.6
    src = butter(butter(src, 'highpass', 7200, 4), 'lowpass', 15000, 2)
    return vel * src * np.exp(-t / decay) * np.minimum(1, t / 0.0006) * 0.5


def rim(r, vel=1.0):
    n = n_of(0.12)
    t = tvec(n)
    y = (np.sin(2 * np.pi * 1710 * t) * np.exp(-t / 0.016) + 0.7 * np.sin(2 * np.pi * 820 * t) * np.exp(-t / 0.03)
         + butter(noise(n, r), 'highpass', 2000) * np.exp(-t / 0.003) * 0.5)
    return vel * y * 0.35


def shaker(r, vel=1.0):
    n = n_of(0.12)
    t = tvec(n)
    e = np.minimum(1, t / 0.012) * np.exp(-t / 0.035)
    return vel * butter(butter(noise(n, r), 'highpass', 5000, 2), 'lowpass', 11000, 2) * e * 0.25


def crash(r, seconds=3.2, vel=1.0):
    n = n_of(seconds)
    t = tvec(n)
    out = []
    for _ in range(2):
        metal = sum(np.sign(np.sin(2 * np.pi * f * (1 + r.uniform(-0.02, 0.02)) * t)) for f in HAT_PARTIALS * 1.3)
        src = 0.4 * metal / 6 + noise(n, r)
        src = butter(src, 'highpass', 3800, 2)
        src = svf(src, 14000 - 9000 * (1 - np.exp(-t / 1.0)), 0.6)
        out.append(src * np.exp(-t / (seconds * 0.32)) * np.minimum(1, t / 0.002))
    return vel * np.stack(out, axis=1) * 0.22


def tom(r, f0=110, vel=1.0):
    n = n_of(0.45)
    t = tvec(n)
    f = f0 * (1 + 0.5 * np.exp(-t / 0.03))
    y = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.18)
    y += butter(noise(n, r), 'bandpass', [800, 4000]) * np.exp(-t / 0.01) * 0.2
    return vel * tanh_sat(y, 3.0) * 0.5


# ------------------------------------------------------------------------------------------------ tonal
def pad_chord(r, notes, seconds, attack=0.45, release=1.6, detune=0.11):
    n = n_of(seconds + release * 2.5)
    env = env_adsr(n, attack, 1.5, 0.85, release, seconds)
    out = np.zeros((n, 2))
    for m in notes:
        f = float(hz(m))
        for c, offs in enumerate(((-detune, 0.035), (-0.035, detune))):
            v = np.zeros(n)
            for cents in (offs[0] * 100, offs[1] * 100, 0.0):
                drift = 1 + 0.0015 * np.sin(2 * np.pi * r.uniform(0.1, 0.35) * tvec(n) + r.uniform(0, 6.28))
                v += saw(f * 2 ** (cents / 1200) * drift, phase=r.uniform(0, 1))
            v += 0.6 * np.sin(2 * np.pi * f * 0.5 * tvec(n))
            out[:, c] += v
    return out * env[:, None] / (len(notes) * 3.5)


def stab(r, notes, vel=1.0):
    seconds = 1.2
    out = np.zeros((n_of(seconds), 2))
    for j, m in enumerate(notes):
        y = fm_note(float(hz(m)), seconds, r, ratio=1.0, index=1.4, idecay=0.12, decay=0.35, attack=0.003, tine=0.25)
        out += pan2(y, (-0.4, 0.4, -0.15, 0.15, 0.0, 0.25)[j % 6])
    return vel * out / len(notes)


def pluck(r, m, vel=1.0, bright=1.0):
    n = n_of(0.7)
    t = tvec(n)
    f = float(hz(m))
    y = saw(f * 1.003, 0.7, r.uniform(0, 1)) + saw(f * 0.997, 0.7, r.uniform(0, 1))
    y = svf(y, 280 + 3600 * bright * np.exp(-t / 0.07), 1.1)
    return vel * y * np.exp(-t / 0.22) * np.minimum(1, t / 0.002) * 0.3


def bell(r, m, seconds=3.0, vel=1.0):
    f = float(hz(m))
    y = fm_note(f, seconds, r, ratio=3.5, index=1.2, idecay=0.5, decay=1.1, attack=0.002)
    y += 0.35 * fm_note(f * 2.0, seconds, r, ratio=1.41, index=0.8, idecay=0.2, decay=0.6, attack=0.002)
    return vel * y * 0.3


def vox(r, m, seconds, vowel='a', vel=1.0):
    n = n_of(seconds + 0.08)
    t = tvec(n)
    f = float(hz(m)) * (2 ** (-0.9 / 12) + (1 - 2 ** (-0.9 / 12)) * (1 - np.exp(-t / 0.035)))
    f = f * (1 + 0.006 * np.sin(2 * np.pi * 5.2 * t) * np.minimum(1, t / 0.25))
    src = saw(f, phase=r.uniform(0, 1)) + 0.08 * noise(n, r)
    fr, amps = FORMANTS[vowel]
    y = sum(a * butter(src, 'bandpass', [fc / 1.18, fc * 1.18], 1) for fc, a in zip(fr, amps))
    e = np.minimum(1, t / 0.012) * np.where(t > seconds, np.exp(-(t - seconds) / 0.03), 1.0)
    return vel * y * e * 0.5


# ------------------------------------------------------------------------------------------------ textures
def water(r, seconds, level=1.0):
    n = n_of(seconds)
    nz = noise(n, r, 'pink')
    slow = butter(r.standard_normal(n), 'lowpass', 0.6, 1)
    slow = (slow - slow.min()) / (np.ptp(slow) + 1e-9)
    fc = 350 + 900 * slow
    left = svf(nz, fc, 1.4, 'bp')
    right = svf(noise(n, r, 'pink'), fc[::-1].copy(), 1.4, 'bp')
    lap = 0.6 + 0.4 * np.sin(2 * np.pi * 0.11 * tvec(n) + np.cumsum(r.standard_normal(n)) * 1e-4)
    return level * np.stack([left, right], axis=1) * lap[:, None] * 0.25


def riser(r, seconds, f0=300, f1=9000):
    n = n_of(seconds)
    u = np.linspace(0, 1, n)
    fc = f0 * (f1 / f0) ** (u ** 1.6)
    out = np.stack([svf(noise(n, r), fc, 2.2, 'bp'), svf(noise(n, r), fc, 2.2, 'bp')], axis=1)
    tone = saw(hz(50) * 2 ** (2 * u ** 1.4), phase=0.0)
    tone = svf(tone, fc * 0.5, 1.0)
    out += pan2(tone * 0.3)
    return out * (u ** 2.2)[:, None] * 0.5


def snare_roll(r, start, end, buf):
    t = start
    while t < end - 1e-6:
        u = (t - start) / (end - start)
        dt = STEP if u < 0.5 else STEP / 2
        place(buf, clap(r, 0.25 + 0.7 * u ** 1.5), t, 1.0, r.uniform(-0.2, 0.2))
        t += dt


# ------------------------------------------------------------------------------------------------ arrangement
def section_drum_style(b):
    sec, t = b['section'], b['t']
    if sec == 'reveal':
        return 'drop' if b['k'] == 0 else 'half'
    if sec == 'problem':
        return 'garage_lite'
    if sec in ('treasury', 'copilot'):
        return 'garage'
    if sec == 'how':
        return 'light' if t < 101 else 'garage_lite'
    if sec == 'break':
        return 'garage' if t < 113 else 'drive'
    if sec == 'tradeflow':
        return 'hold' if HOLD[0] <= t < HOLD[1] else 'garage'
    if sec == 'proof':
        return 'drive'
    return None


def pad_cutoff(t):
    pts = [(0, 300), (7, 260), (12, 700), (24, 2400), (25, 1700), (37, 1900), (38, 2200), (57, 2600), (58, 3000),
           (84, 3300), (85, 1700), (104, 2100), (105, 1800), (130, 4800), (132, 2200), (143.9, 2300), (144, 700),
           (149.9, 900), (150, 2400), (157.9, 3200), (158, 3800), (169.9, 3800), (170, 4200), (176, 3200), (180, 900)]
    x, y = zip(*pts)
    return np.exp(np.interp(t, x, np.log(y)))


def compose(seed=124):
    r = np.random.default_rng(seed)
    bars = chord_bars()
    stems = {k: np.zeros((N, 2)) for k in ('kick', 'drums', 'bass', 'pads', 'keys', 'vox', 'fx')}
    kicks = []
    sub_f = np.zeros(N)
    sub_a = np.zeros(N)
    reese_a = np.zeros(N)

    def sub_note(t0, dur, midi, vel=1.0, reese=0.0):
        i0, i1 = int(t0 * SR), min(N, int((t0 + dur) * SR))
        sub_f[i0:i1] = float(hz(midi))
        a = np.ones(i1 - i0) * vel
        rel = min(len(a), n_of(0.05))
        a[-rel:] *= np.linspace(1, 0, rel)
        att = min(len(a), n_of(0.006))
        a[:att] *= np.linspace(0, 1, att)
        sub_a[i0:i1] = np.maximum(sub_a[i0:i1], a)
        if reese:
            reese_a[i0:i1] = np.maximum(reese_a[i0:i1], a * reese)

    def hit(kind, t, vel=1.0, pos=0.0, **kw):
        jit = r.normal(0, 0.0025) if kind not in ('kick',) else 0.0
        if kind == 'kick':
            place(stems['kick'], kick(r, vel, **kw), t)
            kicks.append(t)
        elif kind == 'clap':
            place(stems['drums'], clap(r, vel), t + jit, 1.0, pos)
        elif kind == 'hat':
            place(stems['drums'], hat(r, vel, **kw), t + jit, 1.0, pos)
        elif kind == 'rim':
            place(stems['drums'], rim(r, vel), t + jit, 1.0, pos)
        elif kind == 'shaker':
            place(stems['drums'], shaker(r, vel), t + jit, 1.0, pos)
        elif kind == 'tom':
            place(stems['drums'], tom(r, vel=vel, **kw), t, 1.0, pos)

    for b in bars:
        t0, steps, sec = b['t'], b['beats'] * 4, b['section']
        root, notes = CHORDS[b['chord']]
        style = section_drum_style(b)
        if steps == 8:
            style = None
        if style == 'drop':
            hit('kick', t0, 1.0)
            for s in range(8, 16, 2):
                hit('hat', step_time(t0, s), 0.25 + 0.1 * (s % 4 == 2), pos=0.25)
        elif style == 'half':
            hit('kick', t0, 1.0)
            if b['k'] % 2 == 1:
                hit('kick', step_time(t0, 11), 0.7)
            hit('clap', step_time(t0, 8), 0.9)
            for s in range(2, 16, 4):
                hit('hat', step_time(t0, s), 0.45, pos=0.25)
            for s in range(1, 16, 2):
                hit('shaker', step_time(t0, s), 0.4 + 0.3 * (s % 4 == 3), pos=-0.35)
        elif style in ('garage', 'garage_lite', 'drive', 'light'):
            ks = {'garage': [0, 10], 'garage_lite': [0, 10], 'drive': [0, 4, 8, 12], 'light': [0]}[style]
            if style == 'garage' and b['k'] % 4 == 3:
                ks = [0, 7, 10]
            if style == 'drive' and b['k'] % 2 == 1:
                ks = [0, 4, 8, 10, 12]
            for s in ks:
                hit('kick', step_time(t0, s, 0.0), 1.0 if s == 0 else 0.85)
            if style == 'light':
                for s in (4, 12):
                    hit('rim', step_time(t0, s), 0.8, pos=0.15)
            elif sec == 'problem' and t0 < 29:
                for s in (4, 12):
                    hit('rim', step_time(t0, s), 0.9, pos=0.15)
            else:
                for s in (4, 12):
                    hit('clap', step_time(t0, s, 0.0), 0.9)
            hat_steps = range(0, 16) if style in ('garage', 'drive') else range(2, 16, 2)
            for s in hat_steps:
                accent = 0.75 if s % 4 == 2 else (0.32 if s % 2 == 0 else 0.22)
                if style in ('light', 'garage_lite'):
                    accent *= 0.8
                hit('hat', step_time(t0, s), accent, pos=0.22 + 0.1 * np.sin(s))
            if style in ('garage', 'drive') and b['k'] % 2 == 1:
                hit('hat', step_time(t0, 14), 0.5, pos=-0.2, decay=0.22)
            if style in ('garage', 'drive'):
                for s in (3, 9, 15):
                    if r.random() < 0.6:
                        hit('rim', step_time(t0, s), 0.3, pos=-0.3)
            if style in ('light', 'garage_lite', 'drive'):
                for s in range(1, 16, 2):
                    hit('shaker', step_time(t0, s), 0.35, pos=-0.35)
            if style == 'drive':
                for s in range(0, 16, 4):
                    hit('hat', step_time(t0, s + 2), 0.35, pos=-0.4, decay=0.4)
                if b['k'] % 4 == 3:
                    for j, s in enumerate((12, 13, 14, 15)):
                        hit('tom', step_time(t0, s, 0.0), 0.8, pos=(-0.4 + 0.27 * j), f0=140 - 18 * j)
        elif style == 'hold':
            for s in range(2, 16, 4):
                hit('hat', step_time(t0, s), 0.25, pos=0.3)
            for s in (0, 8):
                hit('rim', step_time(t0, s), 0.35, pos=-0.2)

        bar_len = b['dur']
        if sec == 'cold_open':
            pass
        elif steps == 8:
            sub_note(t0, bar_len * 0.5, root, 0.8)
        elif style in ('drop', 'half'):
            sub_note(t0, bar_len - 0.02, root, 1.0)
        elif style == 'light':
            sub_note(t0, 1.0, root, 0.9)
            sub_note(t0 + 1.25, 0.7, root, 0.75)
        elif style == 'hold':
            for q in range(4):
                sub_note(t0 + q * grid.BEAT, 0.3, 38, 0.8)
        elif style is not None:
            reese = 0.0
            if sec == 'break':
                reese = 0.5 + 0.5 * (t0 - 105) / 26
            elif sec == 'proof':
                reese = 1.0
            pattern = [(0, 6, 0), (6, 3, 0), (10, 4, 0), (14, 2, 12 if b['k'] % 2 else 0)]
            if style == 'drive':
                pattern = [(0, 3, 0), (3, 3, 0), (6, 2, 12), (8, 3, 0), (11, 3, 0), (14, 2, 12)]
            for s, d, oct_ in pattern:
                sub_note(step_time(t0, s, 0.0), d * STEP - 0.01, root + oct_, 1.0, reese)

    # 2/4 pickups and stops: drums out, a short snare roll or reversed swell into the downbeat
    for t_pick, t_next in ((24.0, 25.0), (37.0, 38.0), (84.0, 85.0)):
        snare_roll(r, t_pick + 0.5, t_next, stems['drums'])
    snare_roll(r, 103.0, 105.0, stems['drums'])
    snare_roll(r, 129.0, 131.0, stems['drums'])
    snare_roll(r, 156.0, 158.0, stems['drums'])

    for t in (12.0, 25.0, 38.0, 58.0, 85.0, 105.0, 113.0, 132.0, 150.0, 158.0, 161.0, 164.0, 167.0, 170.0):
        vel = 0.55 if t in (25.0, 85.0) else 0.85
        place(stems['drums'], crash(r, 3.2, vel), t)
    for t in (12.0, 38.0, 58.0, 105.0, 132.0, 158.0, 170.0):
        rc = crash(r, 1.8, 0.7)[::-1].copy()
        place(stems['fx'], rc, t - len(rc) / SR)
    for t in (161.0, 164.0, 167.0):
        hit('kick', t, 1.0)

    # sub bass and reese from the note curves
    k = n_of(0.012)
    last = np.maximum.accumulate(np.where(sub_f > 0, np.arange(N), 0))
    sub_f[:] = np.where(sub_f[last] > 0, sub_f[last], float(hz(38)))
    logf = np.log(np.maximum(sub_f, 20.0))
    logf = np.convolve(np.pad(logf, (k, k), mode='edge'), np.ones(k) / k, mode='same')[k:-k]
    f = np.exp(logf)
    ph = 2 * np.pi * np.cumsum(f) / SR
    sub = (np.sin(ph) + 0.18 * np.sin(2 * ph) + 0.06 * np.sin(3 * ph)) * sub_a
    sub = tanh_sat(sub * 0.9, 2.0)
    stems['bass'] += pan2(sub) * 0.55
    if reese_a.any():
        idx = np.nonzero(reese_a)[0]
        a, z = idx[0], idx[-1] + 1
        fr = f[a:z] * 2
        l = saw(fr * 2 ** (-14 / 1200)) + saw(fr * 2 ** (9 / 1200), phase=0.3)
        rr = saw(fr * 2 ** (14 / 1200), phase=0.6) + saw(fr * 2 ** (-9 / 1200), phase=0.1)
        tt = np.arange(a, z) / SR
        cut = np.where(tt < 132, 380 + 1300 * np.clip((tt - 105) / 26, 0, 1), 1400)
        cut = cut * (1 + 0.35 * np.sin(2 * np.pi * tt * grid.BPM / 60 / 2))
        rs = np.stack([svf(l, cut, 1.4), svf(rr, cut, 1.4)], axis=1)
        rs = tanh_sat(butter(rs, 'highpass', 90, 2) * 0.6, 6.0) * reese_a[a:z, None]
        stems['bass'][a:z] += rs * 0.16

    # pads: one chord per bar, filtered by the section cutoff
    pad = np.zeros((N, 2))
    for b in bars:
        root, notes = CHORDS[b['chord']]
        if b['section'] == 'cold_open':
            if b['t'] in (0.0,):
                place(pad, pad_chord(r, notes, 6.4, attack=2.5, release=0.6), 0.0, 0.5)
            continue
        att = 0.02 if b['t'] in (12.0, 158.0, 170.0) else 0.35
        if HOLD[0] <= b['t'] < HOLD[1]:
            att = 0.8
        place(pad, pad_chord(r, notes, b['dur'], attack=att, release=1.4), b['t'], 1.0)
    cut = pad_cutoff(tvec(N))
    pad = svf(pad, cut, 0.9)
    pad = butter(pad, 'highpass', 110, 2)
    stems['pads'] += pad * 0.85

    # tension at the cold open (0:04 to 0:07): a minor-second cluster swelling under the orange line
    tn = n_of(3.0)
    tt = tvec(tn)
    clus = sum(saw(float(hz(m)) * (1 + 0.002 * j), 3.0, phase=0.1 * j) for j, m in enumerate((62, 63, 69, 75)))
    clus = svf(clus, 400 + 2600 * (tt / 3.0) ** 2, 1.2) * (tt / 3.0) ** 1.5 * 0.15
    place(stems['pads'], np.stack([clus, np.roll(clus, 220)], axis=1), 4.0)
    low = bell(r, 38, 3.0, 0.7) + 0.6 * np.sin(2 * np.pi * float(hz(26)) * tvec(n_of(3.0))) * np.exp(-tvec(n_of(3.0)) / 1.2)
    place(stems['keys'], low, 7.0, 0.8)

    # the reveal swell: a reversed reverberant Dm9 chord rising into the drop at 0:12
    sw = pad_chord(r, CHORDS['Dm9'][1], 1.2, attack=0.01, release=0.4)
    sw = convolve(sw, ir(r, 2.2, damp=0.3))[:n_of(1.5)][::-1].copy()
    sw *= np.linspace(0, 1, len(sw))[:, None] ** 1.5
    place(stems['fx'], sw, 12.0 - len(sw) / SR, 0.9)

    # EP stabs (offbeat garage stabs)
    for b in bars:
        if b['section'] not in ('treasury', 'copilot', 'tradeflow', 'proof') or b['beats'] != 4:
            continue
        if HOLD[0] <= b['t'] < HOLD[1]:
            continue
        root, notes = CHORDS[b['chord']]
        for s in ((3, 6, 11) if b['k'] % 2 == 0 else (3, 10)):
            place(stems['keys'], stab(r, [m + 12 for m in notes[1:]], 0.55), step_time(b['t'], s), 1.0)

    # pluck arpeggio
    arp_idx = [0, 2, 1, 3, 2, 4, 3, 1]
    for b in bars:
        sec = b['section']
        if sec not in ('treasury', 'how', 'break', 'proof') or b['beats'] != 4:
            continue
        root, notes = CHORDS[b['chord']]
        tones = sorted(set([m + 12 for m in notes] + [notes[1] + 24]))
        every = 2 if sec == 'how' else 1
        for s in range(0, 16, every):
            m = tones[arp_idx[(s // every) % len(arp_idx)] % len(tones)]
            v = 0.55 + 0.3 * (s % 4 == 0)
            bright = 0.5 + 0.5 * (sec in ('break', 'proof'))
            place(stems['keys'], pluck(r, m, v, bright), step_time(b['t'], s), 0.8, 0.35 * np.sin(s * 1.3))

    # vocal chops
    for t_start in (66.0, 74.0, 140.0, 158.0, 166.0):
        for s, m, d, v in VOX_PHRASE:
            t = t_start + s * STEP + (SWING if s % 2 else 0)
            if HOLD[0] <= t < HOLD[1] or t >= 170.0:
                continue
            place(stems['vox'], vox(r, m, d * STEP * 0.9, v, 0.8), t, 1.0, 0.2 * np.sin(s))

    # the Porthmos motif on a bell: logo rise, the How-it-works title, the logo return
    for t_m, lvl in ((16.0, 0.9), (85.0, 0.5), (170.5, 1.05)):
        for dt, m, d in MOTIF:
            place(stems['keys'], bell(r, m, 3.0, 0.8), t_m + dt * grid.BEAT, lvl, 0.3 * np.sin(m))

    # risers into the big downbeats
    for t_end, secs in ((25.0, 1.0), (105.0, 4.0), (131.0, 4.0), (158.0, 4.0)):
        place(stems['fx'], riser(r, secs), t_end - secs, 0.11)
    # outro: a long low D under the logo
    tail = n_of(9.5)
    tt = tvec(tail)
    low = np.sin(2 * np.pi * float(hz(38)) * tt) * np.minimum(1, tt / 0.01) * np.exp(-tt / 3.5)
    place(stems['bass'], pan2(low * 0.5), 170.0)

    # water texture through the film, louder in the cold open and the outro
    wt = water(r, grid.LENGTH)
    lvl = np.interp(tvec(N), [0, 7, 7.01, 10, 12, 20, 168, 172, 180], [1, 1, 0.4, 0.4, 0.6, 0.25, 0.25, 0.8, 0.8])
    stems['fx'] += wt * lvl[:, None] * 0.5

    return stems, kicks


ENERGY = [(0, 0), (12, 0), (24.9, 0), (25, -3.5), (37.9, -3), (38, -1.5), (57.9, -1), (58, 0), (84.9, 0),
          (85, -4.5), (100.9, -4), (101, -2.5), (104.9, -1), (105, -1.5), (130.9, 2), (131, 0), (132, 0),
          (143.9, 0), (144, -6), (149.9, -6), (150, 0), (157.9, 1), (158, 2.5), (169.9, 3), (170, 2), (180, 2)]


def energy_db(t):
    x, y = zip(*ENERGY)
    return np.interp(t, x, y)


def tape(x, r):
    """light tape character: slow wow and fine flutter (a modulated fractional delay), soft saturation, a hiss floor"""
    n = len(x)
    t = tvec(n)
    drift = butter(r.standard_normal(n), 'lowpass', 0.4, 1)
    drift /= np.abs(drift).max() + 1e-12
    d = 0.0009 + 0.00035 * np.sin(2 * np.pi * 0.47 * t) + 0.0002 * drift + 0.00004 * np.sin(2 * np.pi * 6.3 * t)
    pos = np.arange(n) - d * SR
    y = np.stack([np.interp(pos, np.arange(n), x[:, c]) for c in range(2)], axis=1)
    pk = np.abs(y).max()
    y = tanh_sat(y / pk, 1.5) * pk
    hiss = butter(np.stack([noise(n, r, 'pink'), noise(n, r, 'pink')], axis=1), 'highpass', 1500, 1)
    return y + hiss * pk * 10 ** (-68 / 20)


def mixdown(stems, kicks, seed=7):
    r = np.random.default_rng(seed)
    duck = duck_curve(N, kicks, depth=0.55, release=0.14)
    duck_deep = duck_curve(N, kicks, depth=0.75, release=0.12)
    hall = ir(r, 3.4, pre=0.03, damp=0.55)
    plate = ir(r, 1.3, pre=0.008, damp=0.4)

    kick_ = stems['kick']
    drums = stems['drums']
    bass = stems['bass'] * duck_deep[:, None]
    pads = stems['pads'] * duck[:, None]
    keys = stems['keys'] * (0.5 + 0.5 * duck)[:, None]
    vox_ = stems['vox'] * (0.5 + 0.5 * duck)[:, None]
    fx = stems['fx']

    keys_send = keys + pingpong(keys, grid.BEAT * 0.75, fb=0.42) * 0.55
    vox_send = vox_ + pingpong(vox_, grid.BEAT * 0.75, fb=0.5) * 0.7
    hall_in = pads * 0.45 + keys_send * 0.55 + vox_send * 0.8 + drums * 0.06 + fx * 0.3
    plate_in = drums * 0.22
    wet = convolve(butter(hall_in, 'highpass', 220, 2), hall) * 0.32 + convolve(plate_in, plate) * 0.25
    wet *= (0.6 + 0.4 * duck)[:, None]

    e = energy_db(tvec(N))
    rhythm = (10 ** (e / 20))[:, None]
    soft = (10 ** (e * 0.5 / 20))[:, None]
    bus = {'kick': kick_ * 0.9 * rhythm, 'drums': drums * 1.05 * rhythm, 'bass': bass * 0.5 * rhythm,
           'pads': pads * 1.8 * soft, 'keys': keys_send * 1.2 * rhythm, 'vox': vox_send * 0.95 * rhythm, 'fx': fx,
           'reverb': wet * 1.6 * soft}
    mix = sum(bus.values())
    mix = tape(mix, r)
    mix = butter(mix, 'highpass', 28, 2)
    mid = mix.mean(axis=1, keepdims=True)
    side = mix - mid
    side_lo = butter(side, 'lowpass', 160, 2)
    mix = mid + (side - side_lo) * 1.15
    mix = shelf(mix, 9000, 1.5, True)
    return mix, bus


def cold_open_gate(x):
    """music near-silence and the half-second silence before the drop"""
    t = tvec(len(x))
    g = np.ones(len(x))
    g = np.where((t >= 10.0) & (t < 10.5), 0.0, g)
    ramp = n_of(0.02)
    i0, i1 = n_of(10.0), n_of(10.5)
    g[i0 - ramp:i0] = np.linspace(1, 0, ramp)
    g[i1:i1 + ramp] = np.linspace(0, 1, ramp)
    end = t > 177.5
    g[end] *= np.clip((179.6 - t[end]) / 2.1, 0, 1) ** 1.4
    return x * g[:, None]


def hard_cut(stems):
    """cut everything sustained at 0:07 (hard cut to black), keeping the low note that starts there"""
    i = n_of(7.0)
    f = n_of(0.006)
    for k in ('pads', 'fx', 'bass', 'drums', 'kick'):
        s = stems[k]
        cut = np.ones(N)
        cut[i - f:i] = np.linspace(1, 0, f)
        cut[i:n_of(10.5)] = 0.0
        if k == 'fx':
            cut[i:n_of(10.0)] = 0.35
        stems[k] = s * cut[:, None]
    return stems


def build(out_dir):
    stems, kicks = compose()
    stems = hard_cut(stems)
    mix, bus = mixdown(stems, kicks)
    mix = cold_open_gate(mix)
    os.makedirs(os.path.join(out_dir, 'music_stems'), exist_ok=True)
    for k, v in bus.items():
        sf.write(os.path.join(out_dir, 'music_stems', f'{k}.wav'), (cold_open_gate(v) * 0.5).astype(np.float32),
                 SR, subtype='FLOAT')
    return mix, kicks


if __name__ == '__main__':
    out = os.path.join(HERE, 'out')
    os.makedirs(out, exist_ok=True)
    mix, _ = build(out)
    peak = np.abs(mix).max()
    sf.write(os.path.join(out, 'music_raw.wav'), (mix / peak * 0.7).astype(np.float32), SR, subtype='FLOAT')
    print('peak', peak, file=sys.stderr)
