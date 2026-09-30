import fs from 'node:fs/promises';
import path from 'node:path';
import { CONFIG } from './core/config.js';
const n=process.argv[2];if(!n){console.error('Uso: ./bot.sh pair 5537999999999');process.exit(1);}const digits=String(n).replace(/\D/g,'');if(!/^\d{10,15}$/.test(digits)){console.error('Número inválido. Use DDI + DDD + número, só dígitos.');process.exit(1);}await fs.mkdir(CONFIG.DATA_DIR,{recursive:true});await fs.writeFile(path.join(CONFIG.DATA_DIR,'pairing-number.txt'),digits+'\n',{mode:0o600});console.log(`✅ Número salvo: +${digits}\n\nO bot solicitará o código automaticamente no próximo início sem sessão.`);
