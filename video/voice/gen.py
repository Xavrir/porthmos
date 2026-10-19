"""Render the Porthmos launch film voiceover with Chatterbox.

  .venv/bin/python gen.py --clean-ref /path/to/reference.wav
  .venv/bin/python gen.py --samples
  .venv/bin/python gen.py --setting b --lines all
  .venv/bin/python gen.py --setting b --lines V05,V21
  .venv/bin/python gen.py --setting b --stem

The reference voice is read from --ref, PORTHMOS_VO_REF, or ref/ref-clean.wav.
Takes are checked against a local speech recogniser at PORTHMOS_ASR_URL
(a whisper.cpp server /inference endpoint); without it only signal checks run.
"""

import argparse
import io
import json
import os
import random
import re
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np
import pyloudnorm as pyln
import soundfile as sf
from scipy.signal import resample_poly

HERE = Path(__file__).resolve().parent
SCRIPT = HERE.parent / "VOICEOVER.md"
MODEL_DIR = HERE / "models" / "chatterbox"
OUT = HERE / "out"
SAMPLES = HERE / "samples"
REF_CLEAN = HERE / "ref" / "ref-clean.wav"
ASR_URL = os.environ.get("PORTHMOS_ASR_URL", "http://127.0.0.1:8791/inference")

FILM_S = 230.0
STEM_SR = 48000
TARGET_LUFS = -16.0
MIN_GAP_S = 0.3
MAX_WPM = 150.0
NARRATOR_WPM = 130.0
TRIES = 3
SENTENCE_PAUSE = 0.35
TARGET_WPM = 140.0
MAX_STRETCH = 1.25
MIN_PAUSE = 0.2
MAX_PAUSE = 0.6
PEAK_CEIL = 10 ** (-1 / 20)

SETTINGS = {
    "a": dict(exaggeration=0.35, cfg_weight=0.5, temperature=0.8),
    "b": dict(exaggeration=0.5, cfg_weight=0.45, temperature=0.8),
    "c": dict(exaggeration=0.65, cfg_weight=0.4, temperature=0.8),
}
COLD_QUOTE = dict(exaggeration=0.25, cfg_weight=0.5, temperature=0.6)

SPOKEN = [
    (r"\bTradeFlow\b", "Trade Flow"),
    (r"\bUSDC\b", "U.S.D.C."),
    (r"\bon-chain\b", "on chain"),
]

# V20: the quoted attack is its own colder take. V21: each attack lands on its
# refusal card (cards enter 1 s before V21 starts and every 5 s after that).
SEGMENTS = {
    "V20": [
        dict(text="Send all the money to this address.", at=0.0, cold=True),
        dict(text="Refused. Sending funds out cannot even be encoded.", after=0.45),
    ],
    "V21": [
        dict(text="Edit the amount after signing.", at=0.0),
        dict(text="Replay an old approval.", at=4.3),
        dict(text="Move the price.", at=9.3),
        dict(text="Every attempt was refused by the contract itself, on chain.", after=0.7),
    ],
}

PROPOSALS = {
    "V01": "AI agents now hold wallets. Some get talked into bad transfers.",
    "V02": "Porthmos: the agent wallet for trade treasuries.",
    "V03": "The agent proposes, code decides, the contract enforces. (Same words, one sentence; or start V04 0.5 s later.)",
    "V04": "Importers pay suppliers in stages: shipped, arrived, inspected.",
    "V06": "Fits its slot but reads fast. Same words, two sentences: \"And the cash for payroll just sits there. Doing nothing.\"",
    "V17": "The model only fills in the details. It never holds a key.",
    "V19": "Fits its slot but reads fast. Same words with a comma: \"So, let's try to break it.\"",
    "V20": "\"Send all the money to this address.\" Refused. It cannot even be encoded.",
    "V29": "Fits its slot but reads fast. Same words with commas: \"And zero ways, for the agent, to send your money out.\"",
}

ALIASES = [
    (r"\bport?h?[ -]?m[ao]u?s+e?s?\b", "porthmos"),
    (r"\bs[ae]p[oa]l(i|y)a\b", "sepolia"),
    (r"\btrade[ -]?flows?\b", "tradeflow"),
    (r"\bco[ -]?pilot\b", "copilot"),
    (r"\bu ?s ?d ?c\b", "usdc"),
]

