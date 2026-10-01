// 🧭 ROUTER — despacha comandos, captura view once real em silêncio,
// aplica anti-delete silencioso (somente para o privado do dono) e controla acesso.
//
// REGRAS DE OURO:
// 1) View Once e Anti-Delete enviam EXCLUSIVAMENTE para o privado do dono
//    (0 rastros nos chats/grupos) e são as ÚNICAS funções invisíveis para os outros.
// 2) Por padrão, o bot SÓ funciona no privado do próprio dono.
// 3) Quando o dono dá `.ativar` (ou `. ativar`) em um grupo ou chat privado,
//    aquele chat ganha acesso a TUDO — figurinhas, downloads de qualquer rede,
//    IA e afins. As duas únicas coisas que nunca aparecem nem respondem para
//    terceiros são View Once e Anti-Delete.

import { isStale, alreadySeen } from '../core/freshness.js';
import { cfg } from '../core/config.js';
import { log } from '../core/logger.js';
import { messageCache, isBotSent, markBotSent } from '../wa/cache.js';
import { extractAnyText, isIgnored, normalizeIgnoreTarget, handleDelete, statusText } from './antidelete.js';
import { isViewOnce, onViewOnceMessage, onViewOnceReply, unwrapViewOnce } from './viewonce.js';
import { extractStickerSource, makeSticker, packInfo, isAnimatedWebp } from './sticker.js';
import { removeBackground, bgStatus, bgPools } from './bgremoval.js';
import { aiChat, aiImage, aiVoice, aiTranslate, aiSummary, resetChatMemory, aiStatus } from './ai.js';
import { resolveDownload, sendDownload, parseQuality, autoDownload, isKnownSocialUrl } from './download.js';
import {
  ownerMenu,
  publicMenu,
  mainMenu,
  downloadMenu,
  stickerMenu,
  antiDeleteMenu,
  infoText
} from './menu.js';
import { extractUrls, truncate, prettyJid, uptimeText, isGroup } from '../util/text.js';
import { hasFfmpeg } from '../util/ffmpeg.js';
import { cobaltPool } from './downloaders/cobalt.js';
import { hasYtDlp } from './downloaders/ytdlp.js';

const STARTED_AT = Date.now();

export { isViewOnce, unwrapViewOnce };

// Comandos do dono para ativar/desativar chats ou grupos
const AUTH_COMMANDS = new Set([
  'ativar',
  'desativar',
  'ativos',
  'autorizar',
  'permitir',
  'liberar',
  'desautorizar',
  'revogar',
  'bloquear',
  'autorizados'
]);

// Comandos BLOQUEADOS para terceiros nos chats/grupos ativados com .ativar.
// São exatamente as duas funções 100% privadas (View Once e Anti-Delete) mais
// os comandos que mudam o comportamento do bot (só o dono mexe neles).
// TODO O RESTO — figurinhas, downloads de qualquer rede, IA, voz, tradução —
// fica liberado para quem o dono autorizou.
const OWNER_ONLY_COMMANDS = new Set([
  // 👁️ View Once (nunca aparece nem responde para terceiros)
  'vo',
  'visu',
  'viewonce',
  'verdepois',
  // 🛡️ Anti-Delete (nunca aparece nem responde para terceiros)
  'antidelete',
  'antidel',
  'ad',
  'apagadas',
  'deletadas',
  // ⚙️ Configuração e diagnóstico do bot
  'config',
  'pools',
  'doctor'
]);

const BOT_OUTPUT_PREFIXES = [
  '⏳ ',
  '⬇️ ',
  '📤 ',
  '✅ ',
  '❌ ',
  '😕 ',
  '🏓 ',
  '👁️ ',
  '🛡️ ',
  '🎭 ',
  '🖌️ ',
  '🎬 ',
  '🏷️ ',
  '🗜️ ',
  '🧠 ',
  '🎨 ',
  '🔊 ',
  '🌍 ',
  '📄 ',
  '🎵 ',
  '🎶 ',
  '📌 ',
  '📸 ',
  '⚙️ ',
  '🔑 ',
  '🩺 ',
  '🔒 ',
  '🔓 ',
  '🖼️ ',
  '🤔 ',
  '╭━━'
];

function isBotGeneratedText(text) {
  if (!text) return false;
  return BOT_OUTPUT_PREFIXES.some((p) => text.startsWith(p));
}

function bareId(jid) {
  return String(jid || '')
    .toLowerCase()
    .replace(/:\d+@/, '@')
    .trim();
}

