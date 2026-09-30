// 🎨 MENU — bonito, elegante e clean. Qualquer pessoa entende de primeira.

import { cfg } from '../core/config.js';
import { PLATFORM, PLATFORM_LABEL } from '../core/platform.js';

const BORDA = '━━━━━━━━━━━━━━━━━━';

export function mainMenu() {
  const nome = cfg.get().nomeBot;
  return `${nome}
${BORDA}
✨ Bem-vindo(a)! Toque no que precisa:

👁️ *VIEW ONCE*
Responda qualquer foto/vídeo de
visualização única com *qualquer
mensagem* e eu baixo pra você.
A captura automática também já vem ligada.

🛡️ *ANTI-DELETE*
Está *ligado em tudo* por padrão.
Ninguém apaga nada sem eu recuperar.
  .antidelete → status e filtros

🖼️ *FIGURINHAS*
  .s → imagem/vídeo/GIF vira figurinha
  .sfundo → figurinha SEM FUNDO (IA)
  .fundo → só remove o fundo (PNG)
  .take nome|autor → renomear pack

⬇️ *DOWNLOADS*
Cole o link que eu baixo na *melhor
qualidade* (peça "baixa" p/ reduzir):
  .dl <link> [qualidade]
  .tiktok <link>  ·  .ttmp3 <link>
  .pin <link>  ·  .insta <link>
Pinterest, TikTok, Instagram, YouTube,
X, Facebook, Threads, Reddit e +200 sites.

🧠 *IA*
  .ia <pergunta> → conversa comigo
  .criar <ideia> → gero a imagem
  .voz <texto> → falo o texto
  .traduz <idioma> <texto>
  .resumo <texto>
  .ia reset → limpar memória

⚙️ *OUTROS*
  .ping · .info · .doctor
${BORDA}
Feito com ⚡ e muito café`;
}

export function downloadMenu() {
  return `⬇️ *GUIA DE DOWNLOADS*
${BORDA}
Basta enviar o link, ou usar comandos:

.tiktok <link> [qualidade]
.ttmp3 <link> → só a música
.pin <link> [qualidade]
.insta <link>
.dl <link> [qualidade] → universal

🎚️ *Qualidades:* melhor (padrão 👑),
alta, media, baixa
Ex.: .tiktok <link> baixa

💡 *Dica:* pode só colar o link solto
no chat que eu baixo sozinho!
${BORDA}`;
}

export function stickerMenu() {
  return `🖼️ *GUIA DE FIGURINHAS*
${BORDA}
.s → responde/envia foto, vídeo ou GIF
.sfundo → figurinha transparente (IA)
.fundo → PNG sem fundo (não figurinha)
.take MeuPack|MinhaAutoria

🎭 A remoção de fundo usa um POOL de
APIs: configure várias contas no .env
(REMOVE_BG_KEYS) e tenha uso ilimitado.
${BORDA}`;
}

export function antiDeleteMenu() {
  return `🛡️ *ANTI-DELETE*
${BORDA}
Ligado em TUDO por padrão. Filtros:

.antidelete → status
.antidelete ignorar grupos
.antidelete ignorar privado
.antidelete ignorar aqui
.antidelete ignorar <número ou jid>
.antidelete remover <filtro>
.antidelete lista
.antidelete on | off

Quando alguém apaga, eu restauro a
mensagem aqui mesmo no chat. 👀
${BORDA}`;
}

export function infoText({ uptime, cacheSize, bgRows, aiRows, poolRows, ownerName }) {
  return [
    '⚡ *NEXUS — status*',
    BORDA,
    `🕒 Online há: ${uptime}`,
    `🖥️ Sistema: ${PLATFORM_LABEL[PLATFORM] || PLATFORM}`,
    `💾 Mensagens em memória: ${cacheSize}`,
    `👑 Dono: ${ownerName || 'conta própria'}`,
    '',
    '🎭 *Remoção de fundo*',
    ...bgRows.map((r) => `• ${r}`),
    '',
    '🧠 *IA*',
    ...aiRows.map((r) => `• ${r}`),
    '',
    '⬇️ *Pools de download*',
    ...poolRows.map((r) => `• ${r}`),
    BORDA
  ].join('\n');
}
