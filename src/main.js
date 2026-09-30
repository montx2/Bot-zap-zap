import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { CONFIG } from './core/config.js';
import { consoleLog,logger } from './core/logger.js';
import { connect,getSocket,stop } from './core/connection.js';
import { startScheduler,stopScheduler } from './core/scheduler.js';
import { closeDb,dbSet,dbGet } from './core/db.js';
import { protectDir } from './core/security.js';
import { cleanTmp,ffmpegCapabilities } from './core/media.js';
import { acquireInstanceLock } from './core/lock.js';
const dirs=[CONFIG.AUTH_DIR,CONFIG.DATA_DIR,CONFIG.LOG_DIR,CONFIG.STORAGE_DIR,CONFIG.MEDIA_DIR,CONFIG.VAULT_DIR,CONFIG.BLACK_DIR,CONFIG.STATUS_DIR,CONFIG.EXPORT_DIR,CONFIG.BACKUP_DIR,CONFIG.TMP_DIR];
for(const d of dirs){await mkdir(d,{recursive:true});await protectDir(d);}
// Uma única cópia por sessão: duas cópias se derrubam (conflict/replaced) e corrompem as chaves (Bad MAC).
{const lock=acquireInstanceLock(path.join(CONFIG.DATA_DIR,'bot.lock'));if(!lock.ok){consoleLog(`\n⛔ O bot já está rodando (PID ${lock.pid}) usando esta mesma sessão do WhatsApp.\n   Duas cópias ao mesmo tempo derrubam uma à outra e quebram as mensagens/figurinhas.\n   Para reiniciar do jeito certo:  ./bot.sh restart\n   Para só parar:                  ./bot.sh stop\n`);process.exit(0);}}
if(dbGet('feature.viewonce')==null)dbSet('feature.viewonce',CONFIG.VIEW_ONCE_AUTO?'1':'0');if(dbGet('feature.sticker')==null)dbSet('feature.sticker',CONFIG.DEFAULT_STICKER?'1':'0');
// Sticker Engine 2.0: libera as figurinhas uma única vez (antes o padrão era bloqueado).
if(dbGet('sticker.engine')!=='2'){dbSet('sticker.engine','2');if(/^(0|false|off|no)$/i.test(String(process.env.STICKER_DEFAULT??'1')))dbSet('feature.sticker','0');else dbSet('feature.sticker','1');}
await cleanTmp(0);
{const caps=await ffmpegCapabilities();if(!caps.installed)consoleLog('⚠️ FFmpeg não encontrado — figurinhas e conversores não vão funcionar (pkg install ffmpeg).');else if(!caps.webp)consoleLog('⚠️ FFmpeg sem libwebp — figurinhas não vão funcionar (pkg upgrade ffmpeg).');}
let shutting=false;async function shutdown(){if(shutting)return;shutting=true;stopScheduler();await stop();closeDb();process.exit(0);}process.on('SIGINT',shutdown);process.on('SIGTERM',shutdown);process.on('uncaughtException',e=>{logger.fatal({err:e?.stack||e?.message||String(e)},'uncaughtException');process.exit(1);});process.on('unhandledRejection',e=>{logger.error({err:e?.stack||e?.message||String(e)},'unhandledRejection (ignorado; o health probe cuida da conexão)');});
consoleLog('╔════════════════════════════════════════════╗');consoleLog('║          BOT-ZAP SUPREMO • TERMUX          ║');consoleLog('║  View Once • Stickers • Vault • Event Core ║');consoleLog('╚════════════════════════════════════════════╝');consoleLog(`                ${CONFIG.BRAND}`);consoleLog('🔐 Somente mensagens administrativas enviadas pela própria conta executam comandos.');
await connect();startScheduler(()=>getSocket(),()=>getSocket()?.user?.id);
