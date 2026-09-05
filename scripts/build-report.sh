#!/usr/bin/env bash
# Génère le PDF d'un rapport de jalon à partir de son fichier HTML.
#
#   ./scripts/build-report.sh docs/reports/M01-blueprint-architecture.html
#
# Le PDF est écrit à côté du HTML, même nom de base.
# Dépendance : un binaire Chromium/Chrome headless.

set -euo pipefail

SRC="${1:?usage: build-report.sh <fichier.html>}"
[ -f "$SRC" ] || { echo "introuvable : $SRC" >&2; exit 1; }

ABS="$(cd "$(dirname "$SRC")" && pwd)/$(basename "$SRC")"
OUT="${ABS%.html}.pdf"

CHROME=""
for c in /opt/pw-browsers/chromium "$(command -v chromium || true)" \
         "$(command -v chromium-browser || true)" "$(command -v google-chrome || true)"; do
  [ -n "$c" ] && [ -x "$c" ] && { CHROME="$c"; break; }
done
[ -n "$CHROME" ] || { echo "aucun binaire Chromium trouvé" >&2; exit 1; }

"$CHROME" --headless --disable-gpu --no-sandbox \
  --run-all-compositor-stages-before-draw --virtual-time-budget=10000 \
  --no-pdf-header-footer \
  --print-to-pdf="$OUT" "file://$ABS" 2>/dev/null

echo "$OUT ($(du -h "$OUT" | cut -f1))"
