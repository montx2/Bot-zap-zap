import { mkdir, writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { downloadMediaMessage } from '@whiskeysockets/baileys';
import { saveVaultItem, listVault } from '../core/db.js';
import { logger } from '../core/logger.js';
import { CONFIG } from '../core/config.js';
import { getQuoted, getMediaNode, extractText, safeFileName } from '../core/format.js';
import { sha256, extFromMime } from '../core/media.js';
import { secureFile, openSecureFile } from '../core/security.js';

export async function saveQuotedToVault(sock,msg,kind='vault'){
  const q=getQuoted(msg);if(!q)throw new Error('responda uma mensagem de mídia ou texto');
  const text=extractText(q.message); const media=getMediaNode(q.message);
  await mkdir(path.join(CONFIG.STORAGE_DIR,kind),{recursive:true});
  if(!media?.type){const hash=sha256(Buffer.from(text));const plain=path.join(CONFIG.TMP_DIR,`txt-${hash}-${Date.now()}.txt`);const dest=path.join(CONFIG.STORAGE_DIR,kind,`${Date.now()}-${hash}.txt.bzs`);await mkdir(CONFIG.TMP_DIR,{recursive:true});await writeFile(plain,Buffer.from(text));await secureFile(plain,dest);await unlink(plain).catch(()=>{});const id=saveVaultItem({kind,sourceJid:q.key.remoteJid,messageId:q.key.id,filePath:dest,mime:'text/plain',bytes:Buffer.byteLength(text),sha256:hash,encrypted:true});return `🔐 Item de texto #${id} salvo.`;}
  const buffer=await downloadMediaMessage(q,'buffer',{}, {logger,reuploadRequest:sock.updateMediaMessage});if(!buffer?.length)throw new Error('não consegui baixar a mídia');
  const hash=sha256(buffer);const ext=extFromMime(media.node?.mimetype,media.type==='stickerMessage'?'webp':'bin');const plain=path.join(CONFIG.TMP_DIR,`${hash}-${Date.now()}.${ext}`);const dest=path.join(CONFIG.STORAGE_DIR,kind,`${Date.now()}-${safeFileName(media.node?.fileName||media.type)}-${hash}.${ext}.bzs`);await mkdir(CONFIG.TMP_DIR,{recursive:true});await writeFile(plain,buffer);await secureFile(plain,dest);await unlink(plain).catch(()=>{});
  const id=saveVaultItem({kind,sourceJid:q.key.remoteJid,messageId:q.key.id,filePath:dest,mime:media.node?.mimetype||null,bytes:buffer.length,sha256:hash,encrypted:true});return `🔐 Item #${id} salvo no cofre.`;
}
export function vaultList(limit=30){const rows=listVault(limit);return rows.map(x=>`#${x.id} • ${x.kind} • ${x.bytes||0} B\n${x.source_jid||''} / ${x.message_id||''}\n${x.file_path}`).join('\n\n')||'Cofre vazio.';}
export async function readVaultItem(row){if(row.encrypted)return openSecureFile(row.file_path);return Buffer.from(row.file_path);}
