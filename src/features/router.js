// 🧭 ROUTER — despacha comandos, captura view once por resposta,
// aplica anti-delete e faz auto-download de links.

import { cfg } from '../core/config.js';
import { log } from '../core/logger.js';
import { messageCache } from '../wa/cache.js';
import { extractAnyText, isIgnored, normalizeIgnoreTarget, handleDelete, statusText } from './antidelete.js';
import { isViewOnce, onViewOnceMessage, onViewOnceReply, unwrapViewOnce } from './viewonce.js';
import { extractStickerSource, makeSticker, packInfo } from './sticker.js';
import { removeBackground, bgStatus, bgPools } from './bgremoval.js';
import { aiChat, aiImage, aiVoice, aiTranslate, aiSummary, resetChatMemory, aiStatus } from './ai.js';
import { resolveDownload, sendDownload, parseQuality, autoDownload, isKnownSocialUrl } from './download.js';
import { mainMenu, downloadMenu, stickerMenu, antiDeleteMenu, infoText } from './menu.js';
import { extractUrls, truncate, prettyJid, uptimeText } from '../util/text.js';
import { hasFfmpeg } from '../util/ffmpeg.js';

const STARTED_AT = Date.now();

export { isViewOnce, unwrapViewOnce };

/**
 * Ponto de entrada para TODA mensagem recebida.
 */
export async function handleMessage(sock, msg, deps) {
  const { ownerJid, isOwner, sendOwner } = deps;
  if (!msg?.message) return;
  if (msg.key.remoteJid === 'status@broadcast') return;

  // 0) Anti-delete: armazena tudo que chega
  messageCache.put(msg);

  // 1) Mensagem apagada (REVOKE)
  const proto = msg.message.protocolMessage;
  if (proto && (proto.type === 0 || proto.type === 'REVOKE')) {
    await handleDelete(sock, msg, { ownerJid }).catch((e) => log.warn(`antidelete: ${e.message}`));
    return;
  }

  const text = extractAnyText(msg.message).trim();
  const prefixes = cfg.get().prefixos;
  const command = parseCommand(text, prefixes);

  // 2) É comando?
  if (command) {
    log.cmd(`${command.name} ${command.args.join(' ')} ← ${msg.pushName || prettyJid(msg.key.remoteJid)}`);
    const reply = async (content) => {
      if (typeof content === 'string') content = { text: content };
      return sock.sendMessage(msg.key.remoteJid, { ...content, quoted: msg }).catch((e) => log.warn(`envio falhou: ${e.message}`));
    };
    try {
      await runCommand(sock, msg, command, { ownerJid, isOwner, reply, sendOwner });
    } catch (error) {
      log.error(`comando .${command.name} falhou`, error);
      await reply(`❌ Deu ruim: ${String(error.message || error).slice(0, 220)}`).catch(() => {});
    }
    return;
  }

  // 3) Respondeu uma view once com qualquer mensagem → baixa
  if (msg.message.extendedTextMessage?.contextInfo?.quotedMessage) {
    const captured = await onViewOnceReply(sock, msg, { ownerJid, senderIsOwner: isOwner(msg.key.remoteJid, msg.key.participant) }).catch(
      (e) => {
        log.warn(`view once resposta: ${e.message}`);
        return false;
      }
    );
    if (captured) return;
  }

  // 4) Auto-download de links soltos
  const urls = extractUrls(text);
  if (urls.length && cfg.get().autoDownload && urls.some(isKnownSocialUrl)) {
    const reply = async (t) => sock.sendMessage(msg.key.remoteJid, { text: t, quoted: msg }).catch(() => {});
    await autoDownload(sock, msg, urls.filter(isKnownSocialUrl), { reply });
    return;
  }

  // 5) View once comum (sem resposta) → captura automática
  if (isViewOnce(msg.message)) {
    await onViewOnceMessage(sock, msg, { ownerJid }).catch((e) => log.warn(`view once: ${e.message}`));
  }
}

