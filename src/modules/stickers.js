// STICKER ENGINE 2.0
//
// - Imagem, vídeo, GIF, figurinha (estática/animada) e documento de imagem/vídeo.
// - Modos: crop (padrão — preenche o quadrado inteiro), fit (inteira), full (estica),
//   circle, round.
// - Efeitos: bw, sepia, invert, flip, blur.  Vídeo: fast, slow, rev, boomerang, duração.
// - Compressão adaptativa: tenta qualidades/FPS menores até caber no limite do WhatsApp.
// - Nome do pacote/autor/emojis gravados no EXIF do WebP (aparece no WhatsApp).
// - Extras: .take (troca pack/autor), .toimg, .stickerinfo, modo automático no chat consigo.
// - Filtros com plano B: se o FFmpeg recusar um filtro (build limitado), reencoded com
//   uma versão mais simples em vez de falhar.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { downloadMediaMessage } from '@whiskeysockets/baileys';
import { dbGet, dbSet } from '../core/db.js';
import { CONFIG } from '../core/config.js';
import { logger } from '../core/logger.js';
import { extractText, getQuoted, getMediaNode, formatBytes, isSelfChat, card } from '../core/format.js';
import { extFromMime, ffmpegCapabilities, probeMedia, runFfmpeg, withTempDir } from '../core/media.js';
import { SerialQueues } from '../core/queue.js';
import { isAnimatedWebp, parseWebp, packId, readStickerExif, tagSticker } from '../core/webp.js';
import { decodeAnimatedWebp, webpToPng } from '../core/webpDecode.js';

const SIZE = 512;
const queue = new SerialQueues();

/* ───────────────────────── configurações ───────────────────────── */

export function stickerEnabled() { const v = dbGet('feature.sticker'); return v == null ? CONFIG.DEFAULT_STICKER : v === '1'; }
export const setStickerEnabled = (on) => dbSet('feature.sticker', on ? '1' : '0');

export function stickerAutoEnabled() { const v = dbGet('sticker.auto'); return v == null ? CONFIG.STICKER_AUTO_SELF : v === '1'; }
export const setStickerAuto = (on) => dbSet('sticker.auto', on ? '1' : '0');

export function getPack(sock) {
  const fallbackAuthor = CONFIG.STICKER_AUTHOR; // vazio por padrão: só o nome do pack aparece (visual limpo)
  return {
    pack: dbGet('sticker.pack') || CONFIG.STICKER_PACK,
    author: dbGet('sticker.author') ?? fallbackAuthor
  };
}
export function setPack(pack, author) {
  if (pack != null) dbSet('sticker.pack', String(pack).slice(0, 60));
  if (author != null) dbSet('sticker.author', String(author).slice(0, 60));
}
export function resetPack() { dbSet('sticker.pack', ''); dbSet('sticker.author', ''); }

/* ───────────────────────── ajuda ───────────────────────── */

