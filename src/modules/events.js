import { saveEvent } from '../core/db.js';
import { isStatusJid } from '../core/format.js';
export function logEvent(kind, data={}){
  saveEvent({kind,remoteJid:data.remoteJid||data.jid||null,refId:data.messageId||data.id||data.callId||null,data,ts:data.ts||Date.now()});
}
export function classifySpecial(msg, normalized){
  const m=normalized?.message||msg?.message||{}; const out=[];
  if(normalized?.viewOnce)out.push('view_once');
  if(msg?.key?.remoteJid=== 'status@broadcast' || isStatusJid(msg?.key?.remoteJid))out.push('status');
  const c=m.extendedTextMessage?.contextInfo||m.imageMessage?.contextInfo||m.videoMessage?.contextInfo||m.documentMessage?.contextInfo||{};
  if(c?.isForwarded||Number(c?.forwardingScore)>0)out.push('forwarded');
  if(c?.quotedMessage)out.push('quoted');
  if(m.locationMessage||m.liveLocationMessage)out.push('location');
  if(m.contactMessage||m.contactsArrayMessage)out.push('contact');
  if(m.pollCreationMessageV3||m.pollCreationMessage||m.pollUpdateMessage)out.push('poll');
  if(m.reactionMessage)out.push('reaction');
  if(m.protocolMessage)out.push('protocol');
  return [...new Set(out)];
}
