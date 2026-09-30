import makeWASocket, {
  fetchLatestBaileysVersion,
  fetchLatestWaWebVersion,
  Browsers,
  DisconnectReason,
  useMultiFileAuthState
} from '@whiskeysockets/baileys';

import fs from 'node:fs/promises';
import path from 'node:path';

import { CONFIG } from './config.js';
import { logger, consoleLog, createBaileysLogger } from './logger.js';
import { getStoredMessage, saveEvent } from './db.js';
import { handleCommand } from './commands.js';
import { maybeAutoSticker } from '../modules/stickers.js';
import { archiveIncoming } from '../modules/archive.js';
import { detectSpecial } from '../modules/special.js';
import { detectLinks } from '../modules/links.js';
import { captureViewOnce, scheduleViewOnceRetry } from '../modules/viewonce.js';
import { archiveMedia } from '../modules/mediaVault.js';
import { handleDelete, handleEdit, handleMessageUpdate } from '../modules/anti.js';
import {
  onReaction,
  onPresence,
  onReceipt,
  onCall,
  onDevice,
  maybeSmartAlert
} from '../modules/monitors.js';
import { onForward } from '../modules/forward.js';
import { handleGroupEvent } from '../modules/groups.js';
import { handleStatus } from '../modules/status.js';
import { ownerJid } from './identity.js';
import { tsMs } from './format.js';
import { isFeatureOn } from './features.js';
import { SerialQueues } from './queue.js';

let socket = null;
let connectPromise = null;
let stopping = false;
let pairTimer = null;
let reconnectTimer = null;
let healthTimer = null;

const state = {
  reconnects: 0,
  lastOpen: 0,
  lastUpsert: 0,
  lastEvent: Date.now(),
  lastProbe: 0,
  upserts: 0,
  started: Date.now(),
  waVersion: null,
  waVersionSource: null
};

const incomingQueues = new SerialQueues();
const COMMAND_MAX_AGE_MS = 2 * 60_000;

const VERSION_CACHE_FILE = path.join(CONFIG.DATA_DIR, 'wa-web-version.json');
const FALLBACK_TIMEOUT_MS = 15_000;

function isValidWaVersion(value) {
  return (
    Array.isArray(value) &&
    value.length === 3 &&
    value.every((part) => Number.isInteger(part) && part > 0)
  );
}

function parseVersionOverride(value) {
  if (!value) return null;

  const parsed = String(value)
    .split(/[,.]/)
    .map((part) => Number(part.trim()));

  return isValidWaVersion(parsed) ? parsed : null;
}

async function loadCachedWaVersion() {
  try {
    const raw = await fs.readFile(VERSION_CACHE_FILE, 'utf8');
    const parsed = JSON.parse(raw);

    if (isValidWaVersion(parsed?.version)) {
      return parsed.version;
    }
  } catch {
    // Cache is optional.
  }

  return null;
}

async function saveCachedWaVersion(version) {
  if (!isValidWaVersion(version)) return;

  try {
    await fs.mkdir(CONFIG.DATA_DIR, { recursive: true });
    await fs.writeFile(
      VERSION_CACHE_FILE,
      `${JSON.stringify({
        version,
        savedAt: new Date().toISOString()
      })}\n`,
      { mode: 0o600 }
    );
  } catch (error) {
    logger.debug({ err: error?.message }, 'não foi possível salvar cache da versão WA Web');
  }
}

/**
 * WhatsApp Web muda o client revision rapidamente.
 * A fonte ao vivo é preferida; cache é mantido para reconexões
 * quando a consulta externa momentaneamente falha.
 */