export function stickerHelp(sock) {
  const { pack, author } = getPack(sock);
  return card('🎨 *FIGURINHAS — guia simples*', [
    `Estado: ${stickerEnabled() ? '✅ liberadas' : '🔒 bloqueadas'} • automático no meu chat: ${stickerAutoEnabled() ? '✅ ligado' : '🔒 desligado'}`,
    `📦 Pack: *${pack || '—'}* • ✍️ Autor: *${author || '—'}*`,
    '',
    '*1️⃣ COMO CRIAR*',
    'Responda uma foto, vídeo, GIF ou figurinha com `.s`',
    '(ou mande a mídia com `.s` escrito na legenda).',
    'A figurinha sempre sai *preenchendo o quadradinho inteiro*.',
    '',
    '*2️⃣ MUDAR O FORMATO* (opcional)',
    '`.s inteira` → mostra a imagem toda, com espacinho transparente em volta',
    '`.s preencher` → quadrado cheio, cortando o que sobra (é o padrão)',
    '`.s esticar` → estica a imagem até caber',
    '`.s circulo` → deixa a figurinha redonda',
    '`.s borda` → só arredonda os cantos',
    '',
    '*3️⃣ EFEITOS* (pode juntar: `.s circulo espelho`)',
    '`.s pretoebranco` • `.s sepia` • `.s inverter`',
    '`.s espelho` • `.s desfoque`',
    '',
    '*4️⃣ VÍDEO E GIF*',
    '`.s rapido` / `.s lento` → muda a velocidade',
    '`.s reverso` → roda de trás pra frente • `.s vaievem` → vai e volta',
    '`.s parada` → só o primeiro quadro (vira foto)',
    '`.s 5` → só os 5 primeiros segundos',
    '`.s qualidade` → mais nítida • `.s leve` → arquivo menor',
    '',
    '*5️⃣ SEU NOME NA FIGURINHA*',
    '`.s 😎 | Meu Pack | Meu Nome` → só nesta figurinha',
    '`.sticker pack Nome | Autor` → define o padrão de todas',
    '`.sticker pack reset` → volta ao padrão',
    '',
    '*6️⃣ OUTRAS FERRAMENTAS*',
    '`.take Nome | Autor` → copia uma figurinha trocando o pack',
    '`.toimg` → figurinha vira imagem (`.toimg doc` = arquivo com transparência)',
    '`.togif` / `.tovideo` → figurinha animada vira GIF / vídeo',
    '`.stickerinfo` → mostra pack, autor, tamanho e quadros',
    '`.sticker auto on` → o que você mandar no seu próprio chat vira figurinha',
    '`.sticker on` / `.sticker off` → liga / desliga'
  ], { footer: true });
}

/* ───────────────────────── parser de opções ───────────────────────── */

const strip = (s) => String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const alias = (names, value) => Object.fromEntries(names.map((n) => [n, value]));
const FIT_TOKENS = {
  ...alias(['fit', 'inteira', 'inteiro', 'contain', 'normal'], 'fit'),
  ...alias(['crop', 'cortar', 'corte', 'cover', 'preencher', 'c'], 'crop'),
  ...alias(['full', 'esticar', 'estica', 'stretch'], 'full'),
  ...alias(['circle', 'circulo', 'redonda', 'redondo', 'bola'], 'circle'),
  ...alias(['round', 'rounded', 'arredondada', 'arredondado', 'borda'], 'round')
};
const FX_TOKENS = {
  ...alias(['bw', 'pb', 'pretoebranco', 'mono'], 'bw'),
  ...alias(['sepia', 'vintage'], 'sepia'),
  ...alias(['invert', 'inverter', 'negativo'], 'invert'),
  ...alias(['flip', 'espelho', 'mirror'], 'flip'),
  ...alias(['blur', 'borrar', 'desfoque'], 'blur')
};
const FLAG_TOKENS = {
  ...alias(['fast', 'rapido', 'acelerar', '2x'], 'fast'),
  ...alias(['slow', 'lento', 'lenta', 'devagar', '0.5x'], 'slow'),
  ...alias(['rev', 'reverso', 'reverse', 'reversa'], 'reverse'),
  ...alias(['boomerang', 'bounce', 'pingpong', 'vaievem'], 'boomerang'),
  ...alias(['static', 'estatica', 'estatico', 'img', 'foto', 'parada'], 'static'),
  ...alias(['hq', 'max', 'qualidade', 'alta'], 'hq'),
  ...alias(['lq', 'leve', 'lite', 'baixa'], 'lq')
};
const EMOJI_RE = /\p{Extended_Pictographic}(?:\uFE0F|\u200D\p{Extended_Pictographic}|[\u{1F3FB}-\u{1F3FF}])*/gu;

const DEFAULT_FIT = FIT_TOKENS[strip(CONFIG.STICKER_FIT)] || 'crop';

export function defaultOptions() {
  return { fit: DEFAULT_FIT, fx: [], speed: 1, reverse: false, boomerang: false, static: false, quality: 'normal', seconds: null };
}

/**
 * Interpreta `opções 😎 | pack | autor`.
 * @returns {{opts:object, pack:string|null, author:string|null, emojis:string[], unknown:string[]}}
 */
