import pino from 'pino';
import { CONFIG } from './config.js';

export const logger = pino({
  level: CONFIG.LOG_LEVEL,
  base: null,
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: {
    paths: ['msg.key', 'key', 'remoteJid', 'participant', 'jid', 'message'],
    censor: '[redacted]'
  }
});

export function consoleLog(text) { process.stdout.write(`${text}\n`); }

function searchableArgs(args) {
  return args.map((value) => {
    if (typeof value === 'string') return value;
    try { return JSON.stringify(value); } catch { return String(value); }
  }).join(' ');
}

/**
 * Baileys logs some transport failures without emitting connection.close.
 * The wrapper lets connection.js turn the specific init-query timeout into a
 * controlled socket restart instead of leaving a dead session running forever.
 */
export function createBaileysLogger(onTransportProblem, onDecryptFailure) {
  const wrap = (target) => new Proxy(target, {
    get(obj, prop) {
      if (prop === 'child') {
        return (bindings, options) => wrap(obj.child(bindings, options));
      }

      const value = obj[prop];
      if (typeof value !== 'function') return value;

      return (...args) => {
        // Falha de descriptografia (Bad MAC / sem sessão): a chave crua ainda está aqui, antes do redact do pino.
        if (prop === 'error' && onDecryptFailure && args[1] === 'failed to decrypt message') {
          try { onDecryptFailure({ key: args[0]?.key, error: String(args[0]?.err?.message || args[0]?.err || '') }); } catch {}
        }
        if (prop === 'error' || prop === 'warn') {
          const text = searchableArgs(args);
          if (/unexpected error in ['\"]init queries['\"]|executeInitQueries|fetchProps.*Timed Out|init queries.*Timed Out/i.test(text)) {
            try { onTransportProblem?.({ type: 'init-queries-timeout', text }); } catch {}
          }
        }
        return value.apply(obj, args);
      };
    }
  });

  return wrap(logger.child({ component: 'baileys' }));
}