/** Acha a primeira URL nos argumentos (funciona com a qualidade em qualquer posição). */
function pickUrl(args) {
  const url = (args || []).find((a) => /^https?:\/\//i.test(a));
  return url || null;
}

function parseCommand(text, prefixes) {
  if (!text) return null;
  for (const prefix of prefixes) {
    if (text.startsWith(prefix)) {
      const body = text.slice(prefix.length).trim();
      if (!body) return null;
      const [name, ...args] = body.split(/\s+/);
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
  const { name, args, raw } = cmd;
  const { reply, ownerJid, isOwner } = ctx;
  const jid = msg.key.remoteJid;
  const owner = isOwner(jid, msg.key.participant);
  const argText = args.join(' ');

  switch (name) {
    // ── MENU / UTILITÁRIOS ──────────────────────────────
    case 'menu':
    case 'help':
    case 'ajuda':
    case 'comandos':
      return reply(mainMenu());

    case 'menudl':
    case 'downloadmenu':
      return reply(downloadMenu());

    case 'menufig':
    case 'stickerhelp':
      return reply(stickerMenu());

    case 'ping': {
      const t0 = Date.now();
      const sent = await reply('🏓 ping…');
      const ms = Date.now() - t0;
      return sock.sendMessage(jid, { text: `🏓 Pong! ${ms}ms`, edit: sent?.key }).catch(() => reply(`🏓 Pong! ${ms}ms`));
    }

    case 'info':
    case 'status':
      return reply(
        infoText({
          uptime: uptimeText(STARTED_AT),
          cacheSize: messageCache.size(),
          bgRows: bgStatus(),
          aiRows: aiStatus(),
          poolRows: ['tiktok (tikwm): ativo', `cobalt: ${cfg.get().autoDownload ? 'auto-dl ligado' : 'auto-dl desligado'}`],
          ownerName: owner ? 'você 👑' : undefined
        })
      );

    case 'doctor':
      return reply(doctorText());

    // ── ANTI-DELETE ─────────────────────────────────────
    case 'antidelete':
    case 'antidel':
    case 'ad':
      return antiDeleteCommand(sock, msg, args, ctx);

    // ── VIEW ONCE (config) ──────────────────────────────
    case 'vo':
    case 'visu': {
      if (!args.length) {
        const v = cfg.get().viewOnce;
        return reply(
          [
            '👁️ *VIEW ONCE*',
            '',
            `Captura automática: ${v.auto ? '✅ ligada' : '❌ desligada'}`,
            `Destino da auto: ${v.destinoAuto === 'chat' ? 'devolve no chat' : 'vai pro dono'}`,
            `Responder p/ baixar: ${v.resposta === 'todos' ? 'qualquer pessoa' : 'só o dono'}`,
            '',
            '💡 Responda qualquer view once com qualquer mensagem que eu baixo!'
          ].join('\n')
        );
      }
      requireOwner({ isOwner }, msg);
      const [sub, val] = args.map((a) => a.toLowerCase());
      const v = cfg.get().viewOnce;
      if (sub === 'auto') v.auto = ['on', 'true', '1', 'sim'].includes(val);
      else if (sub === 'destino') v.destinoAuto = val === 'chat' ? 'chat' : 'dono';
      else if (sub === 'resposta') v.resposta = val === 'dono' ? 'dono' : 'todos';
      else throw new Error('uso: .vo auto on|off · .vo destino dono|chat · .vo resposta todos|dono');
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
      const source = await extractStickerSource(sock, msg);
      if (!source) return reply('📸 Envie ou responda uma *imagem, vídeo ou GIF* com esse comando!');
      await reply('🖌️ Fazendo sua figurinha…').catch(() => {});
      const webp = await makeSticker(source, packInfo());
      return sock.sendMessage(jid, { sticker: webp }, { quoted: msg });
    }

    case 'sfundo':
    case 'stickerfundo':
    case 'sfundinho': {
      const source = await extractStickerSource(sock, msg);
      if (!source) return reply('📸 Envie ou responda uma *imagem* com esse comando!');
      await reply('🎭 Removendo o fundo com IA… (pode levar uns segundos)').catch(() => {});
      const webp = await makeSticker(source, { ...packInfo(), removeBg: true });
      return sock.sendMessage(jid, { sticker: webp }, { quoted: msg });
    }

    case 'fundo':
    case 'removefundo':
    case 'rmbg':
    case 'removebg': {
      const source = await extractStickerSource(sock, msg);
      if (!source) return reply('📸 Envie ou responda uma *imagem*!');
      await reply('🎭 Removendo o fundo com IA…').catch(() => {});
      const { buffer, via } = await removeBackground(source.buffer);
      return sock.sendMessage(jid, { image: buffer, caption: `🎭 Fundo removido via *${via}*`, mimetype: 'image/png' }, { quoted: msg });
    }

    case 'take':
    case 'renomear': {
      const source = await extractStickerSource(sock, msg);
      if (!source) return reply('🖼️ Responda uma *figurinha* com .take NomePack|NomeAutor');
      const [pack = packInfo().pack, author = packInfo().author] = argText.split('|').map((s) => s.trim());
      const webp = await makeSticker(source, { pack, author });
      return sock.sendMessage(jid, { sticker: webp }, { quoted: msg });
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
      const question =
        argText ||
        extractAnyText(msg.message?.extendedTextMessage?.contextInfo?.quotedMessage || {});
      if (!question) return reply('🧠 Pergunte algo! Ex.: `.ia qual a capital do Japão?`');
      await reply('🧠 Pensando…').catch(() => {});
      const answer = await aiChat(jid, question);
      return reply(truncate(answer, 3800));
    }

    case 'criar':
    case 'img':
    case 'gerar':
    case 'imagine':
    case 'desenhar': {
      if (!argText) return reply('🎨 Diga o que quer ver! Ex.: `.criar um gato astronauta em marte, realista`');
      await reply('🎨 Gerando sua imagem com IA… (até 1 min)').catch(() => {});
      const buffer = await aiImage(argText);
      return sock.sendMessage(jid, { image: buffer, caption: `🎨 "${truncate(argText, 200)}"` }, { quoted: msg });
    }

    case 'voz':
    case 'tts':
    case 'falar': {
      const text2 = argText || extractAnyText(msg.message?.extendedTextMessage?.contextInfo?.quotedMessage || {});
      if (!text2) return reply('🔊 Diga o que devo falar! Ex.: `.voz bom dia grupo`');
      const buffer = await aiVoice(truncate(text2, 900));
      return sock.sendMessage(jid, { audio: buffer, mimetype: 'audio/mpeg', ptt: true }, { quoted: msg });
    }

    case 'traduz':
    case 'traduzir': {
      const [target, ...restArr] = args;
      let text3 = restArr.join(' ');
      if (!text3) text3 = extractAnyText(msg.message?.extendedTextMessage?.contextInfo?.quotedMessage || {});
      if (!target || !text3) return reply('🌍 Ex.: `.traduz inglês boa tarde` (ou responda um texto)');
      const result = await aiTranslate(truncate(text3, 3000), target);
      return reply(`🌍 *Tradução (${target}):*\n\n${truncate(result, 3800)}`);
    }

    case 'resumo':
    case 'resumir': {
      let text4 = argText;
      if (!text4) text4 = extractAnyText(msg.message?.extendedTextMessage?.contextInfo?.quotedMessage || {});
      if (!text4) return reply('📄 Envie ou responda um texto grande com `.resumo`');
      const result = await aiSummary(truncate(text4, 6000));
      return reply(`📄 *Resumo:*\n\n${truncate(result, 3800)}`);
    }

    // ── DOWNLOADS ───────────────────────────────────────
    case 'dl':
    case 'download':
    case 'baixar': {
      const url = pickUrl(args);
      if (!url) return reply(downloadMenu());
      const { quality } = parseQuality(args, cfg.get().qualidadePadrao);
      await reply('⬇️ Buscando na melhor qualidade…').catch(() => {});
      const result = await resolveDownload(url, quality);
      return sendDownload(sock, jid, result, { quality, url });
    }

    case 'tiktok':
    case 'tt':
    case 'tiktokdl': {
      const url = pickUrl(args);
      if (!url) return reply('🎵 Manda o link! Ex.: `.tiktok https://vm.tiktok.com/…`');
      const { quality } = parseQuality(args, cfg.get().qualidadePadrao);
      await reply('🎵 Baixando do TikTok…').catch(() => {});
      const result = await resolveDownload(url, quality);
      return sendDownload(sock, jid, result, { quality, url });
    }

    case 'ttmp3':
    case 'tiktokmp3':
    case 'ttaudio': {
      const url = pickUrl(args);
      if (!url) return reply('🎶 Manda o link do TikTok!');
      const { quality } = parseQuality(args);
      const result = await resolveDownload(url, quality, { audioOnly: true });
      return sendDownload(sock, jid, result, { quality, url });
    }

    case 'pin':
    case 'pinterest':
    case 'pint': {
      const url = pickUrl(args);
      if (!url) return reply('📌 Manda o link do Pinterest! (aceito até pin.it)');
      const { quality } = parseQuality(args, cfg.get().qualidadePadrao);
      await reply('📌 Baixando do Pinterest…').catch(() => {});
      const result = await resolveDownload(url, quality);
      return sendDownload(sock, jid, result, { quality, url });
    }

    case 'insta':
    case 'instagram':
    case 'ig':
    case 'reels': {
      const url = pickUrl(args);
      if (!url) return reply('📸 Manda o link do Instagram!');
      const { quality } = parseQuality(args, cfg.get().qualidadePadrao);
      await reply('📸 Baixando do Instagram…').catch(() => {});
      const result = await resolveDownload(url, quality);
      return sendDownload(sock, jid, result, { quality, url });
    }

    // ── CONFIGURAÇÃO ────────────────────────────────────
    case 'config': {
      requireOwner(ctx, msg);
      if (!args.length) {
        const c = cfg.get();
        return reply(
          [
            '⚙️ *CONFIGURAÇÃO ATUAL*',
            '',
            `autoDownload: ${c.autoDownload}`,
            `qualidadePadrao: ${c.qualidadePadrao}`,
            `maxMB: ${c.maxMB}`,
            `viewOnce: auto=${c.viewOnce.auto} destino=${c.viewOnce.destinoAuto} resposta=${c.viewOnce.resposta}`,
            `antiDelete: ativo=${c.antiDelete.ativo} ignorar=[${c.antiDelete.ignorar.join(', ')}]`,
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
      lines.push('🎭 remove.bg', ...removebg.summary().map((s) => '  ' + s), '🎭 endpoints', ...endpoints.summary().map((s) => '  ' + s));
      return reply(lines.join('\n'));
    }

    default:
      if (cfg.get().responderDesconhecido) {
        return reply(`🤔 Não conheço .${name}. Digita .menu pra ver tudo que eu faço!`);
      }
      return;
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
    return reply(`🛡️ Anti-delete ${settings.ativo ? 'ATIVADO em tudo ✅' : 'desativado ⚠️'}`);
  }

  if (sub === 'lista') {
    return reply(`🛡️ *Filtros de ignorar:*\n${settings.ignorar.length ? settings.ignorar.map((r) => `• ${r}`).join('\n') : '• nenhum (protegendo tudo)'}`);
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
    return reply(`🛡️ Filtro removido: *${target}* — protegido de novo ✅`);
  }

  if (sub === 'dono') {
    if (!owner) throw new Error('só o dono muda filtros 👑');
    settings.avisarDono = !settings.avisarDono;
    cfg.save();
    return reply(`🛡️ Cópia para o dono: ${settings.avisarDono ? 'ligada ✅' : 'desligada'}`);
  }

  return reply(antiDeleteMenu());
}

function doctorText() {
  const lines = [
    '🩺 *DOCTOR NEXUS*',
    '',
    `Node: ${process.version} ${Number(process.versions.node.split('.')[0]) >= 20 ? '✅' : '⚠️ use 20+'}`,
    `FFmpeg: ${hasFfmpeg() ? '✅ instalado' : '❌ ausente — figurinhas precisam dele'}`,
    `Plataforma: ${process.platform}`,
    `Memória: ${Math.round(process.memoryUsage().rss / 1024 / 1024)} MB`,
    '',
    '🎭 Fundo: ' + bgStatus().join(' · '),
    '🧠 IA: ' + aiStatus().join(' · '),
    '',
    !hasFfmpeg() ? 'Instale FFmpeg: pkg install ffmpeg (Termux) / apt install ffmpeg' : '✅ Tudo certo por aqui!'
  ];
  return lines.join('\n');
}


