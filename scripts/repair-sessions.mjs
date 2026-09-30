// Conserta "Bad MAC" / "No matching sessions found" SEM precisar parear o WhatsApp de novo.
//
// Apaga só as sessões de criptografia por contato (session-*, sender-key-*), que o WhatsApp recria
// sozinho na próxima mensagem. A conta (creds.json), pre-keys e app-state são mantidos.
// Uma cópia de segurança de data/auth fica em data/auth-backup-<data>.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const auth = path.join(root, 'data', 'auth');
const lock = path.join(root, 'data', 'bot.lock');

if (!fs.existsSync(path.join(auth, 'creds.json'))) {
  console.log('ℹ️ Nenhuma sessão encontrada em data/auth — nada para consertar.');
  process.exit(0);
}

try {
  const pid = Number.parseInt(fs.readFileSync(lock, 'utf8'), 10);
  if (pid) { process.kill(pid, 0); console.log(`⛔ O bot está rodando (PID ${pid}). Pare antes: ./bot.sh stop`); process.exit(1); }
} catch (e) { if (e?.code === 'EPERM') { console.log('⛔ O bot está rodando. Pare antes: ./bot.sh stop'); process.exit(1); } }

const victims = fs.readdirSync(auth).filter((f) => /^(session|sender-key|sender-key-memory)-.*\.json$/.test(f));
if (!victims.length) { console.log('✅ Não há sessões de contatos para limpar.'); process.exit(0); }

const backup = path.join(root, 'data', `auth-backup-${new Date().toISOString().replace(/[:.]/g, '-')}`);
fs.cpSync(auth, backup, { recursive: true });
for (const f of victims) fs.rmSync(path.join(auth, f), { force: true });

// mantém só os 3 backups mais recentes
const olds = fs.readdirSync(path.join(root, 'data')).filter((f) => f.startsWith('auth-backup-')).sort().slice(0, -3);
for (const f of olds) fs.rmSync(path.join(root, 'data', f), { recursive: true, force: true });

console.log(`✅ ${victims.length} sessões de contatos reiniciadas (backup em ${path.relative(root, backup)}).`);
console.log('   Agora inicie o bot (UMA única cópia):  ./bot.sh start');
