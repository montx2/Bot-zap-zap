// 🌐 Cobalt — downloader universal (YouTube, Instagram, X/Twitter, Facebook,
// Threads, Reddit, Snapchat, Vimeo, Twitch, SoundCloud e centenas de outros).
// Usa um POOL de instâncias comunitárias: se uma cair ou limitar, gira pra próxima.
// Adicione as suas em COBALT_INSTANCES no .env.

import { KeyPool } from '../../core/keypool.js';
import { ENV } from '../../core/config.js';
import { postJson, fetchBuffer } from '../../core/http.js';
import { log } from '../../core/logger.js';

const DEFAULT_INSTANCES = [
  'https://cobalt-backend.canine.tools',
  'https://cobalt-api.meowing.de',
  'https://capi.3kh0.net'
];

const pool = new KeyPool(
  'cobalt',
  ENV.cobaltInstances.length ? ENV.cobaltInstances : DEFAULT_INSTANCES,
  { cooldownMs: 15 * 60_000 }
);

const QUALITY_MAP = {
  melhor: 'max',
  alta: '1080',
  media: '720',
  baixa: '480'
};

/**
 * Baixa qualquer URL suportada pelo Cobalt.
 * @returns {{urls: string[], audio?: string, kind: string}}
 */
export async function cobaltDownload(url, quality = 'melhor', { audioOnly = false } = {}) {
  const body = {
    url,
    videoQuality: QUALITY_MAP[quality] || 'max',
    audioFormat: 'mp3',
    audioBitrate: '320',
    filenameStyle: 'basic',
    downloadMode: audioOnly ? 'audio' : 'auto'
  };

  const result = await pool.run(
    async (instance) => {
      const data = await postJson(`${instance.replace(/\/$/, '')}/`, body, {
        headers: { accept: 'application/json' },
        timeoutMs: 60_000
      });
      if (data?.status === 'error') {
        const err = new Error(data?.error?.code || 'cobalt error');
        // erros de conteúdo/suporte não devem esfriar a instância
        if (!String(data?.error?.code || '').includes('content')) err.status = 422;
        throw err;
      }
      if (data?.status === 'tunnel' || data?.status === 'redirect' || data?.status === 'stream') {
        return { urls: [data.url], kind: data.url && /\.mp3|audio/i.test(data.url) ? 'audio' : 'video' };
      }
      if (data?.status === 'picker' && Array.isArray(data.picker)) {
        return {
          urls: data.picker.filter((p) => p.url).map((p) => p.url),
          audio: data.audio,
          kind: 'picker'
        };
      }
      if (data?.status === 'local-processing') {
        // instância pede processamento local — não suportamos; tenta outra
        const err = new Error('cobalt pediu local-processing');
        err.status = 422;
        throw err;
      }
      throw new Error(`cobalt status inesperado: ${data?.status}`);
    },
    {
      label: url,
      isExhausted: (e) => {
        const s = Number(e?.status);
        return [429, 502, 503].includes(s) || /rate|limit|unavailable|fetch/i.test(String(e?.message || ''));
      }
    }
  );

  // baixa os buffers
  const buffers = [];
  for (const link of result.urls.slice(0, 10)) {
    log.dl(`cobalt: baixando ${String(link).slice(0, 60)}…`);
    const buffer = await fetchBuffer(link, { timeoutMs: 180_000, maxBytes: 200 * 1024 * 1024 });
    buffers.push(buffer);
  }
  let audioBuffer = null;
  if (result.audio) {
    try {
      audioBuffer = await fetchBuffer(result.audio, { timeoutMs: 120_000 });
    } catch {}
  }
  return { buffers, audioBuffer, kind: result.kind };
}

export function cobaltPool() {
  return pool;
}
