#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

mkdir -p logs data .tmp storage/{media,vault,black,status,exports,backups}

cmd="${1:-status}"

case "$cmd" in
  start)
    if [ -f data/supervisor.pid ] && kill -0 "$(cat data/supervisor.pid)" 2>/dev/null; then
      echo "✅ Bot já está rodando PID=$(cat data/supervisor.pid)"
      exit 0
    fi

    nohup bash scripts/supervisor.sh >> logs/supervisor-launcher.log 2>&1 </dev/null &

    for _ in $(seq 1 20); do
      if [ -f data/supervisor.pid ] && kill -0 "$(cat data/supervisor.pid)" 2>/dev/null; then
        echo "✅ Supervisor iniciado PID=$(cat data/supervisor.pid)"
        break
      fi
      sleep 0.25
    done

    if [ -f data/supervisor.pid ] && kill -0 "$(cat data/supervisor.pid)" 2>/dev/null; then
      echo "📜 Logs: ./bot.sh logs"
    else
      echo "❌ Supervisor não iniciou. Veja: ./bot.sh logs"
      exit 1
    fi
    ;;

  stop)
    if [ -f data/supervisor.pid ]; then
      kill -TERM "$(cat data/supervisor.pid)" 2>/dev/null || true
      sleep 1
      rm -f data/supervisor.pid
    fi

    # Limpa somente processos do Bot-Zap lançados pelo supervisor.
    pkill -TERM -f "$ROOT/src/main.js" 2>/dev/null || true
    echo '🛑 Bot parado.'
    ;;

  restart)
    "$0" stop || true
    sleep 1
    exec "$0" start
    ;;

  status)
    if [ -f data/supervisor.pid ] && kill -0 "$(cat data/supervisor.pid)" 2>/dev/null; then
      SUP_PID="$(cat data/supervisor.pid)"
      echo "✅ Supervisor ativo PID=$SUP_PID"

      if [ -f data/node.pid ] && kill -0 "$(cat data/node.pid)" 2>/dev/null; then
        NODE_PID="$(cat data/node.pid)"
        echo "✅ Node do Bot-Zap ativo PID=$NODE_PID"
      else
        echo "⚠️ Supervisor ativo, mas o processo Node não está ativo neste momento"
      fi

      if grep -q 'WhatsApp conectado — BOT-ZAP SUPREMO ONLINE' logs/bot.log 2>/dev/null; then
        echo "✅ WhatsApp conectado anteriormente"
      else
        echo "ℹ️ Ainda não há confirmação de conexão aberta no log"
      fi
    else
      echo '❌ Bot parado.'
    fi
    ;;

  logs)
    tail -n 120 logs/bot.log 2>/dev/null || echo 'Sem logs ainda.'
    ;;

  pair)
    node src/pair.js "${2:-}"
    ;;

  doctor)
    node scripts/doctor.mjs
    ;;

  test)
    node scripts/selftest.mjs
    ;;

  connection-smoke)
    node scripts/connection-smoke.mjs
    ;;

  backup)
    bash scripts/backup.sh
    ;;

  boot-install)
    bash scripts/boot-install.sh
    ;;

  *)
    echo "Uso: $0 {start|stop|restart|status|logs|pair|doctor|test|connection-smoke|backup|boot-install}"
    exit 1
    ;;
esac
