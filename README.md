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
npm run connection-test   # simula queda, conflito e auto-cura de sessão
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

Dentro do chat, `.menu` mostra tudo organizado por *o que você quer fazer* (figurinha, ver o que só aparece uma vez, transformar mídia, achar e guardar, monitorar alguém, grupo, extras) — cada linha explica o que o comando faz. `.menu figurinha` abre o guia completo de figurinhas.

```text
.menu
.vo                  # painel da visualização única
.vo on|off
.vo list [n]         # últimas capturas
.vo get ID           # reenvia uma captura arquivada
.o                  # responder uma View Once para tentar recuperação manual
.find termo
.media
.links
.events
.save                # guardar a mensagem citada no cofre
.black save|list|get ID
.s                   # figurinha (responde ou legenda) — imagem inteira, sem cortar
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

**A figurinha sempre mostra a imagem INTEIRA** — rosto, bicho, objeto: nada é cortado. A imagem é
só redimensionada para caber no quadrado 512×512 e centralizada (com espacinho transparente em
volta quando sobra). Vale para foto, vídeo, GIF, documento e figurinha: basta `.s` puro. Se você
preferir o quadrado 100% preenchido (cortando o que sobra), escreva `.s preencher`.

```text
.s                     # padrão: imagem inteira, sem cortar (borda transparente se sobrar)
.s inteira             # imagem inteira (mesma coisa do padrão)
.s preencher           # quadrado 100% preenchido, cortando o que sobra
.s esticar             # estica para 512×512
.s circulo | .s borda  # redonda / cantos arredondados (borda suave)
.s pretoebranco | sepia | inverter | espelho | desfoque   # efeitos (combináveis)
.s rapido | lento | reverso | vaievem | parada            # vídeo/GIF
.s 5                   # só os 5 primeiros segundos (1–15)
.s qualidade | leve    # mais nítida / arquivo menor
.s 😎 | Meu Pack | Meu Nome            # emoji + pack + autor desta figurinha

.sticker pack Nome | Autor    # pack/autor padrão (reset: .sticker pack reset)
.sticker auto on|off          # tudo que você mandar pro seu próprio chat vira figurinha
.take Nome | Autor            # responda uma figurinha: troca o pack/autor
.toimg [doc]                  # figurinha → imagem (doc mantém transparência)
.togif | .tovideo             # figurinha animada → GIF / vídeo
.stickerinfo                  # pack, autor, emojis, frames, tamanho
.menu figurinha               # guia simples, explica cada opção
```

Os comandos em inglês (`crop`, `full`, `circle`, `round`, `bw`, `sepia`, `invert`, `flip`,
`blur`, `fast`, `slow`, `rev`, `boomerang`, `static`, `hq`, `lq`) continuam funcionando.

O que o motor faz por você:

- **Nada de corte**: por padrão a imagem inteira é dimensionada para caber no 512×512 (centralizada, com transparência em volta) — rosto, animal e objeto continuam aparecendo por completo. Quem pede `.s preencher` tem o quadrado cheio: aí sim o bot mede a caixa opaca da figurinha de entrada e recorta o excesso antes de escalar. Figurinha que já preenche vai por atalho instantâneo (só troca o pack, sem re-encode).
- **Compressão adaptativa**: se a figurinha passa de 100 KB (estática) ou 500 KB (animada), o bot baixa qualidade/FPS/duração automaticamente até caber.
- **Pack e autor de verdade**: gravados no EXIF do WebP (em JavaScript puro, sem `webpmux`).
- **Figurinha animada → qualquer coisa**: o FFmpeg 7.0 não lê WebP animado, então o bot decodifica e compõe os frames sozinho.
- **Filtros com plano B**: se o seu FFmpeg não tiver algum filtro (`geq`, `gblur`...), o bot reencoded com uma versão mais simples em vez de falhar.
- Reações ⏳ → (some) / ❌ na mensagem do comando, fila de uma conversão por vez (poupa o celular) e limpeza automática de temporários.
- Pack padrão: **by 𝖒𝖔𝖓𝖙𝖝2_** (sem autor, visual limpo). Ajustes por `.env`: `BOT_BRAND`, `STICKER_PACK`, `STICKER_AUTHOR`, `STICKER_MAX_SECONDS`, `STICKER_MAX_STATIC_KB`, `STICKER_MAX_ANIMATED_KB`, `STICKER_REACT`, `STICKER_AUTO_SELF`.

O formato padrão pode ser trocado no `.env` com `STICKER_FIT` (`fit` — imagem inteira, é o padrão —, `crop`, `full`, `circle` ou `round`).

> Quem tinha figurinhas bloqueadas (`.sticker off`) no motor antigo passa a ter o recurso liberado uma única vez na atualização; use `.sticker off` de novo se quiser bloquear.

## 🔧 Uso 24h no Termux (1 aparelho)

- **`.env` agora é lido de verdade.** Copie `cp .env.example .env` e edite (antes as variáveis eram ignoradas).
- **Wake-lock:** `pkg install termux-api` (e o app *Termux:API*). O supervisor usa `termux-wake-lock` para o Android não matar o bot com a tela apagada. Desative a otimização de bateria do Termux nas configurações do Android.
- **Manutenção automática diária** (ou `.clean` na hora): compacta mensagens antigas (`KEEP_RAW_DAYS`), expira mídias comuns (`MEDIA_KEEP_DAYS`, teto `MEDIA_MAX_GB`), poda eventos antigos, rotaciona o log (`LOG_MAX_MB`) e limpa temporários. **View Once e cofre nunca são apagados.**
- **Backup** (`./bot.sh backup` / `.backup`): não inclui backups anteriores e mantém só os 5 mais recentes.
- **Comandos antigos não reexecutam:** mensagens com mais de 2 min entregues em lote após uma queda de internet não disparam comandos.
- **Sessão encerrada pelo WhatsApp:** o bot avisa no log e para (em vez de ficar em loop). Re-pareie: `./bot.sh stop && rm -rf data/auth && ./bot.sh pair 55DDDNUMERO && ./bot.sh start`.
- `./bot.sh doctor` mostra FFmpeg/codecs, espaço livre, wake-lock e `.env`.

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

## 🩹 Problemas de conexão: `conflict / replaced`, `Bad MAC`, figurinha lenta

| Sintoma no log | Causa | O que o bot faz agora |
| --- | --- | --- |
| `stream:error … conflict … replaced` em loop (a cada ~6 s) | **Duas cópias** do bot usando a mesma sessão (ex.: `./bot.sh start` + `npm start`) — uma derruba a outra | Trava de instância única (`data/bot.lock`): a 2ª cópia avisa e sai. Se o conflito vier de outro aparelho, o bot espera 15 s → 30 s → … (máx. 5 min) em vez de brigar |
| `Bad MAC` / `No matching sessions found` | Chaves de criptografia corrompidas (normalmente consequência das duas cópias acima) | Se o mesmo contato falha 2× em 15 min, só a sessão dele é apagada e recriada sozinha |
| Comando/figurinha demora | Comando ficava na fila atrás do arquivamento; chaves lidas do disco a cada mensagem | Comandos saem em fila própria; chaves em cache na memória; redimensionamento mais leve |

Se ainda aparecer `Bad MAC` depois de garantir **uma única cópia**:

```bash
./bot.sh stop      # para TODAS as cópias (supervisor e `npm start` manual)
./bot.sh repair    # limpa só as sessões por contato (faz backup; não precisa parear de novo)
./bot.sh start
```

Sempre use `./bot.sh restart` para reiniciar — nunca abra `npm start` enquanto o supervisor estiver ativo.
