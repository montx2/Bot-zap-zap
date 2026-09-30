import { ownerJid } from '../core/identity.js';
import { getProfile, saveProfile } from '../core/db.js';
import { allWatched } from './watch.js';
import { formatDate } from '../core/format.js';

export async function profileCheck(sock,jid){
  const old=getProfile(jid)||{jid};let pp=null,about=null;try{pp=await sock.profilePictureUrl(jid,'image');}catch{}try{about=(await sock.fetchStatus?.(jid))?.status||null;}catch{}
  const changes=[];if(old.pp_url&&pp&&old.pp_url!==pp)changes.push('foto');if(old.about!=null&&old.about!==about)changes.push('status');saveProfile({jid,label:old.label||jid,ppUrl:pp||old.pp_url||null,about,lastCheck:Date.now()});
  if(changes.length){await sock.sendMessage(ownerJid(sock),{text:`🔎 *PERFIL ALTERADO*\n👤 ${jid}\nAlterações: ${changes.join(', ')}\n🕒 ${formatDate(Date.now())}`}).catch(()=>{});}
  return {pp,about,changes};
}
export async function sweepProfiles(sock){for(const w of allWatched()){await profileCheck(sock,w.jid).catch(()=>{});await new Promise(r=>setTimeout(r,1200));}}