export function parseStickerArgs(text = '') {
  const segs = String(text).split('|').map((s) => s.trim());
  const head = segs[0] || '';
  const emojis = [...(head.match(EMOJI_RE) || [])].slice(0, 3);
  const tokens = head.replace(EMOJI_RE, ' ').split(/\s+/).filter(Boolean);
  const opts = defaultOptions();
  const unknown = [];
  for (const raw of tokens) {
    const t = strip(raw);
    if (FIT_TOKENS[t]) opts.fit = FIT_TOKENS[t];
    else if (FX_TOKENS[t]) { if (!opts.fx.includes(FX_TOKENS[t])) opts.fx.push(FX_TOKENS[t]); }
    else if (FLAG_TOKENS[t]) {
      const f = FLAG_TOKENS[t];
      if (f === 'fast') opts.speed = 2;
      else if (f === 'slow') opts.speed = 0.5;
      else if (f === 'hq') opts.quality = 'hq';
      else if (f === 'lq') opts.quality = 'lq';
      else opts[f] = true;
    } else if (/^\d+(?:[.,]\d+)?s?$/.test(t)) {
      opts.seconds = Math.min(CONFIG.STICKER_MAX_SECONDS_LIMIT, Math.max(1, Number(t.replace(',', '.').replace('s', ''))));
    } else unknown.push(raw);
  }
  return {
    opts,
    pack: segs.length > 1 && segs[1] ? segs[1].slice(0, 60) : null,
    author: segs.length > 2 && segs[2] ? segs[2].slice(0, 60) : null,
    emojis,
    unknown
  };
}

const hasVisualChange = (o) => o.fit !== DEFAULT_FIT || o.fx.length > 0 || o.speed !== 1 || o.reverse || o.boomerang || o.static || o.seconds != null;

/* ───────────────────────── filtros FFmpeg ───────────────────────── */

const FX_FILTERS = {
  bw: 'hue=s=0',
  sepia: 'colorchannelmixer=.393:.769:.189:0:.349:.686:.168:0:.272:.534:.131:0:0:0:0:1',
  invert: 'negate',
  flip: 'hflip',
  blur: 'gblur=sigma=5'
};

// Máscara com borda suavizada (anti-alias) aplicada no canal alfa.
const MASKS = {
  circle: "format=gbrap,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='alpha(X,Y)*clip(W/2-hypot(X+0.5-W/2,Y+0.5-H/2)+0.5,0,1)'",
  round: `format=gbrap,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='alpha(X,Y)*clip(${Math.round(SIZE * 0.16)}-hypot(max(abs(X+0.5-W/2)-(W/2-${Math.round(SIZE * 0.16)}),0),max(abs(Y+0.5-H/2)-(H/2-${Math.round(SIZE * 0.16)}),0))+0.5,0,1)'`
};

export function buildFilter(opts, { animated, fps = 15 } = {}) {
  const f = [];
  // Em "fast" amostra mais rápido na entrada; em "slow" duplica frames depois do setpts.
  if (animated) f.push(`fps=${fps * Math.max(1, opts.speed)}`);
  f.push('format=rgba');
  for (const fx of opts.fx) f.push(FX_FILTERS[fx]);
  f.push('format=rgba');
  if (opts.fit === 'full') f.push(`scale=${SIZE}:${SIZE}:flags=lanczos`);
  else if (opts.fit === 'crop' || opts.fit === 'circle' || opts.fit === 'round') f.push(`scale=${SIZE}:${SIZE}:force_original_aspect_ratio=increase:flags=lanczos`, `crop=${SIZE}:${SIZE}`);
  else f.push(`scale=${SIZE}:${SIZE}:force_original_aspect_ratio=decrease:flags=lanczos`, `pad=${SIZE}:${SIZE}:(ow-iw)/2:(oh-ih)/2:color=0x00000000`);
  f.push('setsar=1');
  if (MASKS[opts.fit]) f.push(MASKS[opts.fit]);
  if (animated) {
    if (opts.speed !== 1) f.push(`setpts=PTS/${opts.speed}`, `fps=${fps}`);
    if (opts.reverse) f.push('reverse');
    if (opts.boomerang) f.push('split[bm_a][bm_b];[bm_b]reverse[bm_r];[bm_a][bm_r]concat=n=2:v=1:a=0');
  }
  f.push('format=rgba');
  return f.join(',');
}

