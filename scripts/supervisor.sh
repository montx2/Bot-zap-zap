#!/data/data/com.termux/files/usr/bin/bash
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

mkdir -p logs data

LOG="$ROOT/logs/bot.log"
PIDFILE="$ROOT/data/supervisor.pid"
NODEPIDFILE="$ROOT/data/node.pid"
NODE="$PREFIX/bin/node"
NODE_PID=""

if [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
  echo "✅ Supervisor já está rodando PID=$(cat "$PIDFILE")"
  exit 0
fi

echo $$ > "$PIDFILE"

cleanup() {
  if [ -n "$NODE_PID" ] && kill -0 "$NODE_PID" 2>/dev/null; then
    kill -TERM "$NODE_PID" 2>/dev/null || true
    sleep 1
    kill -KILL "$NODE_PID" 2>/dev/null || true
  fi

  rm -f "$PIDFILE" "$NODEPIDFILE"
}

trap cleanup EXIT
trap 'exit 143' INT TERM

backoff=2

while true; do
  started_at=$(date +%s)

  echo "[$(date '+%Y-%m-%d %H:%M:%S')] [supervisor] iniciando Node" | tee -a "$LOG"

  "$NODE" src/main.js >> "$LOG" 2>&1 &
  NODE_PID=$!
  echo "$NODE_PID" > "$NODEPIDFILE"

  wait "$NODE_PID"
  code=$?
  NODE_PID=""
  rm -f "$NODEPIDFILE"

  ended_at=$(date +%s)
  runtime=$((ended_at-started_at))

  if [ "$code" -eq 0 ]; then
    break
  fi

  if [ "$runtime" -ge 60 ]; then
    backoff=2
  fi

  echo "[$(date '+%Y-%m-%d %H:%M:%S')] [supervisor] Node saiu code=$code; reiniciando em ${backoff}s" | tee -a "$LOG"

  sleep "$backoff"

  if [ "$backoff" -lt 60 ]; then
    backoff=$((backoff*2))
    [ "$backoff" -gt 60 ] && backoff=60
  fi
done
