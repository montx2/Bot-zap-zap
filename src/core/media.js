import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { CONFIG } from './config.js';

export const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
export const randomId = () => crypto.randomBytes(10).toString('hex');

export async function ensureFile(pathname) {
  await fs.mkdir(path.dirname(pathname), { recursive: true });
  return pathname;
}

export async function runFfmpeg(args, timeoutMs=45_000) {
  return new Promise((resolve,reject)=>{
    const p=spawn('ffmpeg',['-hide_banner','-loglevel','error','-nostdin',...args],{stdio:['ignore','pipe','pipe']});
    let stderr='';
    p.stderr.on('data',d=>{stderr+=d.toString(); if(stderr.length>4000) stderr=stderr.slice(-4000);});
    const timer=setTimeout(()=>{p.kill('SIGKILL');reject(new Error('FFmpeg excedeu o tempo limite'));},timeoutMs);
    p.on('error',e=>{clearTimeout(timer);reject(e);});
    p.on('close',(code)=>{clearTimeout(timer); if(code===0)resolve({stdout:'',stderr}); else reject(new Error(stderr||`FFmpeg saiu com código ${code}`));});
  });
}

export async function convertMedia(input, output, mode) {
  await ensureFile(output);
  const filters={
    ptt: ['-i',input,'-vn','-c:a','libopus','-b:a','48k','-map_metadata','-1','-y',output],
    mp3: ['-i',input,'-vn','-c:a','libmp3lame','-q:a','4','-map_metadata','-1','-y',output],
    gif: ['-i',input,'-t',String(CONFIG.STICKER_MAX_SECONDS),'-vf','fps=12,scale=480:-1:flags=lanczos,split[s0][s1];[s0]palettegen=stats_mode=diff[p];[s1][p]paletteuse=dither=sierra2_4a','-loop','0','-y',output],
    sticker: ['-i',input,'-vf','scale=512:512:force_original_aspect_ratio=decrease:flags=lanczos,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=0x00000000','-c:v','libwebp','-lossless','0','-q:v','75','-loop','0','-y',output],
    stickerVideo: ['-i',input,'-t',String(CONFIG.STICKER_MAX_SECONDS),'-vf','fps=12,scale=512:512:force_original_aspect_ratio=decrease:flags=lanczos,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=0x00000000','-an','-c:v','libwebp','-q:v','55','-loop','0','-y',output]
  };
  if(!filters[mode]) throw new Error(`modo FFmpeg desconhecido: ${mode}`);
  await runFfmpeg(filters[mode]);
  return output;
}

export function extFromMime(mime='', fallback='bin') {
  const m=String(mime).toLowerCase();
  if(m.includes('jpeg'))return 'jpg'; if(m.includes('png'))return 'png'; if(m.includes('webp'))return 'webp';
  if(m.includes('mp4'))return 'mp4'; if(m.includes('webm'))return 'webm'; if(m.includes('ogg'))return 'ogg';
  if(m.includes('mpeg'))return 'mp3'; if(m.includes('pdf'))return 'pdf';
  return fallback;
}
