// 🎨 MENUS — separados em 2 versões:
// 1) ownerMenu(): menu COMPLETO que só aparece no privado do dono.
// 2) publicMenu(): menu para grupos/conversas liberadas com .ativar.
//    Mostra TUDO (figurinhas, downloads de qualquer rede, IA, voz…)
//    MENOS as duas funções 100% privadas: View Once e Anti-Delete,
//    que não são citadas em nenhum lugar e não respondem para terceiros.

import { cfg } from '../core/config.js';
import { PLATFORM, PLATFORM_LABEL } from '../core/platform.js';
import { hasYtDlp } from './downloaders/ytdlp.js';

const BORDA = '━━━━━━━━━━━━━━━━━━';

/**
 * Menu público para chats/grupos liberados com .ativar.
 * Regra: ZERO menção a View Once e Anti-Delete. Todo o resto aparece.
 */
export function publicMenu() {
  const nome = cfg.get().nomeBot;
  return `${nome} ⚡
${BORDA}
🖼️ *FIGURINHAS*
  .s → foto, vídeo ou GIF vira figurinha (preenche o quadrado)
  .s inteira → mantém a imagem inteira, sem esticar
  .s cortar → preenche sem esticar (corta as bordas)
  .sfundo → figurinha SEM FUNDO (IA)
  .fundo → remove o fundo em PNG
  .take Pack|Autor → muda nome do pacote

⬇️ *DOWNLOADS*
Qualquer rede social: é só mandar o link!
  .dl <link> [qualidade] → universal
  .tiktok <link>  ·  .ttmp3 <link>
  .pin <link>  ·  .insta <link>
  .yt <link>  ·  .ytmp3 <link>
  .tw <link>  ·  .face <link>
Redes: TikTok · Instagram · YouTube ·
Pinterest · X · Facebook · Threads ·
Reddit · Twitch · Vimeo e mais.

🧠 *INTELIGÊNCIA ARTIFICIAL*
  .ia <pergunta>  ·  .criar <ideia>
  .voz <texto>  ·  .traduz <idioma> <txt>
  .resumo <texto>  ·  .ia reset

⚙️ *OUTROS*
  .menu  ·  .ping  ·  .info

💡 Envie uma foto, vídeo ou GIF com a
legenda *.s*, ou cole qualquer link de
rede social que eu baixo na melhor
qualidade. 🎚️ Qualidades: melhor (padrão
👑), alta, media, baixa.
${BORDA}`;
}

/** Menu completo do dono — exibido SOMENTE no privado do próprio dono. */
export function ownerMenu() {
  const nome = cfg.get().nomeBot;
  return `${nome} — *PAINEL DO DONO* 👑
${BORDA}
🔒 *CONTROLE DE CHATS / GRUPOS*
  .ativar → libera o bot no chat/grupo
  .desativar → bloqueia o chat/grupo
  .desativar tudo → bloqueia todos
  .ativos → lista chats liberados

👁️ *VIEW ONCE (100% SILENCIOSO)*
Automático ou respondendo a visu:
vai *somente pro seu privado* (0 rastros).
  .vo → status  ·  .vo on | off

🛡️ *ANTI-DELETE (100% SILENCIOSO)*
Tudo apagado vai *somente pro seu
privado* (0 rastros no grupo/chat).
  .antidelete → status e filtros

🖼️ *FIGURINHAS*
  .s → imagem/vídeo/GIF vira figurinha (preenche o quadrado)
  .s inteira → mantém a imagem inteira, sem esticar
  .s cortar → preenche sem esticar (corta as bordas)
  .sfundo → figurinha SEM FUNDO (IA)
  .fundo → só remove o fundo (PNG)
  .take nome|autor → renomear pack

⬇️ *DOWNLOADS*
  .dl <link> [qualidade] → universal
  .tiktok <link>  ·  .ttmp3 <link>
  .pin <link>  ·  .insta <link>
  .yt <link>  ·  .ytmp3 <link>
  .tw <link>  ·  .face <link>
  .menudl → guia completo

🧠 *IA*
  .ia <pergunta>  ·  .criar <ideia>
  .voz <texto>  ·  .traduz <idioma> <txt>
  .resumo <texto>  ·  .ia reset

⚙️ *OUTROS*
  .ping · .info · .doctor · .config
${BORDA}
Feito com ⚡ e muito café`;
}

export function mainMenu({ isOwnerPrivate = true } = {}) {
  return isOwnerPrivate ? ownerMenu() : publicMenu();
}

export function downloadMenu() {
  const extra = hasYtDlp() ? '\n🧰 yt-dlp local detectado (modo turbo ativo).' : '';
  return `⬇️ *GUIA DE DOWNLOADS*
${BORDA}
Basta colar o link, ou usar um comando:

🎵 .tiktok <link> [qualidade]
🎶 .ttmp3 <link> → só a música
📌 .pin <link> [qualidade]
📸 .insta <link>
▶️ .yt <link>  ·  .ytmp3 <link>
𝕏 .tw <link>  ·  👥 .face <link>
🌐 .dl <link> [qualidade] → universal

Redes atendidas: TikTok · Instagram ·
YouTube · Pinterest · X/Twitter ·
Facebook · Threads · Reddit · Twitch ·
Vimeo · Snapchat · SoundCloud e muito
mais pelo modo universal.

🎚️ *Qualidades:* melhor (padrão 👑),
alta, media, baixa
Ex.: .tiktok <link> baixa
${BORDA}${extra}`;
}

export function stickerMenu() {
  return `🖼️ *FIGURINHAS*
${BORDA}
  .s → foto, vídeo ou GIF vira figurinha (preenche o quadrado)
  .s inteira → mantém a imagem inteira, sem esticar
  .s cortar → preenche sem esticar (corta as bordas)
  .sfundo → figurinha SEM FUNDO (IA)
  .fundo → remove o fundo em PNG
  .take Pack|Autor → muda o pacote

💡 Envie uma mídia com a legenda *.s*
ou responda a mídia digitando *.s*.
📐 Modos: *.s* (preenche), *.s inteira*, *.s cortar*
${BORDA}`;
}

export function antiDeleteMenu() {
  return `🛡️ *ANTI-DELETE (SILENCIOSO)*
${BORDA}
Envia tudo que apagarem silenciosamente
para o seu privado (0 rastros no grupo).

.antidelete → status
.antidelete ignorar grupos
.antidelete ignorar privado
.antidelete ignorar aqui
.antidelete ignorar <número ou jid>
.antidelete remover <filtro>
.antidelete lista
.antidelete on | off
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
    '🌐 *Downloaders*',
    ...poolRows.map((r) => `• ${r}`),
    BORDA
  ].join('\n');
}
