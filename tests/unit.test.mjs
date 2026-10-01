// Testes offline das peças de lógica do NEXUS (node:test, zero deps).
import test from 'node:test';
import assert from 'node:assert/strict';

import { KeyPool } from '../src/core/keypool.js';
import { parseQuality, QUALITIES } from '../src/features/downloaders/quality.js';
import { isIgnored, normalizeIgnoreTarget } from '../src/features/antidelete.js';
import { unwrapViewOnce, isViewOnce } from '../src/features/viewonce.js';
import { detectPlatform, isKnownSocialUrl } from '../src/features/download.js';
import { isTikTokUrl } from '../src/features/downloaders/tiktok.js';
import { isPinterestUrl } from '../src/features/downloaders/pinterest.js';
import { isInstagramUrl } from '../src/features/downloaders/instagram.js';
import { extractUrls, isGroup, parseBool } from '../src/util/text.js';
import { isWebp, makeStickerExif, setWebpExif, readChunks } from '../src/util/webp.js';
import { DEFAULT_CONFIG } from '../src/core/config.js';

// ── KeyPool ──────────────────────────────────────────────────
test('KeyPool gira em round-robin', () => {
  const pool = new KeyPool('t', ['a', 'b', 'c']);
  assert.equal(pool.next(), 'a');
  assert.equal(pool.next(), 'b');
  assert.equal(pool.next(), 'c');
  assert.equal(pool.next(), 'a');
});

test('KeyPool pula chave em cooldown', () => {
  const pool = new KeyPool('t', ['a', 'b'], { cooldownMs: 60_000 });
  pool.reportFailure('a', { reason: 'limite' });
  assert.equal(pool.available, 1);
  assert.equal(pool.next(), 'b');
  assert.equal(pool.next(), 'b');
});

test('KeyPool.run gira até ter sucesso', async () => {
  const pool = new KeyPool('t', ['bad', 'good']);
  let calls = 0;
  const result = await pool.run((key) => {
    calls++;
    if (key === 'bad') {
      const e = new Error('rate limit exceeded');
      throw e;
    }
    return `ok-${key}`;
  });
  assert.equal(result, 'ok-good');
  assert.equal(calls, 2);
});

test('KeyPool.run falha quando todos falham', async () => {
  const pool = new KeyPool('t', ['x']);
  await assert.rejects(() => pool.run(() => {
    const e = new Error('quota exceeded');
    throw e;
  }), /falharam/);
});

// ── Qualidade ────────────────────────────────────────────────
test('parseQuality padrão é melhor', () => {
  const { quality, rest } = parseQuality(['https://x.com']);
  assert.equal(quality, 'melhor');
  assert.deepEqual(rest, ['https://x.com']);
});

test('parseQuality entende apelidos', () => {
  assert.equal(parseQuality(['baixa']).quality, 'baixa');
  assert.equal(parseQuality(['sd']).quality, 'baixa');
  assert.equal(parseQuality(['hd']).quality, 'melhor');
  assert.equal(parseQuality(['média']).quality, 'media');
  assert.equal(parseQuality(['720']).quality, 'media');
  assert.equal(parseQuality(['leve']).quality, 'baixa');
});

test('parseQuality preserva os demais argumentos', () => {
  const { quality, rest } = parseQuality(['link', 'alta', 'extra']);
  assert.equal(quality, 'alta');
  assert.deepEqual(rest, ['link', 'extra']);
});

test('todas as qualidades conhecidas existem', () => {
  assert.deepEqual(QUALITIES, ['melhor', 'alta', 'media', 'baixa']);
});

// ── Anti-delete ──────────────────────────────────────────────
test('antiDelete ignora grupos quando filtrado', () => {
  assert.equal(isIgnored('123@g.us', ['grupos']), true);
  assert.equal(isIgnored('5511@s.whatsapp.net', ['grupos']), false);
});

test('antiDelete ignora privado quando filtrado', () => {
  assert.equal(isIgnored('55119@s.whatsapp.net', ['privado']), true);
  assert.equal(isIgnored('123@g.us', ['privado']), false);
});

test('antiDelete ignora jid específico', () => {
  assert.equal(isIgnored('55119@s.whatsapp.net', ['55119@s.whatsapp.net']), true);
  assert.equal(isIgnored('55118@s.whatsapp.net', ['55119@s.whatsapp.net']), false);
});

test('antiDelete lista vazia protege tudo', () => {
  assert.equal(isIgnored('123@g.us', []), false);
  assert.equal(isIgnored('55@s.whatsapp.net', []), false);
});

test('normalizeIgnoreTarget resolve "aqui" e números', () => {
  const msg = { key: { remoteJid: 'grupo@g.us' } };
  assert.equal(normalizeIgnoreTarget('aqui', msg), 'grupo@g.us');
  assert.equal(normalizeIgnoreTarget('GRUPOS', msg), 'grupos');
  assert.equal(normalizeIgnoreTarget('5511999999999', msg), '5511999999999@s.whatsapp.net');
});

test('antiDelete vem ATIVO por padrão sem filtros', () => {
  assert.equal(DEFAULT_CONFIG.antiDelete.ativo, true);
  assert.deepEqual(DEFAULT_CONFIG.antiDelete.ignorar, []);
});

