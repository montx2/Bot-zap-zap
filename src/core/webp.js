// Utilitários WebP em JavaScript puro (sem dependências).
//
// Por que existe: o WhatsApp lê o nome do pacote/autor/emojis de uma chunk EXIF
// dentro do próprio .webp. O FFmpeg não escreve essa chunk e o `webpmux` nem
// sempre existe no Termux, então o bot faz a injeção sozinho. Também é usado para
// detectar figurinhas animadas e para decodificar frames (FFmpeg 7.0 não lê WebP
// animado).

import crypto from 'node:crypto';

const VP8X_ALPHA = 0x10;
const VP8X_EXIF = 0x08;
const VP8X_ANIM = 0x02;

const u24 = (b, o) => b[o] | (b[o + 1] << 8) | (b[o + 2] << 16);

export function isWebp(buf) {
  return Buffer.isBuffer(buf) && buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP';
}

export function readChunks(buf) {
  if (!isWebp(buf)) throw new Error('arquivo não é um WebP válido');
  const chunks = [];
  let off = 12;
  const end = Math.min(buf.length, 8 + buf.readUInt32LE(4));
  while (off + 8 <= end) {
    const type = buf.toString('ascii', off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    const dataStart = off + 8;
    if (dataStart + size > buf.length) throw new Error(`chunk ${type} truncada`);
    chunks.push({ type, data: buf.subarray(dataStart, dataStart + size) });
    off = dataStart + size + (size & 1);
  }
  return chunks;
}

export function buildRiff(chunks) {
  const parts = [Buffer.from('WEBP', 'ascii')];
  for (const c of chunks) {
    const head = Buffer.alloc(8);
    head.write(c.type, 0, 'ascii');
    head.writeUInt32LE(c.data.length, 4);
    parts.push(head, c.data);
    if (c.data.length & 1) parts.push(Buffer.alloc(1));
  }
  const body = Buffer.concat(parts);
  const head = Buffer.alloc(8);
  head.write('RIFF', 0, 'ascii');
  head.writeUInt32LE(body.length, 4);
  return Buffer.concat([head, body]);
}

function bitstreamInfo(chunk) {
  const d = chunk.data;
  if (chunk.type === 'VP8 ') {
    if (d.length < 10 || d[3] !== 0x9d || d[4] !== 0x01 || d[5] !== 0x2a) throw new Error('bitstream VP8 inválido');
    return { width: d.readUInt16LE(6) & 0x3fff, height: d.readUInt16LE(8) & 0x3fff, alpha: false };
  }
  if (chunk.type === 'VP8L') {
    if (d.length < 5 || d[0] !== 0x2f) throw new Error('bitstream VP8L inválido');
    const bits = d.readUInt32LE(1);
    return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1, alpha: !!((bits >>> 28) & 1) };
  }
  return null;
}

function frameFromChunks(chunks, x = 0, y = 0, duration = 0, blend = true, dispose = false) {
  const bit = chunks.find((c) => c.type === 'VP8 ' || c.type === 'VP8L');
  if (!bit) throw new Error('frame WebP sem bitstream');
  const info = bitstreamInfo(bit);
  return { x, y, w: info.width, h: info.height, duration, blend, dispose, chunks, alpha: info.alpha || chunks.some((c) => c.type === 'ALPH') };
}

/** Analisa um WebP (estático ou animado). */
export function parseWebp(buf) {
  const chunks = readChunks(buf);
  const vp8x = chunks.find((c) => c.type === 'VP8X');
  const anim = chunks.find((c) => c.type === 'ANIM');
  const exif = chunks.find((c) => c.type === 'EXIF')?.data || null;
  const out = { chunks, exif, width: 0, height: 0, animated: false, hasAlpha: false, loop: 0, frames: [] };
  if (vp8x) {
    out.width = u24(vp8x.data, 4) + 1;
    out.height = u24(vp8x.data, 7) + 1;
    out.hasAlpha = !!(vp8x.data[0] & VP8X_ALPHA);
    out.animated = !!(vp8x.data[0] & VP8X_ANIM) || !!anim;
  }
  if (anim) out.loop = anim.data.readUInt16LE(4);
  const anmf = chunks.filter((c) => c.type === 'ANMF');
  if (anmf.length) {
    out.animated = true;
    for (const c of anmf) {
      const d = c.data;
      const sub = [];
      let off = 16;
      while (off + 8 <= d.length) {
        const type = d.toString('ascii', off, off + 4);
        const size = d.readUInt32LE(off + 4);
        sub.push({ type, data: d.subarray(off + 8, off + 8 + size) });
        off += 8 + size + (size & 1);
      }
      const flags = d[15];
      const f = frameFromChunks(sub, u24(d, 0) * 2, u24(d, 3) * 2, u24(d, 12), !(flags & 2), !!(flags & 1));
      // Dimensões oficiais vêm do cabeçalho ANMF.
      f.w = u24(d, 6) + 1;
      f.h = u24(d, 9) + 1;
      out.frames.push(f);
    }
  } else {
    const f = frameFromChunks(chunks.filter((c) => ['ALPH', 'VP8 ', 'VP8L'].includes(c.type)));
    out.frames.push(f);
    if (!out.width) { out.width = f.w; out.height = f.h; }
    out.hasAlpha = out.hasAlpha || f.alpha;
  }
  return out;
}

