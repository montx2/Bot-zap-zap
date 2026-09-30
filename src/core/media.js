import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { CONFIG } from './config.js';

export const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
export const randomId = () => crypto.randomBytes(10).toString('hex');

export async function ensureFile(pathname) {
  await fs.mkdir(path.dirname(pathname), { recursive: true });
  return pathname;
}

/**
 * Executa o FFmpeg.
 * - `opts` pode ser um número (timeout em ms, compatível com a versão antiga)
 *   ou { timeoutMs, stdin: Buffer, stdinStream: (writable)=>Promise, stdout: true }.
 * - Com `stdout:true` devolve { stdout: Buffer }.
 */
export async function runFfmpeg(args, opts = 45_000) {
  const o = typeof opts === 'number' ? { timeoutMs: opts } : opts || {};
  const timeoutMs = o.timeoutMs || 45_000;
  return new Promise((resolve, reject) => {
    const hasStdin = o.stdin != null || typeof o.stdinStream === 'function';
    const p = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-nostdin', ...args], {
      stdio: [hasStdin ? 'pipe' : 'ignore', 'pipe', 'pipe']
    });
    let stderr = '';
    const out = [];
    let settled = false;
    const done = (fn, v) => { if (settled) return; settled = true; clearTimeout(timer); fn(v); };
    p.stderr.on('data', (d) => { stderr += d.toString(); if (stderr.length > 4000) stderr = stderr.slice(-4000); });
    p.stdout.on('data', (d) => { if (o.stdout) out.push(d); });
    const timer = setTimeout(() => { p.kill('SIGKILL'); done(reject, new Error('FFmpeg excedeu o tempo limite')); }, timeoutMs);
    p.on('error', (e) => done(reject, e.code === 'ENOENT' ? new Error('FFmpeg não está instalado (pkg install ffmpeg)') : e));
    p.on('close', (code) => {
      if (code === 0) done(resolve, { stdout: o.stdout ? Buffer.concat(out) : '', stderr });
      else done(reject, new Error(cleanFfmpegError(stderr) || `FFmpeg saiu com código ${code}`));
    });
    if (hasStdin) {
      p.stdin.on('error', () => {});
      if (o.stdin != null) p.stdin.end(o.stdin);
      else Promise.resolve(o.stdinStream(p.stdin)).then(() => p.stdin.end(), (e) => { p.kill('SIGKILL'); done(reject, e); });
    }
  });
}

function cleanFfmpegError(stderr) {
  const lines = String(stderr || '').split('\n').map((l) => l.trim()).filter(Boolean);
  return lines.slice(-3).join(' | ').slice(0, 400);
}

