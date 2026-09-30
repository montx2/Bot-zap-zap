import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { CONFIG } from './config.js';

const KEY_FILE=path.join(CONFIG.DATA_DIR,'vault.key');
let keyCache=null;

async function getKey(){
  if(keyCache)return keyCache;
  if(existsSync(KEY_FILE)){
    const raw=await fs.readFile(KEY_FILE,'utf8');
    const key=Buffer.from(raw.trim(),'hex');
    if(key.length===32){keyCache=key;return key;}
  }
  const key=crypto.randomBytes(32);
  await fs.mkdir(CONFIG.DATA_DIR,{recursive:true});
  await fs.writeFile(KEY_FILE,key.toString('hex'),{mode:0o600});
  keyCache=key; return key;
}
export async function secureFile(file, outFile){
  const key=await getKey(); const iv=crypto.randomBytes(12); const cipher=crypto.createCipheriv('aes-256-gcm',key,iv);
  const input=await fs.readFile(file); const enc=Buffer.concat([cipher.update(input),cipher.final()]); const tag=cipher.getAuthTag();
  await fs.mkdir(path.dirname(outFile),{recursive:true}); await fs.writeFile(outFile,Buffer.concat([Buffer.from('BZS1'),iv,tag,enc]),{mode:0o600});
  return outFile;
}
export async function openSecureFile(file){
  const key=await getKey(); const raw=await fs.readFile(file); if(raw.subarray(0,4).toString()!=='BZS1') throw new Error('cofre inválido');
  const iv=raw.subarray(4,16), tag=raw.subarray(16,32), data=raw.subarray(32); const dec=crypto.createDecipheriv('aes-256-gcm',key,iv); dec.setAuthTag(tag); return Buffer.concat([dec.update(data),dec.final()]);
}
export async function protectDir(dir){try{await fs.chmod(dir,0o700);}catch{}}
export async function protectFile(file){try{await fs.chmod(file,0o600);}catch{}}
export async function hasKey(){return existsSync(KEY_FILE);}