export function isAnimatedWebp(buf) {
  try {
    if (!isWebp(buf)) return false;
    return readChunks(buf).some((c) => c.type === 'ANIM' || c.type === 'ANMF');
  } catch { return false; }
}

/** WebP standalone (1 frame) a partir de um frame de animação — usado na decodificação. */
export function frameToWebp(frame) {
  const chunks = [];
  if (frame.chunks.some((c) => c.type === 'ALPH') || frame.alpha) {
    const vp8x = Buffer.alloc(10);
    vp8x[0] = VP8X_ALPHA;
    vp8x.writeUIntLE(frame.w - 1, 4, 3);
    vp8x.writeUIntLE(frame.h - 1, 7, 3);
    chunks.push({ type: 'VP8X', data: vp8x });
  }
  chunks.push(...frame.chunks.filter((c) => ['ALPH', 'VP8 ', 'VP8L'].includes(c.type)));
  return buildRiff(chunks);
}

/** Substitui/insere a chunk EXIF, criando VP8X quando necessário. */
export function setWebpExif(buf, exif) {
  const info = parseWebp(buf);
  const chunks = info.chunks.filter((c) => c.type !== 'EXIF');
  let vp8x = chunks.find((c) => c.type === 'VP8X');
  if (!vp8x) {
    const f = info.frames[0];
    const data = Buffer.alloc(10);
    data[0] = f.alpha ? VP8X_ALPHA : 0;
    data.writeUIntLE(f.w - 1, 4, 3);
    data.writeUIntLE(f.h - 1, 7, 3);
    vp8x = { type: 'VP8X', data };
    chunks.unshift(vp8x);
  } else {
    vp8x = { type: 'VP8X', data: Buffer.from(vp8x.data) };
    chunks[chunks.findIndex((c) => c.type === 'VP8X')] = vp8x;
  }
  if (exif?.length) {
    vp8x.data[0] |= VP8X_EXIF;
    chunks.push({ type: 'EXIF', data: exif });
  } else {
    vp8x.data[0] &= ~VP8X_EXIF;
  }
  return buildRiff(chunks);
}

const EXIF_HEAD = Buffer.from([0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00, 0x01, 0x00, 0x41, 0x57, 0x07, 0x00, 0x00, 0x00, 0x00, 0x00, 0x16, 0x00, 0x00, 0x00]);

export function packId(pack, author) {
  return crypto.createHash('sha1').update(`${pack}\u0000${author}`).digest('hex').slice(0, 32);
}

/** Monta a chunk EXIF no formato que o WhatsApp entende. */
export function makeStickerExif({ pack = '', author = '', emojis = [], id } = {}) {
  const json = Buffer.from(JSON.stringify({
    'sticker-pack-id': id || packId(pack, author),
    'sticker-pack-name': String(pack),
    'sticker-pack-publisher': String(author),
    emojis: emojis.length ? emojis : [],
    'android-app-store-link': '',
    'ios-app-store-link': ''
  }), 'utf8');
  const exif = Buffer.concat([EXIF_HEAD, json]);
  exif.writeUInt32LE(json.length, 14);
  return exif;
}

export function readStickerExif(buf) {
  try {
    const exif = isWebp(buf) ? parseWebp(buf).exif : buf;
    if (!exif?.length) return null;
    const text = exif.toString('utf8');
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start < 0 || end < start) return null;
    const j = JSON.parse(text.slice(start, end + 1));
    return {
      id: j['sticker-pack-id'] || '',
      pack: j['sticker-pack-name'] || '',
      author: j['sticker-pack-publisher'] || '',
      emojis: Array.isArray(j.emojis) ? j.emojis : []
    };
  } catch { return null; }
}

