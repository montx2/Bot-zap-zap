import { sweepProfiles } from '../modules/profile.js';
import { dbGet,dbSet } from './db.js';
import { CONFIG } from './config.js';
import { logger } from './logger.js';
import { runMaintenance,lastMaintenance } from './maintenance.js';
import { isFeatureOn } from './features.js';
let timers=[];
export function startScheduler(getSocket,getOwner){stopScheduler();timers.push(setInterval(async()=>{const s=getSocket();if(!s?.user||!isFeatureOn('profile'))return;await sweepProfiles(s).catch(e=>logger.debug({err:e.message},'profile sweep failed'));},30*60*1000));timers.at(-1).unref?.();const tick=async()=>{try{if(Date.now()-lastMaintenance()<24*3600*1000)return;await runMaintenance();}catch{}};timers.push(setInterval(tick,60*60*1000));timers.at(-1).unref?.();const first=setTimeout(tick,2*60*1000);first.unref?.();timers.push(first);}
export function stopScheduler(){for(const t of timers)clearInterval(t);timers=[];}
