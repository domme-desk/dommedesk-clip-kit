import ffmpeg from 'fluent-ffmpeg';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { execSync } from 'child_process';

// Resolve the system ffmpeg/ffprobe binaries. On macOS dev, this is typically
// /opt/homebrew/bin/ffmpeg. On Linux/prod servers, it's /usr/bin/ffmpeg.
function which(cmd: string): string | null {
  try {
    return execSync(`which ${cmd}`, { encoding: 'utf8' }).trim() || null;
  } catch {
    return null;
  }
}

const ffmpegPath = which('ffmpeg');
const ffprobePath = which('ffprobe');
if (ffmpegPath) ffmpeg.setFfmpegPath(ffmpegPath);
if (ffprobePath) ffmpeg.setFfprobePath(ffprobePath);

export type ExtractedFrame = {
  timestamp: number;
  localPath: string;
};

export async function extractFrames(
  videoPath: string,
  count: number = 60
): Promise<ExtractedFrame[]> {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'clipkit-frames-'));

  const duration = await probeDuration(videoPath);

  const timestamps: number[] = [];
  const start = 1;
  const end = Math.max(duration - 1, start + 1);
  for (let i = 0; i < count; i++) {
    const t = start + ((end - start) * i) / (count - 1);
    timestamps.push(Number(t.toFixed(2)));
  }

  const frames: ExtractedFrame[] = [];
  for (const t of timestamps) {
    const out = path.join(tmpDir, `frame-${t.toFixed(2).replace('.', '_')}.jpg`);
    await new Promise<void>((resolve, reject) => {
      ffmpeg(videoPath)
        .seekInput(t)
        .frames(1)
        .outputOptions(['-q:v 2'])
        .output(out)
        .on('end', () => resolve())
        .on('error', reject)
        .run();
    });
    frames.push({ timestamp: t, localPath: out });
  }

  return frames;
}

async function probeDuration(videoPath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(videoPath, (err, data) => {
      if (err) return reject(err);
      const d = data.format?.duration;
      if (typeof d !== 'number') return reject(new Error('No duration in probe output'));
      resolve(d);
    });
  });
}

export async function downloadToTmp(url: string, extension: string = 'mp4'): Promise<string> {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'clipkit-dl-'));
  const hash = crypto.randomBytes(6).toString('hex');
  const out = path.join(tmpDir, `${hash}.${extension}`);

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed: ${res.status} ${res.statusText}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await fs.writeFile(out, buf);
  return out;
}

export async function cleanup(pathToRemove: string): Promise<void> {
  try {
    const stat = await fs.stat(pathToRemove);
    if (stat.isDirectory()) {
      await fs.rm(pathToRemove, { recursive: true, force: true });
    } else {
      await fs.unlink(pathToRemove);
    }
  } catch {
    // ignore
  }
}
