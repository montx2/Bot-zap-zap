// Decodificação de WebP animado (figurinhas animadas) para vídeo/imagem.
// O FFmpeg 7.0 não lê WebP animado, então os frames são decodificados um a um,
// compostos em JS (offset/blend/dispose) e enviados como rawvideo ao FFmpeg.

import { once } from 'node:events';
import { runFfmpeg } from './media.js';
import { composeFrames, frameTiming, parseWebp, opaqueBbox, unionBbox } from './webp.js';

/** Um quadro (WebP standalone) para RGBA cru. Exportado para medições de opacidade. */
export async function decodeWebpFrame(webp) {
  const { stdout } = await runFfmpeg(['-f', 'webp_pipe', '-i', 'pipe:0', '-f', 'rawvideo', '-pix_fmt', 'rgba', 'pipe:1'], { stdin: webp, stdout: true, timeoutMs: 30_000 });
  return stdout;
}

/**
 * Converte um WebP animado para `outFile` usando `outArgs` (args de saída do FFmpeg).
 * @param {Buffer} buf WebP animado
 * @param {{outFile:string,outArgs?:string[],background?:number[]|null,maxFrames?:number,maxSeconds?:number,measure?:boolean}} o
 * @returns {{width:number,height:number,frames:number,durationMs:number,bbox:object|null}}
 *   `measure:true` também devolve a caixa opaca (união dos quadros) — custo quase zero.
 */
export async function decodeAnimatedWebp(buf, { outFile, outArgs = [], background = null, maxFrames = 600, maxSeconds = 30, measure = false } = {}) {
  const info = parseWebp(buf);
  if (!info.animated) throw new Error('WebP não é animado');
  // Limita a duração total e o número de frames.
  let frames = 0;
  let acc = 0;
  for (const d of frameTiming(info, { maxFrames }).durs) { if (acc >= maxSeconds * 1000) break; acc += d; frames++; }
  const limit = Math.max(1, Math.min(maxFrames, frames));
  const timing = frameTiming(info, { maxFrames: limit });
  let bbox = null;
  await runFfmpeg([
    '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${info.width}x${info.height}`,
    '-framerate', String(1000 / timing.tickMs), '-i', 'pipe:0', ...outArgs, '-y', outFile
  ], {
    timeoutMs: 240_000,
    stdinStream: async (stdin) => {
      for await (const fr of composeFrames(buf, decodeWebpFrame, { maxFrames: limit, background })) {
        if (measure) bbox = unionBbox(bbox, opaqueBbox(fr.rgba, fr.width, fr.height, 2));
        for (let i = 0; i < fr.repeat; i++) {
          if (!stdin.write(fr.rgba)) await once(stdin, 'drain');
        }
      }
    }
  });
  return { width: info.width, height: info.height, frames: limit, durationMs: acc, bbox };
}

/** Primeiro frame de qualquer WebP como PNG (com transparência). */
export async function webpToPng(buf, outFile) {
  const info = parseWebp(buf);
  if (info.animated) {
    await decodeAnimatedWebp(buf, { outFile, outArgs: ['-frames:v', '1'], maxFrames: 1 });
  } else {
    await runFfmpeg(['-f', 'webp_pipe', '-i', 'pipe:0', '-frames:v', '1', '-y', outFile], { stdin: buf, timeoutMs: 30_000 });
  }
  return outFile;
}
