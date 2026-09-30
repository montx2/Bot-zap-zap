# 📱 Instalação no Termux — passo a passo

> O NEXUS no Termux usa **pareamento por código**: nada de QR Code.

## 1. Preparar o Termux

Abra o Termux e rode (aceite todos os `y`):

```bash
pkg update -y && pkg upgrade -y
pkg install -y git nodejs-lts ffmpeg
termux-setup-storage
```

## 2. Baixar o bot

```bash
cd ~
git clone https://github.com/montx2/Bot-zap-zap.git
cd Bot-zap-zap
./install-termux.sh
```

## 3. Parear seu WhatsApp

```bash
./bot.sh pair 55SEUDDDSEUNUMERO     # ex.: ./bot.sh pair 5511999999999
./bot.sh start
```

O bot vai mostrar um **código de 8 letras** no terminal.

No celular:
1. WhatsApp → **⋮** → **Dispositivos conectados**
2. **Conectar um dispositivo**
3. **Conectar com número de telefone**
4. Digite o código de 8 letras

Pronto! Mande **`.menu`** em qualquer conversa. 🚀

## 4. Recomendações para o Termux

```bash
termux-wake-lock        # impede o Android de suspender o bot
```

- Desative a otimização de bateria para o Termux (Configurações do Android → Bateria).
- Se fechar o Termux, o bot para. Use `termux-wake-lock` e mantenha o app aberto
  (ou use o Termux:Boot + um script para iniciar sozinho).

## 5. Comandos do launcher

| Comando | O que faz |
|---|---|
| `./bot.sh start` | inicia o bot |
| `./bot.sh pair NUMERO` | salva número de pareamento |
| `./bot.sh doctor` | diagnóstico do ambiente |
| `./bot.sh test` | roda os testes |
| `./bot.sh update` | atualiza o código e dependências |
| `./bot.sh stop` | para o bot |

## ❓ Erros comuns

- **`FFmpeg ausente`** → `pkg install ffmpeg`
- **`Cannot find module`** → `npm install` dentro da pasta do bot
- **`node: command not found`** → `pkg install nodejs-lts`
- **Não conecta / loop** → confira internet; o bot salva a versão do WA Web sozinho
- **Sessão expirou** → apague `data/auth` e repita o passo 3
