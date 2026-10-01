# ⚡ NEXUS BOT

**O bot de WhatsApp mais completo da sua vida.** Multi-Device (Baileys), feito para
**Termux** (pareamento por código, sem QR), e também roda em **Linux** e **Windows** (com QR).

Tudo que importa, nada que atrapalha:

| Recurso | Descrição |
|---|---|
| 👁️ **View Once** | Captura automática + **responda QUALQUER view once com QUALQUER mensagem** e ela é baixada |
| 🛡️ **Anti-Delete** | **Ligado em tudo por padrão**, com filtro de ignorar (grupos, privado, chats específicos) |
| 🖼️ **Figurinhas** | Imagem, vídeo, GIF e figurinha→figurinha, **com remoção de fundo por IA** |
| 🎭 **Remoção de fundo** | Pool de APIs com várias contas girando (estilo "requisições ilimitadas") |
| 🧠 **IA completa** | Chat, geração de imagens, voz, tradução e resumo — com pool de chaves + fallback grátis |
| ⬇️ **Downloader universal** | Pinterest, TikTok, Instagram, YouTube, X, Facebook, Threads, Reddit e +200 sites |
| 🎚️ **Qualidade** | Sempre a **MELHOR por padrão**; peça `baixa` para reduzir |
| 🎨 **Menu limpo** | `.menu` bonito e direto, qualquer pessoa entende |

---

## 🚀 Instalação rápida

### 📱 Termux (recomendado)

```bash
pkg update -y && pkg upgrade -y
pkg install -y git nodejs-lts ffmpeg
git clone https://github.com/montx2/Bot-zap-zap.git
cd Bot-zap-zap
./install-termux.sh        # instala tudo
./bot.sh pair 55SEUNUMERO  # salva seu número (sem QR no Termux!)
./bot.sh start             # mostra o código de 8 letras
```

No WhatsApp: **Dispositivos conectados → Conectar com número de telefone** → digite o código.

> 💡 Precisa manter o Termux vivo? Rode `termux-wake-lock` antes do `./bot.sh start`.

### 🐧 Linux

```bash
sudo apt install nodejs npm ffmpeg   # Node 20+
npm install
npm start                            # escaneie o QR no terminal
```

### 🪟 Windows

