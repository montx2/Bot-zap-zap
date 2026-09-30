import { saveGroupEvent } from '../core/db.js';
import { ownerJid } from '../core/identity.js';
import { formatDate, normalizeNumber } from '../core/format.js';
import { watched } from './watch.js';
import { isFeatureOn } from '../core/features.js';

export async function handleGroupEvent(sock,ev){if(!isFeatureOn('groups'))return;
  if(!ev?.id)return;let subject=ev.id;try{subject=(await sock.groupMetadata(ev.id)).subject||subject;}catch{}
  saveGroupEvent({groupJid:ev.id,action:ev.action,participants:ev.participants||[],subject,ts:Date.now()});
  const p=(ev.participants||[]).slice(0,12).map(x=>`• ${x}`).join('\n');
  await sock.sendMessage(ownerJid(sock),{text:`👥 *EVENTO DE GRUPO*\n💬 ${subject}\n📡 ${ev.action||'?'}\n${p}${(ev.participants||[]).length>12?`\n+${ev.participants.length-12}`:''}`}).catch(()=>{});
}
export async function groupInfo(sock,jid){const m=await sock.groupMetadata(jid);return `👥 *${m.subject||jid}*\nID: ${jid}\nMembros: ${m.participants?.length||0}\nDescrição: ${m.desc||'—'}`;}
export async function groupAdmins(sock,jid){const m=await sock.groupMetadata(jid);return (m.participants||[]).filter(p=>p.admin).map(p=>p.id||p.jid).join('\n')||'Nenhum admin identificado.';}
export async function tagAll(sock,jid,text='📣') {const m=await sock.groupMetadata(jid);const mentions=(m.participants||[]).map(p=>p.id||p.jid).filter(Boolean);return sock.sendMessage(jid,{text:`${text}\n\n${mentions.map(j=>`@${j.split('@')[0]}`).join(' ')}`,mentions});}
export async function networkMap(sock,watch){
  const groups=await sock.groupFetchAllParticipating();
  const targets=watch.map(x=>({jid:x.jid,label:x.label||x.jid,digits:normalizeNumber(x.jid)}));
  const pairMap=new Map(), groupMap=new Map();
  const same=(p,t)=>{const d=normalizeNumber(p);return d&&t.digits&&(d===t.digits||(d.length>=10&&t.digits.length>=10&&(d.slice(-10)===t.digits.slice(-10)||d.slice(-11)===t.digits.slice(-11))));};
  for(const [gid,m] of Object.entries(groups)){
    const participants=(m.participants||[]).map(p=>p?.id||p?.jid||p).filter(Boolean);
    const present=targets.filter(t=>participants.some(p=>same(p,t)));
    for(const t of present){if(!groupMap.has(t.jid))groupMap.set(t.jid,[]);groupMap.get(t.jid).push(m.subject||gid);}
    for(let i=0;i<present.length;i++)for(let j=i+1;j<present.length;j++){const k=[present[i].jid,present[j].jid].sort().join('::');if(!pairMap.has(k))pairMap.set(k,[]);pairMap.get(k).push(m.subject||gid);}
  }
  const lines=['🔗 *NETWORK MAP*',''];
  for(const [k,v] of pairMap){const [a,b]=k.split('::');lines.push(`🔗 ${a} ↔ ${b}\n   ${v.slice(0,7).join(' · ')}${v.length>7?` (+${v.length-7})`:''}`);}
  if(!pairMap.size)lines.push('Nenhuma conexão entre os alvos pelos grupos conhecidos.');
  return {text:lines.join('\n'),groups:Object.fromEntries([...groupMap])};
}
