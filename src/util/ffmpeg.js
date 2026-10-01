// FFmpeg: detecção e conversão para figurinhas (WebP 512x512).
// Sem dependência npm — chama o binário do sistema (Termux/Linux/Windows).

import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

let ffmpegPath = null;

export function findFfmpeg() {
  if (ffmpegPath !== null) return ffmpegPath;
  const exe = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
  const candidates = [
    exe,
    path.join(process.cwd(), 'bin', exe),
    // Termux coloca os binários em $PREFIX/bin
    process.env.PREFIX ? path.join(process.env.PREFIX, 'bin', exe) : null,
    '/data/data/com.termux/files/usr/bin/ffmpeg'
  ].filter(Boolean);
  for (const c of candidates) {
    try {
      const probe = spawnSync(c, ['-version'], { timeout: 5000 });
      if (probe.status === 0) {
        ffmpegPath = c;
        return c;
      }
    } catch {}
  }
  ffmpegPath = false;
  return false;
}

export function hasFfmpeg() {
  return !!findFfmpeg();
}

function runFfmpeg(args, { timeoutMs = 120_000 } = {}) {
  return new Promise((resolve, reject) => {
    const bin = findFfmpeg();
    if (!bin) return reject(new Error('FFmpeg não encontrado. Instale com: pkg install ffmpeg (Termux) / apt install ffmpeg / winget install ffmpeg'));
    const proc = spawn(bin, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    const timer = setTimeout(() => proc.kill('SIGKILL'), timeoutMs);
    proc.stderr.on('data', (d) => {
      stderr += d.toString();
      if (stderr.length > 20_000) stderr = stderr.slice(-20_000);
    });
    proc.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    proc.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg saiu com código ${code}: ${stderr.slice(-300)}`));
    });
  });
}

function tmpFile(ext) {
  return path.join(os.tmpdir(), `nexus-${crypto.randomBytes(6).toString('hex')}${ext}`);
}

/**
 * Converte imagem/vídeo/gif em WebP de figurinha (512x512, com transparência).
 * @param {Buffer} input mídia original
 * @param {{animated?: boolean, maxSeconds?: number, ext?: string}} opts
 * @returns {Promise<{buffer: Buffer, animated: boolean}>}
 */
export async function toStickerWebp(input, { animated = false, maxSeconds = 9, ext = '.png' } = {}) {
  const inFile = tmpFile(ext);
  const outFile = tmpFile('.webp');
  fs.writeFileSync(inFile, input);
  try {
    // scale+pad 512x512 mantendo proporção, fundo transparente
    const vf =
      'scale=512:512:force_original_aspect_ratio=decrease,format=rgba,' +
      'pad=512:512:(ow-iw)/2:(oh-ih)/2:color=#00000000';
    if (!animated) {
      // Encoder estático: impede WebP animado de um único quadro.
      await runFfmpeg(['-y', '-i', inFile, '-frames:v', '1', '-an', '-vf', vf, '-c:v', 'libwebp',
        '-lossless', '0', '-compression_level', '4', '-quality', '75', outFile]);
      const buffer = fs.readFileSync(outFile);
      if (!buffer.length) throw new Error('ffmpeg não gerou saída');
      return { buffer, animated: false };
    }
    const tries = [
      { q: 60, fps: 15, t: maxSeconds },
      { q: 45, fps: 12, t: Math.min(maxSeconds, 7) },
      { q: 30, fps: 10, t: Math.min(maxSeconds, 6) }
    ];
    let buffer;
    for (const { q, fps, t } of tries) {
      await runFfmpeg(['-y', '-i', inFile, '-t', String(t), '-an', '-vf', `${vf},fps=${fps}`,
        '-loop', '0', '-lossless', '0', '-compression_level', '4', '-quality', String(q), outFile]);
      buffer = fs.readFileSync(outFile);
      if (buffer.length && buffer.length <= 500 * 1024) break;
    }
    if (!buffer?.length) throw new Error('ffmpeg não gerou saída');
    return { buffer, animated: true };
  } finally {
    fs.rmSync(inFile, { force: true });
    fs.rmSync(outFile, { force: true });
  }
}

/** WebP animado → GIF (para devolver figurinha como gif). */
export async function webpToGif(input) {
  const inFile = tmpFile('.webp');
  const outFile = tmpFile('.gif');
  fs.writeFileSync(inFile, input);
  try {
    await runFfmpeg(['-y', '-i', inFile, '-vf', 'fps=12', outFile]);
    return fs.readFileSync(outFile);
  } finally {
    fs.rmSync(inFile, { force: true });
    fs.rmSync(outFile, { force: true });
  }
}
