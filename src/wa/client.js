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
const PAIR_CODE_FILE = path.join(DATA_DIR, 'pairing-code.txt');
const VERSION_CACHE = path.join(DATA_DIR, 'wa-web-version.json');

let socket = null;
let stopping = false;
let reconnectTimer = null;
let pairingRequestedAt = 0;
let pairingRequestInProgress = false;

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

async function waitForSocketOpen(clientSocket) {
  if (typeof clientSocket.waitForSocketOpen !== 'function') {
    throw new Error('esta versão do Baileys não expõe waitForSocketOpen()');
  }

  let timeout;
  try {
    await Promise.race([
      clientSocket.waitForSocketOpen(),
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error('timeout esperando o socket abrir')), 30_000);
      })
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const canRequestPairingCode = () =>
  !pairingRequestedAt || Date.now() - pairingRequestedAt > 120_000;

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

  const clientSocket = makeWASocket({
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
    // Essencial para bot pessoal: o dono comanda o bot a partir da própria
    // conta, então precisamos receber as mensagens fromMe. (Os próprios envios
    // do bot nunca começam com prefixo de comando, então não há loop.)
    emitOwnEvents: true,
    logger: baileysLogger
  });
  socket = clientSocket;

  clientSocket.ev.on('creds.update', saveCreds);

  clientSocket.ev.on('connection.update', (update) => {
    if (socket !== clientSocket) return;
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      if (isTermux()) {
        log.warn('QR recebido no Termux (inesperado) — prefira pareamento por código: ./pair SEUNUMERO');
        return;
      }
      printQR(qr);
    }

    if (connection === 'open') {
      const user = clientSocket.user;
      try {
        fs.rmSync(PAIR_CODE_FILE, { force: true });
      } catch {}
      banner([
        '⚡ N E X U S  B O T ⚡',
        '',
        `✅ Conectado como ${user?.name || ''} (${user?.id?.split('@')[0] || '?'})`,
        platformBanner(),
        'Digite .menu no WhatsApp para começar 🚀'
      ]);
      handlers.onOpen?.(clientSocket);
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

  clientSocket.ev.on('messages.upsert', async ({ messages, type }) => {
    if (socket !== clientSocket) return;
    for (const msg of messages) {
      try {
        await handlers.onMessage?.(clientSocket, msg, type);
      } catch (error) {
        log.error('erro no handler de mensagem', error);
      }
    }
  });

  // pedidos de mídia antiga (placeholders etc.)
  clientSocket.ev.on('messages.update', async (updates) => {
    if (socket !== clientSocket) return;
    for (const { key, update } of updates || []) {
      const proto = update?.message?.protocolMessage;
      if (proto && (proto.type === 0 || proto.type === 'REVOKE')) {
        try {
          await handlers.onMessage?.(clientSocket, { key, message: { protocolMessage: proto }, messageTimestamp: Date.now() / 1000 }, 'update');
        } catch {}
      }
    }
  });

  // Pareamento por código (Termux sempre; desktop opcional). O código é
  // reutilizado por até 2 minutos: reconexões curtas não devem invalidá-lo.
  if (!state.creds.registered && pairingNumber) {
    (async () => {
      if (!canRequestPairingCode()) {
        log.info('pareamento já solicitado há menos de 2 minutos; mantendo o código existente (data/pairing-code.txt).');
        return;
      }

      for (let attempt = 1; attempt <= 3; attempt++) {
        if (stopping || socket !== clientSocket || state.creds.registered) return;
        try {
          await waitForSocketOpen(clientSocket);
          if (stopping || socket !== clientSocket || clientSocket.user || state.creds.registered) return;

          // Serializa pedidos quando uma reconexão começa enquanto o anterior
          // ainda está aguardando a resposta do WhatsApp.
          while (pairingRequestInProgress) {
            if (stopping || socket !== clientSocket || state.creds.registered) return;
            if (!canRequestPairingCode()) {
              log.info('o código recente segue válido; não vou pedir outro nesta reconexão.');
              return;
            }
            await sleep(100);
          }
          if (!canRequestPairingCode()) {
            log.info('o código recente segue válido; não vou pedir outro nesta reconexão.');
            return;
          }

          pairingRequestInProgress = true;
          let code;
          try {
            code = await clientSocket.requestPairingCode(pairingNumber);
            pairingRequestedAt = Date.now();
          } finally {
            pairingRequestInProgress = false;
          }

          try {
            fs.writeFileSync(PAIR_CODE_FILE, `${code}\n`, { mode: 0o600 });
            fs.chmodSync(PAIR_CODE_FILE, 0o600);
          } catch (error) {
            log.warn(`não consegui salvar o código em data/pairing-code.txt: ${error.message}`);
          }

          banner([
            '📱 CÓDIGO DE PAREAMENTO',
            '',
            `          ${code}`,
            '',
            '⏱️ VALE ~1 MINUTO: DIGITE AGORA.',
            '',
            'WhatsApp → Dispositivos conectados →',
            'Conectar com número de telefone'
          ]);
          return;
        } catch (error) {
          log.warn(`pareamento (tentativa ${attempt}/3): ${String(error?.message || error).slice(0, 120)}`);
          if (stopping || socket !== clientSocket) return;
          if (attempt < 3) await sleep(5000);
        }
      }
      log.error('não consegui registrar o código de pareamento após 3 tentativas. Verifique a internet e tente novamente.');
    })();
  }

  return clientSocket;
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
