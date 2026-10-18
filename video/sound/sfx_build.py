"""Render every SFX source (forged recipes from forged.json and earshot bank sounds), write them to sfx/, and lay
the events of grid.EVENTS onto one stereo stem. No models are loaded.

    python sfx_build.py        # writes sfx/*.wav and out/sfx_raw.wav
"""
import json
import os
import sys

import numpy as np
import soundfile as sf

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import grid  # noqa: E402
from synth import SR, butter, n_of, pan2  # noqa: E402

from earshot.forge import bank, dsp  # noqa: E402
from earshot.forge.search import render as forge_render  # noqa: E402

# each source: layers of (kind, id, options, gain dB, offset s); sync = 'onset' or 'peak' of the first layer
SOURCES = {
    'bass_hit': {'sync': 'onset', 'layers': [('forge', 'bass_hit', {}, 0.0, 0.0),
                                             ('bank', 'pro_impact/deep', {'seed': 3}, -9.0, 0.0)]},
    'type_key': {'sync': 'onset', 'layers': [('bank', 'pro_typing_key/glass', {}, 0.0, 0.0)], 'takes': 6},
    'glitch': {'sync': 'onset', 'layers': [('forge', 'glitch', {}, 0.0, 0.0)]},
    'cut_thud': {'sync': 'onset', 'layers': [('bank', 'pro_pop_in/deep', {}, 0.0, 0.0)]},
    'drop_impact': {'sync': 'onset', 'layers': [('forge', 'slam', {}, 0.0, 0.0),
                                                ('bank', 'pro_whoosh_big/reverse', {'apex': 0.9}, -8.0, 0.0)]},
    'drop_sub': {'sync': 'onset', 'layers': [('bank', 'pro_sub_drop/low', {'pitch': 'D1'}, 0.0, 0.0)]},
    'logo_shimmer': {'sync': 'peak', 'layers': [('bank', 'shimmer/m0', {'pitch': 'D6'}, 0.0, 0.0)]},
    'ui_tick': {'sync': 'onset', 'layers': [('bank', 'pro_hover_tick/glass', {}, 0.0, 0.0)]},
    'ui_click': {'sync': 'onset', 'layers': [('bank', 'pro_click/soft', {}, 0.0, 0.0)]},
    'card_cut': {'sync': 'peak', 'layers': [('bank', 'whoosh_fast/tight', {'dur': 0.5, 'apex': 0.32}, 0.0, 0.0),
                                            ('bank', 'pro_tap/knock', {}, -6.0, 0.0)]},
    'act_title': {'sync': 'peak', 'layers': [('bank', 'pro_whoosh_big/swell', {'dur': 0.9, 'apex': 0.6}, -2.0, 0.0),
                                             ('bank', 'pro_impact/short', {'seed': 9}, -1.0, 0.0)]},
    'ding': {'sync': 'onset', 'layers': [('bank', 'pro_notify/ding_2045', {'pitch': 'D7'}, 0.0, 0.0)]},
    'slide': {'sync': 'peak', 'layers': [('bank', 'swish/soft', {}, 0.0, 0.0)]},
    'diagram_tick': {'sync': 'onset', 'layers': [('bank', 'pop/2', {}, 0.0, 0.0),
                                                 ('bank', 'pro_hover_tick/ping', {}, -10.0, 0.0)],
                     'takes': 4, 'take_opts': [{'pitch': 'A4'}, {'pitch': 'C5'}, {'pitch': 'D5'}, {'pitch': 'F5'}]},
    'stamp': {'sync': 'onset', 'layers': [('forge', 'stamp', {}, 0.0, 0.0),
                                          ('bank', 'pro_tap/knock', {}, -2.0, 0.0)]},
    'stamp_soft': {'sync': 'onset', 'layers': [('forge', 'stamp', {}, 0.0, 0.0)], 'lowpass': 2500.0},
    'toggle': {'sync': 'onset', 'layers': [('bank', 'toggle/micro', {}, 0.0, 0.0)]},
    'riser': {'sync': 'peak', 'layers': [('bank', 'riser/tension', {'dur': 4.0}, 0.0, 0.0)]},
    'slam': {'sync': 'onset', 'layers': [('forge', 'slam', {}, 0.0, 0.0),
                                         ('bank', 'pro_sub_drop/quick', {'pitch': 'D1'}, -5.0, 0.0)]},
    'logo_sting': {'sync': 'peak', 'layers': [('bank', 'logo_sting/reverse_bloom', {'pitch': 'D6'}, 0.0, 0.0),
                                               ('bank', 'pro_sub_drop/soft', {'pitch': 'D1'}, -8.0, 0.0)]},
}


