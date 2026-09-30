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
  const head = Buffer.alloc(8);
  head.writeUInt32LE(jsonBuf.length + 4, 0); // pouco uso, mantido p/ compat
  head.write('exif', 4, 'ascii');
  return Buffer.concat([Buffer.from([0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00, 0x01, 0x00, 0x41, 0x57, 0x07, 0x00]),
    Buffer.from([jsonBuf.length & 0xff, (jsonBuf.length >> 8) & 0xff, 0x00, 0x00]),
    jsonBuf]);
}

/** Injeta/substitui a chunk EXIF de um WebP. */
export function setWebpExif(buf, exif) {
  const chunks = readChunks(buf).filter((c) => c.type !== 'EXIF');
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
