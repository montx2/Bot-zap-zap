import fs from 'node:fs/promises';
import path from 'node:path';
import { CONFIG } from './config.js';
import { logger } from './logger.js';
import { ownerJid } from './identity.js';
import { extractText, getQuoted, formatDate, formatBytes, truncate, isGroupJid, card } from './format.js';
import * as DB from './db.js';
import { viewOnceEnabled,setViewOnceEnabled,captureQuotedViewOnce,viewOncePanel,listCaptures,sendCapture } from '../modules/viewonce.js';
import { stickerEnabled,setStickerEnabled,stickerHelp,createSticker,takeSticker,stickerToImage,stickerInfo,setStickerAuto,stickerAutoEnabled,getPack,setPack,resetPack } from '../modules/stickers.js';
import { saveQuotedToVault,vaultList } from '../modules/vault.js';
import { convertQuoted } from '../modules/commandMedia.js';
import { addTarget,removeTarget,allWatched,normalizeWatchTarget } from '../modules/watch.js';
import { globalStats,chatAnalytics,formatAnalytics,find,eventText,linkText } from '../modules/analytics.js';
import { groupInfo,groupAdmins,tagAll,networkMap } from '../modules/groups.js';
import { profileCheck } from '../modules/profile.js';
import { stripTracking } from '../modules/links.js';
import { featureNames,featureStatus,setFeature,setAll,isFeatureOn } from './features.js';
import { readVaultItem } from '../modules/vault.js';
import { openSecureFile } from './security.js';
import { ffmpegCapabilities } from './media.js';
import { runMaintenance } from './maintenance.js';

const HELP=`🔥 *BOT-ZAP SUPREMO*\n_Termux • privado • sem IA obrigatória_\n\n🎨 *Figurinhas* (.menu figurinha)\n.s → imagem, vídeo, GIF ou figurinha (responda ou legenda)\n.s circle | crop | full | round\n.s bw | sepia | invert | flip | blur\n.s slow | fast | rev | boomerang | 6 (segundos)\n.s 😎 | Pack | Autor\n.take Pack | Autor → troca pack da figurinha\n.toimg • .togif • .tovideo • .stickerinfo\n.sticker pack Nome | Autor\n.sticker auto on|off\n\n🎞️ *Conversores*\n.gif • .mp4 • .ptt • .mp3 • .hash → respondendo mídia\n\n👁️ *Visualização única*\n.vo → painel\n.vo on|off\n.vo list • .vo get ID\n.o ou .wow → recupera a mensagem citada\n\n💾 *Arquivo & busca*\n.find termo [limite]\n.media • .links • .events [tipo]\n.export [limite]\n.recover [id]\n.edits → cite a mensagem\n\n🔐 *Cofre*\n.save → salva a citada\n.black save|list|get ID\n\n👀 *Monitoramento*\n.watch add número [nome]\n.watch rm número\n.watch hours número 8 9 10 ...\n.watch list\n.profile número • .network • .patterns • .stalk número\n\n👥 *Grupos*\n.groupinfo • .admins • .tagall [texto]\n\n🛠️ *Utilidades*\n.poll pergunta | opção | opção\n.cleanlink URL\n\n📊 *Sistema*\n.stats • .health • .status • .ping • .id • .check número\n.feature [nome on|off]\n.doctor • .backup • .clean\n\n⚙️ Tudo administrativo exige mensagem enviada pela própria conta.\n\n${CONFIG.BRAND}`;

const send=async(sock,jid,c)=>{if(typeof sock.waitForSocketOpen==='function')await sock.waitForSocketOpen();return sock.sendMessage(jid,c);};

