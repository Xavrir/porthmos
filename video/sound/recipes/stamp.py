"""A forge recipe for the refusal stamp: a heavy rubber stamp slammed onto paper on a wooden desk, with a designed
sub layer under it so it reads as a cinematic hit in a mix.

Layers: a low body (pitch-falling sine), a desk mode cluster, a paper slap (band-passed noise), a small handle
clack, a sub thump for weight, then a short room.
"""
import numpy as np

from earshot.forge import dsp

TARGET = 'a heavy rubber stamp slammed down on paper on a desk, a deep thud'
ALTS = ['a kick drum', 'a door slam', 'a gunshot', 'a hand clap', 'a cardboard box dropped']

SPACE = {
    'body_f': (85.0, 190.0, 'log'),
    'body_drop': (0.0, 0.25),
    'body_tau': (0.03, 0.16, 'log'),
    'desk_f': (180.0, 520.0, 'log'),
    'desk_db': (-14.0, 0.0),
    'desk_tau': (0.02, 0.09, 'log'),
    'slap_db': (-16.0, -1.0),
    'slap_f': (700.0, 3200.0, 'log'),
    'slap_ms': (6.0, 40.0, 'log'),
    'clack_db': (-30.0, -8.0),
    'clack_f': (1200.0, 3600.0, 'log'),
    'sub_db': (-26.0, -8.0),
    'sub_f': (38.0, 60.0, 'log'),
    'sub_tau': (0.12, 0.45, 'log'),
    'sat': (0.0, 9.0),
    'rt60': (0.18, 0.9, 'log'),
    'wet': (0.04, 0.3),
    'length': (0.6, 1.4),
}
DEFAULTS = {'body_f': 120.0, 'body_drop': 0.1, 'body_tau': 0.07, 'desk_f': 300.0, 'desk_db': -6.0, 'desk_tau': 0.04,
            'slap_db': -6.0, 'slap_f': 1500.0, 'slap_ms': 16.0, 'clack_db': -18.0, 'clack_f': 2200.0,
            'sub_db': -14.0, 'sub_f': 46.0, 'sub_tau': 0.25, 'sat': 4.0, 'rt60': 0.35, 'wet': 0.12, 'length': 0.9}


def render(p, r):
    n = dsp.n_of(p['length'])
    t = dsp.t_of(n)
    f = p['body_f'] * (1 + p['body_drop'] * np.exp(-t / 0.018))
    body = np.sin(2 * np.pi * np.cumsum(f) / dsp.SR) * np.exp(-t / p['body_tau'])
    body *= np.minimum(1, t / 0.0012)
    desk = dsp.modal([p['desk_f'], p['desk_f'] * 1.63, p['desk_f'] * 2.41],
                     [p['desk_tau'], p['desk_tau'] * 0.7, p['desk_tau'] * 0.45], [1, 0.55, 0.3], p['length'], r)
    desk = dsp.excite(desk, dsp.contact(0.002, r, 0.5))
    desk = desk / (np.abs(desk).max() + 1e-12) * 10 ** (p['desk_db'] / 20)
    slap = dsp.butter(dsp.noise(p['length'], r), 'bandpass', [p['slap_f'] / 1.8, p['slap_f'] * 1.8])
    slap = slap / (np.abs(slap).max() + 1e-12) * np.exp(-t / (p['slap_ms'] * 1e-3)) * 10 ** (p['slap_db'] / 20)
    clack = dsp.modal([p['clack_f'], p['clack_f'] * 1.37], [0.012, 0.008], [1, 0.5], p['length'], r)
    clack = dsp.excite(clack, dsp.contact(0.0008, r, 0.9))
    clack = clack / (np.abs(clack).max() + 1e-12) * 10 ** (p['clack_db'] / 20)
    sub = np.sin(2 * np.pi * p['sub_f'] * t) * np.exp(-t / p['sub_tau']) * np.minimum(1, t / 0.004)
    sub *= 10 ** (p['sub_db'] / 20)
    x = body + desk + slap + clack + sub
    g = 10 ** (p['sat'] / 20)
    x = np.tanh(g * x) / np.tanh(g)
    x = dsp.room(x, r, rt60=p['rt60'], size=0.4, damp=0.6, wet=p['wet'])
    x = dsp.fade(x, 0.0005, 0.08)
    return dsp.normalize(x, -1.0)
