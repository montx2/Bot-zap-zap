import { jidNormalizedUser } from '@whiskeysockets/baileys';
import { upsertWatch, removeWatch, listWatch, getWatch, watchSettings } from '../core/db.js';
import { normalizeNumber, numberToJid } from '../core/format.js';

export function normalizeWatchTarget(raw){
  if(!raw) throw new Error('informe número/JID');
  const s=String(raw).trim();
  if(s.includes('@')){try{return jidNormalizedUser(s);}catch{return s;}}
  const n=normalizeNumber(s); if(!n)throw new Error('número inválido'); return numberToJid(n);
}
export function addTarget(raw,label){const jid=normalizeWatchTarget(raw);upsertWatch(jid,label||jid.split('@')[0],{});return jid;}
export function removeTarget(raw){const jid=normalizeWatchTarget(raw);return removeWatch(jid);}
export function watched(jid){ if(getWatch(jid)) return true; const d=normalizeNumber(jid); if(!d) return false; const all=listWatch(); return all.some(r=>{const x=normalizeNumber(r.jid); return x===d || (x.length>=10&&d.length>=10&&(x.slice(-10)===d.slice(-10)||x.slice(-11)===d.slice(-11)));}); }
export const allWatched=()=>listWatch();
export const settings=jid=>watchSettings(jid)?.settings_json||{};
export function watchedOrAll(jid,all=false){return all||watched(jid);}