export async function handleCommand(sock,msg){if(!msg?.key?.fromMe)return false;const text=extractText(msg.message);if(!text.startsWith(CONFIG.PREFIX))return false;const raw=text.slice(CONFIG.PREFIX.length).trim();if(!raw)return true;const [name,...args]=raw.split(/\s+/);const cmd=name.toLowerCase();const rest=raw.slice(name.length).trim();const jid=msg.key.remoteJid;try{
 switch(cmd){
  case 'menu':case'help':case'ajuda':{const t=(args[0]||'').toLowerCase();await send(sock,jid,{text:/^(fig|sticker|figurinha|s)$/.test(t)?stickerHelp(sock):HELP});break;}
  case 'ping':await send(sock,jid,{text:`🏓 *PONG*\nNode ${process.version}\nRSS ${Math.round(process.memoryUsage().rss/1048576)} MB`});break;
  case 'id':await send(sock,jid,{text:`🆔 ${jid}`});break;
  case 'status':await send(sock,jid,{text:statusText(sock)});break;
  case 'health':await send(sock,jid,{text:healthText(sock)});break;
  case 'viewonce':case'vo':{
    const a=(args[0]||'').toLowerCase();
    if(a==='on'){setViewOnceEnabled(true);await send(sock,jid,{text:card('👁️ *VISUALIZAÇÃO ÚNICA*',['Modo automático: ✅ *ligado*','Tudo que chegar será capturado e enviado pro seu privado.'])});}
    else if(a==='off'){setViewOnceEnabled(false);await send(sock,jid,{text:card('👁️ *VISUALIZAÇÃO ÚNICA*',['Modo automático: 🔒 *desligado*','Você ainda pode usar `.o` respondendo uma mensagem.'])});}
    else if(a==='status'||a==='panel'||a==='painel'){await send(sock,jid,{text:viewOncePanel()});}
    else if(a==='list'||a==='lista'||a==='ls'){await send(sock,jid,{text:listCaptures(Number(args[1])||10)});}
    else if(a==='get'||a==='id'){if(!args[1])throw new Error('use `.vo get ID` (veja `.vo list`)');await sendCapture(sock,jid,args[1]);}
    else if(getQuoted(msg)){const ok=await captureQuotedViewOnce(sock,msg);if(!ok)await send(sock,jid,{text:card('👁️ *NÃO ENCONTREI*',['Essa mensagem não tem uma visualização única recuperável.'])});}
    else await send(sock,jid,{text:viewOncePanel()});
    break;}
  case 'o':case'wow':case'reveal':case'0':{const ok=await captureQuotedViewOnce(sock,msg);if(!ok)await send(sock,jid,{text:card('👁️ *FALHA AO RECUPERAR*',['Responda a mensagem de visualização única com `.o`.','Se já abriu no celular, o WhatsApp pode não entregar mais a mídia.'])});break;}
  case 'sticker':case'sticke':case's':case'fig':case'figurinha':case'stk':{
    const a=(args[0]||'').toLowerCase();
    if(a==='on'){setStickerEnabled(true);await send(sock,jid,{text:'🎨 Stickers: ✅ LIBERADOS'});}
    else if(a==='off'){setStickerEnabled(false);await send(sock,jid,{text:'🎨 Stickers: 🔒 BLOQUEADOS'});}
    else if(['status','help','ajuda','menu','opcoes','opções'].includes(a)){await send(sock,jid,{text:stickerHelp(sock)});}
    else if(a==='auto'){const v=(args[1]||'').toLowerCase();if(v==='on'||v==='off'){setStickerAuto(v==='on');await send(sock,jid,{text:`🎨 Auto-sticker no chat comigo: ${v==='on'?'✅ ON — mande imagem/vídeo/GIF pra você mesmo':'🔒 OFF'}`});}else await send(sock,jid,{text:`🎨 Auto-sticker: ${stickerAutoEnabled()?'✅ ON':'🔒 OFF'}\nUse \`.sticker auto on|off\``});}
    else if(a==='pack'||a==='autor'||a==='author'){
      const tail=rest.slice(args[0].length).trim();
      if(!tail){const p=getPack(sock);await send(sock,jid,{text:`📦 Pack: *${p.pack||'—'}*\n✍️ Autor: *${p.author||'—'}*\nUse \`.sticker pack Nome | Autor\` ou \`.sticker pack reset\``});}
      else if(tail.toLowerCase()==='reset'){resetPack();const p=getPack(sock);await send(sock,jid,{text:`📦 Padrão restaurado: *${p.pack}* • *${p.author}*`});}
      else{const [pk,au]=tail.split('|').map(x=>x.trim());if(a==='pack')setPack(pk||null,au!=null?au:null);else setPack(null,pk);const p=getPack(sock);await send(sock,jid,{text:`✅ Pack: *${p.pack}*\n✍️ Autor: *${p.author}*`});}
    }
    else if(a==='info'){await send(sock,jid,{text:await stickerInfo(sock,msg)});}
    else await createSticker(sock,msg,rest);
    break;}
  case 'take':case'roubar':case'rename':await takeSticker(sock,msg,rest);break;
  case 'toimg':case'img':case'toimage':await stickerToImage(sock,msg,{asDocument:/^(doc|png|documento)$/i.test(args[0]||'')});break;
  case 'stickerinfo':case'stinfo':await send(sock,jid,{text:await stickerInfo(sock,msg)});break;
  case 'save':case'vault':await send(sock,jid,{text:await saveQuotedToVault(sock,msg,'vault')});break;
  case 'black':{const a=(args[0]||'').toLowerCase();if(a==='save')await send(sock,jid,{text:await saveQuotedToVault(sock,msg,'black')});else if(a==='list')await send(sock,jid,{text:vaultList(50)});else if(a==='get'){const r=DB.getVaultItem(args[1]);if(!r)throw new Error('item não encontrado');const b=await readVaultItem(r);if(r.mime==='text/plain')await send(sock,jid,{text:b.toString('utf8')});else await send(sock,jid,{document:b,fileName:`black-${r.id}.bin`,mimetype:r.mime||'application/octet-stream',caption:`🔐 Black Vault #${r.id}`});}else await send(sock,jid,{text:'Use `.black save`, `.black list` ou `.black get ID`.'});break;}
  case 'find':case'search':{const parts=rest.trim().split(/\s+/).filter(Boolean);const lim=parts.length>1&&/^\d+$/.test(parts[parts.length-1])?Number(parts.pop()):50;const query=parts.join(' ');if(!query)throw new Error('use `.find termo`');const out=find(query,Math.min(100,lim));await send(sock,jid,{text:out?`🔎 *RESULTADOS*\n${out}`:`🔎 Nada encontrado para: ${rest}`});break;}
  case 'media':{if(args[0]==='get'){const r=DB.getMediaById(args[1]);if(!r)throw new Error('mídia não encontrada');const b=await openSecureFile(r.file_path);await sendMediaRow(sock,jid,r,b);break;}const rows=DB.listMedia(30);await send(sock,jid,{text:rows.length?`💾 *MÍDIAS*\n${rows.map(r=>`#${r.id} • ${r.kind} • ${formatBytes(r.bytes)}\n${r.remote_jid}\n${r.file_path}`).join('\n\n')}`:'💾 Nenhuma mídia arquivada.'});break;}
  case 'links':await send(sock,jid,{text:linkText(50)||'🔗 Nenhum link arquivado.'});break;
  case 'cleanlink':{const u=rest.trim();if(!u)throw new Error('use `.cleanlink URL`');await send(sock,jid,{text:stripTracking(u)});break;}
  case 'events':await send(sock,jid,{text:eventText(args[0],50)||'📡 Nenhum evento.'});break;
  case 'feature':case'features':{const name=(args[0]||'').toLowerCase(),action=(args[1]||'').toLowerCase();if(!name||name==='status'){await send(sock,jid,{text:`⚙️ *FEATURES*\n${featureStatus()}`});break;}if(name==='all'){if(!['on','off'].includes(action))throw new Error('use `.feature all on|off`');setAll(action==='on');await send(sock,jid,{text:`⚙️ Todas as features: ${action.toUpperCase()}`});break;}if(!featureNames.includes(name))throw new Error(`feature desconhecida. Opções: ${featureNames.join(', ')}`);if(action==='status'){await send(sock,jid,{text:`⚙️ ${name}: ${isFeatureOn(name)?'ON':'OFF'}`});break;}if(!['on','off'].includes(action))throw new Error('use `.feature nome on|off|status`');setFeature(name,action==='on');await send(sock,jid,{text:`⚙️ ${name}: ${action.toUpperCase()}`});break;}
  case 'stats':{const s=globalStats();await send(sock,jid,{text:`📊 *STATS*\nMensagens: ${s.messages}\nChats: ${s.chats}\nView Once: ${s.viewOnce}\nApagadas: ${s.deleted}\nEdições: ${s.edits}\nMídias: ${s.media} • ${formatBytes(s.mediaBytes)}\nLinks: ${s.links}\nEventos: ${s.events}\nEventos de grupo: ${s.groups}`});break;}
  case 'analytics':await send(sock,jid,{text:formatAnalytics(jid,chatAnalytics(jid))});break;
  case 'patterns':{const target=args[0]?normalizeWatchTarget(args[0]):jid;await send(sock,jid,{text:formatAnalytics(target,chatAnalytics(target))});break;}
  case 'recover':{const id=args[0];const rows=DB.listDeleted(jid,20);const row=id?DB.getStoredEnvelope(jid,id):rows[0];await send(sock,jid,{text:row?`🗑️ *RECUPERADO*\n👤 ${row.sender_name||'?'}\n🕒 ${formatDate(row.ts)}\n${row.text||`[${row.type||'mídia'}]`}\n🆔 ${row.message_id}`:'Nenhuma mensagem apagada registrada.'});break;}
  case 'edits':{const q=getQuoted(msg);if(!q)throw new Error('responda a mensagem com `.edits`');const rows=DB.listEdits(jid,q.key.id,30);await send(sock,jid,{text:rows.length?`✏️ *HISTÓRICO*\n${rows.map(r=>`[${formatDate(r.ts)}]\nANTES: ${r.old_text||'—'}\nDEPOIS: ${r.new_text||'—'}`).join('\n\n')}`:'Nenhuma edição registrada.'});break;}
  case 'watch': {
    const action=(args[0]||'').toLowerCase();
    if(action==='add'){ const target=addTarget(args[1],args.slice(2).join(' ')||args[1]); try{await sock.presenceSubscribe?.(target);}catch{} await send(sock,jid,{text:`👀 Watch adicionado: ${target}`}); break; }
    if(action==='rm'||action==='remove'){ await send(sock,jid,{text:removeTarget(args[1])?'👀 Removido.':'Não estava na lista.'}); break; }
    if(action==='hours'){ const target=normalizeWatchTarget(args[1]); const hours=args.slice(2).map(Number).filter(x=>Number.isInteger(x)&&x>=0&&x<=23); if(!hours.length)throw new Error('use `.watch hours número 8 9 10 ...`'); const old=DB.getWatch(target);let set={};try{set=JSON.parse(old?.settings_json||'{}')}catch{};set.alertHours=[...new Set(hours)].sort((a,b)=>a-b);DB.upsertWatch(target,old?.label||target,set); await send(sock,jid,{text:`⏰ Horários esperados salvos para ${target}: ${hours.join(', ')}h`}); break; }
    const rows=allWatched();
    const lines=rows.map(r=>{let set={};try{set=JSON.parse(r.settings_json||'{}')}catch{}; const hours=Array.isArray(set.alertHours)&&set.alertHours.length?`\n  ⏰ ${set.alertHours.join(', ')}h`:''; return `• ${r.label||r.jid}\n  ${r.jid}${hours}`;});
    await send(sock,jid,{text:lines.length?`👀 *WATCH*\n${lines.join('\n')}`:'👀 Lista vazia.'});
    break;
  }
  case 'profile':{const target=normalizeWatchTarget(args[0]);const r=await profileCheck(sock,target);await send(sock,jid,{text:`🔎 *PROFILE CHECK*\n${target}\n📸 ${r.pp?'foto disponível':'foto indisponível'}\n📝 ${r.about||'sem status'}\n${r.changes.length?`⚠️ alterado: ${r.changes.join(', ')}`:'sem mudança detectada'}`});break;}
  case 'stalk':{const target=normalizeWatchTarget(args[0]||jid);const a=chatAnalytics(target);const r=await profileCheck(sock,target);await send(sock,jid,{text:`🕵️ *REPORT*\n👤 ${target}\n📸 ${r.pp?'✅':'—'}\n📝 ${r.about||'—'}\n\n${formatAnalytics(target,a)}`});break;}
  case 'network':{const r=await networkMap(sock,allWatched());await send(sock,jid,{text:r.text});break;}
  case 'groupinfo':if(!isGroupJid(jid))throw new Error('use dentro de um grupo');await send(sock,jid,{text:await groupInfo(sock,jid)});break;
  case 'admins':if(!isGroupJid(jid))throw new Error('use dentro de um grupo');await send(sock,jid,{text:`👑 *ADMINS*\n${await groupAdmins(sock,jid)}`});break;
  case 'tagall':if(!isGroupJid(jid))throw new Error('use dentro de um grupo');await tagAll(sock,jid,rest||'📣 atenção');break;
  case 'ptt':await convertQuoted(sock,msg,'ptt');break;
  case 'mp3':await convertQuoted(sock,msg,'mp3');break;
  case 'gif':case'togif':await convertQuoted(sock,msg,'gif');break;
  case 'tovideo':case'mp4':case'tovid':await convertQuoted(sock,msg,'mp4');break;
  case 'hash':{const q=getQuoted(msg);if(!q)throw new Error('responda uma mídia');const {downloadMediaMessage}=await import('@whiskeysockets/baileys');const b=await downloadMediaMessage(q,'buffer',{}, {reuploadRequest:sock.updateMediaMessage});const crypto=await import('node:crypto');await send(sock,jid,{text:`🔐 SHA-256\n${crypto.createHash('sha256').update(b).digest('hex')}\n${formatBytes(b.length)}`});break;}
  case 'poll':{const p=rest.split('|').map(s=>s.trim()).filter(Boolean);if(p.length<3)throw new Error('use `.poll pergunta | opção | opção`');await send(sock,jid,{poll:{name:p[0],values:p.slice(1,13),selectableCount:1}});break;}
  case 'export':await exportChat(sock,jid,Math.min(CONFIG.MAX_EXPORT,Number(args[0])||1000));break;
  case 'check':{const target=normalizeWatchTarget(args[0]);let about='';try{about=(await sock.fetchStatus?.(target))?.status||'';}catch{}let pp=false;try{pp=!!(await sock.profilePictureUrl(target,'image'));}catch{}await send(sock,jid,{text:`🔍 *CHECK*\n${target}\n📸 Foto: ${pp?'✅':'—'}\n📝 Status: ${about||'—'}\n\n⚠️ Não existe indicador confiável no protocolo para afirmar bloqueio apenas por ausência de foto/status.`});break;}
  case 'backup':{const {execFile}=await import('node:child_process');await new Promise((resolve,reject)=>execFile('bash',['scripts/backup.sh'],{cwd:CONFIG.ROOT},e=>e?reject(e):resolve()));await send(sock,jid,{text:'💾 Backup concluído em storage/backups.'});break;}
  case 'clean':case'limpar':case'manutencao':{const r=await runMaintenance();await send(sock,jid,{text:card('🧹 *MANUTENÇÃO*',[`Mensagens compactadas: ${r.raw}`,`Eventos antigos removidos: ${r.events}`,`Mídias expiradas: ${r.media} (${formatBytes(r.mediaBytes)})`,`Log rotacionado: ${r.log?'sim':'não'}`,`Temporários removidos: ${r.tmp}`],{body:r.error?`⚠️ ${r.error}`:`Retenção: mensagens ${CONFIG.KEEP_RAW_DAYS}d • mídias ${CONFIG.MEDIA_KEEP_DAYS}d (teto ${CONFIG.MEDIA_MAX_GB} GB).\nView Once e cofre nunca são apagados.`})});break;}
  case 'doctor':{const ffCaps=await ffmpegCapabilities();await send(sock,jid,{text:`🩺 Node ${process.version}\nDB ${DB.stats().messages} mensagens\nFFmpeg: ${ffCaps.installed?`${ffCaps.version} • WebP ${ffCaps.webp?'✅':'❌'} • H264 ${ffCaps.h264?'✅':'❌'} • Opus ${ffCaps.opus?'✅':'❌'} • MP3 ${ffCaps.mp3?'✅':'❌'}`:'❌ não instalado'}\nPasta: ${CONFIG.ROOT}`});break;}
  default:await send(sock,jid,{text:`❓ .${cmd} não existe. Use .menu`});
 }
 return true;
 }catch(e){logger.error({cmd,err:e.message},'command failed');await send(sock,jid,{text:`❌ ${e.message}`}).catch(()=>{});return true;}}

async function exportChat(sock,jid,limit){const rows=DB.exportRows(jid,limit);if(!rows.length)throw new Error('chat sem mensagens arquivadas');await fs.mkdir(CONFIG.EXPORT_DIR,{recursive:true});const file=path.join(CONFIG.EXPORT_DIR,`chat-${jid.replace(/[^a-zA-Z0-9_-]/g,'_')}-${Date.now()}.txt`);let out=`BOT-ZAP SUPREMO\nChat: ${jid}\nMensagens: ${rows.length}\n\n`;for(const r of rows)out+=`[${formatDate(r.ts)}] ${r.from_me?'EU':r.sender_name||r.sender_jid||'?'}: ${r.text||`[${r.type||'mídia'}]`}\n`;await fs.writeFile(file,out);const body=await fs.readFile(file);await send(sock,jid,{document:body,fileName:path.basename(file),mimetype:'text/plain',caption:`📤 Exportação • ${rows.length} mensagens`});}
function statusText(sock){const on=v=>v?'✅':'🔒';return card('⚙️ *STATUS*',[`WhatsApp: ${sock?.user?'✅ conectado':'❌ offline'}`,`Visualização única: ${on(viewOnceEnabled())}`,`Figurinhas: ${on(stickerEnabled())}`,`Anti-delete: ${on(isFeatureOn('antidelete'))} • Anti-edit: ${on(isFeatureOn('antiedit'))}`,`Mídia: ${on(isFeatureOn('media'))} • Status saver: ${on(isFeatureOn('status'))}`,`Eventos: ${on(isFeatureOn('events'))}`]);}
async function sendMediaRow(sock,jid,row,b){const name=path.basename(row.file_path);return send(sock,jid,{document:b,fileName:name,mimetype:row.mime||'application/octet-stream',caption:`💾 Mídia #${row.id} • ${row.kind} • ${formatBytes(row.bytes)}`});}
function healthText(sock){const m=process.memoryUsage();return`🩺 *HEALTH*\nUptime: ${Math.floor(process.uptime())}s\nRSS: ${Math.round(m.rss/1048576)} MB\nHeap: ${Math.round(m.heapUsed/1048576)} MB\nNode: ${process.version}\nWhatsApp: ${sock?.user?'OPEN':'DOWN'}\nDB: ${DB.stats().messages} mensagens`;
}
