// ⚡ NEXUS BOT — ponto de entrada.

import { loadDotEnv } from './core/env.js';
loadDotEnv();

import { jidNormalizedUser } from '@whiskeysockets/baileys';
import { ENV } from './core/config.js';
import { log, banner } from './core/logger.js';
import { ensureDirs, flushStore } from './core/store.js';
import { platformBanner, isTermux } from './core/platform.js';
import { startClient, stopClient } from './wa/client.js';
import { handleMessage } from './features/router.js';
import { hasFfmpeg } from './util/ffmpeg.js';
import { bgStatus } from './features/bgremoval.js';

ensureDirs();

banner([
  '⚡ N E X U S   B O T  v7.0 ⚡',
  '',
  platformBanner(),
  isTermux() ? '📱 Modo Termux: pareamento por código (sem QR)' : '🖥️ Modo desktop: QR Code habilitado',
  `🎭 Fundo: ${bgStatus()[0]}`,
  hasFfmpeg() ? '🎬 FFmpeg: ok' : '⚠️ FFmpeg ausente (figurinhas não funcionarão)'
]);

if (!hasFfmpeg()) {
  log.warn('Instale o FFmpeg para figurinhas: pkg install ffmpeg (Termux) · apt install ffmpeg (Linux) · winget install ffmpeg (Windows)');
}

// ── dono da conta ──────────────────────────────────────────
const owner = {
  jid: null,
  numbers: ENV.ownerNumbers.map((n) => n.replace(/\D/g, '')).filter(Boolean),
  setFromSocket(sock) {
    const id = sock?.user?.id || sock?.user?.lid;
    if (!id) return;
    try {
      this.jid = jidNormalizedUser(id);
    } catch {
      this.jid = id;
    }
  },
  isOwner(sock, jid, participant) {
    const me = sock?.user?.id ? safeNormalize(sock.user.id) : null;
    for (const candidate of [jid, participant]) {
      if (!candidate) continue;
      const num = String(candidate).split('@')[0].split(':')[0];
      if (this.numbers.includes(num)) return true;
      if (me && safeNormalize(candidate) === me) return true;
      if (this.jid && safeNormalize(candidate) === this.jid) return true;
    }
    return false;
  }
};

function safeNormalize(jid) {
  try {
    return jidNormalizedUser(jid);
  } catch {
    return jid;
  }
}

// ── boot ───────────────────────────────────────────────────
async function boot() {
  await startClient({
    onOpen(sock) {
      owner.setFromSocket(sock);
      log.ok('NEXUS está no ar. 🚀');
    },
    onMessage: async (sock, msg) => {
      const deps = {
        ownerJid: owner.jid,
        isOwner: (jid, participant) => owner.isOwner(sock, jid, participant),
        sendOwner: async (content) => {
          if (!owner.jid) return;
          return sock
            .sendMessage(owner.jid, typeof content === 'string' ? { text: content } : content)
            .catch(() => {});
        }
      };
      await handleMessage(sock, msg, deps);
    }
  });
}

boot().catch((error) => {
  log.error('falha fatal no boot', error);
  process.exit(1);
});

// ── encerramento limpo ─────────────────────────────────────
let exiting = false;
function shutdown(signal) {
  if (exiting) process.exit(0);
  exiting = true;
  log.warn(`recebido ${signal} — salvando e saindo…`);
  flushStore();
  stopClient();
  setTimeout(() => process.exit(0), 1200).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('uncaughtException', (e) => log.error('uncaughtException', e));
process.on('unhandledRejection', (e) => log.error('unhandledRejection', e));