// ── View Once ────────────────────────────────────────────────
test('unwrapViewOnce desembrulha todos os wrappers', () => {
  const cases = [
    { viewOnceMessage: { message: { imageMessage: { url: 'x' } } } },
    { viewOnceMessageV2: { message: { videoMessage: { url: 'x' } } } },
    { viewOnceMessageV2Extension: { message: { audioMessage: { url: 'x' } } } }
  ];
  const expected = ['imageMessage', 'videoMessage', 'audioMessage'];
  cases.forEach((msg, i) => {
    const vo = unwrapViewOnce(msg);
    assert.ok(vo, `caso ${i}`);
    assert.equal(vo.type, expected[i]);
  });
});

test('unwrapViewOnce retorna null para mensagens comuns', () => {
  assert.equal(unwrapViewOnce({ conversation: 'oi' }), null);
  assert.equal(unwrapViewOnce(null), null);
  assert.equal(isViewOnce({ conversation: 'oi' }), false);
});

test('viewOnce default: auto ativo e resposta para todos', () => {
  assert.equal(DEFAULT_CONFIG.viewOnce.auto, true);
  assert.equal(DEFAULT_CONFIG.viewOnce.resposta, 'todos');
});

// ── Roteamento de plataformas ────────────────────────────────
test('detecta TikTok, Pinterest e Instagram', () => {
  assert.ok(isTikTokUrl('https://vm.tiktok.com/ZM123/'));
  assert.ok(isTikTokUrl('https://www.tiktok.com/@user/video/123'));
  assert.ok(isPinterestUrl('https://pin.it/abc123'));
  assert.ok(isPinterestUrl('https://br.pinterest.com/pin/123/'));
  assert.ok(isInstagramUrl('https://www.instagram.com/reel/ABC/'));
});

test('detectPlatform cobre as redes principais', () => {
  assert.equal(detectPlatform('https://youtube.com/watch?v=1'), 'YouTube');
  assert.equal(detectPlatform('https://x.com/user/status/1'), 'X (Twitter)');
  assert.equal(detectPlatform('https://facebook.com/watch/?v=1'), 'Facebook');
  assert.equal(detectPlatform('https://reddit.com/r/x/comments/1'), 'Reddit');
  assert.equal(detectPlatform('https://example.com/x'), null);
  assert.ok(isKnownSocialUrl('https://br.pinterest.com/pin/1/'));
});

test('extractUrls limpa pontuação final', () => {
  const urls = extractUrls('olha https://pin.it/abc123. isso');
  assert.deepEqual(urls, ['https://pin.it/abc123']);
});

// ── Util ─────────────────────────────────────────────────────
test('isGroup e parseBool', () => {
  assert.equal(isGroup('x@g.us'), true);
  assert.equal(isGroup('x@s.whatsapp.net'), false);
  assert.equal(parseBool('on'), true);
  assert.equal(parseBool('desativado'), false);
  assert.equal(parseBool('talvez'), null);
});

// ── WebP EXIF ────────────────────────────────────────────────
test('injeta EXIF em webp sintético', () => {
  // RIFF/WEBP mínimo com chunk VP8L 1x1
  const vp8lData = Buffer.from([0x2f, 0x00, 0x00, 0x00, 0x00]);
  const chunkHead = Buffer.alloc(8);
  chunkHead.write('VP8L', 0, 'ascii');
  chunkHead.writeUInt32LE(vp8lData.length, 4);
  const body = Buffer.concat([Buffer.from('WEBP'), chunkHead, vp8lData, Buffer.alloc(1)]);
  const head = Buffer.alloc(8);
  head.write('RIFF', 0, 'ascii');
  head.writeUInt32LE(body.length, 4);
  const webp = Buffer.concat([head, body]);

  assert.ok(isWebp(webp));
  const exif = makeStickerExif({ pack: 'NEXUS ⚡', author: 'teste' });
  const tagged = setWebpExif(webp, exif);
  const chunks = readChunks(tagged);
  assert.ok(chunks.some((c) => c.type === 'EXIF'));
  assert.ok(isWebp(tagged));
});

// Regressão: EXIF válido e VP8 puro sem VP8X.
test('EXIF de figurinha tem cabeçalho de 22 bytes com offset 0x16', () => {
  const ex = makeStickerExif({ pack: 'P', author: 'A' });
  assert.equal(ex.readUInt32LE(18), 0x16);
  assert.equal(ex.readUInt32LE(14), ex.length - 22);
  assert.equal(JSON.parse(ex.subarray(22).toString())['sticker-pack-name'], 'P');
});
test('setWebpExif cria VP8X quando o webp é VP8 puro', () => {
  const vp8data = Buffer.alloc(20);
  vp8data.set([0x9d, 0x01, 0x2a], 3);
  vp8data.writeUInt16LE(512, 6);
  vp8data.writeUInt16LE(300, 8);
  const riffChunk = Buffer.concat([Buffer.from('VP8 '), Buffer.from([20, 0, 0, 0]), vp8data]);
  const body = Buffer.concat([Buffer.from('WEBP'), riffChunk]);
  const head = Buffer.alloc(8);
  head.write('RIFF');
  head.writeUInt32LE(body.length, 4);
  const out = setWebpExif(Buffer.concat([head, body]), makeStickerExif({ pack: 'x' }));
  const chunks = readChunks(out);
  assert.equal(chunks[0].type, 'VP8X');
  assert.ok(chunks[0].data[0] & 0x08);
  assert.equal(chunks[0].data.readUIntLE(4, 3) + 1, 512);
  assert.equal(chunks[0].data.readUIntLE(7, 3) + 1, 300);
  assert.ok(chunks.some((c) => c.type === 'EXIF'));
  assert.ok(isWebp(out));
});
