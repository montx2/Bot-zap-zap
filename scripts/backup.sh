#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)";cd "$ROOT";mkdir -p storage/backups
STAMP="$(date '+%Y%m%d-%H%M%S')";OUT="storage/backups/bot-zap-$STAMP.tar.gz"
# Não inclui storage/backups (senão cada backup engole o anterior) nem arquivos temporários.
ITEMS=(data storage logs)
[ -f .env ] && ITEMS+=(.env)
tar --exclude='storage/backups' -czf "$OUT" "${ITEMS[@]}"
chmod 600 "$OUT"
# Mantém só os 5 backups mais recentes.
ls -1t storage/backups/bot-zap-*.tar.gz 2>/dev/null | tail -n +6 | xargs -r rm -f
echo "✅ Backup: $ROOT/$OUT ($(du -h "$OUT" | cut -f1))"
