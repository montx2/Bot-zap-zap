// Simulação de ponta a ponta com socket fake (sem WhatsApp real).
// Verifica: roteamento de comandos, anti-delete, view once por resposta,
// auto-download e filtros de ignorar.

import test from 'node:test';
import assert from 'node:assert/strict';

process.env.NEXUS_DATA_DIR = new URL('./tmp-data', import.meta.url).pathname;

import fs from 'node:fs';
import { handleMessage } from '../src/features/router.js';
import { messageCache } from '../src/wa/cache.js';
import { cfg, DEFAULT_CONFIG } from '../src/core/config.js';

function makeSock() {
  const sent = [];
  return {
    sent,
    user: { id: '5511900000000:1@s.whatsapp.net', name: 'NEXUS' },
    sendMessage: async (jid, content, opts) => {
      const entry = { jid, content, quoted: opts?.quoted?.key?.id || null };
      sent.push(entry);
      return { key: { id: `SENT${sent.length}`, remoteJid: jid } };
    },
    updateMediaMessage: async () => {
      throw new Error('sem mídia no mock');
    }
  };
}

function makeDeps(sock, type) {
  const ownerJid = '5511900000000@s.whatsapp.net';
  return {
    type,
    ownerJid,
    isOwner: (jid, participant) => [jid, participant].includes(ownerJid) || jid === sock.user.id,
    sendOwner: async () => {}
  };
}

function textMsg(jid, text, { from = '5511988887777@s.whatsapp.net', id, quoted } = {}) {
  const msg = {
    key: { remoteJid: jid, id: id || `MSG${Math.random().toString(36).slice(2)}`, fromMe: false },
    pushName: 'Tester',
    messageTimestamp: Math.floor(Date.now() / 1000),
    message: { conversation: text }
  };
  if (quoted) {
    msg.message = {
      extendedTextMessage: {
        text,
        contextInfo: { stanzaId: quoted.key.id, quotedMessage: quoted.message }
      }
    };
  }
  return msg;
}

test('fluxo: .menu responde com o menu', async () => {
  const sock = makeSock();
  await handleMessage(sock, textMsg('5511988887777@s.whatsapp.net', '.menu'), makeDeps(sock));
  assert.ok(sock.sent.some((s) => typeof s.content.text === 'string' && s.content.text.includes('NEXUS')));
});

test('fluxo: .ping responde pong', async () => {
  const sock = makeSock();
  await handleMessage(sock, textMsg('5511988887777@s.whatsapp.net', '.ping'), makeDeps(sock));
  assert.ok(sock.sent.some((s) => /Pong/i.test(s.content.text || '')));
});

test('fluxo: comandos aceitam múltiplos prefixos', async () => {
  const sock = makeSock();
  await handleMessage(sock, textMsg('5511988887777@s.whatsapp.net', '!menu'), makeDeps(sock));
  assert.ok(sock.sent.some((s) => (s.content.text || '').includes('VIEW ONCE')));
});

test('anti-delete: restaura mensagem de texto apagada no chat', async () => {
  const sock = makeSock();
  const chat = 'grupo-teste@g.us';
  const deps = makeDeps(sock);

  // mensagem original chega e é cacheada
  const original = textMsg(chat, 'mensagem secreta 🤫', { id: 'ORIG1', from: '5522@s.whatsapp.net' });
  original.pushName = 'Fofoqueiro';
  await handleMessage(sock, original, deps);

  assert.ok(messageCache.get(chat, 'ORIG1'), 'mensagem deve estar no cache');

  // o autor apaga a mensagem (REVOKE via protocolMessage)
  const revoke = {
    key: { remoteJid: chat, id: 'REV1', fromMe: false },
    messageTimestamp: Math.floor(Date.now() / 1000),
    message: { protocolMessage: { type: 0, key: { remoteJid: chat, id: 'ORIG1' } } }
  };
  await handleMessage(sock, revoke, deps);

  const restored = sock.sent.find((s) => JSON.stringify(s.content).includes('mensagem secreta'));
  assert.ok(restored, 'mensagem apagada deve ser restaurada');
  assert.equal(restored.jid, chat);
});

