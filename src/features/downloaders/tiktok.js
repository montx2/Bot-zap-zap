// 🎵 TikTok — via API TikWM (sem marca d'água, com qualidade HD original).
// Suporta: vídeo, slideshow de fotos e música.

import { KeyPool } from '../../core/keypool.js';
import { ENV } from '../../core/config.js';
import { fetchJson } from '../../core/http.js';

const DEFAULT_ENDPOINTS = ['https://www.tikwm.com/api/', 'https://tikwm.com/api/'];
const pool = new KeyPool('tikwm', ENV.tiktokApi.length ? ENV.tiktokApi : DEFAULT_ENDPOINTS, {
  cooldownMs: 10 * 60_000
});

export function isTikTokUrl(url) {
  return /tiktok\.com|vm\.tiktok|vt\.tiktok/i.test(url);
}

/**
 * @param {string} url link do TikTok
 * @param {'melhor'|'alta'|'media'|'baixa'} quality
 */
export async function downloadTikTok(url, quality = 'melhor') {
  const data = await pool.run(async (endpoint) => {
    const target = `${endpoint}?url=${encodeURIComponent(url)}&hd=1`;
    const json = await fetchJson(target, { timeoutMs: 60_000 });
    if (json?.code !== 0 || !json?.data) {
      const err = new Error(json?.msg || 'tikwm não retornou dados');
      err.status = 422;
      throw err;
    }
    return json.data;
  });

  const out = {
    platform: 'TikTok',
    title: data.title || '',
    author: data.author?.nickname || data.author?.unique_id || '',
    duration: data.duration || 0,
    cover: data.cover || data.origin_cover || '',
    media: [],
    audioOnly: null
  };

  // Slideshow (carrossel de fotos)
  if (Array.isArray(data.images) && data.images.length) {
    out.kind = 'slideshow';
    out.media = data.images.map((u) => ({ type: 'image', url: u, quality: 'original' }));
    return out;
  }

  const options = [];
  if (data.hdplay) options.push({ type: 'video', url: data.hdplay, quality: 'melhor', size: data.hd_size, label: 'HD sem marca' });
  if (data.play) options.push({ type: 'video', url: data.play, quality: 'media', size: data.size, label: 'sem marca' });
  if (data.wmplay) options.push({ type: 'video', url: data.wmplay, quality: 'baixa', size: data.wm_size, label: 'com marca' });

  if (!options.length) throw new Error('TikWM não devolveu links de vídeo');

  out.kind = 'video';
  out.musicUrl = data.music || data.music_info?.play || null;
  out.audioOnly = out.musicUrl ? { type: 'audio', url: out.musicUrl, label: data.music_info?.title || 'áudio' } : null;

  // seleção por qualidade
  if (quality === 'melhor' || quality === 'alta') {
    out.media = [options[0]];
  } else if (quality === 'media') {
    out.media = [options.find((o) => o.quality === 'media') || options[0]];
  } else {
    out.media = [options[options.length - 1]];
  }
  return out;
}

/** Só a música do vídeo. */
export async function tiktokAudio(url) {
  const result = await downloadTikTok(url, 'melhor');
  if (result.audioOnly) return result;
  // sem música separada: devolve o próprio vídeo como áudio será tratado pelo caller
  result.kind = 'video';
  return result;
}

export function tiktokPool() {
  return pool;
}
