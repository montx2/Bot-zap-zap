import { saveMessage, saveLink, saveEvent } from '../core/db.js';
import { extractText, getContext, getMediaNode, getMessageType, resolveViewOnce, tsMs } from '../core/format.js';

const URL_RE=/https?:\/\/[^\s<>]+/gi;
export function normalizeMessage(msg){
  const media=getMediaNode(msg?.message); const ctx=getContext(msg?.message); const vo=resolveViewOnce(msg?.message);
  return {ts:tsMs(msg.messageTimestamp),type:getMessageType(msg?.message),text:extractText(msg?.message),mime:media?.node?.mimetype||null,fileName:media?.node?.fileName||null,quotedId:ctx.stanzaId||null,viewOnce:vo.wasViewOnce};
}
export function archiveIncoming(msg){
  const n=normalizeMessage(msg); saveMessage(msg,n);
  for(const url of String(n.text||'').match(URL_RE)||[]){saveLink({remoteJid:msg.key.remoteJid,messageId:msg.key.id,url,ts:n.ts});}
  saveEvent({kind:n.viewOnce?'message.view_once':'message.upsert',remoteJid:msg.key.remoteJid,refId:msg.key.id,data:{type:n.type,hasText:!!n.text,fromMe:!!msg.key.fromMe},ts:n.ts});
  return n;
}