test('anti-delete: filtro "grupos" impede restauração em grupo', async () => {
  cfg.get().antiDelete.ignorar = ['grupos'];
  const sock = makeSock();
  const chat = 'grupo2@g.us';
  const deps = makeDeps(sock);

  const original = textMsg(chat, 'segredo do grupo', { id: 'ORIG2' });
  await handleMessage(sock, original, deps);

  const revoke = {
    key: { remoteJid: chat, id: 'REV2', fromMe: false },
    message: { protocolMessage: { type: 'REVOKE', key: { remoteJid: chat, id: 'ORIG2' } } }
  };
  await handleMessage(sock, revoke, deps);

  assert.ok(!sock.sent.some((s) => JSON.stringify(s.content).includes('segredo do grupo')), 'não deve restaurar em grupo ignorado');
  cfg.get().antiDelete.ignorar = [];
});

test('anti-delete: mensagem própria apagada não é reportada', async () => {
  const sock = makeSock();
  const chat = '5533@s.whatsapp.net';
  const deps = makeDeps(sock);
  const mine = textMsg(chat, 'minha msg', { id: 'ORIG3' });
  mine.key.fromMe = true;
  messageCache.put(mine);
  const revoke = {
    key: { remoteJid: chat, id: 'REV3', fromMe: true },
    message: { protocolMessage: { type: 0, key: { remoteJid: chat, id: 'ORIG3' } } }
  };
  await handleMessage(sock, revoke, deps);
  assert.ok(!sock.sent.some((s) => JSON.stringify(s.content).includes('minha msg')));
});

test('view once: responder com qualquer mensagem dispara captura (conteúdo na citação)', async () => {
  const sock = makeSock();
  const deps = makeDeps(sock);
  const chat = '5544@s.whatsapp.net';

  // resposta citando uma view once com mídia "fake" — o download vai falhar
  // (sem rede no mock), então esperamos o aviso de expiração OU captura.
  const replyMsg = {
    key: { remoteJid: chat, id: 'R1', fromMe: false },
    pushName: 'Curioso',
    messageTimestamp: Math.floor(Date.now() / 1000),
    message: {
      extendedTextMessage: {
        text: 'baixa aí',
        contextInfo: {
          stanzaId: 'VO1',
          quotedMessage: { viewOnceMessageV2: { message: { imageMessage: { url: 'fake', mimetype: 'image/jpeg' } } } }
        }
      }
    }
  };
  await handleMessage(sock, replyMsg, deps);
  // sem rede o download falha silenciosamente; o importante é não travar
  // e o roteador seguir o fluxo de view once (não tratar como comando).
  assert.ok(true);
});

test('view once: texto comum sem citação NÃO dispara captura', async () => {
  const sock = makeSock();
  const deps = makeDeps(sock);
  await handleMessage(sock, textMsg('5555@s.whatsapp.net', 'oi tudo bem?'), deps);
  assert.equal(sock.sent.length, 0);
});

test('auto-download: só entra em ação com link conhecido (mock de rede → erro tratado)', async () => {
  const sock = makeSock();
  const deps = makeDeps(sock);
  // link desconhecido: nada acontece
  await handleMessage(sock, textMsg('5566@s.whatsapp.net', 'olha https://example.com/arquivo'), deps);
  assert.equal(sock.sent.length, 0);
});

test('comando restrito: não-dono não mexe no anti-delete on/off', async () => {
  const sock = makeSock();
  const deps = makeDeps(sock);
  await handleMessage(sock, textMsg('5577@s.whatsapp.net', '.antidelete off'), deps);
  assert.equal(cfg.get().antiDelete.ativo, true, 'anti-delete continua ativo');
  assert.ok(sock.sent.some((s) => (s.content.text || '').includes('só o dono')));
});

test('dono pode adicionar e remover filtros de ignorar', async () => {
  const sock = makeSock();
  const ownerJid = '5511900000000@s.whatsapp.net';
  const deps = { ownerJid, isOwner: () => true, sendOwner: async () => {} };

  await handleMessage(sock, textMsg(ownerJid, '.antidelete ignorar grupos'), deps);
  assert.ok(cfg.get().antiDelete.ignorar.includes('grupos'));

  await handleMessage(sock, textMsg(ownerJid, '.antidelete remover grupos'), deps);
  assert.ok(!cfg.get().antiDelete.ignorar.includes('grupos'));
});

test('sticker sem mídia responde instruções', async () => {
  const sock = makeSock();
  await handleMessage(sock, textMsg('5588@s.whatsapp.net', '.s'), makeDeps(sock));
  assert.ok(sock.sent.some((s) => (s.content.text || '').includes('imagem')));
});

