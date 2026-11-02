#!/usr/bin/env bash
# Otevře proxy-servers.txt v nano (nebo $EDITOR), a po uložení ten seznam
# promítne do:
#   - azure-app/PrehrajtoProxy/wwwroot/index.html  (DEFAULT_PROXY_SERVERS)
#   - azure-app/PrehrajtoProxy/appsettings.json     (Prehraj.ProxyUrls)
#   - router.php                                    ($SERVER_PROXIES)
#
# Použití:
#   ./scripts/change-proxy-servers.sh             -> otevře nano, po uložení pushne
#   ./scripts/change-proxy-servers.sh --no-edit   -> jen pushne aktuální proxy-servers.txt (bez editoru)
#   EDITOR=vim ./scripts/change-proxy-servers.sh  -> jiný editor

set -euo pipefail
cd "$(dirname "$0")/.."   # repo root, ať skript jde spustit odkudkoli

LIST_FILE="proxy-servers.txt"
HTML_FILE="azure-app/PrehrajtoProxy/wwwroot/index.html"
JSON_FILE="azure-app/PrehrajtoProxy/appsettings.json"
PHP_FILE="router.php"

if [ ! -f "$LIST_FILE" ]; then
  printf '# Seznam PHP proxy serverů, jeden na řádek. Prázdné řádky a "#" se ignorují.\n' > "$LIST_FILE"
fi

if [ "${1:-}" != "--no-edit" ]; then
  "${EDITOR:-nano}" "$LIST_FILE"
fi

# Vyčistí seznam: bez komentářů/prázdných řádků, ořezané mezery, bez duplicit (pořadí zachováno).
mapfile -t SERVERS < <(grep -vE '^[[:space:]]*(#|$)' "$LIST_FILE" \
  | sed -E 's/^[[:space:]]+//; s/[[:space:]]+$//' \
  | awk '!seen[$0]++')

if [ ${#SERVERS[@]} -eq 0 ]; then
  echo "❌ Seznam je prázdný, nic jsem nepushnul. Uprav $LIST_FILE (nebo spusť skript znovu bez --no-edit)." >&2
  exit 1
fi

for url in "${SERVERS[@]}"; do
  if ! [[ "$url" =~ ^https?://[^[:space:]]+$ ]]; then
    echo "❌ Neplatná URL (musí začínat http:// nebo https://, bez mezer): $url" >&2
    exit 1
  fi
done

if ! command -v python3 >/dev/null 2>&1; then
  echo "❌ Potřebuju python3 (jen na přepsání appsettings.json), nenašel jsem ho v PATH." >&2
  exit 1
fi

echo "📋 Servery k nahrání:"
printf '   - %s\n' "${SERVERS[@]}"

python3 "scripts/apply_proxy_servers.py" "$HTML_FILE" "$JSON_FILE" "$PHP_FILE" "${SERVERS[@]}"

if command -v git >/dev/null 2>&1 && git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo
  echo "📝 git diff:"
  git --no-pager diff --stat -- "$LIST_FILE" "$HTML_FILE" "$JSON_FILE" "$PHP_FILE" || true
fi
