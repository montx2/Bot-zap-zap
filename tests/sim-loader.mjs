const sim = new URL('./sim-baileys.mjs', import.meta.url).href;
export async function resolve(specifier, context, nextResolve) {
  if (specifier === '@whiskeysockets/baileys') return { url: sim, shortCircuit: true };
  return nextResolve(specifier, context);
}
