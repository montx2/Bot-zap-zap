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
{const df=spawnSync('df',['-Pk',root],{encoding:'utf8'});const free=Number((df.stdout||'').trim().split('\n').pop()?.split(/\s+/)[3])*1024;if(free){const gb=free/1024**3;console.log(gb<1?`⚠️ Pouco espaço livre: ${gb.toFixed(2)} GB (mídias e cofre ocupam disco)`:`💾 Espaço livre: ${gb.toFixed(1)} GB`);}}
console.log(spawnSync('sh',['-c','command -v termux-wake-lock'],{stdio:'ignore'}).status===0?'🔋 termux-wake-lock: OK (bot fica vivo com a tela apagada)':'ℹ️ Instale `pkg install termux-api` (+ app Termux:API) para o bot usar wake-lock e não ser morto pelo Android.');
console.log(fs.existsSync(path.join(root,'.env'))?'⚙️ .env: carregado':'ℹ️ Sem .env — usando padrões (copie .env.example para .env para personalizar).');
console.log('✅ Estrutura Termux verificada.');
