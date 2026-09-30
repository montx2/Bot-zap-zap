import { downloadMediaMessage, downloadContentFromMessage, extractMessageContent } from '@whiskeysockets/baileys';
import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { CONFIG } from '../core/config.js';
import { logger } from '../core/logger.js';
import { ownerJid } from '../core/identity.js';
import { getStoredMessage, saveMedia, saveEvent, dbGet, dbSet, mediaForMessageKind } from '../core/db.js';
import { SerialQueues } from '../core/queue.js';
import { resolveViewOnce, extractText, senderName, chatLabel, formatDate, MEDIA_LABEL, tsMs } from '../core/format.js';
import { sha256 } from '../core/media.js';
import { secureFile } from '../core/security.js';

const MEDIA = new Set(['imageMessage','videoMessage','audioMessage']);
const ALL_MEDIA = new Set(['imageMessage','videoMessage','audioMessage','documentMessage','stickerMessage']);
const queues = new SerialQueues();
const inFlight = new Set();
const completed = new Map();
const pending = new Map();

function plainKey(key){
  if(!key)return null;
  try{
    if(Buffer.isBuffer(key))return key.length?key:null;
    if(key instanceof Uint8Array)return key.length?Buffer.from(key):null;
    if(typeof key==='string'){const b=Buffer.from(key,'base64');return b.length?b:null;}
    if(key?.type==='Buffer'&&Array.isArray(key.data)){const b=Buffer.from(key.data);return b.length?b:null;}
    if(Array.isArray(key)){const b=Buffer.from(key);return b.length?b:null;}
  }catch{}
  return null;
}
function normalizeNode(node){const n=node?{...node}:null;if(n?.mediaKey){const k=plainKey(n.mediaKey);if(k)n.mediaKey=k;}return n;}
async function toBuffer(stream){const chunks=[];for await(const c of stream)chunks.push(Buffer.from(c));return Buffer.concat(chunks);}
function ctype(type){return String(type||'').replace(/Message$/,'');}
function keyOf(msg){return `${msg?.key?.remoteJid||''}::${msg?.key?.id||''}`;}
function extension(type,node){const mime=String(node?.mimetype||'').toLowerCase();if(type==='imageMessage')return mime.includes('png')?'png':'jpg';if(type==='videoMessage')return 'mp4';if(type==='audioMessage')return mime.includes('mpeg')?'mp3': 'ogg';return 'bin';}

async function downloadStrategies(sock,msg,resolved){
  const node=normalizeNode(resolved.mediaNode); const errors=[];
  const strategies=[
    async()=>downloadMediaMessage({key:msg.key,message:{[resolved.mediaType]:node}},'buffer',{}, {logger,reuploadRequest:sock.updateMediaMessage}),
    async()=>downloadMediaMessage(msg,'buffer',{}, {logger,reuploadRequest:sock.updateMediaMessage}),
    async()=>{
      const key=plainKey(node?.mediaKey); if(!key||!(node?.directPath||node?.url))throw new Error('mediaKey/directPath ausente');
      return toBuffer(await downloadContentFromMessage({mediaKey:key,directPath:node.directPath,url:node.url},ctype(resolved.mediaType)));
    },
    async()=>{
      if(typeof sock.updateMediaMessage!=='function')throw new Error('updateMediaMessage indisponível');
      const refreshed=await sock.updateMediaMessage(msg); if(!refreshed?.message)throw new Error('reupload vazio');
      const r=resolveViewOnce(refreshed.message); if(!r.mediaNode)throw new Error('reupload sem mídia');
      return downloadMediaMessage({key:refreshed.key||msg.key,message:r.contentMessage},'buffer',{}, {logger,reuploadRequest:sock.updateMediaMessage});
    },
    async()=>{
      if(typeof sock.requestPlaceholderResend!=='function')throw new Error('placeholder resend indisponível');
      await sock.requestPlaceholderResend(msg.key).catch(()=>{}); await sleep(900);
      return downloadMediaMessage(msg,'buffer',{}, {logger,reuploadRequest:sock.updateMediaMessage});
    },
    async()=>{
      await sock.sendPresenceUpdate?.('available').catch(()=>{});
      await sock.requestPlaceholderResend?.(msg.key).catch(()=>{}); await sleep(600);
      await sock.requestPlaceholderResend?.(msg.key).catch(()=>{}); await sleep(1600);
      return downloadMediaMessage(msg,'buffer',{}, {logger,reuploadRequest:sock.updateMediaMessage});
    },
    async()=>{
      if(typeof sock.updateMediaMessage!=='function')throw new Error('updateMediaMessage indisponível');
      const refreshed=await sock.updateMediaMessage(msg); if(!refreshed?.message)throw new Error('refresh vazio');
      const r=resolveViewOnce(refreshed.message); const n=normalizeNode(r.mediaNode); const key=plainKey(n?.mediaKey);
      if(!r.mediaType||!key||!(n?.directPath||n?.url))throw new Error('combo sem dados');
      return toBuffer(await downloadContentFromMessage({mediaKey:key,directPath:n.directPath,url:n.url},ctype(r.mediaType)));
    }
  ];
  const labels=['clean','original','direct','reupload','resend','force-resend','combo'];
  for(let i=0;i<strategies.length;i++){
    try{const b=await strategies[i]();if(b?.length)return {buffer:b,via:labels[i]};}
    catch(e){errors.push(`${labels[i]}:${String(e?.message||e).slice(0,140)}`);}
  }
  const err=new Error(errors.join(' | ')||'download falhou');err.code='VIEW_ONCE_DOWNLOAD_FAILED';throw err;
}

