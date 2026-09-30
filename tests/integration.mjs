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
const { createSticker,setStickerEnabled }=await import('../src/modules/stickers.js');
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
const before=sent.length;
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

// Real FFmpeg: image -> sticker and video -> sticker/gif/mp3/ptt.
setStickerEnabled(true);
globalThis.__MOCK_MEDIA_BUFFER=png;
const imgMsg=baseMsg('st-img',{extendedTextMessage:{text:'.sticker',contextInfo:{stanzaId:'img',quotedMessage:{imageMessage:{mimetype:'image/png'}}}}},true);
// createSticker uses quoted node; give it via its own key/message.
imgMsg.message.extendedTextMessage.contextInfo.stanzaId='img';
imgMsg.message.extendedTextMessage.contextInfo.quotedMessage={imageMessage:{mimetype:'image/png'}};
const imgSentBefore=sent.length; await createSticker(sock,imgMsg); assert.ok(sent.slice(imgSentBefore).some(x=>x.content?.sticker?.length),'sticker de imagem não foi gerado');

const video=path.join(root,'data','fixture.mp4');
const made=spawnSync('ffmpeg',['-hide_banner','-loglevel','error','-f','lavfi','-i','testsrc=size=320x240:rate=12','-f','lavfi','-i','sine=frequency=880:sample_rate=8000','-t','1.2','-shortest','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac','-y',video]);
assert.equal(made.status,0,'FFmpeg não conseguiu gerar fixture de vídeo');
const outputs={
  stickerVideo:path.join(root,'data','out-sticker.webp'),
  gif:path.join(root,'data','out.gif'),
  mp3:path.join(root,'data','out.mp3'),
  ptt:path.join(root,'data','out.ogg')
};
for(const [mode,out] of Object.entries({stickerVideo:outputs.stickerVideo,gif:outputs.gif,mp3:outputs.mp3,ptt:outputs.ptt})){await convertMedia(video,out,mode);assert.ok(fs.statSync(out).size>0,`FFmpeg ${mode} não gerou saída`);}

await DB.closeDb();
console.log('🔥 INTEGRAÇÃO MOCK + FFmpeg: TODOS OS TESTES PASSARAM');
