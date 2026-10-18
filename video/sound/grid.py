"""Tempo map and cue times for the Porthmos launch film (3:00 hackathon cut).

120 BPM puts a beat every 0.5 s, so every time in SCRIPT.md (including 1:56.5 and 2:01.5) sits on a beat.
Four 2/4 bars (at 0:24, 0:37, 1:24, 2:11) move the bar phase by one second so that the hard cuts and act titles
(0:25, 0:29, 0:33, 0:38, 0:58, 1:25, 1:45, 2:12) land on downbeats.
"""

SR = 48000
LENGTH = 180.0
BPM = 120.0
BEAT = 60.0 / BPM

# (start, beats_per_bar, bar_count, section)
LAYOUT = [
    (0.0, 4, 6, 'cold_open'),
    (12.0, 4, 6, 'reveal'),
    (24.0, 2, 1, 'reveal_pickup'),
    (25.0, 4, 6, 'problem'),
    (37.0, 2, 1, 'problem_pickup'),
    (38.0, 4, 10, 'treasury'),
    (58.0, 4, 13, 'copilot'),
    (84.0, 2, 1, 'copilot_pickup'),
    (85.0, 4, 10, 'how'),
    (105.0, 4, 13, 'break'),
    (131.0, 2, 1, 'break_stop'),
    (132.0, 4, 13, 'tradeflow'),
    (158.0, 4, 6, 'proof'),
    (170.0, 4, 5, 'outro'),
]

SECTIONS = {
    'cold_open': (0.0, 12.0), 'reveal': (12.0, 25.0), 'problem': (25.0, 38.0), 'treasury': (38.0, 58.0),
    'copilot': (58.0, 85.0), 'how': (85.0, 105.0), 'break': (105.0, 132.0), 'tradeflow': (132.0, 158.0),
    'proof': (158.0, 170.0), 'outro': (170.0, 180.0),
}


def bars():
    """every bar: dict(t, beats, section, index)"""
    out = []
    for start, bpb, count, sec in LAYOUT:
        for k in range(count):
            out.append({'t': start + k * bpb * BEAT, 'beats': bpb, 'section': sec, 'index': len(out)})
    end = out[-1]['t'] + out[-1]['beats'] * BEAT
    assert abs(end - LENGTH) < 1e-9, end
    return out


def beats():
    return [round(b['t'] + i * BEAT, 4) for b in bars() for i in range(b['beats'])]


def downbeats():
    return [round(b['t'], 4) for b in bars()]


# Every SFX event: (time of the sync point, name, bank/forge source key, gain dB, note)
# The sync point is where the sound's peak (or onset for clicks) must land.
EVENTS = [
    (0.0, 'bass_hit', 'bass_hit', -2.0, 'cold open low hit'),
    *[(0.55 + i * 0.105 + (0.03 if i % 3 == 1 else 0.0), 'type_key', 'type_key', -20.0, 'cursor types the line')
      for i in range(26)],
    (4.0, 'glitch', 'glitch', -5.0, 'line turns orange'),
    (7.0, 'cut_thud', 'cut_thud', -9.0, 'hard cut to black'),
    (12.0, 'drop_impact', 'drop_impact', -1.0, 'logo reveal drop'),
    (12.0, 'drop_sub', 'drop_sub', -4.0, 'logo reveal drop, sub layer'),
    (16.0, 'logo_shimmer', 'logo_shimmer', -11.0, 'Porthmos mark rises'),
    (20.0, 'tag_tick', 'ui_tick', -17.0, 'tagline types'),
    (24.0, 'chip_click', 'ui_click', -14.0, 'Live on Base Sepolia chip'),
    (25.0, 'card_cut', 'card_cut', -10.0, 'problem card 1'),
    (29.0, 'card_cut', 'card_cut', -10.0, 'problem card 2'),
    (33.0, 'card_cut', 'card_cut', -10.0, 'problem card 3'),
    (38.0, 'act_title', 'act_title', -8.0, '01 / Your treasury in a minute'),
    (53.0, 'balance_ding', 'ding', -14.0, 'dashboard lands, balance counts up'),
    (58.0, 'act_title', 'act_title', -8.0, '02 / Ask in plain words'),
    (68.0, 'card_slide', 'slide', -14.0, 'action card slides in'),
    (77.0, 'confirm_click', 'ui_click', -12.0, 'click Confirm'),
    (85.0, 'act_title', 'act_title', -8.0, '03 / How it works'),
    (87.0, 'diagram_tick', 'diagram_tick', -12.0, 'Safe, AegisModule, PolicyRegistry'),
    (92.0, 'diagram_tick', 'diagram_tick', -12.0, 'Copilot, policy engine, authorizer, executor'),
    (97.0, 'diagram_tick', 'diagram_tick', -12.0, 'five service processes'),
    (101.0, 'diagram_tick', 'diagram_tick', -12.0, 'tier ladder T1 to T4'),
    (105.0, 'act_title', 'act_title', -8.0, '04 / Try to break it'),
    (110.0, 'held_stamp', 'stamp', -5.0, 'HELD. Not representable.'),
    (114.0, 'refusal_stamp', 'stamp', -4.0, 'BadSignature'),
    (116.5, 'refusal_stamp', 'stamp', -4.0, 'NonceUsed'),
    (119.0, 'refusal_stamp', 'stamp', -4.0, 'PriceOutOfBand'),
    (121.5, 'refusal_stamp', 'stamp', -4.0, 'Frozen'),
    (124.0, 'freeze_toggle', 'toggle', -12.0, 'bank seat freeze toggle'),
    (132.0, 'act_title', 'act_title', -8.0, '05 / Pay on proof'),
    (138.0, 'release_ding', 'ding', -13.0, '200 USDC released'),
    (144.0, 'held_stamp', 'stamp_soft', -6.0, 'milestone 2 HELD (ConditionNotMet)'),
    (150.0, 'complete_ding', 'ding', -12.0, 'Order Completed'),
    (158.0, 'proof_riser', 'riser', -6.0, 'riser apex into the proof montage'),
    (158.0, 'number_slam', 'slam', -3.0, '9 contracts'),
    (161.0, 'number_slam', 'slam', -3.0, '15 scenarios'),
    (164.0, 'number_slam', 'slam', -3.0, '648 tests'),
    (167.0, 'number_slam', 'slam', -3.0, '0 ways to send money out'),
    (170.0, 'logo_sting', 'logo_sting', -5.0, 'logo returns'),
    (173.0, 'cta_tick', 'ui_tick', -16.0, 'CTA URL'),
    (176.0, 'team_tick', 'ui_tick', -16.0, 'team card'),
]
