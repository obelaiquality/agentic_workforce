#!/usr/bin/env node
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  ensureDir,
  ensureFfmpegInstalled,
  findLatestOutputDir,
  getArgValue,
  getDemoFrameManifest,
  rootDir,
  timestampSlug,
  writeJson,
} from "./suite-utils.mjs";

const argv = process.argv.slice(2);
const sourceDirArg = getArgValue(argv, "--source-dir");
const gifOutArg = getArgValue(argv, "--gif-out");
const videoOutArg = getArgValue(argv, "--video-out");
const sourceDir =
  sourceDirArg ||
  findLatestOutputDir("desktop-acceptance-") ||
  path.join(rootDir, "docs", "screenshots");

ensureFfmpegInstalled();

const renderDir = path.join(rootDir, "output", "playwright", `demo-render-${timestampSlug()}`);
const frameDir = path.join(renderDir, "frames");
const gifOut = gifOutArg || path.join(rootDir, "docs", "media", "agentic-workforce-demo.gif");
const videoOut =
  videoOutArg || path.join(renderDir, "agentic-workforce-demo.mp4");

await ensureDir(frameDir);
await ensureDir(path.dirname(gifOut));
await ensureDir(path.dirname(videoOut));

const requestedFrames = getDemoFrameManifest(sourceDir);
const availableFrames = requestedFrames
  .map((fileName) => path.join(sourceDir, fileName))
  .filter((filePath) => fs.existsSync(filePath));

if (availableFrames.length < 3) {
  throw new Error(`Demo render needs at least 3 frames. Source checked: ${sourceDir}`);
}

for (const [index, sourcePath] of availableFrames.entries()) {
  const targetPath = path.join(frameDir, `${String(index).padStart(3, "0")}.png`);
  await fsp.copyFile(sourcePath, targetPath);
}

const frameInput = path.join(frameDir, "%03d.png");
const videoArgs = [
  "-y",
  "-framerate",
  "0.45",
  "-i",
  frameInput,
  "-vf",
  "scale=1280:-2:force_original_aspect_ratio=decrease,pad=1280:800:(ow-iw)/2:(oh-ih)/2:color=#0a0a0c,format=yuv420p",
  "-pix_fmt",
  "yuv420p",
  videoOut,
];
const gifArgs = [
  "-y",
  "-framerate",
  "0.45",
  "-i",
  frameInput,
  "-vf",
  "fps=12,scale=960:-2:force_original_aspect_ratio=decrease,pad=960:600:(ow-iw)/2:(oh-ih)/2:color=#0a0a0c,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse",
  gifOut,
];

const video = spawnSync("ffmpeg", videoArgs, { cwd: rootDir, encoding: "utf8" });
if (video.status !== 0) {
  throw new Error(video.stderr || video.stdout || "ffmpeg video render failed");
}

const gif = spawnSync("ffmpeg", gifArgs, { cwd: rootDir, encoding: "utf8" });
if (gif.status !== 0) {
  throw new Error(gif.stderr || gif.stdout || "ffmpeg GIF render failed");
}

await writeJson(path.join(renderDir, "summary.json"), {
  sourceDir,
  frames: availableFrames.map((filePath) => path.basename(filePath)),
  gifOut,
  videoOut,
});

process.stdout.write(
  `${JSON.stringify(
    {
      sourceDir,
      gifOut,
      videoOut,
      frameCount: availableFrames.length,
    },
    null,
    2
  )}\n`
);
