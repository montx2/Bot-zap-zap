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
function runFfmpegOut(args){ const r=spawnSync('ffmpeg',['-hide_banner','-loglevel','error',...args],{stdio:'ignore'}); if(r.status!==0) throw new Error('fixture falhou: '+args.join(' ')); return fs.readFileSync(args[args.length-1]); }

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
  // padrão: imagem INTEIRA, sem cortar nada (só dimensiona para caber no quadrado)
  assert.equal(ST.parseStickerArgs('').opts.fit,'fit');
  assert.equal(ST.defaultOptions().fit,'fit');
  assert.match(ST.buildFilter(ST.defaultOptions()),/force_original_aspect_ratio=decrease/);
  assert.match(ST.buildFilter(ST.defaultOptions()),/pad=512:512/);
  assert.ok(!ST.buildFilter(ST.defaultOptions()).includes('crop=512:512'),'padrão não pode cortar a imagem');
  assert.match(ST.buildFilter(ST.defaultOptions(),{animated:true}),/^fps=/);
  // "preencher" (quadrado cheio, cortando o excesso) segue disponível por escolha explícita
  assert.equal(ST.parseStickerArgs('preencher').opts.fit,'crop');
  assert.match(ST.buildFilter(ST.parseStickerArgs('preencher').opts),/crop=512:512/);
  assert.equal(ST.parseStickerArgs('inteira').opts.fit,'fit');
  assert.match(ST.buildFilter(ST.parseStickerArgs('inteira').opts),/pad=512:512/);
  // plano B de filtros: build limitado recebe versão simplificada em vez de erro
  assert.ok(ST.filterVariants(ST.parseStickerArgs('circle blur').opts).length>1,'faltou plano B de filtro');
  assert.equal(ST.filterVariants(ST.defaultOptions()).length,1,'padrão não precisa de plano B');
  const fb=ST.filterVariants(ST.parseStickerArgs('circle blur').opts);
  assert.ok(!fb.at(-1).includes('geq')&&!fb.at(-1).includes('gblur'),'último recurso deveria ser simples');
  // guia simples: explica cada coisa, sem jargão técnico
  const help=ST.stickerHelp(sock);
  for(const trecho of ['COMO CRIAR','imagem inteira','MUDAR O FORMATO','EFEITOS','VÍDEO E GIF','SEU NOME NA FIGURINHA','OUTRAS FERRAMENTAS','.s inteira','.s circulo','.s leve','.take','.sticker auto on'])
    assert.ok(help.includes(trecho),`guia sem "${trecho}"`);
  assert.ok(!help.includes('EXIF')&&!help.includes('hq / lq'),'guia ainda tem jargão');
}