PEAKY = ('whoosh', 'riser', 'shimmer', 'swipe', 'swish')


def _stereo(y):
    y = np.asarray(y, np.float64)
    return pan2(y) / np.sqrt(2) if y.ndim == 1 else y


def _forged(name):
    spec = json.load(open(os.path.join(HERE, 'forged.json')))[name]
    if spec['recipe'].startswith('local:'):
        import importlib
        rec = importlib.import_module('recipes.' + spec['recipe'].split(':', 1)[1])
    else:
        from earshot.forge import load_recipe
        rec = load_recipe(spec['recipe'])
    x = forge_render(rec, {**getattr(rec, 'DEFAULTS', {}), **spec['params']}, int(spec['seed']))
    return dsp.normalize(np.asarray(x, np.float64), -1.0)


def _sync(y, mode):
    m = np.abs(y).max(axis=1)
    if mode == 'peak':
        return int(np.argmax(m))
    thr = m.max() * 10 ** (-30 / 20)
    return int(np.argmax(m > thr))


def render_source(name, take=0):
    spec = SOURCES[name]
    parts = []
    for j, (kind, sid, opts, gain_db, offset) in enumerate(spec['layers']):
        if kind == 'forge':
            y = _forged(sid)
        else:
            o = dict(opts)
            if spec.get('take_opts'):
                if j == 0:
                    o.update(spec['take_opts'][take])
            elif take:
                o['seed'] = int(o.get('seed', 0)) + 101 * take
            y, _ = bank.render(sid, peak_db=-1.0, checks=False, **o)
        y = _stereo(y) * 10 ** (gain_db / 20)
        parts.append((y, offset))
    starts = []
    for j, (y, off) in enumerate(parts):
        sid = spec['layers'][j][1]
        mode = spec['sync'] if j == 0 else ('peak' if any(k in sid for k in PEAKY) else 'onset')
        starts.append(int(round(off * SR)) - _sync(y, mode))
    lead = -min(starts)
    length = max(st + lead + len(y) for st, (y, _) in zip(starts, parts))
    out = np.zeros((length, 2))
    for st, (y, _) in zip(starts, parts):
        out[st + lead:st + lead + len(y)] += y
    if spec.get('lowpass'):
        out = butter(out, 'lowpass', spec['lowpass'], 2)
    out = out / (np.abs(out).max() + 1e-12) * 10 ** (-1 / 20)
    return out, lead


def build(write_dir=None):
    write_dir = write_dir or os.path.join(HERE, 'sfx')
    os.makedirs(write_dir, exist_ok=True)
    cache = {}
    files = {}
    for name, spec in SOURCES.items():
        for take in range(spec.get('takes', 1)):
            y, sync = render_source(name, take)
            cache[(name, take)] = (y, sync)
            fn = f'{name}.wav' if spec.get('takes', 1) == 1 else f'{name}_{take + 1}.wav'
            sf.write(os.path.join(write_dir, fn), y.astype(np.float32), SR, subtype='PCM_24')
            files[(name, take)] = 'sfx/' + fn
    stem = np.zeros((n_of(grid.LENGTH), 2))
    events = []
    counter = {}
    for t, label, src, gain_db, note in grid.EVENTS:
        takes = SOURCES[src].get('takes', 1)
        k = counter.get(src, 0)
        counter[src] = k + 1
        take = k % takes
        y, sync = cache[(src, take)]
        g = 10 ** (gain_db / 20)
        if src == 'type_key':
            g *= 0.75 + 0.25 * ((k * 7) % 5) / 4
        i0 = int(round(t * SR)) - sync
        seg = y
        if i0 < 0:
            seg = y[-i0:]
            i0 = 0
        i1 = min(len(stem), i0 + len(seg))
        stem[i0:i1] += g * seg[:i1 - i0]
        events.append({'time': round(t, 3), 'name': label, 'source': src, 'file': files[(src, take)],
                       'sync': SOURCES[src]['sync'], 'starts_at': round(i0 / SR, 4), 'gain_db': gain_db,
                       'note': note})
    return stem, events


if __name__ == '__main__':
    stem, events = build()
    os.makedirs(os.path.join(HERE, 'out'), exist_ok=True)
    sf.write(os.path.join(HERE, 'out', 'sfx_raw.wav'), stem.astype(np.float32), SR, subtype='FLOAT')
    print(len(events), 'events; peak', np.abs(stem).max())
