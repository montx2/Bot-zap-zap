#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail
pkg install termux-api -y >/dev/null 2>&1 || true
mkdir -p "$HOME/.termux/boot"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cat > "$HOME/.termux/boot/bot-zap.sh" <<BOOT
#!/data/data/com.termux/files/usr/bin/bash
sleep 8
cd "$ROOT"
./bot.sh start
BOOT
chmod +x "$HOME/.termux/boot/bot-zap.sh"
echo '✅ Autostart configurado. Instale o Termux:Boot no Android para ativá-lo.'
