// Configuração persistente do NEXUS (data/config.json).
// Tudo que o usuário pode ligar/desligar em tempo real fica aqui.
// Padrões: Anti-Delete ATIVO em tudo, View Once ativo, auto-download ativo.

import { readJson, writeJsonNow, writeJsonDebounced } from './store.js';
import { envList, envBool } from './env.js';

export const DEFAULT_CONFIG = {
  nomeBot: '⚡ NEXUS',
  nomePack: 'NEXUS ⚡',
  autorPack: 'feito com amor',
  prefixos: ['.', '!', '/', '#'],

  // ── View Once ─────────────────────────────────────────────
  viewOnce: {
    auto: true, // captura automática e envia para o dono
    destinoAuto: 'dono', // 'dono' | 'chat' (devolve no próprio chat)
    resposta: 'todos' // quem pode baixar respondendo a uma visu: 'todos' | 'dono'
  },

  // ── Anti-Delete ───────────────────────────────────────────
  antiDelete: {
    ativo: true, // ATIVO POR PADRÃO EM TUDO
    restaurarNoChat: true, // devolve a mensagem apagada no próprio chat
    avisarDono: false, // também encaminha uma cópia para o dono
    ignorar: [] // filtros: 'grupos', 'privado' ou JIDs específicos
  },

  // ── Downloads ─────────────────────────────────────────────
  autoDownload: true, // link solto de rede social já baixa sozinho
  qualidadePadrao: 'melhor', // melhor | alta | media | baixa
  maxMB: 90, // limite de tamanho para envio

  // ── IA ────────────────────────────────────────────────────
  ia: {
    modeloImagem: 'flux', // flux | turbo
    vozPadrao: 'nova', // alloy echo fable onyx nova shimmer
    sistema:
      'Você é o NEXUS, um assistente de WhatsApp esperto, direto e bem-humorado. ' +
      'Responda sempre em português do Brasil, curto e útil. Use emojis com moderação.'
  },

  // ── Comportamento ─────────────────────────────────────────
  soDonoConfigura: true, // só o dono muda configurações
  responderDesconhecido: false // responde quando não entende um prefixo
};

const FILE = 'config.json';

class Config {
  constructor() {
    this.data = this.#load();
  }

  #load() {
    const saved = readJson(FILE, null);
    const merged = deepMerge(structuredClone(DEFAULT_CONFIG), saved || {});
    // Saneamento básico
    if (!Array.isArray(merged.prefixos) || !merged.prefixos.length) merged.prefixos = DEFAULT_CONFIG.prefixos;
    if (!Array.isArray(merged.antiDelete.ignorar)) merged.antiDelete.ignorar = [];
    return merged;
  }

  get() {
    return this.data;
  }

  /** Lê um valor por caminho: cfg.get('antiDelete.ativo') */
  at(pathStr) {
    return pathStr.split('.').reduce((acc, part) => (acc == null ? undefined : acc[part]), this.data);
  }

  /** Define um valor por caminho e persiste. */
  set(pathStr, value) {
    const parts = pathStr.split('.');
    const last = parts.pop();
    const target = parts.reduce((acc, part) => {
      if (typeof acc[part] !== 'object' || acc[part] === null) acc[part] = {};
      return acc[part];
    }, this.data);
    target[last] = value;
    this.save();
    return value;
  }

  save() {
    writeJsonNow(FILE, this.data);
  }

  saveDebounced() {
    writeJsonDebounced(FILE, this.data);
  }

  reset() {
    this.data = structuredClone(DEFAULT_CONFIG);
    this.save();
  }
}

function deepMerge(base, extra) {
  for (const [key, value] of Object.entries(extra || {})) {
    if (value && typeof value === 'object' && !Array.isArray(value) && base[key] && typeof base[key] === 'object') {
      deepMerge(base[key], value);
    } else if (value !== undefined) {
      base[key] = value;
    }
  }
  return base;
}

export const cfg = new Config();

/** Configurações vindas do ambiente (.env). */
export const ENV = {
  ownerNumbers: envList('OWNER_NUMBERS'),
  pairingNumber: (process.env.PAIRING_NUMBER || '').replace(/\D/g, ''),
  removeBgKeys: envList('REMOVE_BG_KEYS'),
  removeBgUrls: envList('REMOVE_BG_URLS'),
  localRembg: envBool('LOCAL_REMBG', false),
  geminiKeys: envList('GEMINI_KEYS'),
  geminiModels: envList('GEMINI_MODEL'),
  groqModel: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
  pollinationsKeys: envList('POLLINATIONS_KEYS'),
  pollinationsModel: process.env.POLLINATIONS_MODEL || 'openai',
  openaiKeys: envList('OPENAI_KEYS'),
  openaiBase: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
  groqKeys: envList('GROQ_KEYS'),
  aiBase: process.env.AI_BASE_URL || '',
  aiKeys: envList('AI_KEYS'),
  aiModel: process.env.AI_MODEL || '',
  cobaltInstances: envList('COBALT_INSTANCES'),
  tiktokApi: envList('TIKTOK_API'),
  waVersionOverride: process.env.WA_VERSION_OVERRIDE || ''
};
