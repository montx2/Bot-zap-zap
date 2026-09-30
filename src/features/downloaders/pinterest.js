// 📌 Pinterest — scraper próprio (payload SSR __PWS_DATA) + API pública de fallback.
// Baixa: imagens em tamanho ORIGINAL, vídeos na melhor qualidade, GIFs.

import { KeyPool } from '../../core/keypool.js';
import { fetchText, fetchJson, resolveRedirect, shortUrl } from '../../core/http.js';
import { log } from '../../core/logger.js';

const FALLBACK_API = 'https://api.bhawanigarg.com/social/pinterest/?url=';
const fallbackPool = new KeyPool('pin-fallback', [FALLBACK_API], { cooldownMs: 15 * 60_000 });

export function isPinterestUrl(url) {
  return /(pinterest\.[a-z.]+|pin\.it)/i.test(url);
}

function extractPinId(url) {
  const m = url.match(/\/pin\/(?:[\w-]+\/)?(\d+)/i) || url.match(/pin\.it\/(\w+)/i);
  return m ? m[1] : null;
}

function deepFind(obj, key, depth = 0) {
  if (!obj || depth > 6) return null;
  if (typeof obj !== 'object') return null;
  if (obj[key] !== undefined) return obj[key];
  for (const v of Object.values(obj)) {
    const found = deepFind(v, key, depth + 1);
    if (found) return found;
  }
  return null;
}

/** Escolhe o melhor vídeo do video_list do Pinterest. */
function bestVideo(pin, quality) {
  const list = pin?.videos?.video_list;
  if (!list) return null;
  const entries = Object.entries(list)
    .filter(([, v]) => v?.url)
    .map(([name, v]) => ({ name, url: v.url, width: v.width || 0, height: v.height || 0 }))
    .sort((a, b) => b.width * b.height - a.width * a.height);
  if (!entries.length) return null;
  if (quality === 'baixa') return entries[entries.length - 1];
  if (quality === 'media') return entries[Math.min(1, entries.length - 1)];
  return entries[0]; // melhor/alta
}

/** Parse do payload SSR da página do pin. */
function parsePwsData(html) {
  const m = html.match(/<script id="__PWS_DATA__" type="application\/json">(.*?)<\/script>/s);
  if (!m) return null;
  try {
    return JSON.parse(m[1]);
  } catch {
    return null;
  }
}

function findPinInPws(pws) {
  const state = pws?.props?.initialReduxState;
  if (!state) return null;
  if (state.pin && (state.pin.images || state.pin.videos)) return state.pin;
  if (state.pins && typeof state.pins === 'object') {
    for (const pin of Object.values(state.pins)) {
      if (pin && (pin.images || pin.videos)) return pin;
    }
  }
  return null;
}

/** Fallback: extrai URLs de mídia direto do HTML (og: tags e JSON solto). */
function scrapeHtmlFallback(html) {
  const ogVideo = html.match(/property="og:video(?::url)?"\s+content="([^"]+)"/)?.[1];
  if (ogVideo) return [{ type: 'video', url: ogVideo, label: 'og:video', quality: 'media' }];
  const ogImage = html.match(/property="og:image"\s+content="([^"]+)"/)?.[1];
  if (ogImage) return [{ type: 'image', url: ogImage.replace(/\/\d+x\d*\//, '/originals/'), label: 'og:image', quality: 'media' }];
  // último recurso: procura URL de CDN do pinimg
  const vids = [...html.matchAll(/https:\/\/v1\.pinimg\.com\/videos\/[^"\\\s]+\.mp4/g)].map((m) => m[0]);
  if (vids.length) return [{ type: 'video', url: vids.sort((a, b) => b.length - a.length)[0], label: 'cdn', quality: 'media' }];
  const imgs = [...html.matchAll(/https:\/\/i\.pinimg\.com\/originals\/[^"\\\s]+\.(?:jpg|png|gif)/g)].map((m) => m[0]);
  if (imgs.length) return [{ type: 'image', url: imgs[0], label: 'cdn', quality: 'original' }];
  return [];
}

/**
 * @param {string} url link do Pinterest (aceita pin.it)
 * @param {'melhor'|'alta'|'media'|'baixa'} quality
 */
export async function downloadPinterest(url, quality = 'melhor') {
  const finalUrl = await resolveRedirect(url).catch(() => url);
  log.dl(`pinterest: ${shortUrl(finalUrl)}`);

  let html = null;
  try {
    html = await fetchText(finalUrl, {
      headers: { accept: 'text/html,application/xhtml+xml' },
      timeoutMs: 30_000
    });
  } catch (error) {
    log.warn(`pinterest: HTML falhou (${error.message})`);
  }

  if (html) {
    const pws = parsePwsData(html);
    const pin = pws ? findPinInPws(pws) : null;

    if (pin) {
      const out = {
        platform: 'Pinterest',
        title: pin.title || pin.grid_description || '',
        author: pin.pinner?.username || '',
        kind: 'image'
      };
      const video = bestVideo(pin, quality);
      if (video) {
        out.kind = 'video';
        out.media = [{ type: 'video', url: video.url, label: `${video.name} (${video.width}x${video.height})`, quality }];
        return out;
      }
      const images = pin.images;
      if (images) {
        const best = images.orig || images['736x'] || images['564x'] || Object.values(images).sort((a, b) => (b.width || 0) - (a.width || 0))[0];
        if (best?.url) {
          const isGif = /\.gif/i.test(best.url);
          out.kind = isGif ? 'gif' : 'image';
          let target = best.url;
          if (quality === 'baixa' && images['564x']?.url) target = images['564x'].url;
          else if (quality === 'media' && images['736x']?.url) target = images['736x'].url;
          out.media = [{ type: isGif ? 'gif' : 'image', url: target, label: `original ${best.width || ''}x${best.height || ''}`.trim(), quality }];
          return out;
        }
      }
    }

    const scraped = scrapeHtmlFallback(html);
    if (scraped.length) {
      return { platform: 'Pinterest', title: '', kind: scraped[0].type, media: scraped };
    }
  }

  // Fallback: API pública
  const media = await fallbackPool.run(async (endpoint) => {
    const json = await fetchJson(endpoint + encodeURIComponent(finalUrl), { timeoutMs: 45_000 });
    const found = collectUrls(json);
    if (!found.length) throw new Error('API de fallback sem resultado');
    return found;
  });

  return { platform: 'Pinterest', title: '', kind: media[0].type, media };
}

function collectUrls(obj, out = []) {
  if (!obj || typeof obj !== 'object') return out;
  if (typeof obj === 'string') return out;
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === 'string' && /^https?:/.test(v) && /(pinimg|\.mp4|\.jpg|\.jpeg|\.png|\.gif)/i.test(v)) {
      out.push({ type: /\.mp4/i.test(v) ? 'video' : /\.gif/i.test(v) ? 'gif' : 'image', url: v, label: k, quality: 'api' });
    } else if (v && typeof v === 'object') {
      collectUrls(v, out);
    }
  }
  return out;
}
