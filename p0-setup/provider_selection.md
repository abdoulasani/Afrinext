# M05 · Sélection des providers

> **La contrainte qui décide de tout n'est pas la qualité — c'est l'accessibilité réseau.**
> Le proxy sortant de cet environnement refuse le `CONNECT` vers 11 hôtes fournisseurs sur 13
> (preuve : `proxy_status_evidence.json`, `connectivity_tests.json`). Une seule famille passe :
> **Google Cloud**.

## 1 · Le fait qui structure la sélection

```
gateway answered 403 to CONNECT (policy denial)  →  api.elevenlabs.io · api.cartesia.ai
                                                    api.openai.com · api.deepgram.com
                                                    api.assemblyai.com · api.sync.so
                                                    api.hedra.com · fal.run
                                                    api.replicate.com · cloudflarestorage.com
                                                    francecentral.tts.speech.microsoft.com

HTTP 403 "Please use API Key"                    →  texttospeech.googleapis.com       JOIGNABLE
                                                    generativelanguage.googleapis.com JOIGNABLE
                                                    aiplatform.googleapis.com (404)   JOIGNABLE
                                                    storage.googleapis.com (400)      JOIGNABLE
```

La différence est nette : les hôtes Google renvoient une **erreur applicative** (« fournissez
une clé »), les autres sont coupés **avant même la poignée de main TLS**. Ce n'est pas un
problème de credentials, c'est une politique réseau.

## 2 · Sélection

| Catégorie | PRIMARY | SECONDARY | Raison |
|---|---|---|---|
| **TTS** | **Google Cloud Text-to-Speech** (`fr-FR`, Chirp3-HD / Neural2) | ElevenLabs · Azure Speech | Seul TTS joignable. Un unique credential couvre aussi ASR, vidéo et stockage |
| **ASR** | **Google Cloud Speech-to-Text** (`fr-FR`) | Deepgram Nova-3 · AssemblyAI | Joignable ; horodatages mot à mot pour le contrôle `audio_transcription` |
| **Vidéo (contrôle E5)** | **Veo 3.1 Lite via Gemini API** | fal.ai · Replicate | Seul générateur joignable. Lite suffit : E5 est un **contrôle équitable**, pas une recherche du meilleur générateur |
| **Personnage / banque de plans** | **Veo 3.1 Lite** | — | Produit les 10 plans **sans acteur humain**, donc sans consentement de tiers (§10) |
| **Lip-sync** | **sync.so** *(candidat)* | Hedra · LatentSync auto-hébergé | **BLOQUÉ ici.** Aucun fournisseur joignable, et Google n'en propose aucun |
| **Stockage** | disque local | Google Cloud Storage | P0 n'a aucun besoin de stockage cloud |
| **Rendu** | ffmpeg local 7.0.2 | — | Déjà validé sur 20 publicités en M03/M04 |
| **Éval. humaine** | grille CSV locale | — | Prête et vide dans `p0/eval/grid.csv` |

## 3 · Ce que la contrainte impose — et ce qu'elle offre

**Elle impose** une dépendance mono-fournisseur sur trois étages. C'est contraire au principe
*model-agnostic* du M02 §Q. **C'est acceptable pour P0 et seulement pour P0** : l'objectif est
de mesurer, pas de construire. L'abstraction par capabilities reste la cible de la Phase 01,
et le harnais garde ses adaptateurs derrière l'interface `Provider`.

**Elle offre** une simplification réelle : **un seul projet Google Cloud, une clé, une facture,
un quota** couvre E1, E2, E4 et E5. Les garde-fous budgétaires en deviennent triviaux.

## 4 · Le lip-sync — la seule vraie impasse

| Option | État | Ce qu'il faudrait |
|---|---|---|
| API tierce (sync.so, Hedra, fal, Replicate) | **BLOQUÉ** par la politique réseau | ajouter l'hôte à la liste d'autorisation du proxy |
| Modèle auto-hébergé (LatentSync, Wav2Lip) | **BLOQUÉ** — aucun GPU (`/dev/nvidia*` absent), hôtes de poids injoignables | une machine GPU à réseau ouvert |
| Équivalent Google | **N'EXISTE PAS** | — |

> **C'est la dépendance la plus dangereuse du projet** : elle porte à elle seule **~87 % du
> coût variable** (mesuré en M03) **et** l'hypothèse H1. Sans elle, P0 ne peut pas conclure,
> quelle que soit la qualité du reste.

## 5 · Réserves explicites sur les prix

Tous les prix de `provider_matrix.csv` viennent de **comparatifs secondaires** consultés en
septembre 2026 — jamais d'une page tarifaire officielle ni d'une facture. Ils portent la
mention `(source secondaire)`. Aucun prix Google n'a pu être vérifié : `UNKNOWN_verify_official`.

**Avant tout engagement : relever les prix officiels et, mieux, une première facture réelle.**
M03 a déjà montré que le facteur de régénération, et non le prix catalogue, est la variable
dominante.

Sources : [Deepgram — Best TTS APIs](https://deepgram.com/learn/best-text-to-speech-apis-2026) ·
[Gradium — Comparing TTS pricing](https://gradium.ai/content/how-to-compare-tts-pricing-across-providers-2026) ·
[TextToLab — Azure TTS](https://texttolab.com/blog/azure-text-to-speech-pricing) ·
[sync.so pricing](https://sync.so/pricing) ·
[lipsync.com pricing](https://lipsync.com/pricing) ·
[Deepgram pricing](https://deepgram.com/pricing) ·
[buildmvpfast — transcription](https://www.buildmvpfast.com/api-costs/transcription) ·
[buildmvpfast — AI video](https://www.buildmvpfast.com/api-costs/ai-video) ·
[FluxNote — video pricing](https://fluxnote.io/blog/ai-video-generation-pricing-guide-2026)
