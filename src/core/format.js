import { jidNormalizedUser } from '@whiskeysockets/baileys';
import { CONFIG } from './config.js';

export const MEDIA_TYPES = ['imageMessage','videoMessage','audioMessage','documentMessage','stickerMessage'];
export const MEDIA_LABEL = {
  imageMessage: 'imagem', videoMessage: 'vídeo', audioMessage: 'áudio',
  documentMessage: 'documento', stickerMessage: 'figurinha'
};
const VO_WRAPPERS = ['viewOnceMessage','viewOnceMessageV2','viewOnceMessageV2Extension'];
const PASS = ['ephemeralMessage','deviceSentMessage','documentWithCaptionMessage','associatedChildMessage','botInvokeMessage','lottieStickerMessage','groupStatusMessage'];

export function tsMs(value) {
  let n = value;
  if (n && typeof n === 'object' && typeof n.toNumber === 'function') n = n.toNumber();
  n = Number(n);
  if (!Number.isFinite(n) || n <= 0) return Date.now();
  return n > 1e12 ? n : n * 1000;
}
export function formatDate(value) { return new Date(tsMs(value)).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo',day:'2-digit',month:'2-digit',year:'2-digit',hour:'2-digit',minute:'2-digit'}); }
export function shortDate(value) { return new Date(tsMs(value)).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}); }
export function formatBytes(n) { n=Number(n)||0; if(n<1024)return `${n} B`; if(n<1048576)return `${(n/1024).toFixed(1)} KB`; if(n<1073741824)return `${(n/1048576).toFixed(1)} MB`; return `${(n/1073741824).toFixed(2)} GB`; }
export function truncate(s,n=300){ const v=String(s??''); return v.length>n?`${v.slice(0,n-1)}…`:v; }
export function normalizeNumber(raw){ return String(raw||'').replace(/\D/g,''); }
export function numberToJid(raw){ const n=normalizeNumber(raw); return n?`${n}@s.whatsapp.net`:null; }
export function isGroupJid(jid){ return String(jid||'').endsWith('@g.us'); }
export function isStatusJid(jid){ return jid==='status@broadcast'; }
export function senderJid(msg){ return msg?.key?.participantAlt || msg?.key?.participant || msg?.key?.remoteJidAlt || msg?.key?.remoteJid || ''; }
export function senderName(msg){ const n=String(msg?.pushName||'').trim(); return n || String(senderJid(msg)).split('@')[0].split(':')[0] || 'desconhecido'; }
export function chatLabel(msg){ const jid=msg?.key?.remoteJid||''; return isGroupJid(jid)?`grupo ${jid.split('@')[0]}`:(jid.split('@')[0]||'chat'); }

export function unwrap(raw){
  let cur=raw, wasViewOnce=false, wrappers=[];
  for(let i=0;i<20&&cur&&typeof cur==='object';i++){
    let key=Object.keys(cur).find(k=>VO_WRAPPERS.includes(k));
    if(key){ wasViewOnce=true; wrappers.push(key); cur=cur[key]?.message; continue; }
    key=Object.keys(cur).find(k=>PASS.includes(k));
    if(key){ wrappers.push(key); cur=cur[key]?.message; continue; }
    break;
  }
  let type = MEDIA_TYPES.find(t=>cur?.[t]) || null;
  if(type && cur[type]?.viewOnce) wasViewOnce=true;
  return { message:cur||null, wasViewOnce, mediaType:type, wrappers };
}

