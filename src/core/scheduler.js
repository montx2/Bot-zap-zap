import { sweepProfiles } from '../modules/profile.js';
import { dbGet,dbSet } from './db.js';
import { CONFIG } from './config.js';
import { logger } from './logger.js';
import { isFeatureOn } from './features.js';
let timers=[];
export function startScheduler(getSocket,getOwner){stopScheduler();timers.push(setInterval(async()=>{const s=getSocket();if(!s?.user||!isFeatureOn('profile'))return;await sweepProfiles(s).catch(e=>logger.debug({err:e.message},'profile sweep failed'));},30*60*1000));timers.at(-1).unref?.();timers.push(setInterval(()=>{try{const now=Date.now();const last=Number(dbGet('runtime.maintenance')||0);if(now-last<24*3600*1000)return;dbSet('runtime.maintenance',now);logger.info('maintenance tick');}catch{}},60*60*1000));timers.at(-1).unref?.();}
export function stopScheduler(){for(const t of timers)clearInterval(t);timers=[];}
