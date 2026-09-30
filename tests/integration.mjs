import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root=process.env.BOT_ROOT;
if(!root)throw new Error('BOT_ROOT não definido');
await fsp.rm(root,{recursive:true,force:true});
await fsp.mkdir(root,{recursive:true});

const { archiveIncoming }=await import('../src/modules/archive.js');
const { captureViewOnce,captureQuotedViewOnce,viewOnceEnabled }=await import('../src/modules/viewonce.js');
const { setStickerEnabled }=await import('../src/modules/stickers.js');
const { convertMedia }=await import('../src/core/media.js');
const { secureFile,openSecureFile,hasKey }=await import('../src/core/security.js');
const DB=await import('../src/core/db.js');
const { handleDelete,handleEdit }=await import('../src/modules/anti.js');
const { addTarget,settings }=await import('../src/modules/watch.js');
const { find }=await import('../src/modules/analytics.js');

const owner='5511999999999@s.whatsapp.net';
const sent=[];
const sock={user:{id:owner},sendMessage:async(jid,content)=>{sent.push({jid,content});return {key:{id:`out-${sent.length}`}}},updateMediaMessage:async(msg)=>msg,requestPlaceholderResend:async()=>true,sendPresenceUpdate:async()=>true,waitForSocketOpen:async()=>true};
const pngPath=path.join(root,'data','fixture.png'); spawnSync('ffmpeg',['-hide_banner','-loglevel','error','-f','lavfi','-i','color=c=white:s=32x32','-frames:v','1','-y',pngPath]); const png=fs.readFileSync(pngPath); assert.ok(png.length>100,'fixture PNG inválido');

function baseMsg(id,message,fromMe=false,jid='5511988888888@s.whatsapp.net'){return {key:{remoteJid:jid,id,fromMe},message,messageTimestamp:Math.floor(Date.now()/1000),pushName:'Teste'};}
function vo(type,version='viewOnceMessage'){
  const node={mimetype:type==='imageMessage'?'image/jpeg':'video/mp4',mediaKey:Buffer.from('01234567890123456789012345678901'),directPath:'/mock'};
  return {[version]:{message:{[type]:node}}};
}

// View Once variants + automatic forward to owner PV
for(const [i,v] of ['viewOnceMessage','viewOnceMessageV2','viewOnceMessageV2Extension'].entries()){
  globalThis.__MOCK_MEDIA_BUFFER=png;
  const msg=baseMsg(`vo-${i}`,vo('imageMessage',v));
  archiveIncoming(msg);
  const ok=await captureViewOnce(sock,msg);
  assert.equal(ok,true,`View Once ${v} não capturada`);
  assert.ok(sent.some(x=>x.jid===owner&&x.content.image),`View Once ${v} não encaminhada ao PV`);
}
assert.equal(viewOnceEnabled(),true);

// Reply/quoted path independent of command text
const quoted=baseMsg('vo-quoted',vo('imageMessage'),'false','5511777777777@s.whatsapp.net');
const reply=baseMsg('reply-1',{extendedTextMessage:{text:'qualquer coisa',contextInfo:{stanzaId:'vo-quoted',participant:'5511777777777@s.whatsapp.net',quotedMessage:quoted.message}}},true);
globalThis.__MOCK_MEDIA_BUFFER=png;
archiveIncoming(quoted);
let before=sent.length;
assert.equal(await captureQuotedViewOnce(sock,reply),true,'recuperação por resposta falhou');
assert.ok(sent.length>before,'PV não recebeu a recuperação por resposta');

// Search Everything: message + link + event indexes
const normal=baseMsg('normal-1',{conversation:'documento especial https://example.com/a'});
archiveIncoming(normal);
DB.saveEvent({kind:'special.manual',remoteJid:normal.key.remoteJid,refId:normal.key.id,data:{note:'documento especial'}});
const searchMessageEvent=find('especial',20);
assert.match(searchMessageEvent,/MENSAGEM/);
assert.match(searchMessageEvent,/EVENTO/);
const searchLink=find('example.com',20);
assert.match(searchLink,/MENSAGEM/);
assert.match(searchLink,/LINK/);

