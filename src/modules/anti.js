import { downloadMediaMessage } from '@whiskeysockets/baileys';
import { getStoredMessage, markDeleted, markEdited, getStoredEnvelope, listEdits, saveEvent } from '../core/db.js';
import { extractText, getMediaNode, resolveViewOnce, senderName, chatLabel, formatDate, getContext, truncate, card, chatKind } from '../core/format.js';
import { ownerJid } from '../core/identity.js';
import { recoverArchivedMedia } from './mediaVault.js';
import { logger } from '../core/logger.js';
import { isFeatureOn } from '../core/features.js';

function editInfo(msg,update={}){
  const p=msg?.message?.protocolMessage||update?.message?.protocolMessage;
  if(p&&(Number(p.type)===14||p.type==='MESSAGE_EDIT'||p.editedMessage)) return {id:p.key?.id||msg?.key?.id,jid:p.key?.remoteJid||msg?.key?.remoteJid,newMessage:p.editedMessage?.message||p.editedMessage||update?.message};
  if(msg?.message?.editedMessage){const e=msg.message.editedMessage;return {id:e.protocolMessage?.key?.id||msg.key.id,jid:e.protocolMessage?.key?.remoteJid||msg.key.remoteJid,newMessage:e.message||e};}
  return null;
}
export async function handleMessageUpdate(sock,key,update,config){
  const p=update?.message?.protocolMessage; const revoke=p&&(Number(p.type)===0||p.type==='REVOKE'||p.type==='MESSAGE_REVOKE');
  if(revoke&&isFeatureOn('antidelete')){return handleDelete(sock,{key,message:{protocolMessage:p},messageTimestamp:Date.now()},config);}
  const ei=editInfo({key,message:update?.message},update); if(ei&&isFeatureOn('antiedit'))return handleEdit(sock,{key,message:update?.message,messageTimestamp:Date.now()},config,ei);
  return false;
}
export async function handleDelete(sock,msg,config){if(!isFeatureOn('antidelete'))return false;
  const p=msg?.message?.protocolMessage; const id=p?.key?.id||msg.key?.id; const jid=p?.key?.remoteJid||msg.key?.remoteJid; if(!id||!jid)return false; markDeleted(jid,id,Date.now()); saveEvent({kind:'message.deleted',remoteJid:jid,refId:id,data:{}});
  const original=getStoredMessage({remoteJid:jid,id}); if(!original)return false;
  const stored= getStoredEnvelope(jid,id); if(stored?.from_me) return true;
  const owner=ownerJid(sock); const label=senderName({key:msg.key,pushName:undefined}); const env=getStoredEnvelope(jid,id); const text=extractText(original); let archived=null; const who=env?.sender_name||label; const rows=[`👤 ${who}`,`💬 ${chatKind(jid)} · ${chatLabel({key:{remoteJid:jid}})}`,`🕒 ${formatDate(env?.ts||Date.now())}`]; const header=card('🗑️ *MENSAGEM APAGADA*',rows);
  const media=getMediaNode(original);
  if(media?.type){
    archived=await recoverArchivedMedia(jid,id); let buffer=archived?.buffer;
    if(!buffer){try{buffer=await downloadMediaMessage({key:{remoteJid:jid,id,fromMe:!!env?.from_me},message:original},'buffer',{}, {logger,reuploadRequest:sock.updateMediaMessage});}catch{}}
    if(buffer?.length){
      if(media.type==='imageMessage')await sock.sendMessage(owner,{image:buffer,caption:header});
      else if(media.type==='videoMessage')await sock.sendMessage(owner,{video:buffer,caption:header});
      else if(media.type==='audioMessage'){await sock.sendMessage(owner,{audio:buffer,mimetype:media.node?.mimetype||'audio/ogg; codecs=opus',ptt:media.node?.ptt===true});await sock.sendMessage(owner,{text:header});}
      else if(media.type==='stickerMessage'){await sock.sendMessage(owner,{sticker:buffer});await sock.sendMessage(owner,{text:header});}
      else await sock.sendMessage(owner,{document:buffer,fileName:media.node?.fileName||`deleted-${id}.bin`,mimetype:media.node?.mimetype||'application/octet-stream',caption:header});
      return true;
    }
  }
  await sock.sendMessage(owner,{text:card('🗑️ *MENSAGEM APAGADA*',rows,{body:`${text?`“${truncate(text,1500)}”`:'[conteúdo de mídia não recuperável]'}${media?.type&&!archived?'\n\n⚠️ O arquivo não estava no arquivo local.':''}`})}); return true;
}
export async function handleEdit(sock,msg,config,preResolved=null){if(!isFeatureOn('antiedit'))return false;
  const info=preResolved||editInfo(msg); if(!info?.id||!info?.jid)return false;
  const env=getStoredEnvelope(info.jid,info.id); if(env?.from_me) return true;
  const old= getStoredMessage({remoteJid:info.jid,id:info.id}); const oldText=extractText(old); const newText=extractText(info.newMessage); markEdited(info.jid,info.id,oldText,newText,Date.now()); saveEvent({kind:'message.edited',remoteJid:info.jid,refId:info.id,data:{oldText,newText}});
  if(!config.ANTI_EDIT)return true; const owner=ownerJid(sock);
  await sock.sendMessage(owner,{text:card('✏️ *MENSAGEM EDITADA*',[`👤 ${env?.sender_name||info.jid.split('@')[0]}`,`💬 ${chatKind(info.jid)} · ${chatLabel({key:{remoteJid:info.jid}})}`,`🕒 ${formatDate(Date.now())}`],{body:`*Antes*\n${truncate(oldText||'[sem texto]',700)}\n\n*Depois*\n${truncate(newText||'[sem texto]',700)}`})}).catch(()=>{});
  return true;
}
export function editsFor(jid,id){return listEdits(jid,id,50);}
