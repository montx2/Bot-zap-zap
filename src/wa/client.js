// 📡 CONEXÃO WhatsApp (Baileys) — resiliente e multiplataforma.
//
//   • Termux  → SEMPRE código de pareamento (nunca QR Code)
//   • Linux / Windows / macOS → QR Code no terminal (ou código, se preferir)
//
// Guarda a versão atual do WhatsApp Web em cache para evitar o loop do 405
// quando a versão embutida do Baileys fica velha.

import makeWASocket, {
  fetchLatestWaWebVersion,
  fetchLatestBaileysVersion,
  useMultiFileAuthState,
  makeCacheableSignalKeyStore,
  DisconnectReason,
  Browsers
} from '@whiskeysockets/baileys';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

import { ENV } from '../core/config.js';
import { log, banner, baileysLogger } from '../core/logger.js';
import { DATA_DIR, ensureDirs, readJson, writeJsonNow } from '../core/store.js';
import { isTermux, platformBanner } from '../core/platform.js';

const AUTH_DIR = path.join(DATA_DIR, 'auth');
const PAIR_FILE = path.join(DATA_DIR, 'pairing-number.txt');
const VERSION_CACHE = path.join(DATA_DIR, 'wa-web-version.json');

let socket = null;
let stopping = false;
let reconnectTimer = null;

export function getSocket() {
  return socket;
}

function isValidVersion(v) {
  return Array.isArray(v) && v.length === 3 && v.every((n) => Number.isInteger(n) && n > 0);
}

function parseOverride(raw) {
  if (!raw) return null;
  const parts = String(raw)
    .split(/[,.]/)
    .map((n) => Number(n.trim()));
  return isValidVersion(parts) ? parts : null;
}

/** Resolve a versão do WA Web: override → ao vivo → cache → repositório Baileys. */
async function resolveWaVersion() {
  const override = parseOverride(ENV.waVersionOverride);
  if (override) return { version: override, source: 'override' };

  try {
    const live = await fetchLatestWaWebVersion({ timeout: 15_000 });
    if (live?.isLatest && isValidVersion(live.version)) {
      writeJsonNow('wa-web-version.json', { version: live.version, at: new Date().toISOString() });
      return { version: live.version, source: 'whatsapp-web' };
    }
  } catch (error) {
    log.warn(`versão WA ao vivo falhou: ${error.message}`);
  }

  const cached = readJson('wa-web-version.json', null);
  if (isValidVersion(cached?.version)) {
    return { version: cached.version, source: 'cache' };
  }

  try {
    const repo = await fetchLatestBaileysVersion({ timeout: 15_000 });
    if (repo?.isLatest && isValidVersion(repo.version)) {
      return { version: repo.version, source: 'baileys-repo' };
    }
  } catch {}

  return { version: undefined, source: 'padrão do Baileys' };
}

/** Número de pareamento: env → arquivo salvo → pergunta no terminal. */
async function getPairingNumber(creds) {
  if (creds.registered) return null;
  if (ENV.pairingNumber) return ENV.pairingNumber;
  try {
    const saved = fs.readFileSync(PAIR_FILE, 'utf8').trim();
    if (saved) return saved;
  } catch {}

  if (isTermux()) {
    // No Termux não existe QR: precisamos do número.
    const number = await askInTerminal(
      '📱 Digite seu número (DDI+DDD+número, só dígitos. Ex.: 5511999999999): '
    );
    const digits = String(number).replace(/\D/g, '');
    if (/^\d{10,15}$/.test(digits)) {
      savePairingNumber(digits);
      return digits;
    }
    throw new Error('Número inválido para pareamento. Use DDI+DDD+número. Ex.: ./pair 5511999999999');
  }
  return null; // desktop pode usar QR
}