async function resolveWaVersion() {
  const override = parseVersionOverride(CONFIG.WA_VERSION_OVERRIDE);

  if (override) {
    return {
      version: override,
      source: 'env'
    };
  }

  try {
    const live = await fetchLatestWaWebVersion({
      timeout: FALLBACK_TIMEOUT_MS
    });

    if (live?.isLatest && isValidWaVersion(live.version)) {
      await saveCachedWaVersion(live.version);

      return {
        version: live.version,
        source: 'whatsapp-web'
      };
    }

    logger.warn(
      {
        err: live?.error?.message || live?.error
      },
      'WhatsApp Web ao vivo não retornou uma versão válida'
    );
  } catch (error) {
    logger.warn({ err: error?.message }, 'falha ao consultar versão ao vivo do WhatsApp Web');
  }

  const cached = await loadCachedWaVersion();

  if (cached) {
    logger.warn(
      { version: cached.join('.') },
      'usando última versão válida armazenada do WhatsApp Web'
    );

    return {
      version: cached,
      source: 'cache'
    };
  }

  try {
    const repo = await fetchLatestBaileysVersion({
      timeout: FALLBACK_TIMEOUT_MS
    });

    if (repo?.isLatest && isValidWaVersion(repo.version)) {
      logger.warn(
        { version: repo.version.join('.') },
        'usando versão publicada pelo repositório do Baileys como último fallback'
      );

      return {
        version: repo.version,
        source: 'baileys-repo'
      };
    }
  } catch (error) {
    logger.warn({ err: error?.message }, 'falha ao consultar versão do Baileys');
  }

  throw new Error(
    'Não foi possível obter uma versão válida do WhatsApp Web. ' +
      'Conecte o Termux à internet ou defina WA_VERSION_OVERRIDE=2,3000,REVISAO.'
  );
}

async function safeSend(sock, jid, content) {
  if (!sock?.user) {
    throw new Error('WhatsApp ainda não conectado');
  }

  if (typeof sock.waitForSocketOpen === 'function') {
    await sock.waitForSocketOpen();
  }

  return sock.sendMessage(jid, content);
}

async function maybePair(sock, auth) {
  if (auth.creds.registered) return;

  const file = path.join(CONFIG.DATA_DIR, 'pairing-number.txt');
  let number = '';

  try {
    number = (await fs.readFile(file, 'utf8')).trim();
  } catch {
    return;
  }

  if (!number) return;

  if (pairTimer) {
    clearTimeout(pairTimer);
  }

  pairTimer = setTimeout(async () => {
    try {
      if (sock.user || auth.creds.registered) return;

      consoleLog('\n🔐 Solicitando código de pareamento...\n');

      const code = await sock.requestPairingCode(number);

      consoleLog(
        `\n📱 CÓDIGO DE PAREAMENTO\n\n   ${code}\n\n` +
          'WhatsApp → Dispositivos conectados → Conectar com número de telefone\n'
      );

      saveEvent({
        kind: 'pairing.code_issued',
        data: {}
      });
    } catch (error) {
      logger.warn(
        {
          err: error?.message,
          stack: error?.stack
        },
        'pairing code failed'
      );
    }
  }, 5_000);
}

function scheduleReconnect(delay, reason) {
  if (stopping || reconnectTimer) return;

  reconnectTimer = setTimeout(async () => {
    reconnectTimer = null;

    try {
      await connect();
    } catch (error) {
      logger.error(
        {
          reason,
          err: error?.message
        },
        'reconnect failed'
      );
    }
  }, delay);
}

function clearRecoveryTimers() {
  if (healthTimer) { clearInterval(healthTimer); healthTimer = null; }
}

function markEvent() {
  state.lastEvent = Date.now();
}

async function withTimeout(promise, timeoutMs, message) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs);
        timer.unref?.();
      })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function forceSocketRecovery(reason) {
  if (stopping) return;
  const current = socket;
  if (!current) {
    scheduleReconnect(1_500, reason);
    return;
  }

  logger.warn({ reason }, 'solicitando recuperação do socket WhatsApp');
  try { current.end?.(new Error(`recovery:${reason}`)); } catch {}

  setTimeout(() => {
    if (stopping || socket !== current) return;
    socket = null;
    scheduleReconnect(1_500, reason);
  }, 5_000).unref?.();
}

function startHealthProbe(sock) {
  if (healthTimer) clearInterval(healthTimer);
  if (CONFIG.HEALTH_PROBE_INTERVAL_MS <= 0) return;

  healthTimer = setInterval(async () => {
    if (stopping || socket !== sock || !sock?.user) return;

    const current = socket;
    state.lastProbe = Date.now();

    try {
      await withTimeout(
        Promise.resolve(sock.sendPresenceUpdate?.('unavailable')),
        CONFIG.HEALTH_PROBE_TIMEOUT_MS,
        'health probe timed out'
      );
      markEvent();
    } catch (error) {
      logger.warn({ err: error?.message }, 'health probe falhou');
      if (socket === current) forceSocketRecovery('health-probe-failed');
    }
  }, CONFIG.HEALTH_PROBE_INTERVAL_MS);
  healthTimer.unref?.();
}

