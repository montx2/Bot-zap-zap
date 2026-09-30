import { pathToFileURL } from 'node:url';

const baileys = new URL('./mock-baileys.mjs', import.meta.url).href;
const pino = new URL('./mock-pino.mjs', import.meta.url).href;

export async function resolve(specifier, context, nextResolve) {
  if (specifier === '@whiskeysockets/baileys') return { url: baileys, shortCircuit: true };
  if (specifier === 'pino') return { url: pino, shortCircuit: true };
  return nextResolve(specifier, context);
}