function bareDigits(jid) {
  if (!jid || isGroup(jid)) return '';
  return String(jid).split('@')[0].split(':')[0].replace(/\D/g, '');
}

/** Verifica se o chat ou remetente foi ativado/autorizado explicitamente pelo dono. */
export function isAuthorizedTarget(jid, participant, list = cfg.get().autorizados) {
  if (!Array.isArray(list) || !list.length) return false;
  const candidates = [jid, participant].filter(Boolean);
  for (const rule of list) {
    const r = bareId(rule);
    const rDigits = bareDigits(rule);
    for (const c of candidates) {
      if (bareId(c) === r) return true;
      const cDigits = bareDigits(c);
      if (rDigits && cDigits && rDigits === cDigits) return true;
    }
  }
  return false;
}

/** Normaliza o alvo para .ativar / .desativar / .autorizar / .desautorizar */
export function normalizeAuthTarget(arg, msg) {
  const quotedParticipant = msg?.message?.extendedTextMessage?.contextInfo?.participant;
  const a = String(arg || '').trim().toLowerCase();
  if (!a && quotedParticipant && !isGroup(msg.key.remoteJid)) return bareId(quotedParticipant);
  if (!a || ['aqui', 'este chat', 'esse chat', 'grupo'].includes(a)) return bareId(msg.key.remoteJid);
  const cleanNum = a.replace(/\D/g, '');
  if (!a.includes('@') && cleanNum.length >= 8 && cleanNum.length <= 20) {
    return `${cleanNum}@s.whatsapp.net`;
  }
  return bareId(a);
}

/** Revoke = protocolMessage de apagar para todos (upsert ou messages.update). */
function isRevokeMessage(msg) {
  const proto = msg?.message?.protocolMessage;
  return !!proto && (proto.type === 0 || proto.type === 'REVOKE');
}

let staleCount = 0;
let staleTimer = null;
function noteStale() {
  staleCount += 1;
  if (staleTimer) return;
  staleTimer = setTimeout(() => {
    log.info(`🕰️ ${staleCount} mensagem(ns) antiga(s) ignorada(s) (backlog do WhatsApp ao conectar)`);
    staleCount = 0;
    staleTimer = null;
  }, 3000);
  staleTimer.unref?.();
}

/**
 * Controlador de progresso por edição:
 * a 1ª mensagem de texto é enviada citando o usuário; todas as atualizações
 * seguintes EDITAM a mesma mensagem (`{ text, edit: sentKey }`), evitando
 * várias mensagens soltas no chat.
 */
export function createProgress(sock, jid, quotedMsg) {
  let sentKey = null;
  let lastText = null;
  let chain = Promise.resolve(null);

  const update = (content) => {
    const payload = typeof content === 'string' ? { text: content } : { ...content };
    const text = payload.text;
    if (typeof text === 'string' && text === lastText && sentKey) {
      return chain;
    }
    if (typeof text === 'string') {
      lastText = text;
    }

    chain = chain.then(async () => {
      if (sentKey && typeof text === 'string') {
        try {
          const edited = await sock.sendMessage(jid, { text, edit: sentKey });
          if (edited?.key?.id) {
            markBotSent(edited.key.id);
            if (!sentKey.id) sentKey = edited.key;
          }
          return edited;
        } catch (err) {
          log.warn(`edição de progresso falhou, enviando nova: ${err.message}`);
        }
      }
      try {
        const sent = await sock.sendMessage(
          jid,
          { ...payload, ...(quotedMsg ? { quoted: quotedMsg } : {}) },
          quotedMsg ? { quoted: quotedMsg } : undefined
        );
        if (sent?.key) {
          sentKey = sent.key;
          markBotSent(sent.key.id);
        }
        return sent;
      } catch (err) {
        log.warn(`envio falhou: ${err.message}`);
        return null;
      }
    });

    return chain;
  };

  return {
    update,
    get key() {
      return sentKey;
    },
    get hasSent() {
      return !!sentKey;
    }
  };
}

/** Envia uma figurinha WebP com todos os atributos esperados pelo WhatsApp/Baileys. */
async function sendStickerMessage(sock, jid, webp, quotedMsg) {
  const animated = isAnimatedWebp(webp);
  const sent = await sock.sendMessage(
    jid,
    {
      sticker: webp,
      mimetype: 'image/webp',
      width: 512,
      height: 512,
      isAnimated: animated
    },
    quotedMsg ? { quoted: quotedMsg } : undefined
  );
  if (sent?.key?.id) markBotSent(sent.key.id);
  return sent;
}

/**
 * Ponto de entrada para TODA mensagem recebida.
 */
