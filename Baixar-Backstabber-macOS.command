#!/bin/zsh
set -euo pipefail

REPOSITORY="${BACKSTABBER_REPOSITORY:-lucamdv/Backstabber}"

DESTINATION="$HOME/Downloads/Backstabber-macOS-universal.dmg"
URL="https://github.com/$REPOSITORY/releases/latest/download/Backstabber-macOS-universal.dmg"

echo "Baixando a versão mais recente do Backstabber para macOS..."
curl --fail --location --progress-bar "$URL" --output "$DESTINATION"
echo "Download concluído: $DESTINATION"
open -R "$DESTINATION"