async function storeCapture(msg,resolved,buffer){
  const date=new Intl.DateTimeFormat('en-CA',{timeZone:CONFIG.TZ}).format(new Date());
  const who=String(msg.key.remoteJid||'chat').replace(/[^a-zA-Z0-9_-]/g,'_');
  const dir=path.join(CONFIG.VIEW_ONCE_DIR,date,who); await mkdir(dir,{recursive:true});
  const id=sha256(Buffer.concat([buffer,Buffer.from(msg.key.id||'')]));
  const plaintext=path.join(CONFIG.TMP_DIR,`vo-${id}.${extension(resolved.mediaType,resolved.mediaNode)}`); const encrypted=path.join(dir,`${new Date(tsMs(msg.messageTimestamp)).toISOString().replace(/[:.]/g,'-')}-${id}.bzs`);
  await mkdir(CONFIG.TMP_DIR,{recursive:true}); await writeFile(plaintext,buffer); await secureFile(plaintext,encrypted); try{await fsUnlink(plaintext);}catch{}
  const dbId=saveMedia({remoteJid:msg.key.remoteJid,messageId:msg.key.id,kind:'view-once',filePath:encrypted,sha256:sha256(buffer),bytes:buffer.length,encrypted:true}).lastInsertRowid;
  return {dbId,file:encrypted,sha256:sha256(buffer)};
}
async function fsUnlink(file){const {unlink}=await import('node:fs/promises');await unlink(file);}
async function forwardOwner(sock,msg,resolved,buffer,via,record){
  const owner=ownerJid(sock); const node=resolved.mediaNode||{}; const sender=senderName(msg); const label=chatLabel(msg); const meta=`👁️ *VIEW ONCE CAPTURADA*\n👤 ${sender}\n💬 ${label}\n🕒 ${formatDate(msg.messageTimestamp)}\n📦 ${MEDIA_LABEL[resolved.mediaType]||resolved.mediaType}\n⚡ ${via}\n🆔 ${record.dbId}`;
  if(resolved.mediaType==='imageMessage')return sock.sendMessage(owner,{image:buffer,caption:`${meta}${node.caption?`\n\n📝 ${node.caption}`:''}`});
  if(resolved.mediaType==='videoMessage')return sock.sendMessage(owner,{video:buffer,caption:`${meta}${node.caption?`\n\n📝 ${node.caption}`:''}`});
  if(resolved.mediaType==='audioMessage'){await sock.sendMessage(owner,{audio:buffer,mimetype:node.mimetype||'audio/ogg; codecs=opus',ptt:node.ptt===true});return sock.sendMessage(owner,{text:meta});}
  if(resolved.mediaType==='stickerMessage'){await sock.sendMessage(owner,{sticker:buffer});return sock.sendMessage(owner,{text:meta});}
  return sock.sendMessage(owner,{document:buffer,fileName:node.fileName||`view-once-${record.dbId}.bin`,mimetype:node.mimetype||'application/octet-stream',caption:meta});
}

function enabled(){const v=dbGet('feature.viewonce');return v==null?CONFIG.VIEW_ONCE_AUTO:v==='1';}
export const viewOnceEnabled=enabled;
export const setViewOnceEnabled=on=>dbSet('feature.viewonce',on?'1':'0');

