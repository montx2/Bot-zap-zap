import { saveEvent } from '../core/db.js';
import { getContext, resolveViewOnce, getMessageType } from '../core/format.js';

export function detectSpecial(msg){
  const m=msg?.message||{};const out=[];const ctx=getContext(m);const vo=resolveViewOnce(m);
  if(vo.wasViewOnce)out.push('view-once');
  if(ctx?.isForwarded||Number(ctx?.forwardingScore)>0)out.push('forwarded');
  if(ctx?.quotedMessage)out.push('quoted');
  if(m.locationMessage||m.liveLocationMessage)out.push('location');
  if(m.contactMessage||m.contactsArrayMessage)out.push('contact');
  if(m.pollCreationMessage||m.pollCreationMessageV3||m.pollUpdateMessage)out.push('poll');
  if(m.reactionMessage)out.push('reaction');
  if(m.productMessage||m.orderMessage)out.push('commerce');
  if(msg?.messageStubType)out.push(`stub:${msg.messageStubType}`);
  saveEvent({kind:'message.classified',remoteJid:msg.key?.remoteJid,refId:msg.key?.id,data:{types:out,messageType:getMessageType(m)}});
  return out;
}
