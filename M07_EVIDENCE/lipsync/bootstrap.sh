#!/usr/bin/env bash
# M07 §06 — paquet de lancement du harnais P0 sur une machine à réseau ouvert.
# Ne reconstruit RIEN : clone, installe, vérifie, lance le smoke test.
#
#   chmod +x bootstrap.sh && ./bootstrap.sh
#
# Prérequis : Python 3.11+, git, HTTPS sortant non filtré.
# Les clés se posent dans .env — JAMAIS dans ce script, JAMAIS dans le dépôt.

set -euo pipefail
REPO="${REPO:-https://github.com/abdoulasani/Afrinext.git}"
BRANCH="${BRANCH:-claude/new-session-igslex}"
DIR="${DIR:-afrinext-p0}"

say() { printf "\n\033[1;32m▸ %s\033[0m\n" "$*"; }
die() { printf "\n\033[1;31m✗ %s\033[0m\n" "$*"; exit 1; }

say "1/6 · vérification du runtime"
command -v python3 >/dev/null || die "python3 absent"
PYV=$(python3 -c 'import sys;print("%d.%d"%sys.version_info[:2])')
python3 -c 'import sys;sys.exit(0 if sys.version_info>=(3,11) else 1)' \
  || die "Python >= 3.11 requis (trouvé $PYV)"
command -v git >/dev/null || die "git absent"
echo "  python $PYV · git $(git --version | awk '{print $3}')"

say "2/6 · récupération du harnais"
[ -d "$DIR" ] || git clone --branch "$BRANCH" --depth 1 "$REPO" "$DIR"
cd "$DIR"

say "3/6 · dépendances"
python3 -m pip install --quiet --upgrade pip
python3 -m pip install --quiet pillow numpy httpx imageio-ffmpeg
python3 -c "import PIL, numpy, httpx, imageio_ffmpeg; \
print('  ffmpeg:', imageio_ffmpeg.get_ffmpeg_version())"

say "4/6 · vérification de l'accès réseau (le point qui bloque ailleurs)"
for h in texttospeech.googleapis.com api.sync.so; do
  code=$(curl -s -o /dev/null -w "%{http_code}" -m 12 "https://$h/" || echo 000)
  if [ "$code" = "000" ]; then
    echo "  ✗ $h INJOIGNABLE — cette machine ne convient pas"
  else
    echo "  ✓ $h joignable (HTTP $code)"
  fi
done

say "5/6 · configuration des secrets"
if [ ! -f .env ]; then
  cp p0-setup/.env.example .env
  echo "  .env créé depuis le modèle."
  echo "  → RENSEIGNEZ GOOGLE_API_KEY, LIPSYNC_PROVIDER et LIPSYNC_API_KEY, puis relancez."
  echo "  → .env est gitignoré. Ne le committez pas. Ne le collez nulle part."
  exit 0
fi
set -a; . ./.env; set +a
[ -n "${GOOGLE_API_KEY:-}" ] || echo "  ⚠ GOOGLE_API_KEY vide — E2/E4/E5 resteront SKIPPED"
[ -n "${LIPSYNC_API_KEY:-}" ] || echo "  ⚠ LIPSYNC_API_KEY vide — E3 restera SKIPPED"

say "6/6 · pre-flight et smoke tests"
cd p0 && PYTHONPATH=src python3 -m p0.execute --preflight || true
cd ../p0-setup/smoke_tests && python3 run_smoke.py --all || true

say "terminé"
cat <<'MSG'
  Artefacts : p0-setup/smoke_tests/results/
  Étape suivante : relancer `python3 -m p0.execute --preflight` depuis p0/.
  Objectif : 11/11 READY. À ce moment-là, STOP — c'est M06 qui exécute E1→E7.
MSG
