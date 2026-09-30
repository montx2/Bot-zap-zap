#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail
pkg update -y
pkg install nodejs-lts git ffmpeg unzip nano termux-api -y
cd "$HOME"
if [ ! -d Bot-Zap-Supremo ]; then
  if [ -f "$HOME/storage/downloads/Bot-Zap-Supremo-2026.zip" ]; then unzip "$HOME/storage/downloads/Bot-Zap-Supremo-2026.zip" -d "$HOME"; mv "$HOME/Bot-Zap-Supremo-2026" "$HOME/Bot-Zap-Supremo" 2>/dev/null || true; fi
fi
cd "$HOME/Bot-Zap-Supremo"
npm install --no-audit --no-fund
chmod +x bot.sh scripts/*.sh
./bot.sh doctor
./bot.sh test
printf '\n🔥 Instalação concluída. Use: ./bot.sh pair 55DDDNUMERO && ./bot.sh start\n'
