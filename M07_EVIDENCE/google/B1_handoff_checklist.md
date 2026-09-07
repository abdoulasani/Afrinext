# B1 · Google Cloud — checklist de handoff (§02, §03)

> Claude ne peut pas provisionner un projet ni une clé Google. Ce qui suit est la
> **liste d'actions minimale**, à privilèges minimaux. **Ne collez jamais la clé dans
> le chat.** Quand c'est fait, répondez simplement « Configuré. »

## Ce qui est déjà vérifié de mon côté

| | |
|---|---|
| Réseau | ✅ `texttospeech.googleapis.com`, `speech.googleapis.com` et `generativelanguage.googleapis.com` sont **joignables** depuis cet environnement (HTTP 403 « Please use API Key » = l'API répond) |
| Adaptateurs | ✅ `GoogleTTS`, `GoogleASR`, `GoogleVeo` écrits et importables — voir `p0/src/p0/providers/impl.py`. **Ils ne seront pas réécrits.** |
| Smoke tests | ✅ écrits — `p0-setup/smoke_tests/run_smoke.py` |
| Garde-fous | ✅ actifs, `DRY_RUN=true` par défaut |

## Les 8 éléments exacts

| # | | |
|---|---|---|
| **1** | **Action console** | [console.cloud.google.com](https://console.cloud.google.com) → créer un projet (ex. `afrinext-p0`) → **activer la facturation** sur ce projet (obligatoire même pour le palier gratuit) |
| **2** | **APIs à activer** | `texttospeech.googleapis.com` · `speech.googleapis.com` · `generativelanguage.googleapis.com` — *APIs & Services → Enable APIs* |
| **3** | **Méthode d'authentification** | **Clé d'API** (`APIs & Services → Credentials → Create credentials → API key`). Restreindre la clé **aux 3 APIs ci-dessus** et rien d'autre. <br>*(Alternative : compte de service + `GOOGLE_APPLICATION_CREDENTIALS`. La clé d'API suffit pour P0 et expose moins de surface.)* |
| **4** | **Variable d'environnement** | `GOOGLE_API_KEY` — dans un fichier `.env` local (déjà gitignoré) ou injectée au runtime. **Jamais dans le dépôt, jamais dans le chat.** |
| **5** | **Permission requise** | Aucun rôle IAM si vous utilisez une clé d'API restreinte. Avec un compte de service : `roles/cloudtts.user`, `roles/speech.client`, et l'accès au modèle Veo. **Principe du moindre privilège : pas de rôle Editor, pas de rôle Owner.** |
| **6** | **Commande de smoke test** | ```bash\ncd p0-setup/smoke_tests && GOOGLE_API_KEY=… python3 run_smoke.py --all\n``` <br>*(préfixez la commande plutôt que d'exporter, ou chargez un `.env`)* |
| **7** | **Signal de succès attendu** | `[PASS] P0-E2-SMOKE google-tts HTTP 200 … octets` puis `[PASS] P0-E4-SMOKE google-stt … transcription: "Bonjour, ceci est un test…"` et `[PASS] P0-E5-SMOKE google-veo … N modèles · Veo: [...]` |
| **8** | **Signal d'échec attendu** | `[BLOCKED] … HTTP 403 → AUTH` (clé invalide ou API non activée) · `HTTP 400 → INPUT` (nom de voix inexistant) · `HTTP 429 → RATE_LIMIT` · `HTTP 402 → BILLING` (facturation non activée) |

## Points d'attention

- **Le nom du modèle Veo change souvent.** Le smoke test E5 liste d'abord les modèles
  disponibles ; si aucun `veo-*` n'apparaît, l'accès au modèle n'est pas accordé sur ce
  projet — c'est un `MODEL_ACCESS`, pas un `AUTH`.
- **La voix par défaut** est `fr-FR-Neural2-A`. Surchargez avec `TTS_VOICE=` si vous
  préférez une voix Chirp3-HD.
- **Coût du smoke test** : quelques centimes au maximum. Le TTS d'une phrase courte et une
  transcription de 3 secondes sont sous le palier gratuit ; lister les modèles est gratuit.

## Ce qui reste bloqué même après B1

**Rien côté Google.** Une seule clé rend E1, E2, E4 et E5 exécutables.
**E3 (lip-sync) reste bloqué** — voir `M07_EVIDENCE/lipsync/`.
