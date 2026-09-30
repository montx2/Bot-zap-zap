// Salva o número para pareamento por código: node scripts/pair.mjs 5511999999999
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const DATA_DIR = process.env.NEXUS_DATA_DIR || path.join(ROOT, 'data');

const digits = String(process.argv[2] || '').replace(/\D/g, '');
if (!/^\d{10,15}$/.test(digits)) {
  console.error('❌ Número inválido. Use DDI + DDD + número, só dígitos.');
  console.error('   Ex.: npm run pair -- 5537999999999');
  process.exit(1);
}

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.writeFileSync(path.join(DATA_DIR, 'pairing-number.txt'), digits + '\n', { mode: 0o600 });
console.log(`✅ Número salvo: +${digits}`);
console.log('🚀 Agora rode: npm start');
console.log('📱 No WhatsApp: Dispositivos conectados → Conectar com número de telefone');
