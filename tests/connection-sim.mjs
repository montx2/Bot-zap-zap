import assert from 'node:assert/strict';
process.env.BOT_ROOT=process.env.BOT_ROOT||'/tmp/bot-sim-root';process.env.LOG_LEVEL='silent';
const {connect,getSocket}=await import('../src/core/connection.js');
const S=globalThis.__sockets;
await connect();assert.equal(S.length,1);
S[0].ev.emit('connection.update',{connection:'open'});
// comando imediato
const t0=Date.now();
S[0].ev.emit('messages.upsert',{messages:[{key:{remoteJid:'5511@s.whatsapp.net',id:'A1',fromMe:true},message:{conversation:'.ping'},messageTimestamp:Math.floor(Date.now()/1000)}]});
await new Promise(r=>setTimeout(r,200));
assert.equal(S[0].sent.length,1);console.log('ping respondido em',S[0].sent[0][2]-t0,'ms');
// decrypt heal
const key={remoteJid:'5599@s.whatsapp.net',id:'X'};
S[0].cfg.logger.error({key,err:{message:'Bad MAC Error: Bad MAC'}},'failed to decrypt message');
await new Promise(r=>setTimeout(r,20));assert.equal(S[0].keysSet.length,0);
S[0].cfg.logger.error({key,err:{message:'No matching sessions found for message'}},'failed to decrypt message');
await new Promise(r=>setTimeout(r,50));
assert.deepEqual(S[0].keysSet[0],{session:{'5599.0':null}});console.log('heal ok');
// conflito: backoff
S[0].ev.emit('connection.update',{connection:'close',lastDisconnect:{error:{output:{statusCode:440}}}});
await new Promise(r=>setTimeout(r,3500));
assert.equal(S.length,1,'não pode reconectar em <15s após conflict');console.log('conflict backoff ok');
assert.equal(getSocket(),null);
console.log('✅ Simulação de conexão: comando imediato, auto-cura de sessão e backoff de conflito OK');
process.exit(0);