// Anti-delete and edit against archived content
const victim=baseMsg('victim-1',{conversation:'mensagem secreta'});
archiveIncoming(victim);
await handleDelete(sock,{key:victim.key,message:{protocolMessage:{type:0,key:victim.key}},messageTimestamp:victim.messageTimestamp},{ANTI_DELETE:true});
assert.ok(sent.some(x=>x.jid===owner&&String(x.content?.text||'').includes('MENSAGEM APAGADA')),'anti-delete não avisou');
const edited=baseMsg('edit-1',{conversation:'antes'});
archiveIncoming(edited);
await handleEdit(sock,{key:edited.key,message:{protocolMessage:{type:14,key:edited.key,editedMessage:{conversation:'depois'}}}},{ANTI_EDIT:true});
assert.ok(sent.some(x=>x.jid===owner&&String(x.content?.text||'').includes('MENSAGEM EDITADA')),'anti-edit não avisou');

// Watch + smart alert settings persistence
addTarget('5511666666666','Alvo');
DB.upsertWatch('5511666666666@s.whatsapp.net','Alvo',{alertHours:[8,9,18]});
assert.deepEqual(settings('5511666666666@s.whatsapp.net').alertHours,[8,9,18]);

// Encrypted local vault round-trip
const plain=path.join(root,'data','plain.bin'); const enc=path.join(root,'storage','vault','roundtrip.bzs');
await fsp.writeFile(plain,Buffer.from('conteúdo do cofre'));
await secureFile(plain,enc);
assert.equal(await hasKey(),true);
assert.equal((await openSecureFile(enc)).toString(),'conteúdo do cofre');

// ───────── Sticker Engine 2.0 + FFmpeg real ─────────
const ST=await import('../src/modules/stickers.js');
const W=await import('../src/core/webp.js');
const WD=await import('../src/core/webpDecode.js');
const { convertQuoted }=await import('../src/modules/commandMedia.js');
setStickerEnabled(true);
globalThis.__MOCK_MEDIA_BUFFER=png;
const quotedMsg=(id,node,text='.s')=>({key:{remoteJid:'5511988888888@s.whatsapp.net',id:`cmd-${id}`,fromMe:true},messageTimestamp:Math.floor(Date.now()/1000),message:{extendedTextMessage:{text,contextInfo:{stanzaId:id,participant:'5511988888888@s.whatsapp.net',quotedMessage:node}}}});
const lastSticker=()=>sent.filter(x=>x.content?.sticker).at(-1).content;

// parser de opções
{
  const p=ST.parseStickerArgs('circle bw slow 6 😎 | Meu Pack | Eu');
  assert.equal(p.opts.fit,'circle'); assert.deepEqual(p.opts.fx,['bw']); assert.equal(p.opts.speed,0.5); assert.equal(p.opts.seconds,6);
  assert.deepEqual(p.emojis,['😎']); assert.equal(p.pack,'Meu Pack'); assert.equal(p.author,'Eu'); assert.equal(p.unknown.length,0);
  assert.deepEqual(ST.parseStickerArgs('círculo PRETO').unknown,['PRETO']);
  assert.equal(ST.parseStickerArgs('').opts.fit,'fit');
}

// imagem → figurinha estática com EXIF
before=sent.length;
await ST.createSticker(sock,quotedMsg('img',{imageMessage:{mimetype:'image/png'}},'.s | Pack Teste | Autor Teste'));
assert.ok(sent.slice(before).some(x=>x.content?.sticker?.length),'sticker de imagem não foi gerado');
{
  const c=lastSticker(); const info=W.parseWebp(c.sticker);
  assert.equal(info.width,512); assert.equal(info.height,512); assert.equal(info.animated,false); assert.equal(c.isAnimated,false);
  assert.ok(c.sticker.length<=100*1024,'sticker estático acima de 100 KB');
  const ex=W.readStickerExif(c.sticker); assert.equal(ex.pack,'Pack Teste'); assert.equal(ex.author,'Autor Teste');
}
// reações ⏳ → limpa
assert.ok(sent.some(x=>x.content?.react?.text==='⏳'),'faltou reação de progresso');
// opção inválida
await assert.rejects(()=>ST.createSticker(sock,quotedMsg('img',{imageMessage:{mimetype:'image/png'}},'.s xyzzy')),/opção desconhecida/);
// sem mídia
await assert.rejects(()=>ST.createSticker(sock,baseMsg('nomedia',{conversation:'.s'},true)),/responda/);

