// Manutenção automática — mantém o bot leve para rodar por meses no celular:
//  • raw_json de mensagens antigas é apagado (texto/busca continuam);
//  • mídias comuns (não View Once / cofre) expiram e respeitam um teto de espaço;
//  • tabelas de eventos antigas são podadas;
//  • log gigante é rotacionado; WAL do SQLite é compactado; .tmp é limpo.
import fs from 'node:fs/promises';
import path from 'node:path';
import { CONFIG } from './config.js';
import { logger } from './logger.js';
import { dbGet, dbSet, pruneRaw, pruneTable, mediaOlderThan, mediaOldestFirst, mediaBytesOf, deleteMediaRows, checkpointDb } from './db.js';
import { cleanTmp } from './media.js';

const DAY = 24 * 3600 * 1000;
const DISPOSABLE = ['media', 'status']; // nunca apaga view-once, vault ou black

async function removeFiles(rows) {
  let bytes = 0;
  for (const r of rows) {
    try { await fs.unlink(r.file_path); } catch { /* já não existe */ }
    bytes += Number(r.bytes) || 0;
  }
  deleteMediaRows(rows.map((r) => r.id));
  return bytes;
}

export async function rotateLog() {
  const file = path.join(CONFIG.LOG_DIR, 'bot.log');
  try {
    const st = await fs.stat(file);
    if (st.size < CONFIG.LOG_MAX_MB * 1024 * 1024) return false;
    await fs.copyFile(file, `${file}.1`);
    await fs.truncate(file, 0); // o supervisor escreve em modo append, então continua funcionando
    return true;
  } catch { return false; }
}

export async function runMaintenance(now = Date.now()) {
  const report = { raw: 0, events: 0, media: 0, mediaBytes: 0, log: false, tmp: 0 };
  try {
    report.raw = pruneRaw(now - CONFIG.KEEP_RAW_DAYS * DAY);
    report.events += pruneTable('presence_events', 'ts', now - 30 * DAY);
    report.events += pruneTable('receipts', 'ts', now - 60 * DAY);
    report.events += pruneTable('events', 'ts', now - 120 * DAY);

    if (CONFIG.MEDIA_KEEP_DAYS > 0) {
      const old = mediaOlderThan(DISPOSABLE, now - CONFIG.MEDIA_KEEP_DAYS * DAY);
      report.media += old.length; report.mediaBytes += await removeFiles(old);
    }
    const cap = CONFIG.MEDIA_MAX_GB * 1024 ** 3;
    for (let guard = 0; guard < 50 && cap > 0 && mediaBytesOf(DISPOSABLE) > cap; guard++) {
      const batch = mediaOldestFirst(DISPOSABLE, 100);
      if (!batch.length) break;
      report.media += batch.length; report.mediaBytes += await removeFiles(batch);
    }
    report.log = await rotateLog();
    report.tmp = await cleanTmp(3600_000);
    checkpointDb();
    dbSet('runtime.maintenance', now);
    logger.info(report, 'manutenção concluída');
  } catch (e) {
    logger.warn({ err: e?.message }, 'manutenção falhou');
    report.error = e?.message;
  }
  return report;
}

export const lastMaintenance = () => Number(dbGet('runtime.maintenance') || 0);