export async function connect() {
  if (connectPromise) return connectPromise;

  stopping = false;

  connectPromise = (async () => {
    await fs.mkdir(CONFIG.AUTH_DIR, { recursive: true });
    await fs.chmod(CONFIG.AUTH_DIR, 0o700).catch(() => {});

    const { state: auth, saveCreds } = await useMultiFileAuthState(CONFIG.AUTH_DIR);

    const version = [2, 3000, 1043857760];
    const source = 'baileys-6.7.24-bundled';

    state.waVersion = version;
    state.waVersionSource = source;

    consoleLog(
      `🌐 WhatsApp Web ${version.join('.')} ` +
        `(fonte: ${source})`
    );

    state.lastEvent = Date.now();
    state.lastOpen = 0;

    socket = makeWASocket({
      version,
      auth: {
        creds: auth.creds,
        keys: auth.keys
      },
      logger: createBaileysLogger(),
      browser: Browsers.macOS('Chrome'),
      printQRInTerminal: false,
      markOnlineOnConnect: CONFIG.MARK_ONLINE,
      emitOwnEvents: true,
      fireInitQueries: false,
      connectTimeoutMs: CONFIG.CONNECT_TIMEOUT_MS,
      defaultQueryTimeoutMs: CONFIG.DEFAULT_QUERY_TIMEOUT_MS,
      keepAliveIntervalMs: CONFIG.KEEP_ALIVE_INTERVAL_MS,
      retryRequestDelayMs: CONFIG.RETRY_REQUEST_DELAY_MS,
      syncFullHistory: false,
      getMessage: async (key) => getStoredMessage(key),
      shouldSyncHistoryMessage: () => false,
      generateHighQualityLinkPreview: false
    });

    socket.ev.on('creds.update', saveCreds);

    socket.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect } = update;
      markEvent();

      if (connection === 'open') {
        state.lastOpen = Date.now();
        state.reconnects = 0;
              startHealthProbe(socket);

        consoleLog('✅ WhatsApp conectado — BOT-ZAP SUPREMO ONLINE');

        try {
          await sockStatus('connected');
        } catch {
          // Presence/status is non-critical.
        }

        saveEvent({
          kind: 'connection.open',
          data: {
            version: state.waVersion,
            versionSource: state.waVersionSource
          }
        });
      }

      if (connection === 'close') {
        const code = lastDisconnect?.error?.output?.statusCode;
        const fatal =
          code === DisconnectReason.loggedOut ||
          code === DisconnectReason.badSession;

        logger.warn(
          {
            code,
            fatal,
            waVersion: state.waVersion,
            waVersionSource: state.waVersionSource
          },
          'conexão fechada'
        );

        saveEvent({
          kind: 'connection.close',
          data: {
            code,
            fatal,
            waVersion: state.waVersion,
            waVersionSource: state.waVersionSource
          }
        });

        clearRecoveryTimers();
        socket = null;

        if (fatal) {
          consoleLog(
            '\n❌ Sessão do WhatsApp encerrada (code ' + code + ').\n' +
              '   Pare o bot, apague a pasta data/auth e pareie de novo:\n' +
              '   ./bot.sh stop && rm -rf data/auth && ./bot.sh pair 55DDDNUMERO && ./bot.sh start\n'
          );
          // Encerra limpo (SIGTERM → exit 0): o supervisor não reinicia em loop uma sessão que precisa de novo pareamento.
          setTimeout(() => process.kill(process.pid, 'SIGTERM'), 500).unref?.();
        }

        if (!stopping && !fatal) {
          state.reconnects += 1;

          const delay = code === 405 || code === DisconnectReason.restartRequired
            ? 1_500
            : Math.min(
                60_000,
                Math.max(2_500, Math.pow(2, Math.min(state.reconnects, 5)) * 1_000)
              );

          scheduleReconnect(delay, `disconnect:${code ?? 'unknown'}`);
        }
      }

      if (update.qr) {
        logger.info(
          'QR recebido. Neste modo o pareamento preferencial é pelo código em data/pairing-number.txt.'
        );
      }
    });

    socket.ev.on('messages.upsert', async (event) => {
      markEvent();
      if (event?.requestId) {
        logger.warn('upsert com requestId ignorado por segurança');
        return;
      }

      for (const msg of event?.messages || []) {
        if (msg?.requestId || msg?.key?.requestId) {
          logger.warn('mensagem com requestId ignorada');
          continue;
        }

        const jid = msg?.key?.remoteJid || '__unknown__';

        incomingQueues
          .run(jid, () => handleIncoming(msg))
          .catch((error) => {
            logger.warn(
              { err: error?.message },
              'incoming failed'
            );
          });
      }
    });

    socket.ev.on('messages.update', async (updates) => {
      markEvent();
      for (const item of updates || []) {
        try {
          await handleMessageUpdate(
            socket,
            item.key,
            item.update,
            CONFIG
          );
        } catch (error) {
          logger.debug(
            { err: error?.message },
            'message update failed'
          );
        }
      }
    });

    socket.ev.on('messages.reaction', async (updates) => {
      markEvent();
      for (const item of [].concat(updates || [])) {
        try {
          await onReaction(socket, item);
        } catch {
          // Monitor is non-critical.
        }
      }
    });

    socket.ev.on('presence.update', (event) => {
      markEvent();
      onPresence(socket, event).catch(() => {});
    });

    socket.ev.on('message-receipt.update', (event) => {
      markEvent();
      onReceipt(socket, event).catch(() => {});
    });

    socket.ev.on('call', (event) => {
      markEvent();
      onCall(socket, event).catch(() => {});
    });

    socket.ev.on('group-participants.update', (event) => {
      markEvent();
      handleGroupEvent(socket, event).catch(() => {});
    });

    await maybePair(socket, auth);

    return socket;
  })().finally(() => {
    connectPromise = null;
  });

  return connectPromise;
}

