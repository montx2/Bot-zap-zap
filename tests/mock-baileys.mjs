export function jidNormalizedUser(jid){ return String(jid || ''); }
export function extractMessageContent(message){ return message || null; }
export const Browsers={macOS:(name='Chrome')=>['Mac OS',name,'1.0'],ubuntu:(name='Chrome')=>['Ubuntu',name,'22.04.4']};
export async function fetchLatestWaWebVersion(){return {version:[2,3000,1049999999],isLatest:true};}
export async function fetchLatestBaileysVersion(){return {version:[2,3000,1049999999],isLatest:true};}
export const DisconnectReason={loggedOut:401,badSession:500,connectionReplaced:440,restartRequired:515};
export function makeCacheableSignalKeyStore(store){return store;}
export async function useMultiFileAuthState(){ throw new Error('mock only'); }
export function makeWASocket(){ throw new Error('mock only'); }
export async function downloadMediaMessage(){
  const b=globalThis.__MOCK_MEDIA_BUFFER;
  if(!b) throw new Error('mock media buffer ausente');
  return Buffer.from(b);
}
export async function downloadContentFromMessage(){
  const b=globalThis.__MOCK_MEDIA_BUFFER;
  if(!b) throw new Error('mock media buffer ausente');
  async function* gen(){yield Buffer.from(b);}
  return gen();
}
