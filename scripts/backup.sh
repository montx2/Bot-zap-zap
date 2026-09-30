#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)";cd "$ROOT";mkdir -p storage/backups
STAMP="$(date '+%Y%m%d-%H%M%S')";OUT="storage/backups/bot-zap-$STAMP.tar.gz"
tar -czf "$OUT" data storage logs .env 2>/dev/null || tar -czf "$OUT" data storage logs
chmod 600 "$OUT"
echo "✅ Backup: $ROOT/$OUT"