/** Lê duração, dimensões e streams via `ffmpeg -i` (não exige ffprobe). */
export async function probeMedia(file) {
  const text = await new Promise((resolve) => {
    const p = spawn('ffmpeg', ['-hide_banner', '-nostdin', '-i', file], { stdio: ['ignore', 'ignore', 'pipe'] });
    let s = '';
    p.stderr.on('data', (d) => { s += d.toString(); if (s.length > 20000) s = s.slice(0, 20000); });
    const t = setTimeout(() => p.kill('SIGKILL'), 15_000);
    p.on('error', () => { clearTimeout(t); resolve(''); });
    p.on('close', () => { clearTimeout(t); resolve(s); });
  });
  const info = { duration: 0, hasVideo: false, hasAudio: false, width: 0, height: 0, fps: 0 };
  const d = text.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  if (d) info.duration = Number(d[1]) * 3600 + Number(d[2]) * 60 + Number(d[3]);
  const v = text.match(/Stream #[^\n]*Video:[^\n]*/);
  if (v) {
    info.hasVideo = true;
    const dim = v[0].match(/,\s*(\d{2,5})x(\d{2,5})/);
    if (dim) { info.width = Number(dim[1]); info.height = Number(dim[2]); }
    const fps = v[0].match(/([\d.]+)\s*fps/);
    if (fps) info.fps = Number(fps[1]);
  }
  info.hasAudio = /Stream #[^\n]*Audio:/.test(text);
  return info;
}

let capsCache = null;
/** Detecta FFmpeg e suporte a WebP/libx264/opus/mp3 (cacheado). */
export async function ffmpegCapabilities(force = false) {
  if (capsCache && !force) return capsCache;
  const run = (args) => new Promise((resolve) => {
    const p = spawn('ffmpeg', ['-hide_banner', ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    let s = '';
    p.stdout.on('data', (d) => { s += d; });
    p.stderr.on('data', (d) => { s += d; });
    p.on('error', () => resolve(null));
    p.on('close', () => resolve(s));
  });
  const version = await run(['-version']);
  if (!version) return (capsCache = { installed: false, webp: false, h264: false, opus: false, mp3: false, version: '' });
  const enc = (await run(['-encoders'])) || '';
  capsCache = {
    installed: true,
    version: (version.match(/ffmpeg version (\S+)/) || [])[1] || '?',
    webp: /\blibwebp\b/.test(enc),
    h264: /\blibx264\b/.test(enc),
    opus: /\blibopus\b/.test(enc),
    mp3: /\blibmp3lame\b/.test(enc)
  };
  return capsCache;
}

/** Cria um diretório temporário exclusivo para um trabalho e apaga no fim. */
export async function withTempDir(fn, prefix = 'job') {
  const dir = path.join(CONFIG.TMP_DIR, `${prefix}-${Date.now()}-${randomId().slice(0, 6)}`);
  await fs.mkdir(dir, { recursive: true });
  try { return await fn(dir); } finally { await fs.rm(dir, { recursive: true, force: true }).catch(() => {}); }
}

/** Remove restos de trabalhos antigos em .tmp (queda de energia, kill -9...). */
export async function cleanTmp(maxAgeMs = 3600_000) {
  let removed = 0;
  try {
    for (const e of await fs.readdir(CONFIG.TMP_DIR, { withFileTypes: true })) {
      const p = path.join(CONFIG.TMP_DIR, e.name);
      const st = await fs.stat(p).catch(() => null);
      if (st && Date.now() - st.mtimeMs > maxAgeMs) { await fs.rm(p, { recursive: true, force: true }).catch(() => {}); removed++; }
    }
  } catch { /* .tmp ainda não existe */ }
  return removed;
}

const GIF_SCALE = "scale='trunc(min(480,iw)/2)*2':-2:flags=lanczos";

export async function convertMedia(input, output, mode, { maxSeconds = CONFIG.STICKER_MAX_SECONDS } = {}) {
  await ensureFile(output);
  const modes = {
    ptt: () => ['-i', input, '-vn', '-ac', '1', '-c:a', 'libopus', '-b:a', '48k', '-application', 'voip', '-map_metadata', '-1', '-y', output],
    mp3: () => ['-i', input, '-vn', '-c:a', 'libmp3lame', '-q:a', '4', '-map_metadata', '-1', '-y', output],
    // "GIF" do WhatsApp = MP4 sem áudio com gifPlayback.
    gif: () => ['-i', input, '-t', String(Math.max(maxSeconds, 15)), '-an', '-vf', `fps=15,${GIF_SCALE},format=yuv420p`, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '27', '-movflags', '+faststart', '-map_metadata', '-1', '-y', output],
    // Vídeo normal (mantém áudio se existir).
    mp4: () => ['-i', input, '-t', '180', '-vf', `${GIF_SCALE},format=yuv420p`, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '26', '-c:a', 'aac', '-b:a', '96k', '-movflags', '+faststart', '-map_metadata', '-1', '-y', output],
    png: () => ['-i', input, '-frames:v', '1', '-y', output],
    // Modos antigos (mantidos por compatibilidade; o motor novo fica em modules/stickers.js).
    sticker: () => ['-i', input, '-vf', 'scale=512:512:force_original_aspect_ratio=decrease:flags=lanczos,format=rgba,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=0x00000000', '-c:v', 'libwebp', '-lossless', '0', '-q:v', '75', '-frames:v', '1', '-y', output],
    stickerVideo: () => ['-i', input, '-t', String(maxSeconds), '-vf', 'fps=12,scale=512:512:force_original_aspect_ratio=decrease:flags=lanczos,format=rgba,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=0x00000000', '-an', '-c:v', 'libwebp', '-q:v', '55', '-loop', '0', '-y', output]
  };
  if (!modes[mode]) throw new Error(`modo FFmpeg desconhecido: ${mode}`);
  await runFfmpeg(modes[mode](), { timeoutMs: 120_000 });
  return output;
}

export function extFromMime(mime = '', fallback = 'bin') {
  const m = String(mime).toLowerCase();
  if (m.includes('jpeg') || m.includes('jpg')) return 'jpg';
  if (m.includes('png')) return 'png';
  if (m.includes('webp')) return 'webp';
  if (m.includes('gif')) return 'gif';
  if (m.includes('mp4')) return 'mp4';
  if (m.includes('webm')) return 'webm';
  if (m.includes('quicktime')) return 'mov';
  if (m.includes('3gpp')) return '3gp';
  if (m.includes('matroska')) return 'mkv';
  if (m.includes('ogg')) return 'ogg';
  if (m.includes('mpeg')) return 'mp3';
  if (m.includes('pdf')) return 'pdf';
  return fallback;
}
