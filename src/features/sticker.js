// 🖼️ STICKER ENGINE — figurinhas de imagem, vídeo, GIF e outras figurinhas,
// com remoção de fundo por IA (.sfundo) e renomeio de pack (.take).

import { downloadMediaMessage } from '@whiskeysockets/baileys';
import { cfg } from '../core/config.js';
import { log } from '../core/logger.js';
import { toStickerWebp, hasFfmpeg } from '../util/ffmpeg.js';
import { isWebp, isAnimatedWebp, tagSticker } from '../util/webp.js';
import { removeBackground } from './bgremoval.js';
import { formatBytes } from '../core/http.js';

const MEDIA_MAP = {
  imageMessage: 'image',
  videoMessage: 'video',
  stickerMessage: 'sticker'
};

/** Extrai a mídia citada/anexada relevante para figurinha (inclusive view once). */
export async function extractStickerSource(sock, msg) {
  const { unwrapViewOnce } = await import('./viewonce.js');
  const m = msg.message || {};
  const ctx = m.extendedTextMessage?.contextInfo;
  const quoted = ctx?.quotedMessage;

  const pickType = (message) => {
    for (const [type] of Object.entries(MEDIA_MAP)) {
      if (message?.[type]) return { type, node: message[type] };
    }
    // view once embrulhada
    const vo = unwrapViewOnce(message);
    if (vo && vo.type !== 'audioMessage') return vo;
    return null;
  };

  // 1) mídia anexada direto (ou anexada como view once)
  const direct = pickType(m);
  if (direct) {
    const buffer = await downloadMediaMessage(msg, 'buffer', {}, { reuploadRequest: sock.updateMediaMessage });
    return { buffer, type: direct.type, node: direct.node };
  }

  // 2) mídia citada (reply), inclusive citação de view once
  if (quoted) {
    const q = pickType(quoted);
    if (q) {
      const fake = { key: { ...msg.key, id: ctx.stanzaId }, message: quoted };
      const buffer = await downloadMediaMessage(fake, 'buffer', {}, { reuploadRequest: sock.updateMediaMessage });
      return { buffer, type: q.type, node: q.node };
    }
  }
  return null;
}

/**
 * Cria figurinha a partir da mídia.
 * @returns {Promise<Buffer>} webp pronto para enviar
 */
export async function makeSticker(source, { removeBg = false, pack, author } = {}) {
  const { buffer, type, node } = source;
  const mime = String(node?.mimetype || '').toLowerCase();

  if (!hasFfmpeg()) {
    throw new Error('FFmpeg não encontrado — rode `.doctor` para ver como instalar.');
  }

  let imageBuffer = buffer;

  if (type === 'sticker' || mime.includes('webp')) {
    // figurinha → figurinha (re-tag ou remoção de fundo via decodificação)
    if (!isWebp(buffer)) throw new Error('webp inválido');
    if (removeBg) {
      // decodifica o primeiro frame para PNG com ffmpeg
      const { buffer: png } = await decodeWebpToPng(buffer);
      const { buffer: cut } = await removeBackground(png);
      imageBuffer = cut;
      const { buffer: webp } = await toStickerWebp(cut, { animated: false, ext: '.png' });
      return tagSticker(webp, { pack, author });
    }
    return tagSticker(buffer, { pack, author });
  }

  const isVideo = type === 'video' || mime.startsWith('video/');
  const isGif = isVideo && (mime.includes('gif') || !!node?.gifPlayback);

  if (removeBg && (isVideo || isGif)) {
    throw new Error('Remoção de fundo funciona só com *imagens*. Manda uma foto! 📸');
  }

  if (removeBg) {
    log.info('sticker com remoção de fundo…');
    const { buffer: cut, via } = await removeBackground(buffer);
    log.ok(`fundo removido via ${via} (${formatBytes(cut.length)})`);
    imageBuffer = cut;
    const { buffer: webp } = await toStickerWebp(cut, { animated: false, ext: '.png' });
    return tagSticker(webp, { pack, author });
  }

  const { buffer: webp } = isVideo
    ? await toStickerWebp(buffer, { animated: true, ext: mime.includes('gif') ? '.gif' : '.mp4' })
    : await toStickerWebp(buffer, { animated: false, ext: mime.includes('png') ? '.png' : '.jpg' });
  return tagSticker(webp, { pack, author });
}

async function decodeWebpToPng(webpBuffer) {
  // usa ffmpeg via toStickerWebp não serve (já é webp); implementação direta:
  const { spawnSync } = await import('node:child_process');
  const os = await import('node:os');
  const path = await import('node:path');
  const fs = await import('node:fs');
  const crypto = await import('node:crypto');
  const inFile = path.join(os.default.tmpdir(), `nexus-${crypto.randomBytes(5).toString('hex')}.webp`);
  const outFile = inFile.replace('.webp', '.png');
  fs.writeFileSync(inFile, webpBuffer);
  try {
    const probe = spawnSync('ffmpeg', ['-y', '-i', inFile, '-frames:v', '1', outFile], { timeout: 60_000 });
    if (probe.status !== 0 || !fs.existsSync(outFile)) throw new Error('falha ao decodificar webp');
    return { buffer: fs.readFileSync(outFile) };
  } finally {
    fs.rmSync(inFile, { force: true });
    fs.rmSync(outFile, { force: true });
  }
}

/** Info do pack atual para comandos. */
export function packInfo() {
  const c = cfg.get();
  return { pack: c.nomePack, author: c.autorPack };
}

export { isAnimatedWebp };