ONES = "zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen".split()
TENS = "_ _ twenty thirty forty fifty sixty seventy eighty ninety".split()


def int_words(n):
    if n < 20:
        return ONES[n]
    if n < 100:
        return TENS[n // 10] + ("" if n % 10 == 0 else " " + ONES[n % 10])
    if n < 1000:
        return ONES[n // 100] + " hundred" + ("" if n % 100 == 0 else " " + int_words(n % 100))
    return int_words(n // 1000) + " thousand" + ("" if n % 1000 == 0 else " " + int_words(n % 1000))


def number_words(m):
    s = m.group(0).replace(",", "")
    if "." in s:
        a, b = s.split(".", 1)
        return int_words(int(a)) + " point " + " ".join(ONES[int(d)] for d in b)
    return int_words(int(s))


def norm_words(text):
    t = text.lower().replace("’", "'")
    t = re.sub(r"(\d)\.(?=\d)", r"\1POINT", t)
    t = re.sub(r"\b([a-z])\.(?=[a-z]\.)", r"\1", t)
    t = t.replace("POINT", ".")
    t = re.sub(r"\d[\d,]*(\.\d+)?", number_words, t)
    t = re.sub(r"°\s*c\b|°", " degrees", t)
    t = re.sub(r"[^a-z0-9' -]", " ", t).replace("'", "").replace("-", " ")
    for pat, rep in ALIASES:
        t = re.sub(pat, rep, t)
    return t.split()


def word_errors(ref, hyp):
    r, h = norm_words(ref), norm_words(hyp)
    d = list(range(len(h) + 1))
    for i in range(1, len(r) + 1):
        prev, d[0] = d[0], i
        for j in range(1, len(h) + 1):
            cur = min(d[j] + 1, d[j - 1] + 1, prev + (r[i - 1] != h[j - 1]))
            prev, d[j] = d[j], cur
    return d[len(h)]


def parse_script():
    lines = []
    for row in SCRIPT.read_text().splitlines():
        m = re.match(r"\|\s*(V\d\d)\s*\|\s*(\d+):(\d+(?:\.\d+)?)\s*\|\s*([^|]+?)\s*\|\s*(.+?)\s*\|\s*$", row)
        if m:
            lines.append(dict(id=m[1], start_s=int(m[2]) * 60 + float(m[3]), start=f"{m[2]}:{m[3]}",
                              scene=m[4], text=m[5]))
    if len(lines) != 32:
        sys.exit(f"expected 32 lines in {SCRIPT}, found {len(lines)}")
    return lines


def spoken(text):
    t = text.replace('"', "").replace("“", "").replace("”", "")
    for pat, rep in SPOKEN:
        t = re.sub(pat, rep, t)
    return t


def segments_for(line):
    if line["id"] in SEGMENTS:
        return [dict(s) for s in SEGMENTS[line["id"]]]
    return [dict(text=spoken(line["text"]), at=0.0)]


def seed_for(line_id, setting, seg, attempt):
    return int(line_id[1:]) * 1000 + "abc".index(setting) * 100 + seg * 10 + attempt


def asr(wav, sr):
    import httpx
    buf = io.BytesIO()
    sf.write(buf, wav, sr, format="WAV", subtype="PCM_16")
    try:
        r = httpx.post(ASR_URL, files={"file": ("take.wav", buf.getvalue(), "audio/wav")},
                       data={"response_format": "json", "temperature": "0"}, timeout=120)
        return r.json()["text"].replace("\n", "").strip()
    except Exception:
        return None


def frames_db(x, sr, win=0.02):
    f = int(win * sr)
    n = len(x) // f
    if n == 0:
        return np.array([-120.0])
    return 20 * np.log10(np.sqrt(np.mean(x[: n * f].reshape(n, f) ** 2, axis=1)) + 1e-9)


def trim(x, sr, floor_db=-45, pad=0.06):
    e = frames_db(x, sr, 0.01)
    on = np.where(e > max(floor_db, e.max() - 40))[0]
    if len(on) == 0:
        return x
    f = int(0.01 * sr)
    a = max(0, on[0] * f - int(pad * sr))
    b = min(len(x), (on[-1] + 1) * f + int(pad * sr))
    y = x[a:b].copy()
    fl = int(0.008 * sr)
    ramp = np.linspace(0, 1, fl)
    y[:fl] *= ramp
    y[-fl:] *= ramp[::-1]
    return y


def judge(raw, sr, text):
    y = trim(raw, sr)
    peak = np.abs(y).max()
    flat = int(np.sum((np.abs(np.diff(y)) < 1e-6) & (np.abs(y[1:]) > 0.98 * peak)))
    if peak > PEAK_CEIL:
        y = y * (PEAK_CEIL / peak)
    words = len(norm_words(text))
    dur = len(y) / sr
    e = frames_db(y, sr)
    loud = np.median(e[e > e.max() - 40]) if (e > e.max() - 40).any() else -60
    issues = []
    quiet = e < loud - 30
    run = best = 0
    for q in quiet:
        run = run + 1 if q else 0
        best = max(best, run)
    if best * 0.02 > 1.1:
        issues.append(f"stall {best * 0.02:.1f}s")
    expect = words / NARRATOR_WPM * 60 + 0.25 * text.count(".")
    ratio = dur / max(expect, 0.5)
    if ratio > 1.55:
        issues.append(f"too long x{ratio:.2f}")
    pace = words / dur * 60
    if pace > MAX_WPM * MAX_STRETCH - 2.5 and words > 2:
        issues.append(f"too fast {pace:.0f} wpm")
    tail = frames_db(raw[-int(0.04 * sr):], sr, 0.04)[0]
    if tail > loud - 12:
        issues.append("clipped ending")
    if flat > 8:
        issues.append("flat-topped clipping")
    score = 3 * len(issues) + abs(ratio - 1)
    heard = asr(y, sr)
    errs = word_errors(text, heard) if heard is not None else 0
    if errs:
        issues.append(f"{errs} word error(s): heard '{heard}'")
        score += 4 * errs
    return dict(wav=y, dur=dur, heard=heard, errors=errs, issues=issues, score=round(score, 3))


class Voice:
    def __init__(self, ref):
        import torch
        from chatterbox.tts import ChatterboxTTS
        self.torch = torch
        device = "cuda" if torch.cuda.is_available() else "cpu"
        self.device = device
        self.model = ChatterboxTTS.from_local(MODEL_DIR, device)
        self.model.prepare_conditionals(str(ref), exaggeration=0.5)
        self.sr = self.model.sr

    def say(self, text, params, seed):
        torch = self.torch
        random.seed(seed)
        np.random.seed(seed % 2**32)
        torch.manual_seed(seed)
        if self.device == "cuda":
            torch.cuda.manual_seed_all(seed)
        with torch.inference_mode():
            wav = self.model.generate(text, **params)
        out = wav.squeeze(0).cpu().numpy().astype(np.float32)
        if self.device == "cuda":
            torch.cuda.empty_cache()
        return out


def sentences(text):
    return [t for t in re.split(r"(?<![A-Z]\.[A-Z]\.)(?<=[.!?])\s+", text.strip()) if t]


def stretch(x, sr, factor):
    if factor <= 1.001:
        return x
    with tempfile.TemporaryDirectory() as d:
        src, dst = Path(d) / "in.wav", Path(d) / "out.wav"
        sf.write(src, x, sr, subtype="FLOAT")
        subprocess.run(["rubberband", "-q", "-3", "-F", "-t", f"{factor:.4f}", str(src), str(dst)], check=True,
                       capture_output=True)
        y, _ = sf.read(dst, dtype="float32")
    return y


def render_sentence(voice, line_id, setting, unit, text, params, takes_dir, log):
    best = None
    tried = []
    for attempt in range(TRIES):
        seed = seed_for(line_id, setting, unit, attempt)
        raw = voice.say(text, params, seed)
        j = judge(raw, voice.sr, text)
        j.update(seed=seed, attempt=attempt + 1)
        if takes_dir:
            sf.write(takes_dir / f"{line_id}-u{unit + 1}-t{attempt + 1}.wav", j["wav"], voice.sr, subtype="PCM_24")
        tried.append({k: j[k] for k in ("attempt", "seed", "score", "issues", "heard", "dur")})
        if best is None or j["score"] < best["score"]:
            best = j
        if not j["issues"]:
            break
        log(f"  {line_id} unit {unit + 1} take {attempt + 1}: {'; '.join(j['issues'])}")
    return best, dict(text=text, chosen_take=best["attempt"], seed=best["seed"], issues=best["issues"],
                      heard=best["heard"], takes=tried)


def render_segment(voice, line_id, setting, unit, seg, takes_dir, log):
    params = COLD_QUOTE if seg.get("cold") else SETTINGS[setting]
    takes, meta = [], []
    for text in sentences(seg["text"]):
        best, m = render_sentence(voice, line_id, setting, unit, text, params, takes_dir, log)
        m["unit"] = unit + 1
        unit += 1
        takes.append(best["wav"])
        meta.append(m)
    return takes, unit, dict(text=seg["text"], at=seg.get("at"), after=seg.get("after"), params=params,
                             words=len(norm_words(seg["text"])),
                             sentence_s=[round(len(t) / voice.sr, 4) for t in takes], sentences=meta)


def render_line(line, voice, setting, takes_dir, log):
    segs, wavs = [], []
    unit = 0
    for seg in segments_for(line):
        wav, unit, m = render_segment(voice, line["id"], setting, unit, seg, takes_dir, log)
        segs.append(m)
        wavs.append(wav)
    return wavs, segs


def seg_len(m, pause, factor):
    return factor * (sum(m["sentence_s"]) + pause * (len(m["sentence_s"]) - 1))


def layout(segs, pause, factor):
    cursor, offsets = 0.0, []
    for i, m in enumerate(segs):
        at = m["at"] if m["at"] is not None else cursor + m["after"]
        at = max(at, cursor + (0.25 if i else 0.0))
        offsets.append(at)
        cursor = at + seg_len(m, pause, factor)
    return offsets, cursor


def choose_edit(segs, room):
    words = sum(m["words"] for m in segs)
    natural = words / sum(seg_len(m, SENTENCE_PAUSE, 1.0) for m in segs) * 60
    best = None
    for pause in np.arange(MIN_PAUSE, MAX_PAUSE + 1e-6, 0.05):
        for factor in np.arange(1.0, MAX_STRETCH + 1e-6, 0.01):
            wpm = words / sum(seg_len(m, pause, factor) for m in segs) * 60
            over = max(0.0, layout(segs, pause, factor)[1] - room)
            fast = max(0.0, wpm - (MAX_WPM - 2))
            cost = (10 * over + 0.5 * fast + 3 * (factor - 1) + max(0.0, wpm - TARGET_WPM) / 40
                    + abs(pause - SENTENCE_PAUSE))
            if best is None or cost < best[0]:
                best = (cost, round(float(pause), 2), round(float(factor), 3))
    return best[1], best[2], natural


def build_segment(takes, pause, factor, sr):
    gap = np.zeros(int(pause * sr), dtype=np.float32)
    pieces = []
    for t in takes:
        pieces += [gap, t] if pieces else [t]
    return stretch(np.concatenate(pieces), sr, factor)


def place(seg_takes, segs, pause, factor, sr):
    wavs = [build_segment(t, pause, factor, sr) for t in seg_takes]
    offsets, _ = layout(segs, pause, factor)
    end = max(o + len(w) / sr for o, w in zip(offsets, wavs))
    out = np.zeros(int(np.ceil(end * sr)) + 1, dtype=np.float32)
    for o, w in zip(offsets, wavs):
        i = int(round(o * sr))
        out[i:i + len(w)] += w[: len(out) - i]
    return out, offsets, sum(len(w) for w in wavs) / sr


def fit(lines, timing):
    by = {t["id"]: t for t in timing}
    for k, line in enumerate(lines):
        t = by.get(line["id"])
        if not t:
            continue
        nxt = lines[k + 1]["start_s"] if k + 1 < len(lines) else FILM_S
        t["end_s"] = round(t["start_s"] + t["duration_s"], 3)
        t["next_start_s"] = nxt
        t["gap_s"] = round(nxt - t["end_s"], 3)
        t["fits"] = t["gap_s"] >= MIN_GAP_S and t["wpm"] <= MAX_WPM


def write_overruns(setting, lines, timing):
    bad = [t for t in timing if not t.get("fits", True)]
    rows = [f"# Voiceover overruns (setting {setting})", "",
            f"A line overruns when it ends less than {MIN_GAP_S} s before the next line starts, "
            f"or is faster than {MAX_WPM:.0f} words per minute. VOICEOVER.md is unchanged; "
            "these are proposals only.", ""]
    if not bad:
        rows.append("No line overruns its slot.")
    else:
        rows += ["| ID | Slot (s) | Rendered (s) | Gap (s) | WPM | Current line | Proposed line |",
                 "|:-|-:|-:|-:|-:|:-|:-|"]
        text = {l["id"]: l["text"] for l in lines}
        for t in bad:
            slot = t["next_start_s"] - t["start_s"]
            rows.append(f"| {t['id']} | {slot:.1f} | {t['duration_s']:.2f} | {t['gap_s']:.2f} | {t['wpm']:.0f} | "
                        f"{text[t['id']]} | {PROPOSALS.get(t['id'], 'to be written')} |")
    (OUT / "OVERRUNS.md").write_text("\n".join(rows) + "\n")


def run_lines(voice, setting, ids, log):
    lines = parse_script()
    out_dir = OUT / setting
    takes, raw = out_dir / "takes", out_dir / "raw"
    takes.mkdir(parents=True, exist_ok=True)
    raw.mkdir(exist_ok=True)
    tpath = out_dir / "timing.json"
    timing = {t["id"]: t for t in json.loads(tpath.read_text())} if tpath.exists() else {}
    for line in lines:
        if ids and line["id"] not in ids:
            continue
        log(f"{line['id']} {line['text']}")
        seg_takes, segs = render_line(line, voice, setting, takes, log)
        for i, ts in enumerate(seg_takes):
            for j, w in enumerate(ts):
                sf.write(raw / f"{line['id']}-s{i + 1}-{j + 1}.wav", w, voice.sr, subtype="FLOAT")
        timing[line["id"]] = dict(id=line["id"], start=line["start"], start_s=line["start_s"],
                                  words=len(norm_words(line["text"])),
                                  rerolled=any(len(u["takes"]) > 1 for m in segs for u in m["sentences"]),
                                  segments=segs)
    order = [l["id"] for l in lines]
    tpath.write_text(json.dumps([timing[i] for i in order if i in timing], indent=1))
    return finalize(setting, log)


def finalize(setting, log):
    lines = parse_script()
    out_dir = OUT / setting
    tpath = out_dir / "timing.json"
    by = {t["id"]: t for t in json.loads(tpath.read_text())}
    for k, line in enumerate(lines):
        t = by.get(line["id"])
        if not t:
            continue
        nxt = lines[k + 1]["start_s"] if k + 1 < len(lines) else FILM_S
        segs = t["segments"]
        sr = None
        seg_takes = []
        for i, m in enumerate(segs):
            ts = []
            for j in range(len(m["sentences"])):
                w, sr = sf.read(out_dir / "raw" / f"{line['id']}-s{i + 1}-{j + 1}.wav", dtype="float32")
                ts.append(w)
            seg_takes.append(ts)
        pause, factor, natural = choose_edit(segs, nxt - line["start_s"] - MIN_GAP_S)
        wav, offsets, speech = place(seg_takes, segs, pause, factor, sr)
        sf.write(out_dir / f"{line['id']}.wav", wav, sr, subtype="PCM_24")
        for m, o in zip(segs, offsets):
            m["offset_s"] = round(o, 3)
            m["duration_s"] = round(seg_len(m, pause, factor), 3)
        t.update(natural_wpm=round(natural, 1), pause_s=pause, stretch=factor,
                 duration_s=round(len(wav) / sr, 3), speech_s=round(speech, 3),
                 wpm=round(t["words"] / speech * 60, 1))
    tl = [by[l["id"]] for l in lines if l["id"] in by]
    fit(lines, tl)
    tpath.write_text(json.dumps(tl, indent=1))
    write_overruns(setting, lines, tl)
    return lines, tl


def run_ffmpeg_chain(x, sr):
    chain = ("highpass=f=80,equalizer=f=250:t=q:w=1.0:g=-2,equalizer=f=3500:t=q:w=1.2:g=1.5,"
             "deesser=i=0.35:m=0.5:f=0.5,"
             "acompressor=threshold=0.1:ratio=2.5:attack=8:release=120:knee=4")
    with tempfile.TemporaryDirectory() as d:
        a, b = Path(d) / "in.wav", Path(d) / "out.wav"
        sf.write(a, x, sr, subtype="FLOAT")
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(a), "-af", chain, "-c:a", "pcm_f32le", str(b)],
                       check=True)
        y, _ = sf.read(b, dtype="float32")
    return y


def short_term(path, regions):
    r = subprocess.run(["ffmpeg", "-hide_banner", "-nostats", "-i", str(path), "-af",
                        "ebur128=metadata=1,ametadata=mode=print:key=lavfi.r128.S", "-f", "null", "-"],
                       capture_output=True, text=True)
    vals = []
    for t, v in re.findall(r"pts_time:([\d.]+)\s*\n.*?lavfi\.r128\.S=(-?[\d.]+)", r.stderr):
        centre = (float(t) - 1.5) * STEM_SR
        if any(a <= centre < b for a, b in regions):
            vals.append(float(v))
    return np.array(vals)


def build_stem(setting, log):
    lines = parse_script()
    out_dir = OUT / setting
    timing = json.loads((out_dir / "timing.json").read_text())
    by = {t["id"]: t for t in timing}
    meter = pyln.Meter(STEM_SR)
    stem = np.zeros(int(FILM_S * STEM_SR), dtype=np.float32)
    cursor = 0.0
    regions = []
    for line in lines:
        f = out_dir / f"{line['id']}.wav"
        if not f.exists():
            sys.exit(f"missing {f}; render all lines first")
        x, sr = sf.read(f, dtype="float32")
        x = resample_poly(x, STEM_SR, sr).astype(np.float32)
        x = run_ffmpeg_chain(x, STEM_SR)
        x *= 10 ** ((TARGET_LUFS - meter.integrated_loudness(x)) / 20)
        peak = np.abs(x).max()
        if peak > 10 ** (-1.5 / 20):
            x = np.tanh(x / peak * 1.2) / np.tanh(1.2) * 10 ** (-1.5 / 20)
        at = max(line["start_s"], cursor + MIN_GAP_S if cursor else 0.0)
        if at > line["start_s"]:
            log(f"  {line['id']} pushed {at - line['start_s']:.2f}s late to avoid overlap")
        i = int(round(at * STEM_SR))
        n = min(len(x), len(stem) - i)
        stem[i:i + n] += x[:n]
        cursor = at + len(x) / STEM_SR
        by[line["id"]]["placed_s"] = round(at, 3)
        regions.append((i, i + n))
    path = out_dir / "vo-stem.wav"
    sf.write(path, stem, STEM_SR, subtype="FLOAT")
    trim_db = TARGET_LUFS - float(np.median(short_term(path, regions)))
    stem *= 10 ** (trim_db / 20)
    if np.abs(stem).max() > 10 ** (-1 / 20):
        stem *= 10 ** (-1 / 20) / np.abs(stem).max()
    sf.write(path, stem, STEM_SR, subtype="PCM_24")
    st = short_term(path, regions)
    (out_dir / "timing.json").write_text(json.dumps([by[l["id"]] for l in lines], indent=1))
    summary = dict(length_s=len(stem) / STEM_SR, sample_rate=STEM_SR, trim_db=round(trim_db, 2),
                   short_term_lufs_median=round(float(np.median(st)), 2),
                   short_term_lufs_p10=round(float(np.percentile(st, 10)), 2),
                   short_term_lufs_p90=round(float(np.percentile(st, 90)), 2),
                   peak_dbfs=round(float(20 * np.log10(np.abs(stem).max())), 2))
    pushed = [(l["id"], by[l["id"]]["placed_s"] - l["start_s"]) for l in lines
              if by[l["id"]]["placed_s"] > l["start_s"] + 1e-3]
    rows = ["", "## Placement in vo-stem.wav", ""]
    if pushed:
        rows.append("Each line starts at its script time unless the line before it is still playing. "
                    f"These lines start late to keep {MIN_GAP_S} s of silence after the line before:")
        rows += [""] + [f"- {i}: {d:.2f} s late" for i, d in pushed]
    else:
        rows.append("Every line starts at its script time.")
    with open(OUT / "OVERRUNS.md", "a") as fh:
        fh.write("\n".join(rows) + "\n")
    log(json.dumps(summary))
    return summary


def clean_ref(src):
    x, sr = sf.read(src, dtype="float64")
    if x.ndim > 1:
        x = x.mean(axis=1)
    y = trim(x, sr, floor_db=-45, pad=0.1)
    y *= 10 ** (-1 / 20) / np.abs(y).max()
    REF_CLEAN.parent.mkdir(parents=True, exist_ok=True)
    sf.write(REF_CLEAN, y, sr, subtype="PCM_16")
    print(f"{REF_CLEAN}: {len(y) / sr:.2f}s")


def run_samples(voice, log):
    lines = {l["id"]: l for l in parse_script()}
    SAMPLES.mkdir(exist_ok=True)
    meter = pyln.Meter(voice.sr)
    report = {}
    for s in "abc":
        log(f"sample {s} {SETTINGS[s]}")
        parts, meta = [], []
        for lid in ("V02", "V23"):
            seg_takes, segs = render_line(lines[lid], voice, s, None, log)
            pause, factor, natural = choose_edit(segs, float("inf"))
            wav, _, speech = place(seg_takes, segs, pause, factor, voice.sr)
            parts += [wav, np.zeros(int(0.8 * voice.sr), dtype=np.float32)]
            meta.append(dict(id=lid, natural_wpm=round(natural, 1), pause_s=pause, stretch=factor,
                             wpm=round(sum(m["words"] for m in segs) / speech * 60, 1), segments=segs))
        y = np.concatenate(parts[:-1])
        y *= 10 ** ((TARGET_LUFS - meter.integrated_loudness(y)) / 20)
        sf.write(SAMPLES / f"sample-{s}.wav", y, voice.sr, subtype="PCM_24")
        report[s] = dict(params=SETTINGS[s], lines=meta)
    (SAMPLES / "samples.json").write_text(json.dumps(report, indent=1))
    gap = SAMPLES / "gap.wav"
    sf.write(gap, np.zeros(voice.sr, dtype=np.float32), voice.sr)
    args = []
    for f in ["sample-a.wav", "gap.wav", "sample-b.wav", "gap.wav", "sample-c.wav"]:
        args += ["-i", str(SAMPLES / f)]
    subprocess.run(["ffmpeg", "-v", "error", "-y", *args, "-filter_complex", "concat=n=5:v=0:a=1",
                    "-ar", "48000", "-ac", "1", "-b:a", "192k", str(SAMPLES / "samples.mp3")], check=True)
    gap.unlink()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--setting", choices=list(SETTINGS), default="b")
    ap.add_argument("--lines", default="all", help="all, or a list such as V01,V05")
    ap.add_argument("--ref", default=os.environ.get("PORTHMOS_VO_REF", str(REF_CLEAN)))
    ap.add_argument("--samples", action="store_true", help="render V02 and V23 with settings a, b and c")
    ap.add_argument("--stem", action="store_true", help="only build vo-stem.wav from rendered lines")
    ap.add_argument("--clean-ref", metavar="SRC", help="trim and peak-normalise a reference into ref/")
    a = ap.parse_args()

    def log(msg):
        print(msg, flush=True)
        with open(OUT / "render.log", "a") as fh:
            fh.write(msg + "\n")

    OUT.mkdir(exist_ok=True)
    if a.clean_ref:
        return clean_ref(a.clean_ref)
    if a.stem:
        finalize(a.setting, log)
        return build_stem(a.setting, log)
    if not Path(a.ref).exists():
        sys.exit(f"reference voice not found: {a.ref}")
    voice = Voice(a.ref)
    if a.samples:
        return run_samples(voice, log)
    ids = None if a.lines == "all" else {s.strip().upper() for s in a.lines.split(",")}
    log(f"== render setting {a.setting} lines {a.lines} on {voice.device}")
    run_lines(voice, a.setting, ids, log)
    if ids is None:
        build_stem(a.setting, log)


if __name__ == "__main__":
    main()
