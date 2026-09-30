import { ownerJid } from '../core/identity.js';
import { extractText, getContext, formatDate } from '../core/format.js';
import { watched } from './watch.js';
import { saveEvent } from '../core/db.js';
import { isFeatureOn } from '../core/features.js';
export async function onForward(sock,msg){if(!isFeatureOn('forward'))return;if(msg?.key?.fromMe||!msg?.message)return;const c=getContext(msg.message);if(!(c?.isForwarded||Number(c?.forwardingScore)>0))return;saveEvent({kind:'forward',remoteJid:msg.key.remoteJid,refId:msg.key.id,data:{score:Number(c.forwardingScore||1),origin:c.remoteJid||null,newsletter:c.forwardedNewsletterJid||null}});if(!watched(msg.key.remoteJid))return;const origin=c.remoteJid?`\n📤 Origem: ${c.remoteJid}`:'';const chan=c.forwardedNewsletterJid?`\n📰 Canal: ${c.forwardedNewsletterJid}`:'';await sock.sendMessage(ownerJid(sock),{text:`🔁 *ENCAMINHAMENTO DETECTADO*\n💬 ${msg.key.remoteJid}\n🕒 ${formatDate(msg.messageTimestamp)}\n🔄 Score: ${Number(c.forwardingScore||1)}${origin}${chan}${extractText(msg.message)?`\n📝 ${extractText(msg.message).slice(0,280)}`:''}`}).catch(()=>{});}
