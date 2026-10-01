// 🧠 IA — chat, imagens, voz, tradução e resumo.
//
// Provedores de texto (pool com rotação de chaves, igual você gosta):
//   AI_KEYS + AI_BASE_URL  → qualquer API compatível com OpenAI (OpenRouter, Groq, DeepSeek...)
//   GROQ_KEYS              → Groq (grátis e rápido)
//   OPENAI_KEYS            → OpenAI
//   GEMINI_KEYS            → Google Gemini
//   POLLINATIONS_KEYS      → Pollinations (chave grátis em enter.pollinations.ai)
//
// Imagem e voz: Pollinations (precisa de chave desde que migrou para gen.pollinations.ai).

import { KeyPool } from '../core/keypool.js';
import { ENV, cfg } from '../core/config.js';
import { postJson, fetchBuffer, fetchText, sleep } from '../core/http.js';
import { log } from '../core/logger.js';

// ── Pools de chaves ────────────────────────────────────────
const pools = {
  ai: new KeyPool('ai-custom', ENV.aiKeys, { cooldownMs: 10 * 60_000 }),
  groq: new KeyPool('groq', ENV.groqKeys, { cooldownMs: 5 * 60_000 }),
  openai: new KeyPool('openai', ENV.openaiKeys, { cooldownMs: 10 * 60_000 }),
  gemini: new KeyPool('gemini', ENV.geminiKeys, { cooldownMs: 5 * 60_000 }),
  pollinations: new KeyPool('pollinations', ENV.pollinationsKeys, { cooldownMs: 5 * 60_000 })
};

// Tenta modelos em ordem; 404/400 passa para o próximo. Fixe com GEMINI_MODEL.
const GEMINI_MODELS = ENV.geminiModels.length
  ? ENV.geminiModels
  : ['gemini-flash-latest', 'gemini-3.5-flash', 'gemini-2.5-flash'];
const POLLI_GEN = 'https://gen.pollinations.ai';
const NO_PROVIDER_HELP =
  'Nenhuma IA configurada. Crie uma chave GRÁTIS em aistudio.google.com (Gemini) ou console.groq.com ' +
  'e coloque GEMINI_KEYS=... ou GROQ_KEYS=... no arquivo .env (depois reinicie o bot).';

// Memória curta por chat para .ia
const memory = new Map(); // jid -> { turns: [], ts }
const MEMORY_TTL = 30 * 60_000;
const MEMORY_MAX = 10;

export function resetChatMemory(jid) {
  memory.delete(jid);
}

function remember(jid, role, content) {
  let m = memory.get(jid);
  if (!m || Date.now() - m.ts > MEMORY_TTL) m = { turns: [], ts: Date.now() };
  m.turns.push({ role, content });
  if (m.turns.length > MEMORY_MAX) m.turns = m.turns.slice(-MEMORY_MAX);
  m.ts = Date.now();
  memory.set(jid, m);
}

// ── Chamadas por provedor ──────────────────────────────────
async function openAICompat(base, key, model, messages) {
  const data = await postJson(
    `${base.replace(/\/$/, '')}/chat/completions`,
    { model, messages, max_tokens: 1200, temperature: 0.7 },
    { headers: { authorization: `Bearer ${key}` }, timeoutMs: 90_000 }
  );
  const text = data?.choices?.[0]?.message?.content;
  if (!text) throw new Error('resposta vazia');
  return text.trim();
}

async function geminiCall(key, messages) {
  const system = messages.find((m) => m.role === 'system')?.content;
  const contents = messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }));
  const body = { contents };
  if (system) body.systemInstruction = { parts: [{ text: system }] };
  let lastError;
  for (const model of GEMINI_MODELS) {
    try {
      const data = await postJson(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
        body,
        { headers: { 'x-goog-api-key': key }, timeoutMs: 90_000 }
      );
      const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('');
      if (!text) throw new Error(`resposta vazia do gemini (${model})`);
      return text.trim();
    } catch (error) {
      lastError = error;
      if (error?.status !== 404 && error?.status !== 400) throw error;
    }
  }
  throw lastError;
}

async function pollinationsText(messages) {
  if (pools.pollinations.size) {
    return pools.pollinations.run((key) =>
      openAICompat(`${POLLI_GEN}/v1`, key, ENV.pollinationsModel, messages)
    );
  }
  // Endpoint antigo como última tentativa (hoje costuma responder 402).
  return openAICompat('https://text.pollinations.ai/openai', '', 'openai', messages);
}

/** Chat com fallback em cascata por todos os pools. */
export async function aiChat(jid, userText) {
  const system = cfg.get().ia.sistema;
  const m = memory.get(jid);
  const history = m && Date.now() - m.ts <= MEMORY_TTL ? m.turns : [];
  const messages = [{ role: 'system', content: system }, ...history, { role: 'user', content: userText }];

  const attempts = [];
  const model = ENV.aiModel || 'gpt-4o-mini';

  if (pools.ai.size) attempts.push(() => pools.ai.run((key) => openAICompat(ENV.aiBase || ENV.openaiBase, key, ENV.aiModel || model, messages)));
  if (pools.groq.size) attempts.push(() => pools.groq.run((key) => openAICompat('https://api.groq.com/openai/v1', key, ENV.groqModel, messages)));
  if (pools.openai.size) attempts.push(() => pools.openai.run((key) => openAICompat('https://api.openai.com/v1', key, model, messages)));
  if (pools.gemini.size) attempts.push(() => pools.gemini.run((key) => geminiCall(key, messages)));
  attempts.push(() => pollinationsText(messages));

  const errors = [];
  for (const attempt of attempts) {
    try {
      const reply = await attempt();
      remember(jid, 'user', userText);
      remember(jid, 'assistant', reply);
      return reply;
    } catch (error) {
      errors.push(String(error.message || error).slice(0, 100));
      log.warn(`IA falhou, tentando próximo provedor: ${String(error.message || error).slice(0, 100)}`);
      await sleep(300);
    }
  }
  const hasKeys = pools.ai.size || pools.groq.size || pools.openai.size || pools.gemini.size || pools.pollinations.size;
  throw new Error((hasKeys ? 'Todos os provedores de IA falharam' : NO_PROVIDER_HELP) + `: ${errors.join(' | ').slice(0, 300)}`);
}

