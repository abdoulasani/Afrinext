# B2 · Paquet de lancement sur machine ouverte (§06)

> **Le pipeline n'est pas reconstruit.** Ce paquet transporte et lance le harnais existant.

| | |
|---|---|
| **Runtime** | Python **≥ 3.11**, git, bash. Aucun GPU nécessaire *(sauf si vous choisissez LatentSync auto-hébergé)* |
| **Dépendances** | `pillow` · `numpy` · `httpx` · `imageio-ffmpeg` — installées par `bootstrap.sh` |
| **Réseau requis** | HTTPS sortant **non filtré** vers `texttospeech.googleapis.com`, `speech.googleapis.com`, `generativelanguage.googleapis.com` **et** l'hôte du fournisseur lip-sync |
| **Variables** | `GOOGLE_API_KEY`, `LIPSYNC_PROVIDER`, `LIPSYNC_API_KEY` — dans `.env` local, gitignoré |
| **Commande exacte** | `chmod +x bootstrap.sh && ./bootstrap.sh` |
| **Entrée de test** | un plan de `p0/data/shots/*.mp4` (4 s, 1080×1920) + un audio TTS court |
| **Artefact attendu** | `p0-setup/smoke_tests/results/` — `e2_tts_smoke.mp3`, `e4_asr_smoke.json`, `smoke_results.json` |
| **Signal de succès** | `[PASS]` sur `P0-E2-SMOKE`, `P0-E4-SMOKE`, `P0-E5-SMOKE` et — une fois l'adaptateur du fournisseur retenu écrit — `P0-E3-SMOKE` |
| **Signal d'échec** | `[BLOCKED] … NETWORK` = la machine est elle aussi filtrée · `AUTH` = clé ou API · `MODEL_ACCESS` = Veo non accordé sur le projet |

## Vérification préalable, en une commande

Avant de tout transporter, testez seulement que la machine candidate voit bien les hôtes :

```bash
for h in texttospeech.googleapis.com api.sync.so; do
  printf "%-34s HTTP %s\n" "$h" \
    "$(curl -s -o /dev/null -w '%{http_code}' -m 10 https://$h/)"
done
```

`000` sur `api.sync.so` ⇒ **cette machine ne convient pas non plus.** Toute autre valeur
(403, 404, 200…) signifie que l'hôte répond et que la machine convient.

## Une étape reste à écrire

L'adaptateur `LipSyncProvider.sync()` est **volontairement non implémenté** contre une API
précise : M03 §06 interdit d'écrire un appel spéculatif contre un fournisseur non retenu.
Une fois le fournisseur choisi, il reste **une méthode à écrire** (~40 lignes) : soumettre
vidéo + audio, interroger l'opération, télécharger le résultat. Le reste du pipeline
l'utilise déjà.