/** Grava pack/autor/emojis num WebP pronto. */
export function tagSticker(webp, meta) {
  return setWebpExif(webp, makeStickerExif(meta));
}

/**
 * Base de tempo (ms) para reproduzir durações variáveis com fps constante:
 * usa a mediana das durações limitada a 5–30 fps; cada frame repete ≈ dur/tick vezes.
 */
export function frameTiming(info, { maxFrames = 600 } = {}) {
  const frames = info.frames.slice(0, maxFrames);
  const durs = frames.map((f) => Math.max(10, f.duration || 100));
  const sorted = [...durs].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] || 100;
  const fps = Math.min(30, Math.max(5, Math.round(1000 / median)));
  const tick = 1000 / fps;
  return { frames, durs, tickMs: tick, tick, scale: 1, totalMs: durs.reduce((a, b) => a + b, 0) };
}

/**
 * Compõe os frames de um WebP animado (offset/blend/dispose) em canvas RGBA
 * completos. `decodeFrame(webpBuffer, w, h)` deve devolver RGBA bruto do frame.
 * Gera { rgba, repeat } — `repeat` = quantos ticks de `tickMs` o frame ocupa.
 * Os frames são decodificados com uma janela de pré-busca para acelerar.
 */
export async function* composeFrames(buf, decodeFrame, { maxFrames = 600, background = null, prefetch = 4 } = {}) {
  const info = parseWebp(buf);
  const { width: W, height: H } = info;
  const { frames, durs, tick, scale } = frameTiming(info, { maxFrames });
  const jobs = new Map();
  const start = (i) => {
    if (i < frames.length && !jobs.has(i)) {
      const p = decodeFrame(frameToWebp(frames[i]), frames[i].w, frames[i].h);
      p.catch(() => {}); // evita unhandledRejection; o erro real é lançado no await abaixo
      jobs.set(i, p);
    }
  };
  const canvas = Buffer.alloc(W * H * 4);
  const bgPixel = background ? [background[0], background[1], background[2], 255] : [0, 0, 0, 0];
  const clear = (x0, y0, w, h) => {
    for (let y = y0; y < Math.min(H, y0 + h); y++) for (let x = x0; x < Math.min(W, x0 + w); x++) {
      const o = (y * W + x) * 4;
      canvas[o] = bgPixel[0]; canvas[o + 1] = bgPixel[1]; canvas[o + 2] = bgPixel[2]; canvas[o + 3] = bgPixel[3];
    }
  };
  clear(0, 0, W, H);
  for (let i = 0; i < frames.length; i++) {
    for (let k = 0; k <= prefetch; k++) start(i + k);
    const f = frames[i];
    const rgba = await jobs.get(i);
    jobs.delete(i);
    for (let y = 0; y < f.h; y++) {
      if (f.y + y >= H) break;
      for (let x = 0; x < f.w; x++) {
        if (f.x + x >= W) break;
        const s = (y * f.w + x) * 4;
        const o = ((f.y + y) * W + f.x + x) * 4;
        const a = rgba[s + 3];
        if (!f.blend || a === 255 || canvas[o + 3] === 0) {
          // Sem blend (ou pixel opaco / canvas vazio): copia o pixel do frame.
          if (background && a < 255) {
            for (let k = 0; k < 3; k++) canvas[o + k] = Math.round((rgba[s + k] * a + bgPixel[k] * (255 - a)) / 255);
            canvas[o + 3] = 255;
          } else {
            canvas[o] = rgba[s]; canvas[o + 1] = rgba[s + 1]; canvas[o + 2] = rgba[s + 2]; canvas[o + 3] = a;
          }
          continue;
        }
        if (a === 0) continue;
        const da = canvas[o + 3];
        const outA = a + (da * (255 - a)) / 255;
        for (let k = 0; k < 3; k++) canvas[o + k] = Math.round((rgba[s + k] * a + (canvas[o + k] * da * (255 - a)) / 255) / outA);
        canvas[o + 3] = Math.round(outA);
      }
    }
    yield { rgba: Buffer.from(canvas), repeat: Math.max(1, Math.round(durs[i] / tick / scale)), tickMs: tick * scale, width: W, height: H };
    if (f.dispose) clear(f.x, f.y, f.w, f.h);
  }
}
