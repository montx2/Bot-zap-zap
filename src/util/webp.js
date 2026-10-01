// Utilitários WebP em JavaScript puro (sem dependências).
// O WhatsApp lê pack/autor de uma chunk EXIF dentro do .webp; o FFmpeg não
// escreve essa chunk, então injetamos manualmente. Portado do engine anterior
// (código próprio, testado em produção).

const VP8X_ALPHA = 0x10;
const VP8X_EXIF = 0x08;
const VP8X_ANIM = 0x02;

export function isWebp(buf) {
  return (
    Buffer.isBuffer(buf) &&
    buf.length >= 12 &&
    buf.toString('ascii', 0, 4) === 'RIFF' &&
    buf.toString('ascii', 8, 12) === 'WEBP'
  );
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

export function isAnimatedWebp(buf) {
  try {
    const vp8x = readChunks(buf).find((c) => c.type === 'VP8X');
    if (!vp8x) return false;
    return !!(vp8x.data[0] & VP8X_ANIM);
  } catch {
    return false;
  }
}

/** Monta o payload EXIF de figurinha (pack/autor/id). */
export function makeStickerExif({ pack = '', author = '', emojis = [], id = '' } = {}) {
  const json = JSON.stringify({
    'sticker-pack-id': id || 'nexus-bot',
    'sticker-pack-name': pack,
    'sticker-pack-publisher': author,
    emojis: emojis.length ? emojis : undefined
  });
  const jsonBuf = Buffer.from(json, 'utf8');
  // TIFF little-endian, tag 0x5741, JSON no offset 0x16.
  const header = Buffer.from([
    0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00, 0x01, 0x00, 0x41, 0x57, 0x07, 0x00,
    0x00, 0x00, 0x00, 0x00,
    0x16, 0x00, 0x00, 0x00
  ]);
  header.writeUInt32LE(jsonBuf.length, 14);
  return Buffer.concat([header, jsonBuf]);
}

/** Garante VP8X, obrigatória para EXIF em imagens VP8/VP8L simples. */
function ensureVp8x(chunks) {
  if (chunks.some((c) => c.type === 'VP8X')) return;
  const hasAlph = chunks.some((c) => c.type === 'ALPH');
  const vp8 = chunks.find((c) => c.type === 'VP8 ');
  const vp8l = chunks.find((c) => c.type === 'VP8L');
  let width;
  let height;
  let alpha = hasAlph;
  if (vp8 && vp8.data.length >= 10 && vp8.data[3] === 0x9d && vp8.data[4] === 0x01 && vp8.data[5] === 0x2a) {
    width = vp8.data.readUInt16LE(6) & 0x3fff;
    height = vp8.data.readUInt16LE(8) & 0x3fff;
  } else if (vp8l && vp8l.data.length >= 5 && vp8l.data[0] === 0x2f) {
    const bits = vp8l.data.readUInt32LE(1);
    width = (bits & 0x3fff) + 1;
    height = ((bits >>> 14) & 0x3fff) + 1;
    alpha = alpha || ((bits >>> 28) & 1) === 1;
  } else {
    throw new Error('webp sem VP8/VP8L reconhecível');
  }
  const data = Buffer.alloc(10);
  data[0] = alpha ? VP8X_ALPHA : 0;
  data.writeUIntLE(width - 1, 4, 3);
  data.writeUIntLE(height - 1, 7, 3);
  chunks.unshift({ type: 'VP8X', data });
}

/** Injeta/substitui a chunk EXIF de um WebP. */
export function setWebpExif(buf, exif) {
  const chunks = readChunks(buf).filter((c) => c.type !== 'EXIF');
  ensureVp8x(chunks);
  const vp8x = chunks.find((c) => c.type === 'VP8X');
  if (vp8x && vp8x.data.length >= 1) {
    vp8x.data = Buffer.from(vp8x.data);
    vp8x.data[0] |= VP8X_EXIF;
  }
  chunks.push({ type: 'EXIF', data: exif });
  return buildRiff(chunks);
}

/** Aplica pack/autor em um webp já pronto. */
export function tagSticker(webp, { pack, author, id } = {}) {
  try {
    return setWebpExif(webp, makeStickerExif({ pack, author, id }));
  } catch {
    return webp;
  }
}