function ladder(animated, quality) {
  const L = animated
    ? [{ fps: 15, q: 65 }, { fps: 15, q: 50 }, { fps: 12, q: 40 }, { fps: 10, q: 32 }, { fps: 8, q: 25, cut: 0.75 }, { fps: 8, q: 18, cut: 0.6 }, { fps: 6, q: 12, cut: 0.5 }]
    : [{ q: 85 }, { q: 70 }, { q: 55 }, { q: 42 }, { q: 30 }, { q: 20 }, { q: 10 }];
  if (quality === 'hq') return animated ? [{ fps: 20, q: 78 }, ...L] : [{ q: 95 }, ...L];
  if (quality === 'lq') return L.slice(2);
  return L;
}

/**
 * Variantes do filtro de vídeo, da mais completa para a mais simples.
 * FFmpegs enxutos (alguns builds de Termux) não têm `geq`/`gblur`/etc.: em vez de
 * falhar, o bot reencoded com uma versão mais simples e avisa no log.
 */
export function filterVariants(opts, ctx) {
  const out = [buildFilter(opts, ctx)];
  if (MASKS[opts.fit]) out.push(buildFilter({ ...opts, fit: 'crop' }, ctx));  // sem máscara (geq)
  if (opts.fx.length) out.push(buildFilter({ ...opts, fx: [] }, ctx));        // sem efeitos
  out.push(buildFilter({ ...defaultOptions(), fit: 'crop' }, ctx));           // último recurso
  return [...new Set(out)];
}

/** Codifica `input` em WebP respeitando o limite de tamanho (adaptativo). */
async function encode(input, dir, { animated, opts, seconds }) {
  const maxBytes = (animated ? CONFIG.STICKER_MAX_ANIMATED_KB : CONFIG.STICKER_MAX_STATIC_KB) * 1024;
  const hardMax = 1024 * 1024;
  const steps = ladder(animated, opts.quality);
  let best = null;
  let attempts = 0;
  let lastErr = null;
  for (let i = 0; i < steps.length;) {
    const s = steps[i];
    attempts++;
    const out = path.join(dir, `try-${attempts}.webp`);
    // Duração na ENTRADA (antes de speed/boomerang mudarem o tempo final).
    let inSeconds = (seconds * (s.cut || 1)) * (opts.speed || 1);
    if (opts.boomerang) inSeconds /= 2;
    const head = [];
    if (animated) head.push('-t', inSeconds.toFixed(2));
    head.push('-i', input);
    const tail = ['-an', '-sn', '-c:v', 'libwebp', '-lossless', '0', '-q:v', String(s.q), '-compression_level', animated ? '4' : '6', '-preset', 'default'];
    if (animated) tail.push('-loop', '0', '-t', String(Math.ceil(seconds * 1.05 + 0.5)));
    else tail.push('-frames:v', '1');
    tail.push('-y', out);
    const variants = filterVariants(opts, { animated, fps: s.fps });
    let encoded = false;
    for (const vf of variants) {
      try {
        await runFfmpeg([...head, '-vf', vf, ...tail], { timeoutMs: animated ? 150_000 : 60_000 });
        if (vf !== variants[0]) logger.warn({ vf }, 'filtro completo recusado pelo FFmpeg; usando versão simplificada');
        encoded = true;
        break;
      } catch (e) { lastErr = e; }
    }
    if (!encoded) throw lastErr || new Error('não consegui codificar a figurinha');
    const buf = await readFile(out);
    if (!best || buf.length < best.buf.length) best = { buf, step: s };
    if (buf.length <= maxBytes) return { webp: buf, attempts, oversize: false };
    i += buf.length > maxBytes * 2.5 ? 2 : 1;
  }
  if (best && best.buf.length <= hardMax) return { webp: best.buf, attempts, oversize: true };
  throw new Error(`não consegui reduzir a figurinha para menos de ${formatBytes(hardMax)}. Tente com \`.s leve\` ou uma duração menor (ex.: \`.s 4\`).`);
}

