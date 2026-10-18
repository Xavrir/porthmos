// Pulls the latest footage and soundtrack from the sibling agents' folders into assets/, or makes clearly marked
// stand-ins when they are not delivered yet. Run before preview or render: `node scripts/sync-media.mjs`.
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const FILM = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const VIDEO = resolve(FILM, "..");
const FOOTAGE_SRC = join(VIDEO, "footage");
const SOUND_SRC = join(VIDEO, "sound", "out", "soundtrack.wav");
const FOOTAGE_OUT = join(FILM, "assets", "footage");
const AUDIO_OUT = join(FILM, "assets", "audio", "soundtrack.wav");
const FONT = "/usr/share/fonts/TTF/JetBrainsMonoNerdFont-Regular.ttf";
const FILM_SECONDS = 180;

const CLIPS = {
  R1: { secs: 90 },
  "R1-intro": { secs: 15 },
  R2: { secs: 45 },
  "R2-T3-approve": { secs: 31 },
  R3: { secs: 30 },
  R4: { secs: 23 },
  "R6-freeze": { secs: 31 },
  "R6-exit": { secs: 20 },
  R7: { secs: 41 },
};
// The app shows a 28 px "Test mode" banner at the top. Cropping it and scaling back up keeps the aspect ratio and
// trims 23 px from each side.
const STRIP_CROP = "crop=1920:1052:0:28,scale=1966:1080:flags=lanczos,crop=1920:1080,format=yuv420p";

function run(cmd, args) {
  const r = spawnSync(cmd, args, { stdio: ["ignore", "inherit", "inherit"] });
  if (r.status !== 0) throw new Error(`${cmd} failed with ${r.status}`);
}

function readManifest() {
  const p = join(FOOTAGE_SRC, "manifest.json");
  if (!existsSync(p)) return {};
  const raw = JSON.parse(readFileSync(p, "utf8"));
  const list = Array.isArray(raw) ? raw : Array.isArray(raw.clips) ? raw.clips : Object.entries(raw.clips || raw).map(([id, v]) => ({ id, ...(typeof v === "string" ? { file: v } : v) }));
  const out = {};
  for (const c of list) {
    const id = String(c.id || c.clip || c.name || "");
    const file = c.file || c.path || c.src;
    if (id && file) out[id] = { ...c, file: resolve(FOOTAGE_SRC, file) };
  }
  return out;
}

function fromSequence(dir, out, fps) {
  const frames = readdirSync(dir).filter((f) => f.endsWith(".png")).sort();
  if (!frames.length) throw new Error(`no PNG frames in ${dir}`);
  const list = join(FOOTAGE_OUT, ".seq.txt");
  writeFileSync(list, frames.map((f) => `file '${join(dir, f).replace(/'/g, "'\\''")}'\nduration ${1 / fps}`).join("\n"));
  run("ffmpeg", ["-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", list, "-vf", `fps=${fps},${STRIP_CROP}`, "-c:v", "libx264", "-crf", "16", "-g", "30", out]);
}

// A missing clip gets a plain night-coloured stand-in so the composition still resolves; scenes check
// data/media.js and show their fallback instead of the clip.
function placeholder(id, out) {
  run("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", `color=c=0x07110D:s=1920x1080:r=30:d=${CLIPS[id].secs}`, "-c:v", "libx264", "-preset", "veryfast", "-crf", "30", "-g", "30", "-pix_fmt", "yuv420p", out]);
}

mkdirSync(FOOTAGE_OUT, { recursive: true });
mkdirSync(dirname(AUDIO_OUT), { recursive: true });
const manifest = readManifest();
const statusPath = join(FILM, "data", "media-status.json");
const previous = existsSync(statusPath) ? JSON.parse(readFileSync(statusPath, "utf8")) : { footage: {} };
const status = { footage: {}, soundtrack: null };

for (const id of Object.keys(CLIPS)) {
  const out = join(FOOTAGE_OUT, `${id}.mp4`);
  const m = manifest[id] || (existsSync(join(FOOTAGE_SRC, `${id}.mp4`)) ? { file: join(FOOTAGE_SRC, `${id}.mp4`) } : null);
  if (m && existsSync(m.file)) {
    const st = statSync(m.file);
    const stamp = `${st.size}:${st.mtimeMs}`;
    const prev = previous.footage[id];
    if (!(prev && !prev.placeholder && prev.stamp === stamp && existsSync(out))) {
      if (st.isDirectory()) fromSequence(m.file, out, m.fps || 30);
      else run("ffmpeg", ["-v", "error", "-y", "-i", m.file, "-vf", STRIP_CROP, "-an", "-c:v", "libx264", "-crf", "16", "-preset", "medium", "-g", "30", out]);
    }
    status.footage[id] = { source: m.file, placeholder: false, stamp, marks: m.marks || null };
  } else {
    if (!(previous.footage[id]?.placeholder && existsSync(out))) placeholder(id, out);
    status.footage[id] = { placeholder: true };
  }
  console.log(`${id}: ${status.footage[id].placeholder ? "placeholder" : "real"}`);
}

if (existsSync(SOUND_SRC)) {
  copyFileSync(SOUND_SRC, AUDIO_OUT);
  status.soundtrack = { source: SOUND_SRC, placeholder: false };
} else {
  run("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo", "-t", String(FILM_SECONDS), "-c:a", "pcm_s16le", AUDIO_OUT]);
  status.soundtrack = { placeholder: true };
}
console.log(`soundtrack: ${status.soundtrack.placeholder ? "silent stand-in" : "real"}`);
const cues = join(VIDEO, "sound", "cues.json");
if (existsSync(cues)) copyFileSync(cues, join(FILM, "data", "cues.json"));
writeFileSync(statusPath, JSON.stringify(status, null, 2) + "\n");
const real = Object.fromEntries(Object.entries(status.footage).map(([k, v]) => [k, !v.placeholder]));
writeFileSync(join(FILM, "data", "media.js"), `window.PORTHMOS_MEDIA = ${JSON.stringify(real)};\n`);
const facts = JSON.parse(readFileSync(join(FILM, "data", "facts.json"), "utf8"));
facts.tests.total = Object.values(facts.tests).reduce((a, b) => a + b, 0);
writeFileSync(join(FILM, "data", "facts.js"), `window.PORTHMOS_FACTS = ${JSON.stringify(facts)};\n`);
