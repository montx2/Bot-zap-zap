import { dbGet,dbSet } from './db.js';
import { CONFIG } from './config.js';
const defaults={viewonce:CONFIG.VIEW_ONCE_AUTO,sticker:CONFIG.DEFAULT_STICKER,media:CONFIG.MEDIA_VAULT,status:CONFIG.STATUS_SAVER,antidelete:CONFIG.ANTI_DELETE,antiedit:CONFIG.ANTI_EDIT,reaction:CONFIG.REACTION_MONITOR,presence:CONFIG.PRESENCE_MONITOR,receipts:CONFIG.READ_RECEIPT_MONITOR,calls:CONFIG.CALL_MONITOR,groups:CONFIG.GROUP_RADAR,forward:CONFIG.FORWARD_MONITOR,device:CONFIG.DEVICE_MONITOR,profile:CONFIG.PROFILE_MONITOR,smart:CONFIG.SMART_ALERTS,events:CONFIG.AUTO_EVENTS};
export const featureNames=Object.keys(defaults);
export function featureKey(name){return `feature.${name}`;}
export function isFeatureOn(name){const k=String(name||'').toLowerCase();const v=dbGet(featureKey(k));return v==null?!!defaults[k]:v==='1';}
export function setFeature(name,on){const k=String(name||'').toLowerCase();if(!(k in defaults))throw new Error(`feature desconhecida: ${k}`);dbSet(featureKey(k),on?'1':'0');}
export function featureStatus(){return featureNames.map(k=>`${k}:${isFeatureOn(k)?'ON':'OFF'}`).join(' • ');}
export function setAll(on){for(const k of featureNames)dbSet(featureKey(k),on?'1':'0');}
export { defaults };
