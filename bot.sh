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

    # Junta TODOS os Node deste bot: o do supervisor, o da trava e qualquer `npm start`/`node src/main.js`
    # aberto à mão (duas cópias na mesma sessão derrubam uma à outra: "conflict / replaced").
    pids=""
    for f in data/node.pid data/bot.lock; do
      [ -f "$f" ] && pids="$pids $(cat "$f" 2>/dev/null)"
    done
    for p in $(pgrep -f 'src/main.js' 2>/dev/null || true); do
      if [ "$(readlink "/proc/$p/cwd" 2>/dev/null || true)" = "$ROOT" ]; then pids="$pids $p"; fi
    done
    for p in $pids; do
      case "$p" in ''|*[!0-9]*) continue ;; esac
      [ "$p" = "$$" ] && continue
      kill -TERM "$p" 2>/dev/null || true
    done
    pkill -TERM -f "$ROOT/src/main.js" 2>/dev/null || true

    for _ in $(seq 1 20); do
      alive=0
      for p in $pids; do
        case "$p" in ''|*[!0-9]*) continue ;; esac
        kill -0 "$p" 2>/dev/null && alive=1
      done
      [ "$alive" = 0 ] && break
      sleep 0.25
    done
    for p in $pids; do
      case "$p" in ''|*[!0-9]*) continue ;; esac
      kill -KILL "$p" 2>/dev/null || true
    done

    rm -f data/node.pid data/bot.lock
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

  repair)
    node scripts/repair-sessions.mjs "${2:-}"
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
    echo "Uso: $0 {start|stop|restart|status|logs|pair|repair|doctor|test|connection-smoke|backup|boot-install}"
    exit 1
    ;;
esac
