import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { downloadMediaMessage } from '@whiskeysockets/baileys';
import { CONFIG } from '../core/config.js';
import { logger } from '../core/logger.js';
import { saveMedia, mediaForMessage, saveEvent } from '../core/db.js';
import { getMediaNode, resolveViewOnce, senderName, safeFileName, chatLabel } from '../core/format.js';
import { sha256, extFromMime } from '../core/media.js';
import { secureFile, openSecureFile } from '../core/security.js';
import { isFeatureOn } from '../core/features.js';

const MEDIA=new Set(['imageMessage','videoMessage','audioMessage','documentMessage','stickerMessage']);
const done=new Set();
const cleanKey=(msg)=>`${msg?.key?.remoteJid||''}::${msg?.key?.id||''}`;

export async function archiveMedia(sock,msg,{kind='media',force=false}={}){
  if(!isFeatureOn('media')&&!force)return null;
  if(!msg?.message||!msg.key?.remoteJid||!msg.key?.id)return null;
  if(msg.key.remoteJid==='status@broadcast')return null;
  const resolved=resolveViewOnce(msg.message); if(!force && resolved.wasViewOnce)return null;
  const media=getMediaNode(msg.message); if(!media?.type||!MEDIA.has(media.type))return null;
  const ck=`${kind}::${cleanKey(msg)}`; if(done.has(ck))return null; done.add(ck); if(done.size>30000)done.delete(done.values().next().value);
  try{
    const buffer=await downloadMediaMessage(msg,'buffer',{}, {logger,reuploadRequest:sock.updateMediaMessage});
    if(!buffer?.length||buffer.length>CONFIG.MAX_MEDIA_MB*1024*1024) return null;
    const date=new Intl.DateTimeFormat('en-CA',{timeZone:CONFIG.TZ}).format(new Date());
    const chat=safeFileName(chatLabel(msg),'chat'); const sender=safeFileName(senderName(msg),'sender');
    const dir=path.join(CONFIG.MEDIA_DIR,date); await mkdir(dir,{recursive:true});
    const hash=sha256(buffer); const ext=extFromMime(media.node?.mimetype,media.type==='stickerMessage'?'webp':'bin');
    const plain=path.join(CONFIG.TMP_DIR,`${hash}.${ext}`);const enc=path.join(dir,`${Date.now()}-${sender}-${hash}.${ext}.bzs`);
    await mkdir(CONFIG.TMP_DIR,{recursive:true});await writeFile(plain,buffer);await secureFile(plain,enc);try{await (await import('node:fs/promises')).unlink(plain);}catch{}
    const id=saveMedia({remoteJid:msg.key.remoteJid,messageId:msg.key.id,kind,filePath:enc,sha256:hash,bytes:buffer.length,encrypted:true}).lastInsertRowid;
    saveEvent({kind:'media.archived',remoteJid:msg.key.remoteJid,refId:msg.key.id,data:{kind,mediaType:media.type,archiveId:Number(id),bytes:buffer.length}});
    return {id,buffer,file:enc,mediaType:media.type,node:media.node,hash};
  }catch(e){logger.debug({err:e.message,id:msg.key.id},'media archive failed');return null;}
}

export async function recoverArchivedMedia(jid,id){
  for(const row of mediaForMessage(jid,id)){
    try{return {row,buffer:await openSecureFile(row.file_path)};}catch{}
  }
  return null;
}
export function clearMediaCache(){done.clear();}
