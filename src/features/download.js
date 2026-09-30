// ⬇️ DOWNLOAD UNIVERSAL — o coração do NEXUS para mídias.
// Detecta a rede social pelo link, baixa na qualidade pedida (MELHOR por padrão)
// e envia. Redes dedicadas: TikTok, Pinterest, Instagram.
// Qualquer outra (YouTube, X, Facebook, Threads, Reddit, Snapchat…) → Cobalt.

import { cfg } from '../core/config.js';
import { log } from '../core/logger.js';
import { fetchBuffer, formatBytes } from '../core/http.js';
import { truncate } from '../util/text.js';
import { parseQuality, qualityLabel } from './downloaders/quality.js';
import { isTikTokUrl, downloadTikTok } from './downloaders/tiktok.js';
import { isPinterestUrl, downloadPinterest } from './downloaders/pinterest.js';
import { isInstagramUrl, downloadInstagram } from './downloaders/instagram.js';
import { cobaltDownload } from './downloaders/cobalt.js';

export { parseQuality };

const PLATFORM_DETECT = [
  { test: isTikTokUrl, name: 'TikTok' },
  { test: isPinterestUrl, name: 'Pinterest' },
  { test: isInstagramUrl, name: 'Instagram' },
  { test: (u) => /(youtube\.com|youtu\.be)/i.test(u), name: 'YouTube' },
  { test: (u) => /(twitter\.com|x\.com)/i.test(u), name: 'X (Twitter)' },
  { test: (u) => /(facebook\.com|fb\.watch|fb\.com)/i.test(u), name: 'Facebook' },
  { test: (u) => /threads\.(net|com)/i.test(u), name: 'Threads' },
  { test: (u) => /reddit\.com|redd\.it/i.test(u), name: 'Reddit' },
  { test: (u) => /snapchat\.com/i.test(u), name: 'Snapchat' },
  { test: (u) => /vimeo\.com/i.test(u), name: 'Vimeo' },
  { test: (u) => /twitch\.tv/i.test(u), name: 'Twitch' },
  { test: (u) => /soundcloud\.com/i.test(u), name: 'SoundCloud' },
  { test: (u) => /(giphy\.com|tenor\.com)/i.test(u), name: 'GIF' }
];

export function detectPlatform(url) {
  return PLATFORM_DETECT.find((p) => p.test(url))?.name || null;
}

export function isKnownSocialUrl(url) {
  return !!detectPlatform(url);
}

/** Roteia uma URL para o resultado de download. */
export async function resolveDownload(url, quality = 'melhor', { audioOnly = false } = {}) {
  if (isTikTokUrl(url)) {
    const r = await downloadTikTok(url, quality);
    if (audioOnly && r.audioOnly) return { ...r, buffers: [await fetchBuffer(r.audioOnly.url, { timeoutMs: 120_000 })], kind: 'audio', media: [] };
    return withBuffers(r, quality);
  }
  if (isPinterestUrl(url)) {
    return withBuffers(await downloadPinterest(url, quality), quality);
  }
  if (isInstagramUrl(url)) {
    return downloadInstagram(url, quality);
  }
  // universal
  const { buffers, audioBuffer, kind } = await cobaltDownload(url, quality, { audioOnly });
  return { platform: detectPlatform(url) || 'Web', title: '', kind: audioOnly ? 'audio' : kind, buffers, audioBuffer };
}

/** Baixa os buffers de resultados que vieram com URLs (tiktok/pinterest). */
async function withBuffers(result, quality) {
  if (result.buffers) return result;
  const buffers = [];
  for (const item of (result.media || []).slice(0, 10)) {
    log.dl(`baixando ${item.type} (${qualityLabel(quality)})…`);
    const buffer = await fetchBuffer(item.url, { timeoutMs: 180_000, maxBytes: 200 * 1024 * 1024 });
    buffers.push(buffer);
  }
  return { ...result, buffers };
}

/** Envia o resultado para o chat, respeitando limites do WhatsApp. */
export async function sendDownload(sock, jid, result, { quality, url }) {
  const maxMB = Number(cfg.get().maxMB) || 90;
  const qLabel = qualityLabel(quality);
  const header = [
    `⬇️ *${result.platform || 'Download'}* · ${qLabel}`,
    result.title ? `📝 ${truncate(result.title, 300)}` : null,
    result.author ? `👤 ${result.author}` : null,
    result.duration ? `⏱️ ${Math.floor(result.duration / 60)}:${String(result.duration % 60).padStart(2, '0')}` : null
  ]
    .filter(Boolean)
    .join('\n');

  const buffers = result.buffers || [];
  if (!buffers.length) throw new Error('nada para enviar');

  let sent = 0;
  for (let i = 0; i < buffers.length; i++) {
    const buffer = buffers[i];
    const mb = buffer.length / (1024 * 1024);
    if (mb > maxMB) {
      await sock.sendMessage(jid, {
        text: `⚠️ Arquivo ${i + 1} tem ${formatBytes(buffer.length)} (> ${maxMB} MB) — o WhatsApp não aceita. Tente qualidade *baixa*.`
      });
      continue;
    }
    const caption = buffers.length > 1 ? `${header}\n(${i + 1}/${buffers.length})` : header;
    const kind = result.kind;
    if (kind === 'audio') {
      await sock.sendMessage(jid, { audio: buffer, mimetype: 'audio/mpeg', fileName: 'nexus-audio.mp3' });
    } else if (kind === 'video' || detectVideo(buffer)) {
      await sock.sendMessage(jid, { video: buffer, caption, mimetype: 'video/mp4' });
    } else if (kind === 'gif' || (result.media?.[i]?.type === 'gif')) {
      await sock.sendMessage(jid, { video: buffer, caption, gifPlayback: true });
    } else {
      await sock.sendMessage(jid, { image: buffer, caption });
    }
    sent++;
  }
  if (result.audioBuffer && kind !== 'audio') {
    await sock.sendMessage(jid, { audio: result.audioBuffer, mimetype: 'audio/mpeg' }).catch(() => {});
  }
  return sent;
}

function detectVideo(buffer) {
  // assinatura mp4: "ftyp" no offset 4
  return buffer.length > 12 && buffer.toString('ascii', 4, 8) === 'ftyp';
}

/** Handler de auto-download: mensagem contém só links conhecidos. */
export async function autoDownload(sock, msg, urls, { reply }) {
  const { quality } = parseQuality(msg.message?.conversation?.split(' ').slice(1) || []);
  for (const url of urls.slice(0, 3)) {
    try {
      const platform = detectPlatform(url) || 'Web';
      log.dl(`auto-download ${platform}: ${url.slice(0, 80)}`);
      const result = await resolveDownload(url, quality);
      await sendDownload(sock, msg.key.remoteJid, result, { quality, url });
    } catch (error) {
      log.warn(`auto-download falhou: ${error.message}`);
      await reply(`😕 Não consegui baixar esse link (${detectPlatform(url) || 'web'}): ${error.message.slice(0, 140)}`).catch(() => {});
    }
  }
}
