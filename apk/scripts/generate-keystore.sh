#!/usr/bin/env bash
# Vyrobí release keystore pro Wflix a vypíše, co nastavit v GitHubu.
# Spusť lokálně (potřebuje JDK s `keytool`). Keystore ZAZÁLOHUJ – bez něj nejde appku aktualizovat.
set -euo pipefail

KS="${1:-wflix-release.jks}"
ALIAS="${2:-wflix}"

if [ -e "$KS" ]; then
  echo "Soubor $KS už existuje, nic nepřepisuju." >&2
  exit 1
fi

PASS="$(openssl rand -base64 24 | tr -d '/+=' | cut -c1-24)"

keytool -genkeypair -v -keystore "$KS" -storetype PKCS12 \
  -alias "$ALIAS" -keyalg RSA -keysize 4096 -validity 36500 \
  -storepass "$PASS" -keypass "$PASS" \
  -dname "CN=Wflix, O=Qikseek, C=CZ"

cat <<EOF

Hotovo: $KS

1) Ulož $KS a heslo níže na bezpečné místo (správce hesel). NEDÁVEJ je do gitu.
2) Nastav GitHub secrets (potřebuješ gh CLI):

   base64 -w0 "$KS" | gh secret set WFLIX_KEYSTORE_BASE64
   gh secret set WFLIX_STORE_PASSWORD --body '$PASS'
   gh secret set WFLIX_KEY_PASSWORD   --body '$PASS'
   gh secret set WFLIX_KEY_ALIAS      --body '$ALIAS'

3) Lokální release build (volitelné) – do ~/.gradle/gradle.properties:

   WFLIX_STORE_FILE=$(cd "$(dirname "$KS")" && pwd)/$(basename "$KS")
   WFLIX_STORE_PASSWORD=$PASS
   WFLIX_KEY_ALIAS=$ALIAS
   WFLIX_KEY_PASSWORD=$PASS
EOF