// ── Geração de imagem (Pollinations) ───────────────────────
export async function aiImage(prompt, { width = 1024, height = 1024, model } = {}) {
  const m = model || cfg.get().ia.modeloImagem || 'flux';
  const seed = Math.floor(Math.random() * 1_000_000_000);
  const qs = `width=${width}&height=${height}&seed=${seed}&model=${m}&nologo=true&safe=true`;
  log.ai(`gerando imagem: "${prompt.slice(0, 60)}"`);
  let buffer;
  if (pools.pollinations.size) {
    buffer = await pools.pollinations.run((key) =>
      fetchBuffer(`${POLLI_GEN}/image/${encodeURIComponent(prompt)}?${qs}&key=${encodeURIComponent(key)}`, {
        timeoutMs: 180_000, maxBytes: 40 * 1024 * 1024
      })
    );
  } else {
    try {
      buffer = await fetchBuffer(`https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?${qs}&referrer=nexusbot`, {
        timeoutMs: 180_000, maxBytes: 40 * 1024 * 1024
      });
    } catch (error) {
      throw new Error('Geração de imagem precisa de uma chave grátis do Pollinations: crie em enter.pollinations.ai e ' +
        `coloque POLLINATIONS_KEYS=... no .env (${String(error.message).slice(0, 80)})`);
    }
  }
  if (buffer.length < 1024) throw new Error('imagem gerada vazia');
  return buffer;
}

// ── Voz (Pollinations audio) ───────────────────────────────
export async function aiVoice(text, voice) {
  const v = voice || cfg.get().ia.vozPadrao || 'nova';
  let buffer;
  if (pools.pollinations.size) {
    buffer = await pools.pollinations.run((key) =>
      fetchBuffer(`${POLLI_GEN}/audio/${encodeURIComponent(text)}?voice=${v}&key=${encodeURIComponent(key)}`, {
        timeoutMs: 120_000, maxBytes: 25 * 1024 * 1024
      })
    );
  } else {
    try {
      buffer = await fetchBuffer(`https://text.pollinations.ai/${encodeURIComponent(text)}?model=openai-audio&voice=${v}`, {
        timeoutMs: 120_000, maxBytes: 25 * 1024 * 1024
      });
    } catch (error) {
      throw new Error('Voz precisa de uma chave grátis do Pollinations: crie em enter.pollinations.ai e ' +
        `coloque POLLINATIONS_KEYS=... no .env (${String(error.message).slice(0, 80)})`);
    }
  }
  if (buffer.length < 2048) throw new Error('áudio vazio');
  return buffer;
}

// ── Tradução / resumo via chat ─────────────────────────────
export async function aiTranslate(text, target = 'português do Brasil') {
  return aiChatRaw(
    `Você é um tradutor profissional. Traduza EXATAMENTE o texto abaixo para ${target}. ` +
      `Devolve só a tradução, nada mais.\n\nTexto:\n${text}`
  );
}

export async function aiSummary(text) {
  return aiChatRaw(
    'Resuma o texto abaixo em português, em bullets curtos e claros, destacando o essencial. Máximo 10 linhas.\n\n' + text
  );
}

async function aiChatRaw(prompt) {
  const messages = [{ role: 'user', content: prompt }];
  const attempts = [];
  if (pools.ai.size) attempts.push(() => pools.ai.run((key) => openAICompat(ENV.aiBase || ENV.openaiBase, key, ENV.aiModel || 'gpt-4o-mini', messages)));
  if (pools.groq.size) attempts.push(() => pools.groq.run((key) => openAICompat('https://api.groq.com/openai/v1', key, ENV.groqModel, messages)));
  if (pools.openai.size) attempts.push(() => pools.openai.run((key) => openAICompat('https://api.openai.com/v1', key, 'gpt-4o-mini', messages)));
  if (pools.gemini.size) attempts.push(() => pools.gemini.run((key) => geminiCall(key, messages)));
  attempts.push(() => pollinationsText(messages));
  const errors = [];
  for (const attempt of attempts) {
    try {
      return await attempt();
    } catch (error) {
      errors.push(String(error.message || error).slice(0, 80));
    }
  }
  const hasKeys = pools.ai.size || pools.groq.size || pools.openai.size || pools.gemini.size || pools.pollinations.size;
  throw new Error(`${hasKeys ? 'IA indisponível' : NO_PROVIDER_HELP}: ${errors.join(' | ').slice(0, 200)}`);
}

export function aiStatus() {
  const rows = [];
  for (const [name, pool] of Object.entries(pools)) {
    rows.push(pool.size ? `${name}: ${pool.available}/${pool.size} chaves` : null);
  }
  if (!rows.some(Boolean)) rows.push('⚠️ nenhuma chave de IA — configure GEMINI_KEYS ou GROQ_KEYS no .env');
  return rows.filter(Boolean);
}