// modos visuais
for(const args of ['crop','full','circle','round','bw sepia','invert flip','blur','hq','lq']){
  before=sent.length; await ST.createSticker(sock,quotedMsg('img',{imageMessage:{mimetype:'image/png'}},`.s ${args}`),args,{silent:true});
  assert.ok(W.parseWebp(lastSticker().sticker).width===512,`modo ${args}`);
}

// vídeo → figurinha animada
const video=path.join(root,'data','fixture.mp4');
const made=spawnSync('ffmpeg',['-hide_banner','-loglevel','error','-f','lavfi','-i','testsrc=size=320x240:rate=12','-f','lavfi','-i','sine=frequency=880:sample_rate=8000','-t','1.6','-shortest','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac','-y',video]);
assert.equal(made.status,0,'FFmpeg não conseguiu gerar fixture de vídeo');
globalThis.__MOCK_MEDIA_BUFFER=fs.readFileSync(video);
const vnode={videoMessage:{mimetype:'video/mp4'}};
await ST.createSticker(sock,quotedMsg('vid',vnode,'.s'),'',{silent:true});
const animSticker=lastSticker();
assert.equal(animSticker.isAnimated,true); assert.equal(W.isAnimatedWebp(animSticker.sticker),true);
assert.ok(animSticker.sticker.length<=500*1024,'sticker animado acima de 500 KB');
assert.ok(W.parseWebp(animSticker.sticker).frames.length>=10,'poucos frames');
for(const args of ['circle slow','boomerang 1','rev fast','static','crop 1']){
  await ST.createSticker(sock,quotedMsg('vid',vnode,`.s ${args}`),args,{silent:true});
  const c=lastSticker(); assert.equal(c.isAnimated,args==='static'?false:true,`animação em "${args}"`);
}
// vídeo dentro da própria mensagem (legenda)
await ST.createSticker(sock,{key:{remoteJid:owner,id:'own-vid',fromMe:true},message:{videoMessage:{mimetype:'video/mp4',caption:'.s'}},messageTimestamp:1},'',{silent:true});
assert.equal(lastSticker().isAnimated,true);
// GIF (videoMessage gifPlayback) e documento de vídeo
await ST.createSticker(sock,quotedMsg('gif',{videoMessage:{mimetype:'video/mp4',gifPlayback:true}}),'',{silent:true});
await ST.createSticker(sock,quotedMsg('doc',{documentMessage:{mimetype:'video/mp4',fileName:'a.mp4'}}),'',{silent:true});
assert.equal(lastSticker().isAnimated,true);

// figurinha animada → nova figurinha (retag instantâneo e re-encode)
globalThis.__MOCK_MEDIA_BUFFER=animSticker.sticker;
const snode={stickerMessage:{mimetype:'image/webp',isAnimated:true}};
await ST.createSticker(sock,quotedMsg('stk',snode,'.s | Outro | Dono'),'| Outro | Dono',{silent:true});
assert.equal(W.readStickerExif(lastSticker().sticker).pack,'Outro'); assert.equal(W.isAnimatedWebp(lastSticker().sticker),true);
await ST.createSticker(sock,quotedMsg('stk',snode),'circle',{silent:true});
assert.equal(W.isAnimatedWebp(lastSticker().sticker),true);
// .take, .stickerinfo
await ST.takeSticker(sock,quotedMsg('stk',snode,'.take X | Y'),'Nome | Autor');
assert.deepEqual([W.readStickerExif(lastSticker().sticker).pack,W.readStickerExif(lastSticker().sticker).author],['Nome','Autor']);
assert.match(await ST.stickerInfo(sock,quotedMsg('stk',snode)),/animada/);
// .toimg (animada e estática)
before=sent.length; await ST.stickerToImage(sock,quotedMsg('stk',snode,'.toimg'));
assert.ok(sent.slice(before).some(x=>x.content?.image?.length>100),'toimg animada');
globalThis.__MOCK_MEDIA_BUFFER=fs.readFileSync(path.join(root,'data','fixture.png'));
await ST.createSticker(sock,quotedMsg('img2',{imageMessage:{mimetype:'image/png'}}),'',{silent:true});
globalThis.__MOCK_MEDIA_BUFFER=lastSticker().sticker;
before=sent.length; await ST.stickerToImage(sock,quotedMsg('stk2',{stickerMessage:{mimetype:'image/webp'}},'.toimg doc'),{asDocument:true});
assert.ok(sent.slice(before).some(x=>x.content?.document?.length>50),'toimg estática');

