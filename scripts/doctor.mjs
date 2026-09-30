import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const dirs=['data','data/auth','logs','storage','storage/media','storage/vault','storage/black','storage/status','storage/exports','storage/backups','.tmp'];
console.log('🔎 Bot-Zap Supremo Doctor');console.log(`📍 ${root}`);console.log(`📦 Node: ${process.version}`);
const major=Number(process.versions.node.split('.')[0]);if(major<24){console.log('❌ Node 24+ é obrigatório.');process.exitCode=1;}
for(const d of dirs){const p=path.join(root,d);if(!fs.existsSync(p))fs.mkdirSync(p,{recursive:true});}
const ff=spawnSync('ffmpeg',['-version'],{stdio:'ignore'});console.log(ff.status===0?'🎞️ FFmpeg: OK':'⚠️ FFmpeg não encontrado (pkg install ffmpeg)');
if(ff.status===0){const enc=spawnSync('ffmpeg',['-hide_banner','-encoders'],{encoding:'utf8'}).stdout||'';for(const [codec,what] of [['libwebp','figurinhas'],['libx264','.gif/.mp4'],['libopus','.ptt'],['libmp3lame','.mp3']])console.log(new RegExp(`\\b${codec}\\b`).test(enc)?`   ✅ ${codec} (${what})`:`   ⚠️ ${codec} ausente — ${what} não vão funcionar`);}
console.log(fs.existsSync(path.join(root,'data','pairing-number.txt'))?'🔐 Número de pareamento: configurado':'ℹ️ Número de pareamento: ainda não configurado');
console.log(fs.existsSync(path.join(root,'data','auth','creds.json'))?'🔗 Sessão: encontrada':'🔗 Sessão: ainda não pareada');
console.log('✅ Estrutura Termux verificada.');
