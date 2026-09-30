import { listLinks, saveEvent } from '../core/db.js';
import { extractText } from '../core/format.js';
const URL_RE=/https?:\/\/[^\s<>]+/gi;
const TRACKER=/[?&](utm_[^=]+|fbclid|gclid|mc_[^=]+)=/i;
export function detectLinks(msg){
  const urls=String(extractText(msg?.message)||'').match(URL_RE)||[];
  for(const raw of urls){const url=raw.replace(/[),.;!?]+$/g,'');saveEvent({kind:'link.detected',remoteJid:msg.key.remoteJid,refId:msg.key.id,data:{url,tracking:TRACKER.test(url)}});}
  return urls;
}
export function linkList(limit=50){return listLinks(limit);}
export function stripTracking(url){try{const u=new URL(url);for(const k of [...u.searchParams.keys()])if(/^utm_|^(fbclid|gclid)$|^mc_/.test(k))u.searchParams.delete(k);return u.toString();}catch{return url;}}
