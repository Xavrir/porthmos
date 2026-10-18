"""Offline step: search the hero SFX with `earshot forge` (designed mode: no reference recordings on this machine)
and store each winner's recipe, parameters and seed in forged.json. build.py re-renders from that file with no
models, so this script only needs to run again when a recipe or a target changes.

    .venv/bin/python forge_sfx.py [name ...]
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
os.environ.setdefault('EARSHOT_HOME', os.path.join(HERE, '.earshot'))

JOBS = {
    'stamp': dict(recipe='local:stamp', seed=12, budget=128,
                  target='a heavy rubber stamp slammed down on paper on a desk, a deep thud',
                  alts=['a kick drum', 'a door slam', 'a gunshot', 'a hand clap', 'a cardboard box dropped']),
    'slam': dict(recipe='impact', seed=21, budget=96,
                 target='a deep cinematic boom impact with a punchy attack',
                 alts=['an explosion', 'thunder', 'a door slam', 'a kick drum']),
    'bass_hit': dict(recipe='subdrop', seed=31, budget=64,
                     target='a deep low sub bass hit, a dark cinematic boom',
                     alts=['a kick drum', 'an explosion', 'thunder', 'a low hum']),
    'glitch': dict(recipe='glitch', seed=41, budget=64,
                   target='a short digital glitch stutter with bit-crushed noise bursts that speed up and cut off',
                   alts=['static noise', 'a camera shutter', 'a zipper', 'a typewriter']),
}


def load(recipe):
    if recipe.startswith('local:'):
        import importlib
        return importlib.import_module('recipes.' + recipe.split(':', 1)[1])
    from earshot.forge import load_recipe
    return load_recipe(recipe)


def main(names):
    from earshot.forge import forge
    path = os.path.join(HERE, 'forged.json')
    done = json.load(open(path)) if os.path.exists(path) else {}
    for name in names or JOBS:
        job = JOBS[name]
        rec = load(job['recipe'])
        out = os.path.join(HERE, 'sfx', 'forge', name)
        rep = forge(rec, target=job['target'], alts=job['alts'], budget=job['budget'], pop=12, keep=2,
                    seed=job['seed'], out=out, mode='designed', robust=2, log=lambda *a: print(name, *a))
        pick = rep['picks'][0]
        done[name] = {'recipe': job['recipe'], 'params': pick['params'], 'seed': int(pick.get('seed', 0)),
                      'target': job['target'], 'score': pick['score']['total'],
                      'critic': pick['score']['summary']}
        json.dump(done, open(path, 'w'), indent=1, default=float)
        print(name, 'done', pick['score']['summary'])


if __name__ == '__main__':
    main(sys.argv[1:])
