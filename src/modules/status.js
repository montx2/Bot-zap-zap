import { downloadMediaMessage } from '@whiskeysockets/baileys';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { CONFIG } from '../core/config.js';
import { logger } from '../core/logger.js';
import { isFeatureOn } from '../core/features.js';
import { ownerJid } from '../core/identity.js';
import { senderName, formatDate, MEDIA_LABEL } from '../core/format.js';
import { secureFile } from '../core/security.js';
import { sha256 } from '../core/media.js';
import { saveMedia, saveEvent } from '../core/db.js';
import { watched } from './watch.js';

const seen=new Set();
export async function handleStatus(sock,msg){
  if(!isFeatureOn('status')||msg?.key?.remoteJid!=='status@broadcast'||!msg.message)return;
  const participant=msg.key.participant||msg.key.participantAlt;if(!participant)return;if(CONFIG.STATUS_ONLY_WATCH&&!watched(participant))return;
  const k=`${msg.key.id}::${participant}`;if(seen.has(k))return;seen.add(k);
  const type=['imageMessage','videoMessage','audioMessage'].find(t=>msg.message[t]);
  const owner=ownerJid(sock), name=senderName(msg);
  if(!type){const text=msg.message.conversation||msg.message.extendedTextMessage?.text;if(text)await sock.sendMessage(owner,{text:`📸 *STATUS*\n👤 ${name}\n🕒 ${formatDate(msg.messageTimestamp)}\n\n${text}`});return;}
  try{
    const buffer=await downloadMediaMessage(msg,'buffer',{}, {logger,reuploadRequest:sock.updateMediaMessage});if(!buffer?.length)return;
    const date=new Intl.DateTimeFormat('en-CA',{timeZone:CONFIG.TZ}).format(new Date());const dir=path.join(CONFIG.STATUS_DIR,date);await mkdir(dir,{recursive:true});const plain=path.join(CONFIG.TMP_DIR,`${sha256(buffer)}.tmp`);const enc=path.join(dir,`${Date.now()}-${sha256(buffer)}.bzs`);await writeFile(plain,buffer);await secureFile(plain,enc);try{await (await import('node:fs/promises')).unlink(plain);}catch{}
    saveMedia({remoteJid:'status@broadcast',messageId:msg.key.id,kind:'status',filePath:enc,sha256:sha256(buffer),bytes:buffer.length,encrypted:true});saveEvent({kind:'status.saved',remoteJid:participant,refId:msg.key.id,data:{type,bytes:buffer.length}});
    if(type==='imageMessage')await sock.sendMessage(owner,{image:buffer,caption:`📸 *STATUS SALVO*\n👤 ${name}\n🕒 ${formatDate(msg.messageTimestamp)}\n📦 ${MEDIA_LABEL[type]}`});
    else if(type==='videoMessage')await sock.sendMessage(owner,{video:buffer,caption:`📸 *STATUS SALVO*\n👤 ${name}\n🕒 ${formatDate(msg.messageTimestamp)}\n📦 ${MEDIA_LABEL[type]}`});
    else{await sock.sendMessage(owner,{audio:buffer,mimetype:msg.message[type].mimetype||'audio/ogg; codecs=opus',ptt:msg.message[type].ptt===true});await sock.sendMessage(owner,{text:`📸 *STATUS SALVO*\n👤 ${name}\n🕒 ${formatDate(msg.messageTimestamp)}`});}
  }catch(e){saveEvent({kind:'status.failed',remoteJid:participant,refId:msg.key.id,data:{error:e.message}});}
}
