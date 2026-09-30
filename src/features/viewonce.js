// 👁️ VIEW ONCE — captura de mensagens de visualização única.
//
// 1) AUTO: toda view once recebida é baixada e enviada para o dono (padrão ON).
// 2) RESPOSTA: responda QUALQUER view once com QUALQUER mensagem e o bot baixa.

import { downloadMediaMessage, downloadContentFromMessage } from '@whiskeysockets/baileys';
import { cfg } from '../core/config.js';
import { log } from '../core/logger.js';
import { truncate, formatDate } from '../util/text.js';
import { formatBytes } from '../core/http.js';
import { messageCache } from '../wa/cache.js';

// Tipos que podem vir embrulhados como view once.
const VO_WRAPPERS = [
  'viewOnceMessage',
  'viewOnceMessageV2',
  'viewOnceMessageV2Extension',
  'documentWithCaptionMessage'
];
const MEDIA_TYPES = ['imageMessage', 'videoMessage', 'audioMessage'];

/** Desembrulha uma mensagem view once. Retorna { type, node } ou null. */
export function unwrapViewOnce(message) {
  if (!message) return null;
  for (const wrapper of VO_WRAPPERS) {
    const inner = message[wrapper]?.message;
    if (inner) {
      const found = unwrapViewOnce(inner);
      if (found) return found;
    }
  }
  for (const type of MEDIA_TYPES) {
    if (message[type]) return { type, node: message[type] };
  }
  return null;
}

export function isViewOnce(message) {
  return !!unwrapViewOnce(message);
}

/** Mensagem citada (reply) contém view once? */
export function quotedViewOnce(message) {
  const quoted = message?.extendedTextMessage?.contextInfo?.quotedMessage;
  if (!quoted) return null;
  return unwrapViewOnce(quoted);
}

/** Baixa a mídia de uma view once com múltiplas estratégias. */
export async function downloadViewOnceMedia(sock, msg) {
  const vo = unwrapViewOnce(msg.message) || unwrapViewOnce(msg.message?.extendedTextMessage?.contextInfo?.quotedMessage);
  if (!vo) throw new Error('não é uma mensagem de visualização única');

  const errors = [];
  const strategies = [
    () =>
      downloadMediaMessage(
        { key: msg.key, message: { [vo.type]: vo.node } },
        'buffer',
        {},
        { reuploadRequest: sock.updateMediaMessage }
      ),
    () => downloadMediaMessage(msg, 'buffer', {}, { reuploadRequest: sock.updateMediaMessage }),
    async () => {
      const stream = await downloadContentFromMessage(vo.node, vo.type.replace(/Message$/, ''));
      const chunks = [];
      for await (const c of stream) chunks.push(c);
      return Buffer.concat(chunks);
    },
    async () => {
      if (typeof sock.updateMediaMessage !== 'function') throw new Error('reupload indisponível');
      const refreshed = await sock.updateMediaMessage(msg);
      return downloadMediaMessage(refreshed, 'buffer', {}, { reuploadRequest: sock.updateMediaMessage });
    }
  ];

  for (const strategy of strategies) {
    try {
      const buffer = await strategy();
      if (buffer?.length) return { buffer, type: vo.type, node: vo.node };
    } catch (error) {
      errors.push(String(error?.message || error).slice(0, 90));
    }
  }
  throw new Error(`não consegui baixar a view once (${errors.join(' | ').slice(0, 240)})`);
}

function captionFor(source, { auto }) {
  const who = source.pushName || source.key?.participant || source.key?.remoteJid?.split('@')[0] || 'desconhecido';
  return [
    `${auto ? '👁️ *VIEW ONCE CAPTURADA*' : '👁️ *VIEW ONCE BAIXADA*'}`,
    '',
    `👤 De: ${who}`,
    `🕒 Recebida: ${formatDate(source.ts || Date.now())}`
  ].join('\n');
}