export async function handleMessage(sock, msg, deps) {
  const { ownerJid, isOwner, sendOwner } = deps;
  if (!msg?.message) return;
  const jid = msg.key?.remoteJid;
  if (!jid || jid === 'status@broadcast') return;

  // Ignora imediatamente mensagens enviadas pelo próprio bot (evita loop com emitOwnEvents)
  if (msg.key?.id && isBotSent(msg.key.id)) return;
  const text = extractAnyText(msg.message).trim();
  if (msg.key?.fromMe && isBotGeneratedText(text)) return;

  // 0) Anti-delete: armazena tudo em memória (100% em silêncio)
  messageCache.put(msg);

  // 0.1) Backlog/histórico/reentrega: guarda no cache mas NÃO age.
  const revoke = isRevokeMessage(msg);
  if (isStale(msg, deps.type) || (!revoke && alreadySeen(msg))) {
    noteStale();
    return;
  }

  // 1) Mensagem apagada (REVOKE) → envia 100% EM SILÊNCIO SOMENTE para o privado do dono (0 rastros no grupo/chat)
  if (revoke) {
    await handleDelete(sock, msg, { ownerJid }).catch((e) => log.warn(`antidelete: ${e.message}`));
    return;
  }

  // 2) View once REAL recebida → baixa 100% EM SILÊNCIO e envia SOMENTE para o privado do dono (0 rastros)
  if (!msg.key.fromMe && isViewOnce(msg.message)) {
    await onViewOnceMessage(sock, msg, { ownerJid }).catch((e) => log.warn(`view once: ${e.message}`));
  }

  const senderIsOwner = Boolean(msg.key?.fromMe || isOwner?.(jid, msg.key.participant));
  const inOwnerPrivate =
    typeof deps.isOwnerPrivateChat === 'function'
      ? deps.isOwnerPrivateChat(jid, msg)
      : !isGroup(jid) && Boolean(isOwner?.(jid));
  const authorized = isAuthorizedTarget(jid, msg.key.participant);

  // 3) O dono respondeu uma View Once REAL em QUALQUER chat/grupo →
  //    baixa em silêncio e manda SOMENTE pro privado do dono (0 rastros na conversa da pessoa/grupo!)
  if (senderIsOwner) {
    const captured = await onViewOnceReply(sock, msg, {
      ownerJid,
      senderIsOwner: true
    }).catch((e) => {
      log.warn(`view once resposta: ${e.message}`);
      return false;
    });
    // Se a resposta foi em outro chat e não é um comando, termina aqui em silêncio absoluto
    if (captured && !inOwnerPrivate) return;
  }

  const prefixes = cfg.get().prefixos;
  const command = parseCommand(text, prefixes);
  const isAuthCmd = Boolean(command && AUTH_COMMANDS.has(command.name));

  // 4) CONTROLE DE ACESSO:
  // • No privado do dono (inOwnerPrivate): acesso TOTAL, inclusive View Once e Anti-Delete.
  // • Dono digitou .ativar / .desativar / .ativos em qualquer chat: executa.
  // • Chat/grupo ativado com .ativar (authorized): TUDO liberado, MENOS
  //   View Once e Anti-Delete (que somem do menu e não respondem).
  // • Caso contrário: silêncio absoluto (0 mensagens).
  if (command) {
    if (isAuthCmd) {
      if (!senderIsOwner) return; // estranhos tentando dar .ativar são ignorados em silêncio
    } else if (!inOwnerPrivate) {
      // Fora do privado do dono: precisa estar ativado e não ser comando exclusivo do dono
      if (!authorized) return;
      if (OWNER_ONLY_COMMANDS.has(command.name)) return; // View Once / Anti-Delete: 0 traços
    }

    log.cmd(`${command.name} ${command.args.join(' ')} ← ${msg.pushName || prettyJid(jid)}`);
    const progress = createProgress(sock, jid, msg);
    const reply = async (content) => {
      if (typeof content === 'string') return progress.update(content);
      if (content && typeof content === 'object' && 'text' in content && !('edit' in content)) {
        return progress.update(content);
      }
      const sent = await sock
        .sendMessage(jid, { ...content, quoted: msg }, { quoted: msg })
        .catch((e) => {
          log.warn(`envio falhou: ${e.message}`);
          return null;
        });
      if (sent?.key?.id) markBotSent(sent.key.id);
      return sent;
    };
    try {
      await runCommand(sock, msg, command, {
        ownerJid,
        inOwnerPrivate,
        isOwner: () => senderIsOwner,
        reply,
        progress,
        sendOwner
      });
    } catch (error) {
      log.error(`comando .${command.name} falhou`, error);
      await reply(`❌ Deu ruim: ${String(error.message || error).slice(0, 220)}`).catch(() => {});
    }
    return;
  }

  // 5) Auto-download de links soltos: no privado do dono e nos chats/grupos ativados.
  //    (Nunca em grupos aleatórios não autorizados — o bot fica mudo neles.)
  if (inOwnerPrivate || authorized) {
    const urls = extractUrls(text);
    if (urls.length && cfg.get().autoDownload && urls.some(isKnownSocialUrl)) {
      const progress = createProgress(sock, jid, msg);
      const reply = async (t) => progress.update(t);
      await autoDownload(sock, msg, urls.filter(isKnownSocialUrl), { reply });
    }
  }
}

