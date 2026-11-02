#!/data/data/com.termux/files/usr/bin/bash
# WTZI self-host pro Termux (funguje i na běžném Linuxu/macOS s PHP 7.4+)
#
#   ./start-termux.sh              -> http://127.0.0.1:8080  (jen tenhle telefon)
#   HOST=0.0.0.0 ./start-termux.sh -> dostupné i z jiných zařízení v Wi-Fi
#   PORT=9000 ./start-termux.sh    -> jiný port

set -e
cd "$(dirname "$0")"

HOST="${HOST:-127.0.0.1}"
PORT="${PORT:-80}"

if ! command -v php >/dev/null 2>&1; then
  echo "PHP není nainstalované, instaluju…"
  pkg update -y && pkg install -y php
fi

# index.php potřebuje rozšíření curl
if ! php -m | grep -qi '^curl$'; then
  echo "❌ PHP nemá rozšíření curl. V Termuxu: pkg install php"
  exit 1
fi

# víc workerů, aby ověřování videí (5 paralelních dotazů) nebylo sériové
export PHP_CLI_SERVER_WORKERS="${PHP_CLI_SERVER_WORKERS:-6}"

echo "🎬 WTZI běží na http://$HOST:$PORT   (Ctrl+C = konec)"
if [ "$HOST" = "0.0.0.0" ]; then
  IP=$(ifconfig 2>/dev/null | grep -Eo 'inet (addr:)?192\.168\.[0-9.]+|inet (addr:)?10\.[0-9.]+' | grep -Eo '[0-9.]+$' | head -1)
  [ -n "$IP" ] && echo "   z jiného zařízení: http://$IP:$PORT"
fi

# OPcache vypnutá: v Termuxu si nemůže vytvořit zámek v /tmp ("Cannot create lock - Permission denied")
[ -n "$PREFIX" ] && export TMPDIR="${TMPDIR:-$PREFIX/tmp}" && mkdir -p "$TMPDIR"
exec php -d opcache.enable=0 -d opcache.enable_cli=0 -d display_errors=0 \
  -S "$HOST:$PORT" -t azure-app/PrehrajtoProxy/wwwroot router.php
