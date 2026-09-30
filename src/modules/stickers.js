import { mkdir, writeFile, readFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { downloadMediaMessage } from '@whiskeysockets/baileys';
import { dbGet, dbSet } from '../core/db.js';
import { CONFIG } from '../core/config.js';
import { getQuoted, getMediaNode, formatBytes } from '../core/format.js';
import { convertMedia } from '../core/media.js';

export function stickerEnabled(){const v=dbGet('feature.sticker');return v==null?CONFIG.DEFAULT_STICKER:v==='1';}
export const setStickerEnabled=on=>dbSet('feature.sticker',on?'1':'0');
export function stickerHelp(){return `🎨 *STICKER ENGINE*\nStatus: ${stickerEnabled()?'✅ liberado':'🔒 bloqueado'}\n\n.sticker on|off|status\nResponda uma imagem/vídeo com .sticker`}
export async function createSticker(sock,msg){if(!stickerEnabled())throw new Error('criação de figurinhas está bloqueada. Use `.sticker on`.');const q=getQuoted(msg)||msg;const media=getMediaNode(q.message);if(!media?.type||!['imageMessage','videoMessage','stickerMessage'].includes(media.type))throw new Error('responda uma imagem ou vídeo');const input=path.join(CONFIG.TMP_DIR,`st-in-${Date.now()}`),out=path.join(CONFIG.TMP_DIR,`st-out-${Date.now()}.webp`);await mkdir(CONFIG.TMP_DIR,{recursive:true});const b=await downloadMediaMessage(q,'buffer',{}, {reuploadRequest:sock.updateMediaMessage});await writeFile(input,b);await convertMedia(input,out,media.type==='videoMessage'?'stickerVideo':'sticker');const webp=await readFile(out);await sock.sendMessage(msg.key.remoteJid,{sticker:webp});await unlink(input).catch(()=>{});await unlink(out).catch(()=>{});return `sticker ${formatBytes(webp.length)}`;}
