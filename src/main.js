import { mkdir } from 'node:fs/promises';
import { CONFIG } from './core/config.js';
import { consoleLog,logger } from './core/logger.js';
import { connect,getSocket,stop } from './core/connection.js';
import { startScheduler,stopScheduler } from './core/scheduler.js';
import { closeDb,dbSet,dbGet } from './core/db.js';
import { protectDir } from './core/security.js';
const dirs=[CONFIG.AUTH_DIR,CONFIG.DATA_DIR,CONFIG.LOG_DIR,CONFIG.STORAGE_DIR,CONFIG.MEDIA_DIR,CONFIG.VAULT_DIR,CONFIG.BLACK_DIR,CONFIG.STATUS_DIR,CONFIG.EXPORT_DIR,CONFIG.BACKUP_DIR,CONFIG.TMP_DIR];
for(const d of dirs){await mkdir(d,{recursive:true});await protectDir(d);}
if(dbGet('feature.viewonce')==null)dbSet('feature.viewonce',CONFIG.VIEW_ONCE_AUTO?'1':'0');if(dbGet('feature.sticker')==null)dbSet('feature.sticker',CONFIG.DEFAULT_STICKER?'1':'0');
let shutting=false;async function shutdown(){if(shutting)return;shutting=true;stopScheduler();await stop();closeDb();process.exit(0);}process.on('SIGINT',shutdown);process.on('SIGTERM',shutdown);process.on('uncaughtException',e=>{logger.fatal({err:e?.stack||e?.message||String(e)},'uncaughtException');process.exit(1);});process.on('unhandledRejection',e=>{logger.error({err:e?.stack||e?.message||String(e)},'unhandledRejection');setTimeout(()=>process.exit(1),100).unref?.();});
consoleLog('╔════════════════════════════════════════════╗');consoleLog('║          BOT-ZAP SUPREMO • TERMUX          ║');consoleLog('║       View Once • Vault • Event Core       ║');consoleLog('╚════════════════════════════════════════════╝');consoleLog('🔐 Somente mensagens administrativas enviadas pela própria conta executam comandos.');
await connect();startScheduler(()=>getSocket(),()=>getSocket()?.user?.id);