async function handleIncoming(msg) {
  state.upserts += 1;
  state.lastUpsert = Date.now();

  if (!msg?.key?.remoteJid || !msg?.key?.id) return;

  const normalized = archiveIncoming(msg);

  detectSpecial(msg);
  detectLinks(msg);

  if (msg.key.remoteJid === 'status@broadcast') {
    if (isFeatureOn('status')) {
      await handleStatus(socket, msg);
    }

    return;
  }

  if (isFeatureOn('viewonce') && !msg.key.fromMe) {
    const recovered = await captureViewOnce(socket, msg).catch(() => false);

    if (recovered === false) {
      scheduleViewOnceRetry(socket, msg);
    }
  }

  if (isFeatureOn('media') && !msg.key.fromMe) {
    await archiveMedia(socket, msg, { kind: 'media' }).catch(() => {});
  }

  if (isFeatureOn('forward')) {
    await onForward(socket, msg).catch(() => {});
  }

  if (isFeatureOn('device')) {
    await onDevice(socket, msg).catch(() => {});
  }

  if (isFeatureOn('smart')) {
    maybeSmartAlert(socket, msg);
  }

  if (msg.message?.reactionMessage) {
    await onReaction(socket, msg);
  }

  // Comandos antigos (mensagens entregues em lote depois de uma queda/reconexão) não são reexecutados.
  const fresh = Date.now() - tsMs(msg.messageTimestamp) < COMMAND_MAX_AGE_MS;

  if (fresh) {
    const handled = await handleCommand(socket, msg);

    if (!handled) {
      await maybeAutoSticker(socket, msg).catch(() => {});
    }
  }

  saveEvent({
    kind: 'message.processed',
    remoteJid: msg.key.remoteJid,
    refId: msg.key.id,
    data: {
      type: normalized.type
    }
  });
}

async function sockStatus(kind) {
  saveEvent({
    kind: `runtime.${kind}`
  });

  try {
    if (CONFIG.MARK_ONLINE && socket) {
      await socket.sendPresenceUpdate('available');
    }
  } catch {
    // Presence is optional.
  }
}

export function getSocket() {
  return socket;
}

export function getState() {
  return {
    ...state,
    connected: !!socket?.user
  };
}

export async function stop() {
  stopping = true;

  if (pairTimer) {
    clearTimeout(pairTimer);
    pairTimer = null;
  }

  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  clearRecoveryTimers();

  try {
    socket?.end?.(new Error('shutdown'));
  } catch {
    // Ignore shutdown errors.
  }

  socket = null;
}

export { safeSend, ownerJid };
