import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import { CONFIG } from './config.js';
import { logger } from './logger.js';

fs.mkdirSync(CONFIG.DATA_DIR,{recursive:true});
const db=new DatabaseSync(CONFIG.DB_PATH);
db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=8000;
CREATE TABLE IF NOT EXISTS kv(key TEXT PRIMARY KEY,value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS messages(remote_jid TEXT NOT NULL,message_id TEXT NOT NULL,from_me INTEGER NOT NULL DEFAULT 0,sender_jid TEXT,sender_name TEXT,ts INTEGER NOT NULL,type TEXT,text TEXT,mime TEXT,file_name TEXT,quoted_id TEXT,raw_json TEXT,deleted_at INTEGER,edited_at INTEGER,view_once INTEGER DEFAULT 0,PRIMARY KEY(remote_jid,message_id));
CREATE INDEX IF NOT EXISTS idx_msg_jid_ts ON messages(remote_jid,ts DESC); CREATE INDEX IF NOT EXISTS idx_msg_text ON messages(text); CREATE INDEX IF NOT EXISTS idx_msg_deleted ON messages(deleted_at); CREATE INDEX IF NOT EXISTS idx_msg_vo ON messages(view_once);
CREATE TABLE IF NOT EXISTS edits(id INTEGER PRIMARY KEY AUTOINCREMENT,remote_jid TEXT NOT NULL,message_id TEXT NOT NULL,old_text TEXT,new_text TEXT,ts INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS reactions(remote_jid TEXT NOT NULL,message_id TEXT NOT NULL,actor_jid TEXT NOT NULL,emoji TEXT,ts INTEGER NOT NULL,PRIMARY KEY(remote_jid,message_id,actor_jid));
CREATE TABLE IF NOT EXISTS receipts(remote_jid TEXT NOT NULL,message_id TEXT NOT NULL,participant_jid TEXT NOT NULL,status TEXT,ts INTEGER NOT NULL,PRIMARY KEY(remote_jid,message_id,participant_jid,status));
CREATE TABLE IF NOT EXISTS presence_events(jid TEXT NOT NULL,status TEXT,ts INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS group_events(id INTEGER PRIMARY KEY AUTOINCREMENT,group_jid TEXT,action TEXT,participants TEXT,ts INTEGER NOT NULL,subject TEXT);
CREATE TABLE IF NOT EXISTS calls(id INTEGER PRIMARY KEY AUTOINCREMENT,peer_jid TEXT,status TEXT,video INTEGER,call_id TEXT,ts INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS devices(jid TEXT NOT NULL,device TEXT NOT NULL,ts INTEGER NOT NULL,PRIMARY KEY(jid,device));
CREATE TABLE IF NOT EXISTS links(id INTEGER PRIMARY KEY AUTOINCREMENT,remote_jid TEXT,message_id TEXT,url TEXT,ts INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS idx_links_url ON links(url); CREATE INDEX IF NOT EXISTS idx_links_ts ON links(ts DESC);
CREATE TABLE IF NOT EXISTS media(id INTEGER PRIMARY KEY AUTOINCREMENT,remote_jid TEXT,message_id TEXT,kind TEXT NOT NULL,file_path TEXT NOT NULL,sha256 TEXT NOT NULL,bytes INTEGER NOT NULL,encrypted INTEGER NOT NULL DEFAULT 0,created_at INTEGER NOT NULL,UNIQUE(remote_jid,message_id,kind,sha256));
CREATE INDEX IF NOT EXISTS idx_media_ts ON media(created_at DESC);
CREATE TABLE IF NOT EXISTS events(id INTEGER PRIMARY KEY AUTOINCREMENT,kind TEXT NOT NULL,remote_jid TEXT,ref_id TEXT,data_json TEXT,ts INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS idx_events_ts ON events(ts DESC); CREATE INDEX IF NOT EXISTS idx_events_kind ON events(kind);
CREATE TABLE IF NOT EXISTS watch(jid TEXT PRIMARY KEY,label TEXT,enabled INTEGER NOT NULL DEFAULT 1,settings_json TEXT,created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS vault_items(id INTEGER PRIMARY KEY AUTOINCREMENT,kind TEXT,source_jid TEXT,message_id TEXT,file_path TEXT,mime TEXT,bytes INTEGER,sha256 TEXT,encrypted INTEGER DEFAULT 1,created_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS idx_vault_ts ON vault_items(created_at DESC);
CREATE TABLE IF NOT EXISTS profile_snapshots(jid TEXT PRIMARY KEY,label TEXT,pp_url TEXT,about TEXT,last_check INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS app_jobs(id INTEGER PRIMARY KEY AUTOINCREMENT,kind TEXT NOT NULL,payload_json TEXT,status TEXT NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,next_at INTEGER NOT NULL,created_at INTEGER NOT NULL);
`);
let fts=false; try{db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(remote_jid,message_id,text,content='messages',content_rowid='rowid');`);fts=true;}catch(e){logger.warn({err:e.message},'FTS5 indisponível');}

const jdump=v=>v==null?null:JSON.stringify(v,(k,val)=>Buffer.isBuffer(val)?{__buffer:val.toString('base64')}:val);
const jload=v=>v?JSON.parse(v,(k,val)=>val&&val.__buffer?Buffer.from(val.__buffer,'base64'):val):null;
export const dbGet=k=>db.prepare('SELECT value FROM kv WHERE key=?').get(k)?.value??null;
export const dbSet=(k,v)=>db.prepare('INSERT INTO kv(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(k,String(v));
export function saveMessage(msg,normalized){
  const k=msg?.key;if(!k?.remoteJid||!k?.id)return;
  const rawJson=jdump(msg.message); const ts=Number(normalized.ts)||Date.now(); const viewOnce=normalized.viewOnce?1:0;
  db.prepare(`INSERT INTO messages(remote_jid,message_id,from_me,sender_jid,sender_name,ts,type,text,mime,file_name,quoted_id,raw_json,view_once) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(remote_jid,message_id) DO UPDATE SET raw_json=COALESCE(excluded.raw_json,messages.raw_json),type=COALESCE(excluded.type,messages.type),text=COALESCE(excluded.text,messages.text),mime=COALESCE(excluded.mime,messages.mime),file_name=COALESCE(excluded.file_name,messages.file_name),view_once=MAX(messages.view_once,excluded.view_once)`).run(k.remoteJid,k.id,k.fromMe?1:0,k.participant||k.participantAlt||k.remoteJid,msg.pushName||null,ts,normalized.type||null,normalized.text||null,normalized.mime||null,normalized.fileName||null,normalized.quotedId||null,rawJson,viewOnce);
  if(fts&&normalized.text){try{const row=db.prepare('SELECT rowid FROM messages WHERE remote_jid=? AND message_id=?').get(k.remoteJid,k.id); if(row?.rowid){db.prepare('DELETE FROM messages_fts WHERE rowid=?').run(row.rowid);db.prepare('INSERT INTO messages_fts(rowid,remote_jid,message_id,text) VALUES(?,?,?,?)').run(row.rowid,k.remoteJid,k.id,normalized.text);}}catch{}}
  return true;
}
export const getStoredMessage=k=>{const r=db.prepare('SELECT raw_json FROM messages WHERE remote_jid=? AND message_id=?').get(k?.remoteJid,k?.id);return r?.raw_json?jload(r.raw_json):null;};
export const getStoredEnvelope=(jid,id)=>db.prepare('SELECT * FROM messages WHERE remote_jid=? AND message_id=?').get(jid,id)||null;
export const markDeleted=(jid,id,at=Date.now())=>db.prepare('UPDATE messages SET deleted_at=? WHERE remote_jid=? AND message_id=?').run(at,jid,id).changes>0;
export const markEdited=(jid,id,oldText,newText,at=Date.now())=>{db.prepare('UPDATE messages SET text=?,edited_at=? WHERE remote_jid=? AND message_id=?').run(newText,at,jid,id);db.prepare('INSERT INTO edits(remote_jid,message_id,old_text,new_text,ts) VALUES(?,?,?,?,?)').run(jid,id,oldText||'',newText||'',at);};
export const searchMessages=(q,limit=50)=>{const n=Math.min(200,Math.max(1,Number(limit)||50));if(fts){try{const rows=db.prepare('SELECT m.remote_jid,m.message_id,m.from_me,m.sender_name,m.ts,m.type,m.text,m.deleted_at,m.edited_at FROM messages m JOIN messages_fts f ON f.rowid=m.rowid WHERE messages_fts MATCH ? ORDER BY m.ts DESC LIMIT ?').all(String(q).replace(/["*:^]/g,' '),n);if(rows.length)return rows;}catch{}}return db.prepare('SELECT remote_jid,message_id,from_me,sender_name,ts,type,text,deleted_at,edited_at FROM messages WHERE text LIKE ? ORDER BY ts DESC LIMIT ?').all(`%${q}%`,n);};
export function searchEverything(q,limit=40){const n=Math.min(100,Math.max(1,Number(limit)||40));const s=`%${q}%`;return {messages:searchMessages(q,n),links:db.prepare('SELECT * FROM links WHERE url LIKE ? ORDER BY ts DESC LIMIT ?').all(s,n),media:db.prepare('SELECT * FROM media WHERE file_path LIKE ? OR kind LIKE ? ORDER BY created_at DESC LIMIT ?').all(s,s,n),events:db.prepare('SELECT * FROM events WHERE kind LIKE ? OR data_json LIKE ? OR remote_jid LIKE ? ORDER BY ts DESC LIMIT ?').all(s,s,s,n)};}
export const recentMessages=(jid,limit=50)=>db.prepare('SELECT * FROM messages WHERE remote_jid=? ORDER BY ts DESC LIMIT ?').all(jid,Math.min(200,Math.max(1,Number(limit)||50)));
export const listDeleted=(jid,limit=30)=>jid?db.prepare('SELECT * FROM messages WHERE remote_jid=? AND deleted_at IS NOT NULL ORDER BY deleted_at DESC LIMIT ?').all(jid,limit):db.prepare('SELECT * FROM messages WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC LIMIT ?').all(limit);
export const listEdits=(jid,id,limit=30)=>db.prepare('SELECT old_text,new_text,ts FROM edits WHERE remote_jid=? AND message_id=? ORDER BY ts DESC LIMIT ?').all(jid,id,limit);
export const saveReaction=r=>db.prepare('INSERT INTO reactions(remote_jid,message_id,actor_jid,emoji,ts) VALUES(?,?,?,?,?) ON CONFLICT(remote_jid,message_id,actor_jid) DO UPDATE SET emoji=excluded.emoji,ts=excluded.ts').run(r.remoteJid,r.messageId,r.actorJid,r.emoji||'',r.ts||Date.now());
export const saveReceipt=r=>db.prepare('INSERT OR IGNORE INTO receipts(remote_jid,message_id,participant_jid,status,ts) VALUES(?,?,?,?,?)').run(r.remoteJid,r.messageId,r.participantJid,r.status||'read',r.ts||Date.now());
export const savePresence=r=>db.prepare('INSERT INTO presence_events(jid,status,ts) VALUES(?,?,?)').run(r.jid,r.status,r.ts||Date.now());
export const saveGroupEvent=r=>db.prepare('INSERT INTO group_events(group_jid,action,participants,ts,subject) VALUES(?,?,?,?,?)').run(r.groupJid,r.action,JSON.stringify(r.participants||[]),r.ts||Date.now(),r.subject||null);
export const saveCall=r=>db.prepare('INSERT INTO calls(peer_jid,status,video,call_id,ts) VALUES(?,?,?,?,?)').run(r.peerJid,r.status,r.video?1:0,r.callId||null,r.ts||Date.now());
export const saveLink=r=>db.prepare('INSERT INTO links(remote_jid,message_id,url,ts) VALUES(?,?,?,?)').run(r.remoteJid,r.messageId,r.url,r.ts||Date.now());
export const saveMedia=r=>db.prepare('INSERT OR IGNORE INTO media(remote_jid,message_id,kind,file_path,sha256,bytes,encrypted,created_at) VALUES(?,?,?,?,?,?,?,?)').run(r.remoteJid,r.messageId,r.kind,r.filePath,r.sha256,r.bytes||0,r.encrypted?1:0,r.createdAt||Date.now());
export const listMedia=(limit=50)=>db.prepare('SELECT * FROM media ORDER BY created_at DESC LIMIT ?').all(limit);
export const listMediaByKind=(kind,limit=10)=>db.prepare('SELECT * FROM media WHERE kind=? ORDER BY created_at DESC LIMIT ?').all(kind,Math.min(50,Math.max(1,Number(limit)||10)));
export const countMediaByKind=(kind,since=0)=>db.prepare('SELECT COUNT(*) c FROM media WHERE kind=? AND created_at>=?').get(kind,since).c;
export const getMediaById=id=>db.prepare('SELECT * FROM media WHERE id=?').get(Number(id))||null;
export const mediaForMessage=(jid,id)=>db.prepare('SELECT * FROM media WHERE remote_jid=? AND message_id=? ORDER BY created_at DESC LIMIT 20').all(jid,id);
export const mediaForMessageKind=(jid,id,kind)=>db.prepare('SELECT * FROM media WHERE remote_jid=? AND message_id=? AND kind=? ORDER BY created_at DESC LIMIT 1').get(jid,id,kind)||null;
export const saveEvent=r=>db.prepare('INSERT INTO events(kind,remote_jid,ref_id,data_json,ts) VALUES(?,?,?,?,?)').run(r.kind,r.remoteJid||null,r.refId||null,jdump(r.data||{}),r.ts||Date.now());
export const listEvents=(kind,limit=100)=>kind?db.prepare('SELECT * FROM events WHERE kind=? ORDER BY ts DESC LIMIT ?').all(kind,limit):db.prepare('SELECT * FROM events ORDER BY ts DESC LIMIT ?').all(limit);
export const listLinks=(limit=100)=>db.prepare('SELECT * FROM links ORDER BY ts DESC LIMIT ?').all(limit);
export const upsertWatch=(jid,label,settings={})=>db.prepare('INSERT INTO watch(jid,label,enabled,settings_json,created_at) VALUES(?,?,1,?,?) ON CONFLICT(jid) DO UPDATE SET label=excluded.label,enabled=1,settings_json=excluded.settings_json').run(jid,label||jid,JSON.stringify(settings),Date.now());
export const removeWatch=jid=>db.prepare('DELETE FROM watch WHERE jid=?').run(jid).changes>0;
export const getWatch=jid=>db.prepare('SELECT * FROM watch WHERE jid=? AND enabled=1').get(jid)||null;
export const listWatch=()=>db.prepare('SELECT * FROM watch WHERE enabled=1 ORDER BY created_at ASC').all();
export const watchSettings=jid=>{const r=getWatch(jid);try{return r?{...r,settings_json:r.settings_json?JSON.parse(r.settings_json):{}}:null;}catch{return r?{...r,settings_json:{}}:null;}};
export const saveVaultItem=r=>db.prepare('INSERT INTO vault_items(kind,source_jid,message_id,file_path,mime,bytes,sha256,encrypted,created_at) VALUES(?,?,?,?,?,?,?,?,?)').run(r.kind,r.sourceJid||null,r.messageId||null,r.filePath,r.mime||null,r.bytes||0,r.sha256,r.encrypted===false?0:1,r.createdAt||Date.now()).lastInsertRowid;
export const listVault=(limit=50)=>db.prepare('SELECT * FROM vault_items ORDER BY created_at DESC LIMIT ?').all(limit);
export const getVaultItem=id=>db.prepare('SELECT * FROM vault_items WHERE id=?').get(Number(id))||null;
export const getProfile=jid=>db.prepare('SELECT * FROM profile_snapshots WHERE jid=?').get(jid)||null;
export const saveProfile=r=>db.prepare('INSERT INTO profile_snapshots(jid,label,pp_url,about,last_check) VALUES(?,?,?,?,?) ON CONFLICT(jid) DO UPDATE SET label=excluded.label,pp_url=excluded.pp_url,about=excluded.about,last_check=excluded.last_check').run(r.jid,r.label||null,r.ppUrl||null,r.about||null,r.lastCheck||Date.now());
export function stats(){return {messages:db.prepare('SELECT COUNT(*) c FROM messages').get().c,chats:db.prepare('SELECT COUNT(DISTINCT remote_jid) c FROM messages').get().c,deleted:db.prepare('SELECT COUNT(*) c FROM messages WHERE deleted_at IS NOT NULL').get().c,edits:db.prepare('SELECT COUNT(*) c FROM edits').get().c,media:db.prepare('SELECT COUNT(*) c FROM media').get().c,mediaBytes:db.prepare('SELECT COALESCE(SUM(bytes),0) c FROM media').get().c,viewOnce:db.prepare('SELECT COUNT(*) c FROM messages WHERE view_once=1').get().c,links:db.prepare('SELECT COUNT(*) c FROM links').get().c,events:db.prepare('SELECT COUNT(*) c FROM events').get().c,groups:db.prepare('SELECT COUNT(*) c FROM group_events').get().c};}
export const exportRows=(jid,limit)=>jid?db.prepare('SELECT * FROM messages WHERE remote_jid=? ORDER BY ts ASC LIMIT ?').all(jid,limit):[];
export const closeDb=()=>db.close();