// EXIF: VP8X criado para WebP simples + round-trip
{
  const plain=path.join(root,'data','plain.webp');
  spawnSync('ffmpeg',['-hide_banner','-loglevel','error','-i',pngPath,'-c:v','libwebp','-y',plain]);
  const raw=fs.readFileSync(plain); const tagged=W.tagSticker(raw,{pack:'P',author:'A',emojis:['🔥']});
  assert.equal(W.readStickerExif(tagged).pack,'P'); assert.equal(W.parseWebp(tagged).width,32);
  const ok=spawnSync('ffmpeg',['-hide_banner','-loglevel','error','-f','webp_pipe','-i','pipe:0','-frames:v','1','-f','null','-'],{input:tagged});
  assert.equal(ok.status,0,'WebP com EXIF deve continuar decodificável');
}
// WebP animado com sub-frames (offset/blend): composição correta
{
  const mk=(color,size,out)=>{spawnSync('ffmpeg',['-hide_banner','-loglevel','error','-f','lavfi','-i',`color=c=${color}:s=${size}`,'-frames:v','1','-c:v','libwebp','-lossless','1','-y',out]);return W.parseWebp(fs.readFileSync(out)).frames[0];};
  const red=mk('red','64x64',path.join(root,'data','r.webp')),blue=mk('blue','16x16',path.join(root,'data','b.webp'));
  const sub=f=>Buffer.concat(f.chunks.map(c=>{const h=Buffer.alloc(8);h.write(c.type,0,'ascii');h.writeUInt32LE(c.data.length,4);return Buffer.concat([h,c.data,Buffer.alloc(c.data.length&1)]);}));
  const anmf=(f,x,y)=>{const h=Buffer.alloc(16);h.writeUIntLE(x/2,0,3);h.writeUIntLE(y/2,3,3);h.writeUIntLE(f.w-1,6,3);h.writeUIntLE(f.h-1,9,3);h.writeUIntLE(100,12,3);return {type:'ANMF',data:Buffer.concat([h,sub(f)])};};
  const vp8x=Buffer.alloc(10);vp8x[0]=0x12;vp8x.writeUIntLE(63,4,3);vp8x.writeUIntLE(63,7,3);
  const webp=W.buildRiff([{type:'VP8X',data:vp8x},{type:'ANIM',data:Buffer.alloc(6)},anmf(red,0,0),anmf(blue,16,16)]);
  const out=path.join(root,'data','sub.mkv');
  await WD.decodeAnimatedWebp(webp,{outFile:out,outArgs:['-c:v','png']});
  const px=(x,y)=>spawnSync('ffmpeg',['-hide_banner','-loglevel','error','-i',out,'-vf',`select=eq(n\\,1),crop=1:1:${x}:${y},format=rgb24`,'-frames:v','1','-f','rawvideo','pipe:1'],{encoding:'buffer'}).stdout;
  const near=(a,b)=>a.length===3&&a.every((v,i)=>Math.abs(v-b[i])<=4);
  assert.ok(near([...px(20,20)],[0,0,255]),'pixel dentro do sub-frame deve ser azul');
  assert.ok(near([...px(2,2)],[255,0,0]),'pixel fora do sub-frame deve continuar vermelho');
}