/** Acha a primeira URL nos argumentos (funciona com a qualidade em qualquer posição). */
function pickUrl(args) {
  const url = (args || []).find((a) => /^https?:\/\//i.test(a));
  return url || null;
}

/**
 * Faz o parse de comandos aceitando tanto `.ativar` quanto `. ativar` (com espaço após o ponto),
 * mas ignorando reticências (`...`) ou números (`.5`).
 */
function parseCommand(text, prefixes) {
  if (!text) return null;
  for (const prefix of prefixes) {
    if (text.startsWith(prefix)) {
      const body = text.slice(prefix.length).trim();
      if (!body) return null;
      const [name, ...args] = body.split(/\s+/);
      if (!/^[a-zA-ZÀ-ÿ]/.test(name)) return null;
      return { name: name.toLowerCase(), args, raw: body };
    }
  }
  return null;
}

function requireOwner(ctx, msg) {
  if (!ctx.isOwner(msg.key.remoteJid, msg.key.participant)) {
    throw new Error('só o dono pode usar esse comando 👑');
  }
}

async function runCommand(sock, msg, cmd, ctx) {
  const { name, args } = cmd;
  const { reply, isOwner, inOwnerPrivate } = ctx;
  const jid = msg.key.remoteJid;
  const owner = isOwner(jid, msg.key.participant);
  const argText = args.join(' ');

  switch (name) {
    // ── ATIVAR / DESATIVAR (.ativar / .desativar) ───────
    case 'ativar':
    case 'autorizar':
    case 'permitir':
    case 'liberar': {
      requireOwner(ctx, msg);
      const target = normalizeAuthTarget(argText, msg);
      const list = cfg.get().autorizados;
      if (!list.includes(target)) {
        list.push(target);
        cfg.save();
      }
      if (!inOwnerPrivate && target === bareId(jid)) {
        return reply('✅ *Menu de figurinhas ativado neste chat!*\nDigite *.menu* para ver os comandos de figurinhas.');
      }
      return reply(`🔓 Menu de figurinhas ativado para: *${target}* ✅\nPara desativar: \`.desativar ${target}\``);
    }

    case 'desativar':
    case 'desautorizar':
    case 'revogar':
    case 'bloquear': {
      requireOwner(ctx, msg);
      if (['tudo', 'todos', 'all'].includes(argText.trim().toLowerCase())) {
        cfg.get().autorizados = [];
        cfg.save();
        return reply('🔒 Todos os grupos/chats foram desativados! O bot agora responde SOMENTE no seu privado.');
      }
      const target = normalizeAuthTarget(argText, msg);
      const tDigits = bareDigits(target);
      cfg.get().autorizados = (cfg.get().autorizados || []).filter(
        (item) => bareId(item) !== target && (!tDigits || bareDigits(item) !== tDigits)
      );
      cfg.save();
      if (!inOwnerPrivate && target === bareId(jid)) {
        return reply('🔒 *Menu de figurinhas desativado neste chat.*');
      }
      return reply(`🔒 Acesso desativado para: *${target}* ✅`);
    }

    case 'ativos':
    case 'autorizados': {
      requireOwner(ctx, msg);
      if (!inOwnerPrivate) return; // nunca exibe lista fora do privado do dono
      const list = cfg.get().autorizados || [];
      if (!list.length) {
        return reply(
          '🔒 *MODO PRIVADO ESTRITO*\n\nNenhum grupo ou chat está ativado além do seu privado.\nUse `.ativar` dentro do chat/grupo desejado (ou `.ativar 5531999999999`).'
        );
      }
      return reply(
        [
          '🔓 *CHATS / GRUPOS ATIVADOS*',
          '_(figurinhas, downloads e IA — nunca View Once/Anti-Delete)_',
          '',
          ...list.map((u) => `• ${u}`),
          '',
          '_Use `.desativar <número/aqui>` ou `.desativar tudo` para bloquear._'
        ].join('\n')
      );
    }

    // ── MENU (separado: completo no privado do dono / só figurinhas nos demais) ──
    case 'menu':
    case 'help':
    case 'ajuda':
    case 'comandos':
      return reply(inOwnerPrivate ? ownerMenu() : publicMenu());

    case 'menudl':
    case 'downloadmenu':
      return reply(downloadMenu());

    case 'menufig':
    case 'stickerhelp':
    case 'figurinhas':
      return reply(stickerMenu());

    case 'ping': {
      const t0 = Date.now();
      await reply('🏓 ping…');
      const ms = Date.now() - t0;
      return reply(`🏓 Pong! ${ms}ms`);
    }

    case 'info':
    case 'status':
      return reply(
        infoText({
          uptime: uptimeText(STARTED_AT),
          cacheSize: messageCache.size(),
          bgRows: bgStatus(),
          aiRows: aiStatus(),
          poolRows: [
            'tikwm: ativo (TikTok)',
            'innertube: ativo (YouTube)',
            'vxtwitter: ativo (X)',
            'pinterest widget: ativo',
            `cobalt: ${cobaltPool().available}/${cobaltPool().size} instâncias`,
            `yt-dlp: ${hasYtDlp() ? 'instalado (modo turbo)' : 'não instalado'}`,
            `auto-dl: ${cfg.get().autoDownload ? 'ligado' : 'desligado'}`
          ],
          ownerName: owner ? 'você 👑' : undefined
        })
      );

    case 'doctor':
      return reply(doctorText());

    // ── ANTI-DELETE (100% privado: só no privado do dono, nunca em grupo/chat) ──
    case 'antidelete':
    case 'antidel':
    case 'ad':
    case 'apagadas':
    case 'deletadas':
      // Defesa em profundidade: mesmo o dono não vê nada disso fora do privado,
      // para não deixar NENHUM traço de anti-delete em grupo ou chat alheio.
      if (!inOwnerPrivate) return;
      return antiDeleteCommand(sock, msg, args, ctx);

    // ── VIEW ONCE (100% privado: só no privado do dono, nunca em grupo/chat) ──
    case 'vo':
    case 'visu':
    case 'viewonce': {
      if (!inOwnerPrivate) return;
      if (!args.length) {
        const v = cfg.get().viewOnce;
        return reply(
          [
            '👁️ *VIEW ONCE (100% SILENCIOSO)*',
            '',
            `Captura automática: ${v.auto ? '✅ ligada' : '❌ desligada'}`,
            'Destino: 🔒 Exclusivo no seu privado (0 rastros nos chats)',
            '',
            '💡 Responda qualquer view once em qualquer conversa que ela cai aqui no seu privado sem ninguém ver!'
          ].join('\n')
        );
      }
      requireOwner(ctx, msg);
      const [sub, val] = args.map((a) => a.toLowerCase());
      const v = cfg.get().viewOnce;
      if (sub === 'auto') v.auto = ['on', 'true', '1', 'sim'].includes(val);
      else if (sub === 'on' || sub === 'off') v.auto = sub === 'on';
      else throw new Error('uso: .vo on|off');
      cfg.save();
      return reply('👁️ Configuração da view once salva! ✅');
    }

    // ── FIGURINHAS ──────────────────────────────────────
    case 's':
    case 'fig':
    case 'figu':
    case 'sticker':
    case 'stiker':
    case 'figurinha': {
      const source = await extractStickerSource(sock, msg, { onProgress: reply, allowViewOnce: inOwnerPrivate });
      if (!source) return reply('📸 Envie ou responda uma *imagem, vídeo ou GIF* com *.s*!');
      const webp = await makeSticker(source, { ...packInfo(), onProgress: reply });
      await reply('📤 Enviando figurinha…');
      await sendStickerMessage(sock, jid, webp, msg);
      return reply('✅ Figurinha criada com sucesso! 🖼️');
    }

    case 'sfundo':
    case 'stickerfundo':
    case 'sfundinho': {
      const source = await extractStickerSource(sock, msg, { onProgress: reply, allowViewOnce: inOwnerPrivate });
      if (!source) return reply('📸 Envie ou responda uma *imagem* com *.sfundo*!');
      const webp = await makeSticker(source, { ...packInfo(), removeBg: true, onProgress: reply });
      await reply('📤 Enviando figurinha sem fundo…');
      await sendStickerMessage(sock, jid, webp, msg);
      return reply('✅ Figurinha sem fundo pronta! 🎭');
    }

    case 'fundo':
    case 'removefundo':
    case 'rmbg':
    case 'removebg': {
      const source = await extractStickerSource(sock, msg, { onProgress: reply, allowViewOnce: inOwnerPrivate });
      if (!source) return reply('📸 Envie ou responda uma *imagem*!');
      await reply('🎭 Removendo o fundo com IA…');
      const { buffer, via } = await removeBackground(source.buffer);
      await reply('📤 Enviando PNG sem fundo…');
      const sent = await sock.sendMessage(
        jid,
        { image: buffer, caption: `🎭 Fundo removido via *${via}*`, mimetype: 'image/png' },
        { quoted: msg }
      );
      if (sent?.key?.id) markBotSent(sent.key.id);
      return reply(`✅ Fundo removido via *${via}*!`);
    }

    case 'take':
    case 'renomear': {
      const source = await extractStickerSource(sock, msg, { onProgress: reply, allowViewOnce: inOwnerPrivate });
      if (!source) return reply('🖼️ Responda uma *figurinha* com .take NomePack|NomeAutor');
      const [pack = packInfo().pack, author = packInfo().author] = argText.split('|').map((s) => s.trim());
      const webp = await makeSticker(source, { pack, author, onProgress: reply });
      await reply('📤 Enviando figurinha renomeada…');
      await sendStickerMessage(sock, jid, webp, msg);
      return reply(`✅ Pacote atualizado: *${pack}*`);
    }

    // ── IA ──────────────────────────────────────────────
    case 'ia':
    case 'ai':
    case 'gpt':
    case 'chat': {
      if (args[0]?.toLowerCase() === 'reset') {
        resetChatMemory(jid);
        return reply('🧠 Memória da conversa limpa!');
      }
      const question = argText || extractAnyText(msg.message?.extendedTextMessage?.contextInfo?.quotedMessage || {});
      if (!question) return reply('🧠 Pergunte algo! Ex.: `.ia qual a capital do Japão?`');
      await reply('🧠 Pensando…');
      const answer = await aiChat(jid, question);
      return reply(truncate(answer, 3800));
    }

    case 'criar':
    case 'img':
    case 'gerar':
    case 'imagine':
    case 'desenhar': {
      if (!argText) return reply('🎨 Diga o que quer ver! Ex.: `.criar um gato astronauta em marte, realista`');
      await reply('🎨 Gerando sua imagem com IA… (até 1 min)');
      const buffer = await aiImage(argText);
      await reply('📤 Enviando imagem gerada…');
      const sent = await sock.sendMessage(jid, { image: buffer, caption: `🎨 "${truncate(argText, 200)}"` }, { quoted: msg });
      if (sent?.key?.id) markBotSent(sent.key.id);
      return reply('✅ Imagem gerada com sucesso! 🎨');
    }

    case 'voz':
    case 'tts':
    case 'falar': {
      const text2 = argText || extractAnyText(msg.message?.extendedTextMessage?.contextInfo?.quotedMessage || {});
      if (!text2) return reply('🔊 Diga o que devo falar! Ex.: `.voz bom dia grupo`');
      await reply('🔊 Gerando voz com IA…');
      const buffer = await aiVoice(truncate(text2, 900));
      await reply('📤 Enviando áudio…');
      const sent = await sock.sendMessage(jid, { audio: buffer, mimetype: 'audio/mpeg', ptt: true }, { quoted: msg });
      if (sent?.key?.id) markBotSent(sent.key.id);
      return reply('✅ Áudio enviado! 🔊');
    }

    case 'traduz':
    case 'traduzir': {
      const [target, ...restArr] = args;
      let text3 = restArr.join(' ');
      if (!text3) text3 = extractAnyText(msg.message?.extendedTextMessage?.contextInfo?.quotedMessage || {});
      if (!target || !text3) return reply('🌍 Ex.: `.traduz inglês boa tarde` (ou responda um texto)');
      await reply(`🌍 Traduzindo para *${target}*…`);
      const result = await aiTranslate(truncate(text3, 3000), target);
      return reply(`🌍 *Tradução (${target}):*\n\n${truncate(result, 3800)}`);
    }

    case 'resumo':
    case 'resumir': {
      let text4 = argText;
      if (!text4) text4 = extractAnyText(msg.message?.extendedTextMessage?.contextInfo?.quotedMessage || {});
      if (!text4) return reply('📄 Envie ou responda um texto grande com `.resumo`');
      await reply('📄 Lendo e resumindo o texto…');
      const result = await aiSummary(truncate(text4, 6000));
      return reply(`📄 *Resumo:*\n\n${truncate(result, 3800)}`);
    }

    // ── DOWNLOADS (qualquer rede social) ────────────────
    case 'dl':
    case 'download':
    case 'baixar':
      return downloadCommand({ sock, msg, args, ctx, url: pickUrl(args), fallback: downloadMenu() });

    case 'tiktok':
    case 'tt':
    case 'tiktokdl':
      return downloadCommand({
        sock, msg, args, ctx,
        url: pickUrl(args),
        fallback: '🎵 Manda o link! Ex.: `.tiktok https://vm.tiktok.com/…`'
      });

    case 'ttmp3':
    case 'tiktokmp3':
    case 'ttaudio':
      return downloadCommand({
        sock, msg, args, ctx,
        url: pickUrl(args),
        audioOnly: true,
        fallback: '🎶 Manda o link do TikTok!'
      });

    case 'pin':
    case 'pinterest':
    case 'pint':
      return downloadCommand({
        sock, msg, args, ctx,
        url: pickUrl(args),
        fallback: '📌 Manda o link do Pinterest! (aceito até pin.it)'
      });

    case 'insta':
    case 'instagram':
    case 'ig':
    case 'reels':
      return downloadCommand({
        sock, msg, args, ctx,
        url: pickUrl(args),
        fallback: '📸 Manda o link do Instagram!'
      });

    case 'yt':
    case 'youtube':
    case 'ytb':
    case 'video':
      return downloadCommand({
        sock, msg, args, ctx,
        url: pickUrl(args),
        fallback: '▶️ Manda o link do YouTube!'
      });

    case 'ytmp3':
    case 'youtubemp3':
    case 'ytaudio':
    case 'mp3':
      return downloadCommand({
        sock, msg, args, ctx,
        url: pickUrl(args),
        audioOnly: true,
        fallback: '🎶 Manda o link do YouTube (ou de qualquer rede)!'
      });

    case 'tw':
    case 'twitter':
    case 'x':
    case 'tweet':
      return downloadCommand({
        sock, msg, args, ctx,
        url: pickUrl(args),
        fallback: '𝕏 Manda o link do tweet!'
      });

    case 'face':
    case 'facebook':
    case 'fb':
      return downloadCommand({
        sock, msg, args, ctx,
        url: pickUrl(args),
        fallback: '👥 Manda o link do Facebook!'
      });

    // ── CONFIGURAÇÃO ────────────────────────────────────
    case 'config': {
      requireOwner(ctx, msg);
      if (!args.length) {
        const c = cfg.get();
        return reply(
          [
            '⚙️ *CONFIGURAÇÃO ATUAL*',
            '',
            '🔒 Acesso: total no privado do dono; liberado só nos chats ativados',
            `chats ativados: ${c.autorizados?.length || 0} (${(c.autorizados || []).join(', ') || 'ninguém'})`,
            '🚫 Nunca visível para terceiros: View Once e Anti-Delete',
            `autoDownload: ${c.autoDownload}`,
            `qualidadePadrao: ${c.qualidadePadrao}`,
            `maxMB: ${c.maxMB}`,
            `viewOnce: auto=${c.viewOnce.auto} (silencioso só pro dono)`,
            `antiDelete: ativo=${c.antiDelete.ativo} (silencioso só pro dono) ignorar=[${c.antiDelete.ignorar.join(', ')}]`,
            '',
            'Mude com `.config <chave> <valor>`',
            'Ex.: `.config autoDownload false`'
          ].join('\n')
        );
      }
      const [key, ...restArr] = args;
      const valueRaw = restArr.join(' ');
      const map = {
        autodownload: ['autoDownload', (v) => v === 'true'],
        qualidadepadrao: ['qualidadePadrao', (v) => v],
        maxmb: ['maxMB', (v) => Number(v) || 90]
      };
      const entry = map[key.toLowerCase()];
      if (!entry) throw new Error('chaves: autoDownload, qualidadePadrao, maxMB');
      cfg.set(entry[0], entry[1](valueRaw.toLowerCase()));
      return reply(`⚙️ ${entry[0]} = ${cfg.get()[entry[0]]} ✅`);
    }

    case 'pools': {
      requireOwner(ctx, msg);
      const lines = ['🔑 *POOLS DE APIS*', ''];
      const { removebg, endpoints } = bgPools();
      lines.push(
        '🎭 remove.bg',
        ...removebg.summary().map((s) => '  ' + s),
        '🎭 endpoints',
        ...endpoints.summary().map((s) => '  ' + s)
      );
      return reply(lines.join('\n'));
    }

    default:
      if (inOwnerPrivate && cfg.get().responderDesconhecido) {
        return reply(`🤔 Não conheço .${name}. Digita .menu pra ver tudo que eu faço!`);
      }
      return;
  }
}

/**
 * Handler único de download: resolve a URL, baixa e envia tudo em cascata
 * (extrator da rede → Cobalt → yt-dlp → scraping), editando a mesma mensagem
 * de progresso em vez de disparar várias.
 */
async function downloadCommand({ sock, msg, args, ctx, url, audioOnly = false, fallback }) {
  const { reply } = ctx;
  if (!url) return reply(fallback);
  const { quality } = parseQuality(args, cfg.get().qualidadePadrao);
  const jid = msg.key.remoteJid;
  try {
    const result = await resolveDownload(url, quality, { audioOnly, onProgress: reply });
    return await sendDownload(sock, jid, result, { quality, url, onProgress: reply, quoted: msg });
  } catch (error) {
    log.warn(`download falhou (${url.slice(0, 60)}): ${error.message}`);
    const detail = String(error.message || error).slice(0, 260);
    return reply(
      '😕 Não consegui baixar esse link.\n\n' +
        `Motivo: ${detail}\n\n` +
        'Tenta de novo em alguns minutos, manda o link direto do app ' +
        '(compartilhar → copiar link) ou usa `.dl <link> baixa`.'
    );
  }
}

async function antiDeleteCommand(sock, msg, args, ctx) {
  const { reply, isOwner } = ctx;
  const jid = msg.key.remoteJid;
  const owner = isOwner(jid, msg.key.participant);
  const settings = cfg.get().antiDelete;
  const [sub, ...restArr] = args.map((a, i) => (i === 0 ? a.toLowerCase() : a));

  if (!sub) return reply(statusText(jid));

  if (['on', 'off'].includes(sub)) {
    if (!owner) throw new Error('só o dono liga/desliga 👑');
    settings.ativo = sub === 'on';
    cfg.save();
    return reply(`🛡️ Anti-delete ${settings.ativo ? 'ATIVADO ✅ (100% silencioso no seu privado)' : 'desativado ⚠️'}`);
  }

  if (sub === 'lista') {
    return reply(
      `🛡️ *Filtros de ignorar:*\n${settings.ignorar.length ? settings.ignorar.map((r) => `• ${r}`).join('\n') : '• nenhum (monitorando tudo)'}`
    );
  }

  if (['ignorar', 'add', 'addignorar'].includes(sub)) {
    if (!owner) throw new Error('só o dono muda filtros 👑');
    const target = normalizeIgnoreTarget(restArr.join(' '), msg);
    if (settings.ignorar.includes(target)) return reply('ℹ️ Esse filtro já existe!');
    settings.ignorar.push(target);
    cfg.save();
    return reply(`🛡️ Ignorando agora: *${target}* ✅\nUse .antidelete remover ${target} para voltar.`);
  }

  if (['remover', 'rm', 'tirar', 'parar'].includes(sub)) {
    if (!owner) throw new Error('só o dono muda filtros 👑');
    const target = normalizeIgnoreTarget(restArr.join(' '), msg);
    settings.ignorar = settings.ignorar.filter((r) => r !== target);
    cfg.save();
    return reply(`🛡️ Filtro removido: *${target}* — monitorado de novo ✅`);
  }

  return reply(antiDeleteMenu());
}

function doctorText() {
  const lines = [
    '🩺 *DOCTOR NEXUS*',
    '',
    `Node: ${process.version} ${Number(process.versions.node.split('.')[0]) >= 20 ? '✅' : '⚠️ use 20+'}`,
    `FFmpeg: ${hasFfmpeg() ? '✅ instalado' : '❌ ausente — figurinhas precisam dele'}`,
    `yt-dlp: ${hasYtDlp() ? '✅ instalado (modo turbo dos downloads)' : '— opcional (pip install -U yt-dlp)'}`,
    `Plataforma: ${process.platform}`,
    `Memória: ${Math.round(process.memoryUsage().rss / 1024 / 1024)} MB`,
    '',
    '🎭 Fundo: ' + bgStatus().join(' · '),
    '🧠 IA: ' + aiStatus().join(' · '),
    '',
    `🌐 Cobalt: ${cobaltPool().available}/${cobaltPool().size} instâncias saudáveis`,
    '',
    !hasFfmpeg() ? 'Instale FFmpeg: pkg install ffmpeg (Termux) / apt install ffmpeg' : '✅ Tudo certo por aqui!'
  ];
  return lines.join('\n');
}
