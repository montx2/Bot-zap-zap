import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');let failures=0;
const check=(name,fn)=>{try{fn();console.log(`✅ ${name}`);}catch(e){failures++;console.log(`❌ ${name}: ${e.message}`);}};
check('package existe',()=>{if(!fs.existsSync(path.join(root,'package.json')))throw new Error('ausente')});
check('estrutura Termux',()=>{for(const d of ['src','scripts'])if(!fs.existsSync(path.join(root,d)))throw new Error(d)});
check('sha256 determinístico',()=>{const a=crypto.createHash('sha256').update('abc').digest('hex');if(a!=='ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')throw new Error('hash incorreto')});
check('ffmpeg disponível',()=>{if(spawnSync('ffmpeg',['-version']).status!==0)throw new Error('FFmpeg não encontrado')});
check('syntax dos módulos',()=>{const files=[];const walk=d=>{for(const e of fs.readdirSync(d,{withFileTypes:true})){const p=path.join(d,e.name);if(e.isDirectory())walk(p);else if(e.name.endsWith('.js')||e.name.endsWith('.mjs'))files.push(p);}};walk(path.join(root,'src'));walk(path.join(root,'scripts'));walk(path.join(root,'tests'));for(const f of files){const r=spawnSync(process.execPath,['--check',f],{encoding:'utf8'});if(r.status!==0)throw new Error(`${f}: ${r.stderr||r.stdout}`)}});
const webp=await import('../src/core/webp.js');
check('ffmpeg com libwebp (figurinhas)',()=>{const r=spawnSync('ffmpeg',['-hide_banner','-encoders'],{encoding:'utf8'});if(!/libwebp/.test(r.stdout||''))throw new Error('FFmpeg sem libwebp — pkg upgrade ffmpeg')});
check('webp: EXIF de figurinha (round-trip)',()=>{
  const tmp=path.join(root,'.tmp');fs.mkdirSync(tmp,{recursive:true});const f=path.join(tmp,'selftest.webp');
  const r=spawnSync('ffmpeg',['-hide_banner','-loglevel','error','-f','lavfi','-i','color=c=red:s=64x64','-frames:v','1','-c:v','libwebp','-y',f]);if(r.status!==0)throw new Error('não gerou WebP');
  const tagged=webp.tagSticker(fs.readFileSync(f),{pack:'Pack',author:'Autor',emojis:['🔥']});const x=webp.readStickerExif(tagged);
  if(x?.pack!=='Pack'||x.author!=='Autor'||webp.parseWebp(tagged).width!==64)throw new Error('EXIF inválido');fs.rmSync(f,{force:true});
});
console.log(failures?`\n❌ ${failures} teste(s) falharam.`:'\n🔥 Todos os testes locais passaram.');process.exitCode=failures?1:0;