// conversores: gif / mp4 / ptt / mp3 a partir de vídeo, e gif de figurinha animada
globalThis.__MOCK_MEDIA_BUFFER=fs.readFileSync(video);
for(const mode of ['gif','mp4','ptt','mp3']){
  before=sent.length; await convertQuoted(sock,quotedMsg('vid',vnode,`.${mode}`),mode);
  const c=sent.slice(before).at(-1).content;
  if(mode==='gif'){assert.equal(c.gifPlayback,true);assert.equal(c.mimetype,'video/mp4');assert.ok(c.video.length>500);}
  if(mode==='mp4')assert.ok(c.video.length>500);
  if(mode==='ptt'){assert.equal(c.ptt,true);assert.ok(c.audio.length>100);}
  if(mode==='mp3')assert.ok(c.audio.length>100);
}
globalThis.__MOCK_MEDIA_BUFFER=animSticker.sticker;
before=sent.length; await convertQuoted(sock,quotedMsg('stk',snode,'.gif'),'gif');
assert.equal(sent.slice(before).at(-1).content.gifPlayback,true,'figurinha animada → GIF');
await assert.rejects(()=>convertQuoted(sock,quotedMsg('x',{imageMessage:{mimetype:'image/png'}}),'gif'),/vídeo/);

// auto-sticker no chat consigo mesmo
ST.setStickerAuto(true);
globalThis.__MOCK_MEDIA_BUFFER=png;
before=sent.length;
assert.equal(await ST.maybeAutoSticker(sock,{key:{remoteJid:owner,id:'auto-1',fromMe:true},message:{imageMessage:{mimetype:'image/png',caption:'circle'}},messageTimestamp:1}),true);
assert.ok(sent.slice(before).some(x=>x.content?.sticker),'auto-sticker não gerou');
before=sent.length;
assert.equal(await ST.maybeAutoSticker(sock,{key:{remoteJid:'5511988888888@s.whatsapp.net',id:'auto-2',fromMe:true},message:{imageMessage:{mimetype:'image/png'}},messageTimestamp:1}),false,'auto-sticker só no chat comigo');
assert.equal(sent.length,before);
ST.setStickerAuto(false);

// Despacho real dos comandos (.s, .sticker pack, .menu figurinha, .toimg...)
{
  const { handleCommand }=await import('../src/core/commands.js');
  const cmd=(text,node)=>handleCommand(sock,quotedMsg('cmdimg',node||{imageMessage:{mimetype:'image/png'}},text));
  globalThis.__MOCK_MEDIA_BUFFER=png;
  let n=sent.length; await cmd('.s circle | CmdPack | CmdAutor');
  assert.equal(W.readStickerExif(lastSticker().sticker).pack,'CmdPack');
  n=sent.length; await cmd('.sticker pack Padrao | Dono');
  assert.match(sent.at(-1).content.text,/Padrao/);
  await cmd('.fig'); assert.equal(W.readStickerExif(lastSticker().sticker).pack,'Padrao');
  await cmd('.sticker auto on'); assert.equal(ST.stickerAutoEnabled(),true); await cmd('.sticker auto off');
  await cmd('.menu figurinha'); assert.match(sent.at(-1).content.text,/STICKER ENGINE/);
  await cmd('.menu'); assert.match(sent.at(-1).content.text,/Figurinhas/);
  await cmd('.s nãoexiste'); assert.match(sent.at(-1).content.text,/❌.*opção desconhecida/);
  await cmd('.sticker off'); await cmd('.s'); assert.match(sent.at(-1).content.text,/bloqueada/); await cmd('.sticker on');
  await cmd('.doctor'); assert.match(sent.at(-1).content.text,/WebP ✅/);
  globalThis.__MOCK_MEDIA_BUFFER=animSticker.sticker;
  n=sent.length; await cmd('.toimg',{stickerMessage:{mimetype:'image/webp',isAnimated:true}}); assert.ok(sent.slice(n).some(x=>x.content?.image));
  n=sent.length; await cmd('.take A | B',{stickerMessage:{mimetype:'image/webp',isAnimated:true}}); assert.equal(W.readStickerExif(lastSticker().sticker).author,'B');
}

