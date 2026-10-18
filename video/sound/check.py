"""Listen to the build with earshot (one process, models load once) and save the results to out/checks/.

    .venv/bin/python check.py [mix|sfx|all]      # default all
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
os.environ.setdefault('EARSHOT_HOME', os.path.join(HERE, '.earshot'))
OUT = os.path.join(HERE, 'out')
CHK = os.path.join(OUT, 'checks')
FILM = os.path.join(HERE, '..', 'film', 'out', 'porthmos-launch.mp4')

SFX_QUERIES = {
    'bass_hit': ('a deep low sub bass hit, a dark cinematic boom', ['a kick drum', 'thunder', 'a door slam']),
    'glitch': ('a short digital glitch stutter', ['static noise', 'a camera shutter', 'a zipper']),
    'cut_thud': ('a short low thud', ['a door slam', 'a kick drum', 'a gunshot']),
    'drop_impact': ('a deep cinematic boom impact', ['an explosion', 'thunder', 'a kick drum']),
    'drop_sub': ('a deep sub bass drop', ['a kick drum', 'a low hum', 'thunder']),
    'logo_shimmer': ('a sparkling magical shimmer', ['wind chimes', 'a bell', 'rain']),
    'ui_tick': ('a tiny high soft user interface tick', ['a mouse click', 'a key press', 'a drop of water']),
    'ui_click': ('a clean soft user interface click', ['a mouse click', 'a key press', 'a pen click']),
    'card_cut': ('a fast crisp whoosh transition', ['wind', 'a sword swing', 'a car passing']),
    'act_title': ('a whoosh into a punchy cinematic hit', ['an explosion', 'a door slam', 'wind']),
    'ding': ('a short bright notification ding', ['a bell', 'a glass clink', 'a microwave beep']),
    'slide': ('a soft swipe of a card sliding in', ['wind', 'cloth rustling', 'paper']),
    'diagram_tick_1': ('a soft round low pop as an icon appears on screen', ['a kick drum', 'a wooden knock',
                                                                            'a water drop']),
    'stamp': ('a heavy rubber stamp slammed down on paper, a deep thud', ['a kick drum', 'a door slam', 'a gunshot']),
    'toggle': ('a small switch flipped on', ['a mouse click', 'a key press', 'a camera shutter']),
    'riser': ('a cinematic riser building tension into a hit', ['a jet engine', 'wind', 'a siren']),
    'slam': ('a deep cinematic boom impact with a punchy attack', ['an explosion', 'thunder', 'a kick drum']),
    'logo_sting': ('a soft glassy logo sting, a chime chord ringing out', ['a bell', 'wind chimes', 'a gong']),
    'type_key_1': ('a soft digital typing key tick', ['a mouse click', 'a clock ticking', 'a typewriter']),
}


def save(name, obj):
    os.makedirs(CHK, exist_ok=True)
    with open(os.path.join(CHK, name + '.json'), 'w') as f:
        json.dump(obj, f, indent=1, default=str)


def summary(r):
    for k in ('summary', 'text', 'verdict'):
        if isinstance(r, dict) and isinstance(r.get(k), str):
            return r[k]
    return json.dumps(r, default=str)[:1500]


def sync_cues():
    cues = json.load(open(os.path.join(HERE, 'cues.json')))
    ev = [e for e in cues['events'] if e['source'] != 'type_key']
    path = os.path.join(CHK, 'sync_cues.json')
    os.makedirs(CHK, exist_ok=True)
    json.dump({'events': [{'t': e['time'], 'name': e['name']} for e in ev]}, open(path, 'w'))
    return path


def check_mix(api):
    mix = os.path.join(OUT, 'soundtrack.wav')
    video = FILM if os.path.exists(FILM) else None
    r = api.measure(mix, music=True)
    save('measure', r)
    print('MEASURE:', summary(r), '\n')
    cues = sync_cues()
    tl = api.timeline(mix, video=video, cues=cues, detail='normal', fresh=True)
    save('timeline', tl)
    print('TIMELINE:', summary(tl), '\n')
    api.sheet(mix, os.path.join(OUT, 'sheet.png'), video=video, cues=cues, tl=tl, width=2400)
    c = api.critique(mix, video=video)
    save('critique', c)
    print('CRITIQUE:', summary(c), '\n')
    rl = api.realness(os.path.join(OUT, 'music.wav'))
    save('realness_music', rl)
    print('REALNESS (music):', summary(rl), '\n')


def check_sfx(api):
    rows = {}
    for name, (q, alts) in SFX_QUERIES.items():
        path = os.path.join(HERE, 'sfx', name + '.wav')
        d = api.describe(path, top=4)
        m = api.match(path, q, alts=alts)
        rows[name] = {'describe': summary(d), 'match': summary(m)}
        print(f'{name}:\n  describe: {summary(d)[:300]}\n  match: {summary(m)[:300]}')
    save('sfx', rows)


if __name__ == '__main__':
    from earshot import api
    what = sys.argv[1] if len(sys.argv) > 1 else 'all'
    if what in ('sfx', 'all'):
        check_sfx(api)
    if what in ('mix', 'all'):
        check_mix(api)
