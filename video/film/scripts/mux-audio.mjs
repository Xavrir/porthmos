// HyperFrames' own audio mix lands about 6.6 dB under the mastered soundtrack, so after each render the audio
// track is replaced with the mastered WAV (-14 LUFS, true peak under -1 dBTP). The video stream is copied as is.
//   node scripts/mux-audio.mjs out/porthmos-launch.mp4
//   node scripts/mux-audio.mjs out/porthmos-launch-square.mp4 48
import { spawnSync } from "node:child_process";
import { renameSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const FILM = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const [video, seconds] = process.argv.slice(2);
if (!video) throw new Error("usage: mux-audio.mjs <video.mp4> [seconds]");
const src = resolve(FILM, video);
const tmp = join(dirname(src), ".mux-" + Date.now() + ".mp4");
const args = ["-v", "error", "-y", "-i", src, "-i", join(FILM, "assets", "audio", "soundtrack.wav"), "-map", "0:v", "-map", "1:a", "-c:v", "copy"];
if (seconds) args.push("-t", seconds, "-af", `afade=t=out:st=${Number(seconds) - 1.5}:d=1.5`);
args.push("-c:a", "aac", "-b:a", "320k", "-ar", "48000", "-shortest", "-movflags", "+faststart", tmp);
const r = spawnSync("ffmpeg", args, { stdio: "inherit" });
if (r.status !== 0) throw new Error("ffmpeg failed");
renameSync(tmp, src);
console.log("muxed", video);
