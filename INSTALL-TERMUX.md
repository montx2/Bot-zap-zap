# Instalação no Termux

## 1. Preparar

```bash
pkg update -y && pkg upgrade -y
pkg install nodejs-lts git ffmpeg unzip nano -y
termux-setup-storage
```

## 2. Extrair

Coloque `Bot-Zap-Supremo-2026.zip` em `Download` do Android e rode:

```bash
cd ~/storage/downloads
unzip Bot-Zap-Supremo-2026.zip -d ~
mv ~/Bot-Zap-Supremo-2026 ~/Bot-Zap-Supremo
cd ~/Bot-Zap-Supremo
```

## 3. Instalar e validar

```bash
npm ci
./bot.sh doctor
./bot.sh test
```

## 4. Parear por código

```bash
./bot.sh pair 55DDDNUMERO
./bot.sh start
./bot.sh logs
```

No WhatsApp, abra Dispositivos conectados e escolha a opção de conectar usando número de telefone. Digite o código mostrado pelo Termux.

## 5. Conexão e operação

O bot consulta automaticamente a versão atual do WhatsApp Web antes de conectar. Não é necessário informar a versão manualmente na instalação normal.

```bash
./bot.sh status
./bot.sh logs
./bot.sh restart
./bot.sh stop
./bot.sh backup
./bot.sh doctor
```

## 6. Operação

```bash
./bot.sh status
./bot.sh logs
./bot.sh restart
./bot.sh stop
./bot.sh backup
./bot.sh doctor
```

## 7. Auto-start

Instale o aplicativo Termux:Boot e execute:

```bash
./bot.sh boot-install
```

Depois de reiniciar o Android, o Termux:Boot chama o supervisor do bot.

## 8. Se `npm ci` der EACCES

Nunca instale dependências dentro de `~/storage/downloads`. Use:

```bash
cp -r ~/storage/downloads/Bot-Zap-Supremo ~
cd ~/Bot-Zap-Supremo
npm ci
```
