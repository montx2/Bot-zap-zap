// 📸 Instagram — estratégias em cascata:
//   1) scraping leve da página do post (og:video / og:image)
//   2) endpoint __a=1&__d=dis (quando liberado pelo IP)
//   3) Cobalt (pool de instâncias)

import { fetchText, fetchJson } from '../../core/http.js';
import { log } from '../../core/logger.js';
import { cobaltDownload } from './cobalt.js';

export function isInstagramUrl(url) {
  return /instagram\.com|instagr\.am/i.test(url);
}

function pickFromHtml(html) {
  const media = [];
  const ogVideo = html.match(/property="og:video(?::url)?"\s+content="([^"]+)"/)?.[1];
  if (ogVideo) media.push({ type: 'video', url: ogVideo, label: 'og:video' });
  if (!media.length) {
    const ogImage = html.match(/property="og:image"\s+content="([^"]+)"/)?.[1];
    if (ogImage) media.push({ type: 'image', url: ogImage, label: 'og:image' });
  }
  // vídeos inline no HTML (reels públicos às vezes expõem)
  for (const m of html.matchAll(/"(?:video_url|url)":"(https:[^"]+?\.mp4[^"]*?)"/g)) {
    media.push({ type: 'video', url: m[1].replace(/\\u0026/g, '&'), label: 'inline' });
  }
  const unique = [];
  const seen = new Set();
  for (const item of media) {
    if (!seen.has(item.url)) {
      seen.add(item.url);
      unique.push(item);
    }
  }
  return unique;
}

export async function downloadInstagram(url, quality = 'melhor') {
  const errors = [];

  // 1) HTML direto
  try {
    const html = await fetchText(url, { headers: { accept: 'text/html' }, timeoutMs: 30_000 });
    const media = pickFromHtml(html);
    if (media.length) {
      return { platform: 'Instagram', title: html.match(/property="og:title"\s+content="([^"]*)"/)?.[1] || '', kind: media[0].type, media };
    }
    errors.push('html sem mídia');
  } catch (error) {
    errors.push(`html: ${error.message.slice(0, 60)}`);
  }

  // 2) endpoint interno __a=1
  try {
    const code = url.match(/instagram\.com\/(?:p|reel|reels|tv)\/([\w-]+)/)?.[1];
    if (code) {
      const json = await fetchJson(`https://www.instagram.com/p/${code}/?__a=1&__d=dis`, { timeoutMs: 30_000 });
      const media = extractFromGraphql(json);
      if (media.length) {
        return { platform: 'Instagram', title: '', kind: media[0].type, media };
      }
      errors.push('__a=1 sem mídia');
    }
  } catch (error) {
    errors.push(`__a=1: ${error.message.slice(0, 60)}`);
  }

  // 3) Cobalt
  log.dl('instagram: tentando via cobalt…');
  const { buffers, audioBuffer, kind } = await cobaltDownload(url, quality);
  if (!buffers.length) throw new Error(`Instagram falhou em todas as estratégias: ${errors.join(' | ')}`);
  return {
    platform: 'Instagram',
    title: '',
    kind: kind === 'picker' ? 'carrossel' : 'video',
    buffers,
    audioBuffer
  };
}

function extractFromGraphql(json) {
  const out = [];
  const post = json?.items?.[0] || json?.graphql?.shortcode_media;
  if (!post) return out;
  if (post.video_url) out.push({ type: 'video', url: post.video_url, label: 'graphql' });
  if (post.display_url) out.push({ type: 'image', url: post.display_url, label: 'graphql' });
  const children = post.carousel_media || post.edge_sidecar_to_children?.edges || [];
  for (const child of children) {
    const node = child.node || child;
    if (node.video_url) out.push({ type: 'video', url: node.video_url, label: 'carousel' });
    else if (node.display_url) out.push({ type: 'image', url: node.display_url, label: 'carousel' });
  }
  return out;
}