/* ───────────────────────── núcleo ───────────────────────── */

const isImageDoc = (n) => /^image\//i.test(n?.mimetype || '') || /\.(jpe?g|png|webp|gif|bmp)$/i.test(n?.fileName || '');
const isVideoDoc = (n) => /^video\//i.test(n?.mimetype || '') || /\.(mp4|mov|webm|mkv|3gp|avi|gif)$/i.test(n?.fileName || '');

/** Classifica a mídia: { kind:'image'|'video'|'sticker', animatedHint } ou null. */
export function classifySource(media) {
  if (!media?.type) return null;
  const n = media.node || {};
  if (media.type === 'imageMessage') return { kind: /gif/i.test(n.mimetype || '') ? 'video' : 'image' };
  if (media.type === 'videoMessage') return { kind: 'video' };
  if (media.type === 'stickerMessage') return { kind: 'sticker', animatedHint: !!n.isAnimated };
  if (media.type === 'documentMessage') {
    if (isVideoDoc(n) && !/image\/(?!gif)/i.test(n.mimetype || '')) return { kind: /webp/i.test(n.mimetype || '') ? 'sticker' : 'video' };
    if (/webp/i.test(n.mimetype || '') || /\.webp$/i.test(n.fileName || '')) return { kind: 'sticker' };
    if (isImageDoc(n)) return { kind: /gif/i.test(n.mimetype || n.fileName || '') ? 'video' : 'image' };
  }
  return null;
}

/** Onde está a mídia: na própria mensagem (legenda) ou na citada. */
export function findSource(msg) {
  const own = getMediaNode(msg?.message);
  if (own?.type && classifySource(own)) return { holder: msg, media: own, cls: classifySource(own), quoted: false };
  const q = getQuoted(msg);
  const qm = q && getMediaNode(q.message);
  if (qm?.type && classifySource(qm)) return { holder: q, media: qm, cls: classifySource(qm), quoted: true };
  return null;
}

function toLen(v) { try { return typeof v === 'object' && v?.toNumber ? v.toNumber() : Number(v) || 0; } catch { return 0; } }

/**
 * Converte um buffer de mídia em figurinha WebP pronta (com EXIF).
 * @param {Buffer} buffer
 * @param {{kind:'image'|'video'|'sticker', mime?:string}} src
 * @param {{opts:object, pack:string, author:string, emojis:string[]}} cfg
 */
export async function buildSticker(buffer, src, cfg) {
  const opts = cfg.opts || defaultOptions();
  const meta = { pack: cfg.pack, author: cfg.author, emojis: cfg.emojis?.length ? cfg.emojis : ['🔥'] };
  meta.id = packId(meta.pack, meta.author);

  // Figurinha → figurinha sem mudança visual: só troca os metadados (instantâneo e sem perdas).
  if (src.kind === 'sticker' && !hasVisualChange(opts)) {
    const webp = tagSticker(buffer, meta);
    return { webp, animated: isAnimatedWebp(buffer), bytes: webp.length, attempts: 0, oversize: false, retagged: true };
  }

  const caps = await ffmpegCapabilities();
  if (!caps.installed) throw new Error('FFmpeg não instalado. No Termux: `pkg install ffmpeg`.');
  if (!caps.webp) throw new Error('seu FFmpeg não tem suporte a WebP (libwebp). Atualize: `pkg upgrade ffmpeg`.');

  return withTempDir(async (dir) => {
    let input = path.join(dir, `in.${extFromMime(src.mime, src.kind === 'image' ? 'jpg' : 'mp4')}`);
    let animated = src.kind === 'video';
    const seconds = opts.seconds || CONFIG.STICKER_MAX_SECONDS;

    if (src.kind === 'sticker') {
      animated = isAnimatedWebp(buffer);
      if (animated) {
        // FFmpeg não lê WebP animado → converte para um vídeo intermediário sem perdas.
        input = path.join(dir, 'in.mkv');
        await decodeAnimatedWebp(buffer, { outFile: input, outArgs: ['-c:v', 'png'], maxSeconds: CONFIG.STICKER_MAX_SECONDS_LIMIT });
      } else {
        input = path.join(dir, 'in.webp');
        await writeFile(input, buffer);
      }
    } else {
      await writeFile(input, buffer);
    }
    if (src.kind === 'image' && /gif/i.test(src.mime || '')) animated = true;
    if (opts.static) animated = false;
    if (animated && src.kind !== 'sticker') {
      const probe = await probeMedia(input);
      if (!probe.hasVideo) throw new Error('não encontrei vídeo nesse arquivo');
    }
    const enc = await encode(input, dir, { animated, opts, seconds });
    const webp = tagSticker(enc.webp, meta);
    return { webp, animated, bytes: webp.length, attempts: enc.attempts, oversize: enc.oversize, retagged: false };
  }, 'sticker');
}

