#!/usr/bin/env bash
# ⚡ NEXUS BOT — launcher Termux/Linux
set -euo pipefail
cd "$(dirname "$0")"

cmd="${1:-start}"

case "$cmd" in
  start)
    if [ ! -d node_modules/@whiskeysockets/baileys ]; then
      echo "📦 Instalando dependências…"
      npm install --no-audit --no-fund
    fi
    exec node src/main.js
    ;;
  pair)
    shift || true
    exec node scripts/pair.mjs "$@"
    ;;
  doctor)
    exec node scripts/doctor.mjs
    ;;
  test)
    exec node --test tests/
    ;;
  update)
    echo "🔄 Atualizando…"
    git pull --ff-only || true
    npm install --no-audit --no-fund
    echo "✅ Atualizado. Rode ./bot.sh start"
    ;;
  stop)
    if command -v pkill >/dev/null 2>&1; then
      pkill -f "node src/main.js" && echo "🛑 Bot parado." || echo "ℹ️ Bot não estava rodando."
    else
      pid=$(ps -ef 2>/dev/null | grep "[n]ode src/main.js" | awk '{print $2}' | head -1)
      if [ -n "$pid" ]; then kill "$pid" && echo "🛑 Bot parado (PID $pid)."; else echo "ℹ️ Bot não estava rodando."; fi
    fi
    ;;
  *)
    echo "⚡ NEXUS BOT"
    echo "Uso: ./bot.sh [start|pair NUMERO|doctor|test|update|stop]"
    ;;
esac