1. Instale o [Node.js LTS 20+](https://nodejs.org) e FFmpeg (`winget install ffmpeg`).
2. Dê dois cliques em `start.bat` (ele instala as dependências sozinho).
3. Escaneie o QR Code que aparece no terminal.

---

## 🎮 Como usar

Mande **`.menu`** no WhatsApp. Resumo:

### 👁️ View Once
- **Captura automática**: toda view once recebida é salva e enviada para você (dono).
- **Por resposta**: responda a view once com *qualquer mensagem* (um "oi", um emoji, `.s`…) e o bot baixa na hora, no próprio chat.
- Configurar: `.vo auto on|off` · `.vo destino dono|chat` · `.vo resposta todos|dono`

### 🛡️ Anti-Delete
Vem **ligado em todos os chats**. Quando alguém apaga, o bot restaura a mensagem ali mesmo.

```
.antidelete                    → status
.antidelete ignorar grupos     → para de proteger grupos
.antidelete ignorar privado    → para de proteger PVs
.antidelete ignorar aqui       → ignora o chat atual
.antidelete remover grupos     → volta a proteger
.antidelete lista              → ver filtros
.antidelete on | off           → liga/desliga global (só o dono)
.antidelete dono               → também mandar cópia pro dono
```

### 🖼️ Figurinhas
```
.s / .fig / !sticker    → foto, vídeo, GIF ou figurinha → figurinha
.sfundo                 → figurinha SEM FUNDO (IA remove o fundo)
.fundo                  → devolve PNG transparente (sem virar figurinha)
.take Pack|Autor        → renomear pack de figurinhas
```
Dica: dá pra responder uma **view once** com `.s` e transformar em figurinha. 😉

### ⬇️ Downloads (sempre na melhor qualidade)
```
.dl <link> [qualidade]      → universal (qualquer rede)
.tiktok <link> [qualidade]  → TikTok sem marca d'água (HD original)
.ttmp3 <link>               → só a música do TikTok
.pin <link> [qualidade]     → Pinterest (foto original, vídeo e GIF)
.insta <link> [qualidade]   → Instagram (reels, posts, carrossel)
```
- **Qualidades**: `melhor` (padrão 👑), `alta`, `media`, `baixa` — em qualquer ordem: `.tiktok baixa <link>`
- **Auto-download**: cole o link solto no chat que ele baixa sozinho.
- Redes cobertas via Cobalt: YouTube, X/Twitter, Facebook, Threads, Reddit, Snapchat,
  Vimeo, Twitch, SoundCloud e centenas de outras.

### 🧠 IA
```
.ia <pergunta>            → conversa (com memória no chat · .ia reset limpa)
.criar <descrição>        → gera imagem
.voz <texto>              → áudio falando o texto
.traduz inglês <texto>    → tradução
.resumo <texto>           → resumão em bullets
```

---

## 🔑 O sistema de POOLS (requisições "ilimitadas")

A mágica do NEXUS: em vez de UMA conta/API, você configura **VÁRIAS** e o bot
gira entre elas. Quando uma estoura o limite, ela entra em "geladeira" e a
próxima assume. Copie `.env.example` para `.env` e preencha:

```bash
cp .env.example .env
nano .env
```

### 🎭 Remoção de fundo (para .sfundo / .fundo)
Crie quantas contas grátis quiser em <https://www.remove.bg/api> (50 créditos/mês cada):
```env
REMOVE_BG_KEYS=chave_da_conta1,chave_da_conta2,chave_da_conta3
```
Alternativas:
```env
REMOVE_BG_URLS=https://sua-api-própria/removebg   # POST multipart campo "image"
LOCAL_REMBG=true                                   # usa o rembg local (pip install rembg)
```

### 🧠 IA (precisa de pelo menos 1 chave grátis)
```env
GEMINI_KEYS=key1,key2        # aistudio.google.com (grátis)
GROQ_KEYS=key1               # console.groq.com (grátis, rápido)
OPENAI_KEYS=key1             # OpenAI
AI_BASE_URL=https://openrouter.ai/api/v1   # qualquer API compatível com OpenAI
AI_KEYS=key1,key2
AI_MODEL=anthropic/claude-3.5-sonnet
```
Sem nenhuma chave a IA **não responde** (o Pollinations sem chave passou a dar erro 402).
O caminho mais simples: chave grátis do Gemini em <https://aistudio.google.com/apikey> → `GEMINI_KEYS=...`.
Para `.criar` (imagem) e `.voz`, crie uma chave grátis em <https://enter.pollinations.ai> → `POLLINATIONS_KEYS=...`.

### ⬇️ Downloads universais (Cobalt)
O bot já vem com instâncias públicas. Para ficar 100% confiável, adicione as suas
(veja a lista em <https://instances.cobalt.best> ou suba a sua: <https://github.com/imputnet/cobalt>):
```env
COBALT_INSTANCES=https://sua-instancia.cobalt,https://outra-instancia
```

> 📊 Veja a saúde dos pools no WhatsApp: **`.pools`** (dono) e **`.info`**

---

## ⚙️ Comandos de configuração

```
.config                       → ver tudo
.config autoDownload false    → desligar auto-download de links
.config qualidadePadrao media → qualidade padrão dos downloads
.config maxMB 50              → limite de tamanho por arquivo
.menu · .ping · .info · .doctor · .pools
```

---

## 🧪 Testes

```bash
npm test          # 36 testes offline (lógica, roteamento, anti-delete, view once)
npm run doctor    # diagnóstico do ambiente
```

## 🩺 Problemas comuns

| Sintoma | Solução |
|---|---|
| QR não aparece no Termux | Normal! Termux usa código: `./bot.sh pair SEUNUMERO` |
| Código de pareamento não aparece | Confira o número: só dígitos, com DDI (ex. 55…) |
| Loop de 405 ao conectar | O bot já faz cache da versão do WA Web; se persistir: `WA_VERSION_OVERRIDE=2,3000,REVISAO` |
| Figurinha não sai | Falta FFmpeg: `pkg install ffmpeg` / `apt install ffmpeg` / `winget install ffmpeg` |
| `.sfundo` pede configuração | Coloque chaves em `REMOVE_BG_KEYS` no `.env` |
| Download do Instagram falha | IG bloqueia muitos IPs; o bot tenta 3 estratégias — tente de novo ou use `.dl` |
| Bot cai no Termux ao fechar | `termux-wake-lock` e não mate o app nas configurações de bateria |

## 🧱 Estrutura

```
src/
├── main.js               # boot, dono, handlers
├── core/                 # config, env, http, keypool (motor de contas), store
├── wa/                   # conexão Baileys (QR/código) + cache de mensagens
├── features/             # viewonce, antidelete, sticker, bgremoval, ai, download
│   └── downloaders/      # tiktok (tikwm), pinterest, instagram, cobalt, qualidade
└── util/                 # ffmpeg, webp (exif), texto
```

Zero bancos externos, zero módulos nativos obrigatórios: instala em qualquer lugar.

## 🙏 Créditos e inspiração

Construído sobre [Baileys](https://github.com/WhiskeySockets/Baileys). Ideias e
padrões estudados nos melhores bots abertos da comunidade (Atlas-MD, ChisatoBOT,
KIRA X MD e cia.) — e depois refeitos do zero, mais simples e mais rápidos.
APIs: TikWM, Pollinations, Cobalt, remove.bg.

---

**Feito com ⚡ para ser o bot, não um botzinho.**
