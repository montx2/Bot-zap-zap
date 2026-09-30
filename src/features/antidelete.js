// 🛡️ ANTI-DELETE — nada some.
// ATIVO POR PADRÃO EM TODOS os chats. Filtros de ignorar configuráveis:
//   .antidelete ignorar grupos | privado | <jid> | aqui
// Quando alguém apaga, o bot restaura a mensagem no próprio chat
// (texto, imagem, vídeo, áudio, figurinha, documento...).

import { downloadMediaMessage } from '@whiskeysockets/baileys';
import { cfg } from '../core/config.js';
import { log } from '../core/logger.js';
import { messageCache } from '../wa/cache.js';
import { formatDate, truncate, isGroup } from '../util/text.js';

/** O chat atual está na lista de ignorados? */
export function isIgnored(jid, list = cfg.get().antiDelete.ignorar) {
  for (const rule of list) {
    const r = String(rule).toLowerCase();
    if (r === 'grupos' || r === 'groups') {
      if (isGroup(jid)) return true;
    } else if (r === 'privado' || r === 'private' || r === 'pv') {
      if (!isGroup(jid)) return true;
    } else if (r === jid.toLowerCase()) {
      return true;
    } else if (jid.toLowerCase().startsWith(r.replace(/@.*/, '')) && r.includes('@')) {
      return true;
    }
  }
  return false;
}

/** Normaliza alvo digitado pelo usuário. */
export function normalizeIgnoreTarget(arg, msg) {
  const a = String(arg || '').trim().toLowerCase();
  if (!a || ['aqui', 'este chat', 'esse chat'].includes(a)) return msg.key.remoteJid;
  if (['grupos', 'grupo', 'groups'].includes(a)) return 'grupos';
  if (['privado', 'pv', 'private', 'dm'].includes(a)) return 'privado';
  if (a.includes('@')) return a;
  if (/^\d{8,20}$/.test(a)) return `${a}@s.whatsapp.net`;
  return a;
}

function header(entry) {
  return [
    '🛡️ *ANTI-DELETE — mensagem apagada*',
    `👤 De: ${entry.pushName || entry.jid.split('@')[0]}`,
    `💬 ${isGroup(entry.jid) ? 'Grupo' : 'Privado'} · ${formatDate(entry.ts)}`
  ].join('\n');
}

function findMedia(message) {
  for (const type of ['imageMessage', 'videoMessage', 'audioMessage', 'stickerMessage', 'documentMessage']) {
    if (message?.[type]) return { type, node: message[type] };
  }
  return null;
}

const processedRevokes = new Set();

/**
 * Trata um REVOKE (mensagem apagada). Retorna true se restaurou.
 */
export async function handleDelete(sock, revokeMsg, { ownerJid }) {
  const settings = cfg.get().antiDelete;
  if (!settings.ativo) return false;

  const proto = revokeMsg?.message?.protocolMessage;
  const targetId = proto?.key?.id || revokeMsg?.key?.id;
  if (!targetId) return false;

  // dedupe: o mesmo revoke pode chegar pelo upsert e pelo messages.update
  if (processedRevokes.has(targetId)) return true;
  processedRevokes.add(targetId);
  if (processedRevokes.size > 1000) processedRevokes.delete(processedRevokes.values().next().value);

  const entry = messageCache.getById(targetId);
  if (!entry) return false; // não vimos a mensagem original
  if (entry.fromMe) return true; // não reporta o que nós mesmos apagamos

  const chatJid = entry.jid;
  if (isIgnored(chatJid, settings.ignorar)) return false;

  const caption = header(entry);
  log.warn(`anti-delete: mensagem apagada em ${chatJid} (${targetId})`);

  const media = findMedia(entry.message);
  let sentMedia = false;

  if (media) {
    try {
      const buffer = await downloadMediaMessage(
        { key: { remoteJid: chatJid, id: entry.id, fromMe: false }, message: entry.message },
        'buffer',
        {},
        { reuploadRequest: sock.updateMediaMessage }
      );
      if (buffer?.length) {
        const payload =
          media.type === 'imageMessage'
            ? { image: buffer, caption }
            : media.type === 'videoMessage'
              ? { video: buffer, caption, gifPlayback: !!media.node.gifPlayback }
              : media.type === 'audioMessage'
                ? { audio: buffer, mimetype: media.node.mimetype || 'audio/ogg; codecs=opus', ptt: !!media.node.ptt }
                : media.type === 'stickerMessage'
                  ? { sticker: buffer }
                  : {
                      document: buffer,
                      fileName: media.node.fileName || `apagado-${entry.id}.bin`,
                      mimetype: media.node.mimetype || 'application/octet-stream',
                      caption
                    };
        await sock.sendMessage(chatJid, payload);
        if (media.type === 'audioMessage' || media.type === 'stickerMessage') {
          await sock.sendMessage(chatJid, { text: caption });
        }
        sentMedia = true;
      }
    } catch (error) {
      log.warn(`anti-delete: mídia irrecuperável (${error.message})`);
    }
  }

  if (!sentMedia) {
    const text = extractAnyText(entry.message);
    await sock.sendMessage(chatJid, {
      text: `${caption}\n\n${text ? `💬 "${truncate(text, 1800)}"` : '📎 [conteúdo de mídia não recuperável]'}`
    });
  }

  if (settings.avisarDono && ownerJid && ownerJid !== chatJid) {
    await sock
      .sendMessage(ownerJid, {
        text: `${caption}\n${text0(entry)}${media ? '\n📎 (mídia restaurada no chat de origem)' : ''}`
      })
      .catch(() => {});
  }
  return true;
}

function text0(entry) {
  const t = extractAnyText(entry.message);
  return t ? `\n💬 "${truncate(t, 800)}"` : '';
}

export function extractAnyText(message) {
  return (
    message?.conversation ||
    message?.extendedTextMessage?.text ||
    message?.imageMessage?.caption ||
    message?.videoMessage?.caption ||
    message?.documentMessage?.caption ||
    message?.documentWithCaptionMessage?.message?.documentMessage?.caption ||
    message?.buttonsResponseMessage?.selectedDisplayText ||
    message?.listResponseMessage?.title ||
    message?.templateButtonReplyMessage?.selectedDisplayText ||
    message?.pollCreationMessage?.name ||
    message?.pollCreationMessageV3?.name ||
    message?.contactMessage?.displayName ||
    message?.locationMessage?.name ||
    ''
  );
}

/** Texto de status do anti-delete para o comando .antidelete */
export function statusText(jid) {
  const s = cfg.get().antiDelete;
  const ignoredHere = isIgnored(jid, s.ignorar);
  const rules = s.ignorar.length ? s.ignorar.map((r) => `• ${r}`).join('\n') : '• nenhum — protegendo TUDO';
  return [
    '🛡️ *ANTI-DELETE*',
    '',
    `Status global: ${s.ativo ? '✅ ATIVO (padrão)' : '❌ desativado'}`,
    `Restaurar no chat: ${s.restaurarNoChat ? '✅' : '❌'}`,
    `Cópia para o dono: ${s.avisarDono ? '✅' : '❌'}`,
    `Neste chat: ${ignoredHere ? '⛔ IGNORADO' : '🟢 protegido'}`,
    '',
    '*Filtros de ignorar:*',
    rules,
    '',
    '_Use_ `.antidelete ignorar grupos` _para adicionar filtros._'
  ].join('\n');
}