async function react(sock, msg, emoji) {
  if (!CONFIG.STICKER_REACT || !msg?.key?.id) return;
  try { await sock.sendMessage(msg.key.remoteJid, { react: { text: emoji, key: msg.key } }); } catch { /* reação é opcional */ }
}

async function download(sock, holder) {
  return downloadMediaMessage(holder, 'buffer', {}, { logger, reuploadRequest: sock.updateMediaMessage });
}

function checkSize(media) {
  const len = toLen(media?.node?.fileLength);
  const limit = Math.min(CONFIG.MAX_MEDIA_MB, 60) * 1024 * 1024;
  if (len > limit) throw new Error(`arquivo grande demais (${formatBytes(len)}). Limite: ${formatBytes(limit)}.`);
}

/**
 * Comando .s / .sticker. Retorna um resumo em texto.
 * @param {string} argText argumentos depois do comando
 */
export async function createSticker(sock, msg, argText, { silent = false, lenient = false } = {}) {
  // Sem argumentos explícitos: usa o texto da própria mensagem (sem o comando).
  if (argText === undefined) argText = extractText(msg.message).replace(/^\S+\s*/, '');
  if (!stickerEnabled()) throw new Error('criação de figurinhas está bloqueada. Use `.sticker on`.');
  const parsed = parseStickerArgs(argText);
  if (parsed.unknown.length) {
    if (!lenient) throw new Error(`opção desconhecida: ${parsed.unknown.map((u) => `\`${u}\``).join(', ')}. Veja \`.sticker\` para a lista.`);
    Object.assign(parsed, parseStickerArgs(''));
  }
  const source = findSource(msg);
  if (!source) throw new Error('responda uma imagem, vídeo, GIF ou figurinha com `.s` (ou envie a mídia com `.s` na legenda).');
  checkSize(source.media);
  const jid = msg.key.remoteJid;
  const def = getPack(sock);
  const cfg = { opts: parsed.opts, pack: parsed.pack ?? def.pack, author: parsed.author ?? def.author, emojis: parsed.emojis };

  if (!silent) await react(sock, msg, '⏳');
  try {
    const result = await queue.run('sticker', async () => {
      const buffer = await download(sock, source.holder);
      if (!buffer?.length) throw new Error('não consegui baixar a mídia (ela pode ter expirado).');
      return buildSticker(buffer, { kind: source.cls.kind, mime: source.media.node?.mimetype }, cfg);
    });
    await sock.sendMessage(jid, { sticker: result.webp, isAnimated: result.animated, mimetype: 'image/webp', width: SIZE, height: SIZE });
    if (!silent) await react(sock, msg, '');
    return `${result.animated ? 'figurinha animada' : 'figurinha'} ${formatBytes(result.bytes)}${result.oversize ? ' (acima do ideal)' : ''}`;
  } catch (e) {
    if (!silent) await react(sock, msg, '❌');
    throw e;
  }
}

