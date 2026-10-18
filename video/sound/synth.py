"""Synthesis and effect building blocks for the music bed (48 kHz float64, numpy + numba)."""
import numpy as np
from numba import njit
from scipy import signal

from earshot.forge import dsp

SR = 48000


def hz(m):
    return 440.0 * 2.0 ** ((np.asarray(m, float) - 69.0) / 12.0)


def n_of(s):
    return max(1, int(round(s * SR)))


def tvec(n):
    return np.arange(n) / SR


def saw(freq, seconds=None, phase=0.0):
    return dsp.osc(freq, 'saw', seconds, phase)


@njit(cache=True)
def _svf(x, fc, q, mode):
    y = np.empty_like(x)
    ic1 = 0.0
    ic2 = 0.0
    k = 1.0 / q
    for i in range(len(x)):
        f = min(max(fc[i], 20.0), 20000.0)
        g = np.tan(np.pi * f / 48000.0)
        a1 = 1.0 / (1.0 + g * (g + k))
        a2 = g * a1
        a3 = g * a2
        v3 = x[i] - ic2
        v1 = a1 * ic1 + a2 * v3
        v2 = ic2 + a2 * ic1 + a3 * v3
        ic1 = 2.0 * v1 - ic1
        ic2 = 2.0 * v2 - ic2
        if mode == 0:
            y[i] = v2
        elif mode == 1:
            y[i] = v1
        else:
            y[i] = x[i] - k * v1 - v2
    return y


def svf(x, fc, q=0.707, mode='lp'):
    x = np.asarray(x, np.float64)
    fc = np.broadcast_to(np.asarray(fc, np.float64), x.shape[:1]).copy()
    m = {'lp': 0, 'bp': 1, 'hp': 2}[mode]
    if x.ndim == 2:
        return np.stack([_svf(np.ascontiguousarray(x[:, c]), fc, q, m) for c in range(x.shape[1])], axis=1)
    return _svf(x, fc, q, m)


def butter(x, kind, f, order=2):
    sos = signal.butter(order, f, kind, fs=SR, output='sos')
    return signal.sosfilt(sos, x, axis=0)


def shelf(x, f, gain_db, high=True):
    """first-order-ish shelf by blending a filtered copy"""
    g = 10 ** (gain_db / 20) - 1.0
    part = butter(x, 'highpass' if high else 'lowpass', f, 1)
    return x + g * part


def noise(n, r, color='white'):
    w = r.standard_normal(n)
    if color == 'pink':
        b = [0.049922035, -0.095993537, 0.050612699, -0.004408786]
        a = [1, -2.494956002, 2.017265875, -0.522189400]
        w = signal.lfilter(b, a, w)
        w /= np.std(w) + 1e-12
    return w


def env_adsr(n, a, d, s, rel, hold):
    """attack a, decay d to sustain s, hold until `hold` s, then release rel (all seconds); length n samples"""
    t = tvec(n)
    e = np.where(t < a, t / max(a, 1e-6), s + (1 - s) * np.exp(-(t - a) / max(d, 1e-6)))
    after = t > hold
    if after.any():
        e_h = e[min(n - 1, int(hold * SR))]
        e = np.where(after, e_h * np.exp(-(t - hold) / max(rel, 1e-6)), e)
    return e


def pan2(x, pos=0.0):
    a = (pos + 1) * np.pi / 4
    return np.stack([x * np.cos(a), x * np.sin(a)], axis=1) * np.sqrt(2)


def place(buf, x, t, gain=1.0, pos=0.0):
    if x.ndim == 1:
        x = pan2(x, pos)
    i0 = int(round(t * SR))
    if i0 < 0:
        x = x[-i0:]
        i0 = 0
    i1 = min(len(buf), i0 + len(x))
    if i1 > i0:
        buf[i0:i1] += gain * x[:i1 - i0]


def tanh_sat(x, drive_db=6.0):
    g = 10 ** (drive_db / 20)
    return np.tanh(g * x) / np.tanh(g)


def ir(r, rt60=2.4, pre=0.02, damp=0.5, width=1.0, seconds=None, early=0.25):
    """stereo reverb impulse: decorrelated noise with an exponential decay that darkens over time, plus early taps"""
    seconds = seconds or rt60 * 1.15
    n = n_of(seconds)
    t = tvec(n)
    out = np.zeros((n + n_of(pre), 2))
    for c in range(2):
        w = r.standard_normal(n)
        bright = butter(w, 'highpass', 2500, 1)
        dark = w - bright
        e = 10 ** (-3 * t / rt60)
        eb = 10 ** (-3 * t / (rt60 * (1 - 0.75 * damp)))
        tail = dark * e + bright * eb * 0.7
        tail *= np.minimum(1.0, t / 0.03)
        er = np.zeros(n)
        for _ in range(14):
            k = int(r.uniform(0.004, 0.07) * SR)
            er[k] += r.uniform(-1, 1) * early
        out[n_of(pre):, c] = tail + er
    m = out.mean(axis=1, keepdims=True)
    out = m + (out - m) * width
    return out / np.sqrt((out ** 2).sum() / 2)


def convolve(x, h):
    if x.ndim == 1:
        x = pan2(x)
    y = np.stack([signal.oaconvolve(x[:, c], h[:, c])[:len(x)] for c in range(2)], axis=1)
    return y


def pingpong(x, delay, fb=0.45, taps=7, lp=4500.0, hp=300.0):
    if x.ndim == 1:
        x = pan2(x)
    mono = x.mean(axis=1)
    mono = butter(butter(mono, 'lowpass', lp, 2), 'highpass', hp, 2)
    out = np.zeros_like(x)
    d = n_of(delay)
    g = 1.0
    for k in range(1, taps + 1):
        g *= fb
        s = d * k
        if s >= len(x):
            break
        out[s:, k % 2] += g * mono[:-s]
        mono = butter(mono, 'lowpass', lp * 0.9, 1)
    return out


def duck_curve(n, times, depth=0.6, attack=0.004, release=0.16, hold=0.01):
    """sidechain gain curve from trigger times"""
    k_n = n_of(attack + hold + release * 5)
    kt = tvec(k_n)
    kern = np.where(kt < attack, kt / attack, np.where(kt < attack + hold, 1.0,
                                                       np.exp(-(kt - attack - hold) / release)))
    d = np.zeros(n)
    for t in times:
        i0 = int(round((t - attack) * SR))
        if i0 >= n:
            continue
        a = max(0, i0)
        b = min(n, i0 + k_n)
        d[a:b] = np.maximum(d[a:b], kern[a - i0:b - i0])
    return 1.0 - depth * d


def fm_note(f, seconds, r, ratio=1.0, index=1.5, idecay=0.3, decay=1.0, attack=0.002, tine=0.0):
    n = n_of(seconds)
    t = tvec(n)
    idx = index * np.exp(-t / idecay)
    mod = np.sin(2 * np.pi * f * ratio * t + r.uniform(0, 6.28)) * idx
    y = np.sin(2 * np.pi * f * t + mod)
    if tine:
        y += tine * np.sin(2 * np.pi * f * 7.0 * t) * np.exp(-t / 0.03)
    return y * np.exp(-t / decay) * np.minimum(1.0, t / attack)


FORMANTS = {'a': ((800, 1150, 2900), (1.0, 0.5, 0.25)), 'o': ((450, 800, 2830), (1.0, 0.35, 0.15)),
            'e': ((400, 2000, 2600), (1.0, 0.3, 0.25)), 'u': ((325, 700, 2530), (1.0, 0.2, 0.1))}