export function deepViewOnce(raw, depth=0, path=[]){
  if(!raw||typeof raw!=='object'||depth>28) return null;
  if(Buffer.isBuffer(raw)||raw instanceof Uint8Array) return null;
  for(const type of MEDIA_TYPES){
    const node=raw[type];
    if(node&&typeof node==='object'){
      const flagged=node.viewOnce===true||node.viewOnceV2===true||node.viewOnceV2Extension===true||path.some(x=>/viewOnce/i.test(x));
      if(flagged) return { mediaType:type, mediaNode:node, contentMessage:{[type]:node}, path:[...path,type] };
    }
  }
  for(const [k,v] of Object.entries(raw)){
    if(!v||typeof v!=='object'||k==='messageContextInfo'||k==='messageSecret') continue;
    if(v.message){ const hit=deepViewOnce(v.message,depth+1,[...path,k]); if(hit)return hit; }
    if(k.endsWith('Message')||VO_WRAPPERS.includes(k)||PASS.includes(k)){ const hit=deepViewOnce(v,depth+1,[...path,k]); if(hit)return hit; }
  }
  return null;
}
export function resolveViewOnce(raw){
  const u=unwrap(raw);
  if(u.wasViewOnce&&u.mediaType) return { ...u, method:'unwrap', contentMessage:{[u.mediaType]:u.message[u.mediaType]}, mediaNode:u.message[u.mediaType] };
  const d=deepViewOnce(raw);
  if(d) return { wasViewOnce:true, method:'deep', ...d };
  return { ...u, method:'soft', mediaNode:u.mediaType?u.message?.[u.mediaType]:null, contentMessage:u.message };
}
export function extractText(raw){
  const u=unwrap(raw); const m=u.message||raw||{};
  return String(m.conversation||m.extendedTextMessage?.text||m.imageMessage?.caption||m.videoMessage?.caption||m.documentMessage?.caption||'').replace(/[\u200B-\u200D\uFEFF\u202A-\u202E]/g,'').trim();
}
export function getContext(raw){ const u=unwrap(raw); const m=u.message||raw||{}; return m.extendedTextMessage?.contextInfo||m.imageMessage?.contextInfo||m.videoMessage?.contextInfo||m.documentMessage?.contextInfo||{}; }
export function getQuoted(msg){ const ctx=getContext(msg?.message); if(!ctx?.quotedMessage||!ctx?.stanzaId)return null; return { key:{remoteJid:msg.key.remoteJid,id:ctx.stanzaId,participant:ctx.participant,fromMe:!!ctx.fromMe}, message:ctx.quotedMessage, messageTimestamp:msg.messageTimestamp, pushName:msg.pushName }; }
export function getMessageType(raw){ const u=unwrap(raw); if(u.mediaType)return u.mediaType; const m=u.message||raw||{}; if(m.conversation||m.extendedTextMessage)return 'text'; return Object.keys(m).find(k=>k!=='messageContextInfo'&&k!=='senderKeyDistributionMessage')||'unknown'; }
export function getMediaNode(raw){ const u=unwrap(raw); if(!u.mediaType)return null; return {type:u.mediaType,node:u.message?.[u.mediaType]||null,viewOnce:u.wasViewOnce}; }
export function isSelfChat(sock,jid){ try{return normalizeNumber(jid)===normalizeNumber(sock?.user?.id)}catch{return false;} }
export function normalizeJid(jid){ try{return jidNormalizedUser(jid);}catch{return jid;} }
export function safeFileName(s,fallback='arquivo'){ return String(s||fallback).replace(/[<>:"/\\|?*\x00-\x1F]/g,'_').replace(/\s+/g,' ').trim().slice(0,100)||fallback; }

export const CARD_LINE = '┄┄┄┄┄┄┄┄┄┄┄┄┄┄';
/**
 * Cartão padrão do bot (visual limpo e consistente).
 * card('👁️ *VISUALIZAÇÃO ÚNICA*', ['👤 Ana','🕒 12:05'], { body:'legenda', footer:true })
 */
export function card(title, rows = [], { body = '', footer = true } = {}) {
  // '' é mantido (espaço entre seções); apenas null/undefined são descartados.
  const parts = [title, CARD_LINE, ...rows.filter((r) => r != null)];
  if (body) parts.push('', body);
  if (footer && CONFIG.BRAND) parts.push(CARD_LINE, CONFIG.BRAND);
  return parts.join('\n');
}
export function chatKind(jid) { return isGroupJid(jid) ? 'Grupo' : 'Privado'; }