// ── default .s puro NÃO corta: mostra a imagem inteira em TODO tipo de mídia ──
{
  // mídia NÃO quadrada: 320×120 com a metade esquerda vermelha e a direita azul
  // (assim dá pra provar que nenhum lado foi cortado).
  const wide=path.join(root,'data','split.png');
  spawnSync('ffmpeg',['-hide_banner','-loglevel','error','-f','lavfi','-i','color=c=red:s=160x120','-f','lavfi','-i','color=c=blue:s=160x120',
    '-filter_complex','[0:v][1:v]hstack,format=rgba','-frames:v','1','-y',wide]);
  const split=fs.readFileSync(wide);
  const opaque = await runFfmpegOut(['-f','lavfi','-i','color=c=red:s=320x120','-frames:v','1','-y',path.join(root,'data','wide.png')]);
  const wideMp4=path.join(root,'data','split.mp4');
  spawnSync('ffmpeg',['-hide_banner','-loglevel','error','-f','lavfi','-i','color=c=red:s=160x120:d=1:r=12','-f','lavfi','-i','color=c=blue:s=160x120:d=1:r=12',
    '-filter_complex','[0:v][1:v]hstack','-c:v','libx264','-pix_fmt','yuv444p','-t','1','-y',wideMp4]);
  // pixel (x,y) da figurinha gerada
  const px=(webp,x,y)=>{ const p=path.join(root,'data','c.png');
    spawnSync('ffmpeg',['-hide_banner','-loglevel','error','-f','webp_pipe','-i','pipe:0','-frames:v','1','-y',p],{input:webp,stdio:['pipe','ignore','ignore']});
    return [...spawnSync('ffmpeg',['-hide_banner','-loglevel','error','-i',p,'-vf',`crop=1:1:${x}:${y},format=rgba`,'-frames:v','1','-f','rawvideo','pipe:1'],{encoding:'buffer'}).stdout.slice(0,4)]; };
  const vermelho=(c)=>c.length===4&&c[3]>200&&c[0]>150&&c[1]<110&&c[2]<110;
  const azul=(c)=>c.length===4&&c[3]>200&&c[2]>150&&c[0]<110&&c[1]<110;
  const vazio=(c)=>c.length===4&&c[3]<10;
  // 320×120 vira 512×192 no meio do quadrado: sobra faixa transparente em cima e embaixo
  for(const [nome,src,buf] of [
    ['imagem', {kind:'image',mime:'image/png'}, split],
    ['documento', {kind:'image',mime:'image/png'}, split],
  ]){
    const r=await ST.buildSticker(buf,src,{opts:ST.defaultOptions(),pack:'P',author:'A',emojis:[]});
    const info=W.parseWebp(r.webp);
    assert.equal(info.width,512,`${nome}: largura`); assert.equal(info.height,512,`${nome}: altura`);
    assert.ok(vazio(px(r.webp,0,0)),`${nome}: .s puro deveria deixar faixa transparente em cima`);
    assert.ok(vazio(px(r.webp,511,511)),`${nome}: .s puro deveria deixar faixa transparente embaixo`);
    assert.ok(vermelho(px(r.webp,128,256)),`${nome}: metade vermelha sumiu — cortou a imagem`);
    assert.ok(azul(px(r.webp,384,256)),`${nome}: metade azul sumiu — cortou a imagem`);
  }
  // vídeo/GIF: mesmo acordo, nada de cortar
  {
    const r=await ST.buildSticker(fs.readFileSync(wideMp4),{kind:'video',mime:'video/mp4'},{opts:ST.defaultOptions(),pack:'P',author:'A',emojis:[]});
    assert.ok(vazio(px(r.webp,0,0)),'vídeo: .s puro deveria deixar faixa transparente');
    assert.ok(vermelho(px(r.webp,128,256)),'vídeo: metade vermelha sumiu — cortou a imagem');
    assert.ok(azul(px(r.webp,384,256)),'vídeo: metade azul sumiu — cortou a imagem');
  }
  // figurinha antiga com faixa transparente → .s puro PRESERVA a faixa (não corta)
  const pad=path.join(root,'data','padded.webp');
  spawnSync('ffmpeg',['-hide_banner','-loglevel','error','-i',path.join(root,'data','wide.png'),'-vf',
    'scale=512:512:force_original_aspect_ratio=decrease:flags=lanczos,format=rgba,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=0x00000000',
    '-c:v','libwebp','-q:v','80','-frames:v','1','-y',pad]);
  const padded=fs.readFileSync(pad);
  assert.ok(W.parseWebp(padded).hasAlpha,'fixture padded deveria ter alpha');
  assert.ok(vazio(px(padded,0,0)),'fixture padded deveria ter borda transparente');
  const kept=await ST.buildSticker(padded,{kind:'sticker',mime:'image/webp'},{opts:ST.parseStickerArgs('').opts,pack:'P',author:'A',emojis:[]});
  assert.equal(kept.retagged,false,'figurinha com faixa não pode ir pelo atalho instantâneo');
  assert.ok(vazio(px(kept.webp,0,0)),'.s puro deveria preservar a borda transparente');
  assert.ok(vermelho(px(kept.webp,128,256)),'.s puro deveria manter a figurinha inteira');
  // ...mas quem pede "preencher" quer o quadrado cheio (aí sim corta o excesso)
  const filled=await ST.buildSticker(padded,{kind:'sticker',mime:'image/webp'},{opts:ST.parseStickerArgs('preencher').opts,pack:'P',author:'A',emojis:[]});
  assert.equal(filled.retagged,false,'preencher precisa re-encode');
  assert.ok(!vazio(px(filled.webp,0,0)),'.s preencher deveria preencher a figurinha com faixa');
  // figurinha que já preenche → atalho instantâneo (sem re-encode)
  const solid=await ST.buildSticker(png,{kind:'image',mime:'image/png'},{opts:ST.defaultOptions(),pack:'P',author:'A',emojis:[]});
  const again=await ST.buildSticker(solid.webp,{kind:'sticker',mime:'image/webp'},{opts:ST.parseStickerArgs('').opts,pack:'P',author:'A',emojis:[]});
  assert.equal(again.retagged,true,'figurinha já completa deveria ser só retagueada');
  assert.equal(again.attempts,0,'atalho instantâneo não deveria codificar');
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
  await cmd('.menu figurinha'); assert.match(sent.at(-1).content.text,/FIGURINHAS — guia simples/);
  await cmd('.menu'); assert.match(sent.at(-1).content.text,/Figurinhas/);
  // `.sticker` sozinho (sem mídia) abre o guia em vez de errar
  await handleCommand(sock,baseMsg('menustk',{conversation:'.sticker'},true));
  assert.match(sent.at(-1).content.text,/COMO CRIAR/);
  // `.sticker` respondendo mídia continua criando figurinha
  n=sent.length; await cmd('.sticker'); assert.ok(sent.slice(n).some(x=>x.content?.sticker),'.sticker com mídia deveria criar');
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

// ───────── Manutenção / retenção / .env ─────────
{
  const { runMaintenance }=await import('../src/core/maintenance.js');
  const { CONFIG }=await import('../src/core/config.js');
  const { handleCommand }=await import('../src/core/commands.js');
  // mensagem antiga perde o raw_json, mas continua pesquisável; a recente é preservada
  const old=baseMsg('old-raw',{conversation:'mensagem antiga pesquisavel'}); old.messageTimestamp=Math.floor((Date.now()-40*86400e3)/1000); archiveIncoming(old);
  const fresh=baseMsg('fresh-raw',{conversation:'mensagem nova'}); archiveIncoming(fresh);
  // mídia comum antiga é apagada (arquivo + linha); view-once e cofre nunca
  const mk=(name)=>{const f=path.join(root,'storage','media',name);fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f,'x'.repeat(100));return f;};
  const fOld=mk('old.bin'), fNew=mk('new.bin'), fVo=mk('vo.bin');
  DB.saveMedia({remoteJid:'a',messageId:'m-old',kind:'media',filePath:fOld,sha256:'1',bytes:100,createdAt:Date.now()-60*86400e3});
  DB.saveMedia({remoteJid:'a',messageId:'m-new',kind:'media',filePath:fNew,sha256:'2',bytes:100});
  DB.saveMedia({remoteJid:'a',messageId:'m-vo',kind:'view-once',filePath:fVo,sha256:'3',bytes:100,createdAt:Date.now()-400*86400e3});
  const rep=await runMaintenance();
  assert.ok(rep.raw>=1,'raw antigo deve ser compactado'); assert.equal(DB.getStoredMessage({remoteJid:old.key.remoteJid,id:'old-raw'}),null);
  assert.ok(DB.getStoredMessage({remoteJid:fresh.key.remoteJid,id:'fresh-raw'}),'raw recente deve ficar');
  assert.match(find('antiga pesquisavel',10),/antiga/);
  assert.equal(fs.existsSync(fOld),false); assert.equal(fs.existsSync(fNew),true); assert.equal(fs.existsSync(fVo),true,'view-once nunca expira');
  assert.equal(rep.media,1);
  // rotação de log
  fs.mkdirSync(CONFIG.LOG_DIR,{recursive:true}); const lg=path.join(CONFIG.LOG_DIR,'bot.log'); fs.writeFileSync(lg,Buffer.alloc(CONFIG.LOG_MAX_MB*1048576+10));
  assert.equal((await runMaintenance()).log,true); assert.equal(fs.statSync(lg).size,0); assert.ok(fs.existsSync(lg+'.1'));
  const cmd=t=>handleCommand(sock,baseMsg(`m-${Math.random()}`,{conversation:t},true,owner));
  await cmd('.clean'); assert.match(sent.at(-1).content.text,/MANUTENÇÃO/);
  // .env é carregado de verdade
  const envDir=path.join(root,'envtest'); fs.mkdirSync(envDir,{recursive:true}); fs.writeFileSync(path.join(envDir,'.env'),'BOT_BRAND=marca teste\nSTICKER_MAX_SECONDS=7\n');
  const r=spawnSync(process.execPath,['--input-type=module','-e',"const {CONFIG}=await import(process.argv[1]);console.log(CONFIG.BRAND+'|'+CONFIG.STICKER_MAX_SECONDS)",new URL('../src/core/config.js',import.meta.url).href],{env:{...process.env,BOT_ROOT:envDir},encoding:'utf8'});
  assert.equal(r.stdout.trim(),'marca teste|7','.env deve ser lido');
}
// legado
for(const [mode,out] of Object.entries({stickerVideo:'out-sticker.webp',gif:'out.mp4',mp3:'out.mp3',ptt:'out.ogg'})){const f=path.join(root,'data',out);await convertMedia(video,f,mode);assert.ok(fs.statSync(f).size>0,`FFmpeg ${mode} não gerou saída`);}

await DB.closeDb();
console.log('🔥 INTEGRAÇÃO MOCK + FFmpeg: TODOS OS TESTES PASSARAM');
