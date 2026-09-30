import {EventEmitter} from 'node:events';
export * from './mock-baileys.mjs';
export const DisconnectReason={loggedOut:401,badSession:500,connectionReplaced:440,restartRequired:515};
export const sockets=[];
globalThis.__sockets=sockets;
export async function useMultiFileAuthState(){return {state:{creds:{registered:true},keys:{get:async()=>({}),set:async()=>{}}},saveCreds:async()=>{}};}
export default function makeWASocket(cfg){
  const ev=new EventEmitter(); const sent=[]; const keysSet=[];
  const s={cfg,ev,sent,keysSet,user:{id:'5511@s.whatsapp.net'},ended:false,
    end(){s.ended=true;}, waitForSocketOpen:async()=>{},
    sendMessage:async(jid,c)=>{sent.push([jid,c,Date.now()]);return {}},
    authState:{keys:{set:async(d)=>{keysSet.push(d)}}},
    signalRepository:{jidToSignalProtocolAddress:(j)=>j.split('@')[0]+'.0'},
    sendPresenceUpdate:async()=>{}};
  sockets.push(s);return s;}
