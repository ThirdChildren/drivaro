#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PACKAGE_PATH="${1:-$ROOT_DIR/contracts/vehicle_passport_move}"
OUT_FILE="${2:-$ROOT_DIR/docs/publish-output.json}"

if ! command -v iota >/dev/null 2>&1; then
  echo "Errore: iota CLI non trovato" >&2
  exit 1
fi

echo "[1/2] Publish package Move: $PACKAGE_PATH"
iota client publish "$PACKAGE_PATH" --json | tee "$OUT_FILE" >/dev/null

echo "[2/2] Estrazione IDs"
if command -v jq >/dev/null 2>&1; then
  PACKAGE_ID="$(jq -r '.objectChanges[]? | select(.type=="published") | .packageId // empty' "$OUT_FILE" | head -n1)"
  REGISTRY_ID="$(jq -r '.objectChanges[]? | select(.type=="created" and ((.objectType // "") | contains("::vehicle_passport::Registry"))) | .objectId // empty' "$OUT_FILE" | head -n1)"

  echo "PACKAGE_ID=$PACKAGE_ID"
  echo "REGISTRY_ID=$REGISTRY_ID"
  echo
  echo "Aggiungi questi valori nel file .env:"
  echo "IOTA_PACKAGE_ID=$PACKAGE_ID"
  echo "IOTA_REGISTRY_ID=$REGISTRY_ID"
else
  echo "jq non installato. Leggi l'output in $OUT_FILE e copia packageId/registryId manualmente."
fi
