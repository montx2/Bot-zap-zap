import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { downloadMediaMessage } from '@whiskeysockets/baileys';
import { getQuoted, getMediaNode, formatBytes } from '../core/format.js';
import { logger } from '../core/logger.js';
import { convertMedia, extFromMime, ffmpegCapabilities, probeMedia, withTempDir } from '../core/media.js';
import { isAnimatedWebp } from '../core/webp.js';
import { decodeAnimatedWebp } from '../core/webpDecode.js';

const MODES = {
  ptt: { label: 'áudio (PTT)', ext: 'ogg', needs: 'opus' },
  mp3: { label: 'MP3', ext: 'mp3', needs: 'mp3' },
  gif: { label: 'GIF', ext: 'mp4', needs: 'h264' },
  mp4: { label: 'vídeo', ext: 'mp4', needs: 'h264' }
};
const SUPPORTED = ['audioMessage', 'videoMessage', 'imageMessage', 'stickerMessage', 'documentMessage'];

/** Converte a mídia citada (ou a própria mensagem) para ptt | mp3 | gif | mp4. */
export async function convertQuoted(sock, msg, mode) {
  const spec = MODES[mode];
  if (!spec) throw new Error(`modo desconhecido: ${mode}`);
  const own = getMediaNode(msg?.message);
  const q = getQuoted(msg);
  const holder = own?.type && SUPPORTED.includes(own.type) ? msg : q;
  const media = holder === msg ? own : q && getMediaNode(q.message);
  if (!holder || !media?.type) throw new Error('responda uma mídia (vídeo, áudio, GIF ou figurinha animada)');
  if (!SUPPORTED.includes(media.type)) throw new Error('tipo de mídia não suportado');
  if (mode === 'gif' && media.type === 'imageMessage' && !/gif/i.test(media.node?.mimetype || '')) throw new Error('`.gif` precisa de vídeo, GIF ou figurinha animada');

  const caps = await ffmpegCapabilities();
  if (!caps.installed) throw new Error('FFmpeg não instalado. No Termux: `pkg install ffmpeg`.');
  if (!caps[spec.needs]) throw new Error(`seu FFmpeg não tem o codec necessário (${spec.needs}).`);

  const buffer = await downloadMediaMessage(holder, 'buffer', {}, { logger, reuploadRequest: sock.updateMediaMessage });
  if (!buffer?.length) throw new Error('não consegui baixar a mídia');

  const jid = msg.key.remoteJid;
  const out = await withTempDir(async (dir) => {
    let input = path.join(dir, `in.${extFromMime(media.node?.mimetype, 'bin')}`);
    if (media.type === 'stickerMessage' || /webp/i.test(media.node?.mimetype || '')) {
      if (!isAnimatedWebp(buffer)) {
        if (mode === 'gif' || mode === 'mp4') throw new Error('essa figurinha não é animada');
        throw new Error('figurinha sem áudio para converter');
      }
      input = path.join(dir, 'in.mkv');
      await decodeAnimatedWebp(buffer, { outFile: input, background: [255, 255, 255], outArgs: ['-c:v', 'png'] });
    } else {
      await writeFile(input, buffer);
    }
    const info = await probeMedia(input);
    if ((mode === 'ptt' || mode === 'mp3') && !info.hasAudio) throw new Error('essa mídia não tem áudio');
    if ((mode === 'gif' || mode === 'mp4') && !info.hasVideo) throw new Error('essa mídia não tem vídeo');
    const file = path.join(dir, `out.${spec.ext}`);
    await convertMedia(input, file, mode);
    return readFile(file);
  }, 'conv');

  if (mode === 'ptt') await sock.sendMessage(jid, { audio: out, mimetype: 'audio/ogg; codecs=opus', ptt: true });
  else if (mode === 'mp3') await sock.sendMessage(jid, { audio: out, mimetype: 'audio/mpeg' });
  else if (mode === 'gif') await sock.sendMessage(jid, { video: out, gifPlayback: true, mimetype: 'video/mp4', caption: '🎞️ GIF' });
  else await sock.sendMessage(jid, { video: out, mimetype: 'video/mp4', caption: '🎬 Vídeo' });
  return `${spec.label} ${formatBytes(out.length)}`;
}
