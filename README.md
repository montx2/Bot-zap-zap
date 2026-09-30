# BOT-ZAP SUPREMO

Bot pessoal WhatsApp para Termux, sem painel web, sem Windows, sem IA obrigatória e sem banco externo. A prioridade do projeto é a captura/arquivo local de mensagens e mídia, com View Once como motor principal.

## Núcleo

- View Once automática com múltiplas estratégias e fallback.
- Arquivo de mensagens e mídia local em SQLite + armazenamento cifrado.
- Anti-delete e histórico de edição do que já chegou à sessão.
- Detectores de encaminhamento, localização, contatos, enquetes, comércio, reações e eventos.
- Radar de grupos, administradores, mudanças de participantes e mapa de grupos dos alvos monitorados.
- Monitor de reações, presença, recibos, chamadas e mudança de dispositivo.
- Profile checker e alertas inteligentes por horário configurado.
- Histórico de links e limpeza de parâmetros de rastreamento.
- Cofre normal + Black Vault.
- Status saver opcional e limitado à lista de alvos.
- **Sticker Engine 2.0**: figurinhas de imagem, vídeo, GIF e de outras figurinhas, com pack/autor, formatos, efeitos e compressão adaptativa (veja abaixo).
- Conversores FFmpeg: GIF, MP4, PTT, MP3, figurinha → imagem/GIF/vídeo.
- Hash SHA-256, exportação de conversa, backups e doctor.
- Busca unificada `.find` em mensagens, links, mídias e eventos.
- Comandos administrativos aceitos somente de mensagens enviadas pela própria conta.

## O que não está incluído

Não foram incluídos os módulos pedidos para remoção: Inbox, Notas e Lembretes/Tarefas. Também não há painel web, PM2, Chromium, scripts Windows ou serviços pagos.

## Conexão resiliente

A conexão consulta a revisão atual do WhatsApp Web antes de criar o socket, guarda a última revisão válida localmente e usa fallback apenas quando necessário. Isso evita o loop de `405` causado por versões WA Web desatualizadas no Baileys. O override manual opcional é `WA_VERSION_OVERRIDE=2,3000,REVISAO`.

## Testes locais

```bash
npm test
npm run integration-test
```

O teste de integração usa mocks locais e FFmpeg; ele não substitui um teste real de conexão com o WhatsApp.

## Requisitos

- Termux atualizado.
- Node.js 24+.
- FFmpeg.
- Conexão com internet durante a instalação e pareamento.

## Instalação

```bash
pkg update -y
pkg install nodejs-lts git ffmpeg unzip nano -y
termux-setup-storage
cd ~/storage/downloads
unzip Bot-Zap-Supremo-2026.zip -d ~
mv ~/Bot-Zap-Supremo-2026 ~/Bot-Zap-Supremo
cd ~/Bot-Zap-Supremo
npm ci
./bot.sh doctor
./bot.sh test
```

## Pareamento sem QR

```bash
./bot.sh pair 55DDDNUMERO
./bot.sh start
./bot.sh logs
```

O número usa país + DDD + número, apenas dígitos. O código aparece no terminal.

## Comandos principais

```text
.menu
.vo on|off|status
.o                  # responder uma View Once para tentar recuperação manual
.find termo
.media
.links
.events
.save                # guardar a mensagem citada no cofre
.black save|list|get ID
.s                   # figurinha de imagem/vídeo/GIF/figurinha (responda ou use como legenda)
.gif | .mp4 | .ptt | .mp3   # responder mídia
.toimg | .take | .stickerinfo   # veja a seção Figurinhas
.hash
.watch add número nome
.watch hours número 8 9 10 11
.watch rm número
.watch list
.profile número
.network
.patterns
.stalk número
.groupinfo
.admins
.tagall texto
.stats
.analytics
.export [limite]
.backup
.health
.status
```

## 🎨 Figurinhas (Sticker Engine 2.0)

Liberado por padrão. Responda uma mídia com `.s` — ou envie a imagem/vídeo/GIF já com `.s` na legenda. Aceita imagem, vídeo, GIF, figurinha (estática ou animada) e documento de imagem/vídeo.

```text
.s                     # padrão: imagem inteira com fundo transparente
.s crop                # preenche o quadrado cortando as bordas
.s full                # estica para 512×512
.s circle | .s round   # recorte circular / cantos arredondados (borda suave)
.s bw | sepia | invert | flip | blur        # efeitos (combináveis)
.s slow | fast | rev | boomerang            # vídeo/GIF
.s 6                   # duração máxima em segundos (1–15)
.s static              # só o primeiro frame do vídeo
.s hq | lq             # qualidade maior / arquivo menor
.s crop 😎 | Meu Pack | Meu Nome            # emoji + pack + autor desta figurinha

.sticker pack Nome | Autor    # pack/autor padrão (reset: .sticker pack reset)
.sticker auto on|off          # tudo que você mandar pro seu próprio chat vira figurinha
.take Pack | Autor            # responda uma figurinha: troca o pack/autor
.toimg [doc]                  # figurinha → imagem (doc mantém transparência)
.togif | .tovideo             # figurinha animada → GIF / vídeo
.stickerinfo                  # pack, autor, emojis, frames, tamanho
.menu figurinha               # ajuda completa
```

O que o motor faz por você:

- **Compressão adaptativa**: se a figurinha passa de 100 KB (estática) ou 500 KB (animada), o bot baixa qualidade/FPS/duração automaticamente até caber.
- **Pack e autor de verdade**: gravados no EXIF do WebP (em JavaScript puro, sem `webpmux`).
- **Figurinha animada → qualquer coisa**: o FFmpeg 7.0 não lê WebP animado, então o bot decodifica e compõe os frames sozinho.
- Reações ⏳ → (some) / ❌ na mensagem do comando, fila de uma conversão por vez (poupa o celular) e limpeza automática de temporários.
- Ajustes por `.env`: `STICKER_PACK`, `STICKER_AUTHOR`, `STICKER_MAX_SECONDS`, `STICKER_MAX_STATIC_KB`, `STICKER_MAX_ANIMATED_KB`, `STICKER_REACT`, `STICKER_AUTO_SELF`.

> Quem tinha figurinhas bloqueadas (`.sticker off`) no motor antigo passa a ter o recurso liberado uma única vez na atualização; use `.sticker off` de novo se quiser bloquear.

## Controle de módulos

```text
.feature
.feature viewonce on
.feature sticker off
.feature status on
.feature all on
```

## Privacidade e limites

O bot só registra o conteúdo que a própria sessão conectada recebe. A captura de View Once depende de quais dados o WhatsApp entrega ao dispositivo companheiro; o projeto usa várias rotas de download, mas não existe garantia matemática de 100% contra mudanças do protocolo.

As chaves de autenticação e `data/vault.key` são dados extremamente sensíveis. Não compartilhe a pasta `data/auth` nem o backup gerado.


## RECUPERAÇÃO AUTOMÁTICA
A conexão usa timeout explícito, keep-alive curto, `fireInitQueries` e recuperação automática para o erro interno de `init queries`. Um health probe periódico também detecta sessões que deixam de responder. A recuperação não apaga `data/auth`.