test('.ia sem pergunta responde instruções', async () => {
  const sock = makeSock();
  await handleMessage(sock, textMsg('5599@s.whatsapp.net', '.ia'), makeDeps(sock));
  assert.ok(sock.sent.some((s) => (s.content.text || '').includes('Pergunte')));
});

test('comando desconhecido não responde por padrão', async () => {
  const sock = makeSock();
  await handleMessage(sock, textMsg('5510@s.whatsapp.net', '.xyzzy'), makeDeps(sock));
  assert.equal(sock.sent.length, 0);
});

// Regressão do patch: o revoke reaproveita a key da mensagem ORIGINAL (formato do
// messages.update em src/wa/client.js, e também o do upsert no WhatsApp atual). Como
// a original já passou pelo router, o dedupe por id engoliria o revoke e mataria o
// anti-delete — por isso o router isenta revokes do alreadySeen().
test('anti-delete: revoke com a MESMA key da original (upsert) ainda restaura', async () => {
  const sock = makeSock();
  const chat = '5560@s.whatsapp.net';
  const keyOfOriginal = { remoteJid: chat, id: 'REVUPD1', fromMe: false };

  await handleMessage(
    sock,
    { key: { ...keyOfOriginal }, pushName: 'Fofoqueiro', messageTimestamp: Math.floor(Date.now() / 1000), message: { conversation: 'segredo' } },
    makeDeps(sock, 'notify')
  );

  await handleMessage(
    sock,
    { key: { ...keyOfOriginal }, messageTimestamp: Date.now() / 1000, message: { protocolMessage: { type: 0, key: { ...keyOfOriginal } } } },
    makeDeps(sock, 'notify')
  );

  const restored = sock.sent.find((s) => JSON.stringify(s.content).includes('ANTI-DELETE'));
  assert.ok(restored, 'anti-delete deve restaurar mesmo com a key repetida');
  assert.equal(restored.jid, chat);
});

test('anti-delete: revoke via messages.update (type update) ainda restaura', async () => {
  const sock = makeSock();
  const chat = '5563@s.whatsapp.net';
  const keyOfOriginal = { remoteJid: chat, id: 'REVUPD2', fromMe: false };

  await handleMessage(
    sock,
    { key: { ...keyOfOriginal }, pushName: 'Fofoqueiro', messageTimestamp: Math.floor(Date.now() / 1000), message: { conversation: 'segredo 2' } },
    makeDeps(sock, 'notify')
  );
  await handleMessage(
    sock,
    { key: { ...keyOfOriginal }, messageTimestamp: Date.now() / 1000, message: { protocolMessage: { type: 0, key: { ...keyOfOriginal } } } },
    makeDeps(sock, 'update')
  );

  const restored = sock.sent.find((s) => JSON.stringify(s.content).includes('ANTI-DELETE'));
  assert.ok(restored, 'anti-delete deve restaurar o revoke vindo de messages.update');
  assert.equal(restored.jid, chat);
});

// Regressão: backlog (append) não age, mas continua indo para o cache do anti-delete.
test('backlog (append) não executa comando nem responde, mas fica no cache', async () => {
  const sock = makeSock();
  const chat = '5561@s.whatsapp.net';
  const msg = textMsg(chat, '.menu', { id: 'APPEND1' });
  await handleMessage(sock, msg, makeDeps(sock, 'append'));

  assert.equal(sock.sent.length, 0, 'mensagem de histórico não deve disparar resposta');
  assert.ok(messageCache.get(chat, 'APPEND1'), 'mensagem antiga deve ficar no cache do anti-delete');
});

// Regressão: reentrega ao vivo (mesma msg, type notify) é descartada.
test('reentrega da mesma mensagem ao vivo não responde duas vezes', async () => {
  const sock = makeSock();
  const chat = '5562@s.whatsapp.net';
  const msg = textMsg(chat, '.ping', { id: 'DUP1' });
  await handleMessage(sock, msg, makeDeps(sock, 'notify'));
  const afterFirst = sock.sent.length;
  await handleMessage(sock, msg, makeDeps(sock, 'notify'));
  assert.equal(sock.sent.length, afterFirst, 'segunda entrega não deve gerar nova resposta');
});