function askInTerminal(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

export function savePairingNumber(digits) {
  ensureDirs();
  fs.writeFileSync(PAIR_FILE, digits + '\n', { mode: 0o600 });
}

function printQR(qr) {
  // import dinâmico para não pesar o boot
  import('qrcode-terminal')
    .then((mod) => {
      const qrcode = mod.default || mod;
      banner([
        '🔗 ESCANEIE O QR CODE',
        '',
        'WhatsApp → Dispositivos conectados →',
        'Conectar um dispositivo'
      ]);
      qrcode.generate(qr, { small: true });
    })
    .catch(() => {
      log.warn('QR recebido (instale qrcode-terminal para desenhar):');
      log.raw(qr);
    });
}

/**
 * Inicia (ou reinicia) o socket do Baileys.
 * @param {object} handlers { onOpen, onMessage, onClosing }
 */
export async function startClient(handlers = {}) {
  ensureDirs();
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);

  const { version, source } = await resolveWaVersion();
  log.info(`versão WA Web: ${version ? version.join('.') : 'padrão'} (${source})`);

  const pairingNumber = await getPairingNumber(state.creds);

  socket = makeWASocket({
    version,
    // sem sessão ainda: dá tempo para o pareamento antes de reconectar
    connectTimeoutMs: state.creds.registered ? 45_000 : 150_000,
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, undefined)
    },
    browser: isTermux() ? Browsers.ubuntu('NEXUS Bot') : Browsers.windows('NEXUS Bot'),
    printQRInTerminal: false, // nós controlamos o QR
    markOnlineOnConnect: false,
    generateHighQualityLinkPreview: true,
    syncFullHistory: false,
    emitOwnEvents: false,
    logger: baileysLogger
  });

  socket.ev.on('creds.update', saveCreds);

  socket.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      if (isTermux()) {
        log.warn('QR recebido no Termux (inesperado) — prefira pareamento por código: ./pair SEUNUMERO');
        return;
      }
      printQR(qr);
    }

    if (connection === 'open') {
      const user = socket.user;
      banner([
        '⚡ N E X U S  B O T ⚡',
        '',
        `✅ Conectado como ${user?.name || ''} (${user?.id?.split('@')[0] || '?'})`,
        platformBanner(),
        'Digite .menu no WhatsApp para começar 🚀'
      ]);
      handlers.onOpen?.(socket);
    }

    if (connection === 'close') {
      const code = lastDisconnect?.error?.output?.statusCode;
      const loggedOut = code === DisconnectReason.loggedOut;
      log.warn(`conexão fechada (código ${code ?? '?'})${loggedOut ? ' — sessão expirada' : ''}`);

      if (stopping) return;

      if (loggedOut) {
        // sessão morta: limpa credenciais e repareia na próxima subida
        try {
          fs.rmSync(AUTH_DIR, { recursive: true, force: true });
        } catch {}
        log.warn('credenciais removidas — iniciando novo pareamento…');
      }

      scheduleReconnect(handlers, loggedOut ? 2000 : 4000, code);
    }
  });

  socket.ev.on('messages.upsert', async ({ messages, type }) => {
    for (const msg of messages) {
      try {
        await handlers.onMessage?.(socket, msg, type);
      } catch (error) {
        log.error('erro no handler de mensagem', error);
      }
    }
  });

  // pedidos de mídia antiga (placeholders etc.)
  socket.ev.on('messages.update', async (updates) => {
    for (const { key, update } of updates || []) {
      const proto = update?.message?.protocolMessage;
      if (proto && (proto.type === 0 || proto.type === 'REVOKE')) {
        try {
          await handlers.onMessage?.(socket, { key, message: { protocolMessage: proto }, messageTimestamp: Date.now() / 1000 }, 'update');
        } catch {}
      }
    }
  });

  // pareamento por código (Termux sempre; desktop opcional)
  if (!state.creds.registered && pairingNumber) {
    setTimeout(async () => {
      try {
        if (socket?.user || state.creds.registered) return;
        log.info('solicitando código de pareamento…');
        const code = await socket.requestPairingCode(pairingNumber);
        banner([
          '📱 CÓDIGO DE PAREAMENTO',
          '',
          `        ${code}`,
          '',
          'WhatsApp → Dispositivos conectados →',
          'Conectar com número de telefone'
        ]);
      } catch (error) {
        log.error(`código de pareamento falhou: ${error.message}`);
      }
    }, 4000);
  }

  return socket;
}

function scheduleReconnect(handlers, delayMs, code) {
  if (stopping || reconnectTimer) return;
  log.info(`reconectando em ${delayMs / 1000}s…`);
  reconnectTimer = setTimeout(async () => {
    reconnectTimer = null;
    try {
      await startClient(handlers);
    } catch (error) {
      log.error(`falha ao reconectar: ${error.message}`);
      scheduleReconnect(handlers, 15_000, code);
    }
  }, delayMs);
}

export function stopClient() {
  stopping = true;
  try {
    socket?.end(undefined);
  } catch {}
}