/** .take — troca o pack/autor de uma figurinha. */
export async function takeSticker(sock, msg, argText = '') {
  if (!stickerEnabled()) throw new Error('criação de figurinhas está bloqueada. Use `.sticker on`.');
  const q = getQuoted(msg);
  const media = q && getMediaNode(q.message);
  if (media?.type !== 'stickerMessage') throw new Error('responda uma *figurinha* com `.take Pack | Autor`.');
  const segs = String(argText).split('|').map((s) => s.trim());
  const def = getPack(sock);
  const buffer = await download(sock, q);
  const old = readStickerExif(buffer);
  const pack = segs[0] || def.pack;
  const author = segs.length > 1 ? segs[1] : def.author;
  const webp = tagSticker(buffer, { pack, author, emojis: old?.emojis?.length ? old.emojis : ['🔥'], id: packId(pack, author) });
  await sock.sendMessage(msg.key.remoteJid, { sticker: webp, isAnimated: isAnimatedWebp(buffer), mimetype: 'image/webp' });
  return `pack: ${pack} • autor: ${author}`;
}

/** .toimg — figurinha → PNG. */
export async function stickerToImage(sock, msg, { asDocument = false } = {}) {
  const q = getQuoted(msg);
  const media = q && getMediaNode(q.message);
  if (media?.type !== 'stickerMessage') throw new Error('responda uma *figurinha* com `.toimg`.');
  const buffer = await download(sock, q);
  const png = await withTempDir(async (dir) => {
    const out = path.join(dir, 'out.png');
    await webpToPng(buffer, out);
    return readFile(out);
  }, 'toimg');
  if (asDocument) await sock.sendMessage(msg.key.remoteJid, { document: png, mimetype: 'image/png', fileName: 'figurinha.png' });
  else await sock.sendMessage(msg.key.remoteJid, { image: png, caption: '🖼️ Figurinha → imagem' });
  return formatBytes(png.length);
}

/** .stickerinfo */
export async function stickerInfo(sock, msg) {
  const q = getQuoted(msg);
  const media = q && getMediaNode(q.message);
  if (media?.type !== 'stickerMessage') throw new Error('responda uma *figurinha* com `.stickerinfo`.');
  const buffer = await download(sock, q);
  const info = parseWebp(buffer);
  const exif = readStickerExif(buffer);
  const dur = info.animated ? info.frames.reduce((a, f) => a + (f.duration || 0), 0) / 1000 : 0;
  return `🎨 *FIGURINHA*
📦 Pack: ${exif?.pack || '—'}
✍️ Autor: ${exif?.author || '—'}
😀 Emojis: ${exif?.emojis?.join(' ') || '—'}
🆔 ${exif?.id || '—'}
📐 ${info.width}×${info.height} • ${info.animated ? `animada (${info.frames.length} frames, ${dur.toFixed(1)}s)` : 'estática'}${info.hasAlpha ? ' • transparente' : ''}
💾 ${formatBytes(buffer.length)}`;
}

/**
 * Modo automático: tudo que EU envio para o meu próprio chat (imagem/vídeo/GIF)
 * vira figurinha. A legenda pode ter opções (ex.: `circle`).
 */
export async function maybeAutoSticker(sock, msg) {
  try {
    if (!msg?.key?.fromMe || !stickerAutoEnabled() || !stickerEnabled()) return false;
    if (!isSelfChat(sock, msg.key.remoteJid)) return false;
    const text = extractText(msg.message);
    if (text.startsWith(CONFIG.PREFIX)) return false;
    const own = getMediaNode(msg.message);
    if (!own?.type || own.viewOnce || !['imageMessage', 'videoMessage'].includes(own.type)) return false;
    await createSticker(sock, msg, text, { lenient: true });
    return true;
  } catch (e) {
    logger.warn({ err: e.message }, 'auto-sticker falhou');
    await sock.sendMessage(msg.key.remoteJid, { text: `❌ Auto-sticker: ${e.message}` }).catch(() => {});
    return false;
  }
}

export async function ensureTmp() { await mkdir(CONFIG.TMP_DIR, { recursive: true }); }
