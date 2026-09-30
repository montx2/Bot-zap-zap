import { mkdir, readFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { downloadMediaMessage } from '@whiskeysockets/baileys';
import { getQuoted, getMediaNode, safeFileName } from '../core/format.js';
import { CONFIG } from '../core/config.js';
import { convertMedia } from '../core/media.js';
export async function convertQuoted(sock,msg,mode){const q=getQuoted(msg);if(!q)throw new Error('responda uma mídia');const media=getMediaNode(q.message);if(!media?.type||!['audioMessage','videoMessage','imageMessage'].includes(media.type))throw new Error('tipo de mídia não suportado');const inFile=path.join(CONFIG.TMP_DIR,`cmd-in-${Date.now()}`),ext=mode==='ptt'?'ogg':mode==='mp3'?'mp3':'gif',out=path.join(CONFIG.TMP_DIR,`cmd-out-${Date.now()}.${ext}`);await mkdir(CONFIG.TMP_DIR,{recursive:true});await (await import('node:fs/promises')).writeFile(inFile,await downloadMediaMessage(q,'buffer',{}, {reuploadRequest:sock.updateMediaMessage}));await convertMedia(inFile,out,mode);const b=await readFile(out);if(mode==='ptt')await sock.sendMessage(msg.key.remoteJid,{audio:b,mimetype:'audio/ogg; codecs=opus',ptt:true});else if(mode==='mp3')await sock.sendMessage(msg.key.remoteJid,{audio:b,mimetype:'audio/mpeg'});else await sock.sendMessage(msg.key.remoteJid,{video:b,gifPlayback:true,caption:'🎞️ GIF'});await unlink(inFile).catch(()=>{});await unlink(out).catch(()=>{});}