// ───────── Interface da Visualização única / privacidade ─────────
{
  const { viewOncePanel,listCaptures,sendCapture,captureCard,sniffMedia }=await import('../src/modules/viewonce.js');
  const { handleCommand }=await import('../src/core/commands.js');
  const { CONFIG }=await import('../src/core/config.js');
  assert.equal(CONFIG.BRAND,'by 𝖒𝖔𝖓𝖙𝖝2_');
  // cartão da captura: limpo e sem ruído técnico
  const vm=baseMsg('vo-ui',vo('imageMessage'),false,'5511955555555@s.whatsapp.net'); globalThis.__MOCK_MEDIA_BUFFER=png; archiveIncoming(vm);
  let n=sent.length; assert.equal(await captureViewOnce(sock,vm),true);
  const cap=sent.slice(n).find(x=>x.content?.image).content.caption;
  assert.match(cap,/VISUALIZAÇÃO ÚNICA/); assert.ok(cap.includes('by 𝖒𝖔𝖓𝖙𝖝2_')); assert.match(cap,/📷 Foto/); assert.doesNotMatch(cap,/⚡|🆔/);
  assert.match(viewOncePanel(),/Capturas: \*\d+\*/);
  assert.match(listCaptures(5),/CAPTURAS/);
  const row=DB.listMediaByKind('view-once',1)[0];
  n=sent.length; await sendCapture(sock,owner,row.id); assert.ok(sent.slice(n).some(x=>x.content?.image),'.vo get deve reenviar a captura');
  await assert.rejects(()=>sendCapture(sock,owner,999999),/não encontrada/);
  assert.equal(sniffMedia(png).type,'imageMessage');
  const cmd=t=>handleCommand(sock,baseMsg(`vo-cmd-${Math.random()}`,{conversation:t},true,owner));
  await cmd('.vo'); assert.match(sent.at(-1).content.text,/Modo automático/);
  await cmd('.vo list'); assert.match(sent.at(-1).content.text,/CAPTURAS/);
  n=sent.length; await cmd(`.vo get ${row.id}`); assert.ok(sent.slice(n).some(x=>x.content?.image));
  await cmd('.vo get'); assert.match(sent.at(-1).content.text,/❌/);
  await cmd('.vo off'); assert.match(sent.at(-1).content.text,/desligado/); await cmd('.vo on'); assert.match(sent.at(-1).content.text,/ligado/);
  // .Wow (qualquer caixa) recupera a view once citada, igual ao .o
  globalThis.__MOCK_MEDIA_BUFFER=png;
  const wq=baseMsg('vo-wow',vo('imageMessage'),false,'5511944444444@s.whatsapp.net'); archiveIncoming(wq);
  for(const t of ['.Wow','.wow','.WOW']){
    n=sent.length;
    await handleCommand(sock,baseMsg(`wow-${t}`,{extendedTextMessage:{text:t,contextInfo:{stanzaId:'vo-wow',participant:'5511944444444@s.whatsapp.net',quotedMessage:wq.message}}},true,'5511944444444@s.whatsapp.net'));
    assert.ok(sent.slice(n).some(x=>x.jid===owner&&x.content?.image),`${t} deve enviar a captura pro privado`);
  }
  await cmd('.status'); assert.match(sent.at(-1).content.text,/STATUS/);
  ST.resetPack(); assert.equal(ST.getPack(sock).pack,CONFIG.BRAND); assert.equal(ST.getPack(sock).author,'');
}
// legado
for(const [mode,out] of Object.entries({stickerVideo:'out-sticker.webp',gif:'out.mp4',mp3:'out.mp3',ptt:'out.ogg'})){const f=path.join(root,'data',out);await convertMedia(video,f,mode);assert.ok(fs.statSync(f).size>0,`FFmpeg ${mode} não gerou saída`);}

await DB.closeDb();
console.log('🔥 INTEGRAÇÃO MOCK + FFmpeg: TODOS OS TESTES PASSARAM');