export async function captureViewOnce(sock,msg,{manual=false}={}){
  if(!msg?.message||!msg.key?.remoteJid||!msg.key?.id)return null;
  if(!manual&&!enabled())return null;
  if(!manual&&msg.key.fromMe)return null;
  const key=keyOf(msg); if(completed.has(key)||inFlight.has(key))return false; inFlight.add(key);
  return queues.run(msg.key.remoteJid,async()=>{
    try{
      const archived=mediaForMessageKind(msg.key.remoteJid,msg.key.id,'view-once');
      if(archived?.file_path && existsSync(archived.file_path)){
        try{
          const {openSecureFile}=await import('../core/security.js');
          const cached=await openSecureFile(archived.file_path);
          await forwardOwner(sock,msg,resolveViewOnce(msg.message),cached,'archive-replay',{dbId:archived.id});
          completed.set(key,Date.now());
          return true;
        }catch(e){logger.debug({err:e.message,id:msg.key.id},'view-once archive replay failed; continuing download');}
      }
      let current={...msg}; let resolved=resolveViewOnce(current.message);
      if(!resolved.wasViewOnce&&!manual)return null;
      for(let round=1;round<=3;round++){
        try{
          if(!resolved.mediaNode){const stored=getStoredMessage(current.key);if(stored){const s=resolveViewOnce(stored);if(s.mediaNode){current={...current,message:stored};resolved=s;}}}
          if(resolved.mediaType&&ALL_MEDIA.has(resolved.mediaType)){
            const result=await downloadStrategies(sock,current,resolved); if(result.buffer.length>CONFIG.MAX_MEDIA_MB*1024*1024)throw new Error('mídia excede limite configurado');
            const record=await storeCapture(current,resolved,result.buffer); await forwardOwner(sock,current,resolved,result.buffer,result.via,record);
            completed.set(key,Date.now()); if(completed.size>20000)completed.delete(completed.keys().next().value);
            saveEvent({kind:'viewonce.captured',remoteJid:current.key.remoteJid,refId:current.key.id,data:{mediaType:resolved.mediaType,bytes:result.buffer.length,via:result.via,archiveId:Number(record.dbId)}});
            return true;
          }
          if(typeof sock.updateMediaMessage==='function'){
            const refreshed=await sock.updateMediaMessage(current).catch(()=>null); if(refreshed?.message){current=refreshed;resolved=resolveViewOnce(refreshed.message);if(resolved.mediaNode)continue;}
          }
        }catch(e){if(round===3){saveEvent({kind:'viewonce.failed',remoteJid:key.split('::')[0],refId:key.split('::')[1],data:{error:String(e?.message||e)}});logger.warn({err:String(e?.message||e),id:current.key.id},'view-once: todas as estratégias falharam');}}
        if(round<3){await sock.sendPresenceUpdate?.('available').catch(()=>{});await sock.requestPlaceholderResend?.(current.key).catch(()=>{});await sleep(round*1000);}
      }
      return false;
    }finally{inFlight.delete(key);}
  });
}

export function scheduleViewOnceRetry(sock,msg){
  const key=keyOf(msg);if(!key||pending.has(key))return;
  const entry={tries:0,timer:null};pending.set(key,entry);
  const tick=async()=>{const p=pending.get(key);if(!p)return;p.tries++;const ok=await captureViewOnce(sock,msg).catch(()=>false);if(ok===true||p.tries>=CONFIG.VIEW_ONCE_RETRIES){pending.delete(key);return;}await sock.requestPlaceholderResend?.(msg.key).catch(()=>{});p.timer=setTimeout(tick,p.tries<=6?500:2500);p.timer.unref?.();};
  entry.timer=setTimeout(tick,180);entry.timer.unref?.();
}

export async function captureQuotedViewOnce(sock,msg){
  const ctx=msg?.message?.extendedTextMessage?.contextInfo || msg?.message?.imageMessage?.contextInfo || msg?.message?.videoMessage?.contextInfo || {};
  if(!ctx?.quotedMessage||!ctx?.stanzaId)return false;
  const fake={key:{remoteJid:msg.key.remoteJid,id:ctx.stanzaId,participant:ctx.participant,fromMe:!!ctx.fromMe},message:ctx.quotedMessage,messageTimestamp:msg.messageTimestamp,pushName:msg.pushName};
  return !!(await captureViewOnce(sock,fake,{manual:true}));
}
function sleep(ms){return new Promise(r=>setTimeout(r,ms));}