/** Envia a mídia capturada ao destino configurado. */
async function deliver(sock, ctx, source, result) {
  const settings = cfg.get().viewOnce;
  const dest = settings.destinoAuto === 'chat' || !ctx.isAuto ? ctx.msg.key.remoteJid : ctx.ownerJid;
  const caption = captionFor(source, { auto: ctx.isAuto });
  const { buffer, type, node } = result;

  try {
    if (type === 'imageMessage') {
      await sock.sendMessage(dest, { image: buffer, caption });
    } else if (type === 'videoMessage') {
      await sock.sendMessage(dest, { video: buffer, caption, gifPlayback: !!node.gifPlayback });
    } else {
      await sock.sendMessage(dest, {
        audio: buffer,
        mimetype: node?.mimetype || 'audio/ogg; codecs=opus',
        ptt: !!node?.ptt
      });
      await sock.sendMessage(dest, { text: caption });
    }
    log.ok(`view once capturada (${formatBytes(buffer.length)}) → ${dest}`);
  } catch (error) {
    log.error('falha ao entregar view once', error);
  }
}

/**
 * Handler principal chamado pelo roteador para toda mensagem recebida.
 */
export async function onViewOnceMessage(sock, msg, { ownerJid }) {
  const settings = cfg.get().viewOnce;
  if (!settings.auto) return false;
  if (msg.key.fromMe) return false;
  if (!isViewOnce(msg.message)) return false;

  // Evita capturar duas vezes ( eventos duplicados )
  const dedupeKey = `${msg.key.remoteJid}:${msg.key.id}`;
  if (recentCaptures.has(dedupeKey)) return false;
  recentCaptures.add(dedupeKey);
  if (recentCaptures.size > 500) recentCaptures.delete(recentCaptures.values().next().value);

  try {
    const result = await downloadViewOnceMedia(sock, msg);
    await deliver(sock, { msg, ownerJid, isAuto: true }, msg, result);
    return true;
  } catch (error) {
    log.warn(`view once não baixada: ${error.message}`);
    try {
      await sock.sendMessage(ownerJid, {
        text: `👁️ Uma view once chegou de ${msg.pushName || 'alguém'}, mas a mídia já expirou ou está indisponível.\n💬 Texto: "${truncate(msg.message?.viewOnceMessageV2?.message?.imageMessage?.caption || msg.message?.viewOnceMessage?.message?.videoMessage?.caption || '[sem texto]', 300)}"`
      });
    } catch {}
    return false;
  }
}

const recentCaptures = new Set();

/**
 * Captura via resposta: usuário respondeu uma view once com qualquer mensagem.
 * Retorna true se capturou.
 */
export async function onViewOnceReply(sock, msg, { ownerJid, senderIsOwner }) {
  const settings = cfg.get().viewOnce;
  if (settings.resposta === 'dono' && !senderIsOwner) return false;

  // Caso A: a citação carrega o conteúdo view once completo.
  if (quotedViewOnce(msg.message)) {
    try {
      const result = await downloadViewOnceMedia(sock, msg);
      await deliver(sock, { msg, ownerJid, isAuto: false }, { pushName: msg.pushName, key: msg.key, ts: Date.now() }, result);
      return true;
    } catch (error) {
      log.warn(`view once por resposta falhou na citação: ${error.message}`);
      // segue para o caso B
    }
  }

  // Caso B: citação chegou "vazia" (placeholder) — procura no cache.
  const quotedId = msg.message?.extendedTextMessage?.contextInfo?.stanzaId;
  if (!quotedId) return false;
  const cached = messageCache.get(msg.key.remoteJid, quotedId);
  if (!cached || !isViewOnce(cached.message)) return false;

  try {
    const fake = { key: { ...msg.key, id: quotedId }, message: cached.message };
    const result = await downloadViewOnceMedia(sock, fake);
    await deliver(sock, { msg, ownerJid, isAuto: false }, cached, result);
    return true;
  } catch (error) {
    log.warn(`view once por resposta falhou no cache: ${error.message}`);
    try {
      await sock.sendMessage(msg.key.remoteJid, {
        text: '👁️ Essa view once já expirou — a mídia não está mais disponível no servidor. 😕'
      });
    } catch {}
    return false;
  }
}
