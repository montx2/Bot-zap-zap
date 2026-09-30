import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const connection = fs.readFileSync(path.join(root, 'src/core/connection.js'), 'utf8');
const config = fs.readFileSync(path.join(root, 'src/core/config.js'), 'utf8');

const required = [
  'fetchLatestWaWebVersion',
  'fetchLatestBaileysVersion',
  'WA_VERSION_OVERRIDE',
  "browser: Browsers.macOS('Chrome')",
  'health probe timed out',
  'keepAliveIntervalMs: CONFIG.KEEP_ALIVE_INTERVAL_MS',
  'defaultQueryTimeoutMs: CONFIG.DEFAULT_QUERY_TIMEOUT_MS',
  'fireInitQueries: false',
  'wa-web-version.json'
];

for (const marker of required) {
  if (!connection.includes(marker) && !config.includes(marker)) {
    throw new Error(`marcador ausente: ${marker}`);
  }
}

console.log('✅ Conexão resiliente: estrutura verificada');
