# M05 · Rapport d'environnement (§14) et tests de connectivité (§15)

> Mesuré, non déclaré. Source brute : `environment_report.json`, `connectivity_tests.json`,
> `proxy_status_evidence.json`.

## 1 · Machine

| | |
|---|---|
| OS | Linux 6.18.44-fc-v24 · `x86_64` |
| Distribution | PRETTY_NAME="Ubuntu 24.04.4 LTS" NAME="Ubuntu" |
| CPU | 4 vCPU — Intel(R) Xeon(R) Processor @ 2.80GHz |
| RAM | 16075 Mo |
| Disque disponible | 30G |
| **GPU** | **AUCUN (pas de /dev/nvidia*)** — interdit tout modèle lip-sync auto-hébergé |
| Proxy sortant | oui |
| Gestionnaires de paquets | pip 24.0 · npm 10.9.7 · apt 2.8.3 (amd64) |

## 2 · Dépendances logicielles

| Dépendance | Installée | Version | Bloquante |
|---|---|---|---|
| `python` | ✅ | `3.11.15` | oui |
| `node` | ✅ | `v22.22.2` | non |
| `ffmpeg` | ✅ | `7.0.2-static` | oui |
| `espeak-ng` | ✅ | `eSpeak NG text-to-speech: 1.51` | non |
| `Pillow` | ✅ | `12.3.0` | oui |
| `numpy` | ✅ | `2.4.6` | oui |
| `httpx` | ✅ | `0.28.1` | oui |
| `requests` | ✅ | `2.33.1` | non |
| `pypdfium2` | ✅ | `présent` | non |
| `git` | ✅ | `git version 2.43.0` | non |

**Aucune dépendance logicielle bloquante ne manque.** L'environnement est reproductible :
Python 3.11, ffmpeg 7.0.2 via `imageio-ffmpeg`, Pillow, numpy, httpx.

## 3 · Tests de connectivité providers

Test le plus économique possible : `GET` non authentifié. **Aucun appel facturable émis.**

| Catégorie | Provider | HTTP | Latence | DNS | Clé | Classe |
|---|---|---|---|---|---|---|
| TTS | ElevenLabs | `000` | 294 ms | OK | non | **NETWORK** |
| TTS | Cartesia | `000` | 276 ms | OK | non | **NETWORK** |
| TTS | Azure Speech | `000` | 259 ms | OK | non | **NETWORK** |
| TTS | OpenAI | `000` | 261 ms | OK | non | **NETWORK** |
| LIPSYNC | sync.so | `000` | 260 ms | OK | non | **NETWORK** |
| LIPSYNC | Hedra | `000` | 230 ms | OK | non | **NETWORK** |
| LIPSYNC | fal.ai | `000` | 258 ms | OK | non | **NETWORK** |
| LIPSYNC | Replicate | `000` | 307 ms | OK | non | **NETWORK** |
| ASR | Deepgram | `000` | 259 ms | OK | non | **NETWORK** |
| ASR | AssemblyAI | `000` | 256 ms | OK | non | **NETWORK** |
| VIDEO | fal.ai | `000` | 230 ms | OK | non | **NETWORK** |
| VIDEO | Replicate | `000` | 104 ms | OK | non | **NETWORK** |
| VIDEO | Google AI | `403` | 351 ms | OK | non | **AUTH** |
| STORAGE | Cloudflare R2 | `000` | 49 ms | OK | non | **NETWORK** |

## 4 · Diagnostic

**Le DNS résout pour les 14 hôtes.** Les connexions échouent au niveau `CONNECT` du proxy,
qui répond explicitement :

```
gateway answered 403 to CONNECT (policy denial or upstream failure)
```

pour : `api.elevenlabs.io` · `api.cartesia.ai` · `api.openai.com` · `api.deepgram.com` ·
`api.assemblyai.com` · `api.sync.so` · `api.hedra.com` · `fal.run` · `api.replicate.com` ·
`cloudflarestorage.com` · `francecentral.tts.speech.microsoft.com`

**Les hôtes Google, eux, répondent applicativement :**

```json
{"error": {"code": 403,
  "message": "Method doesn't allow unregistered callers ... Please use API Key",
  "status": "PERMISSION_DENIED"}}
```

> **Conclusion : ce n'est pas un problème de credentials, c'est une politique réseau.**
> Google Cloud (TTS, STT, Veo, GCS) est pleinement joignable et n'attend qu'une clé.
> Tous les autres fournisseurs sont coupés avant la poignée de main TLS.

## 5 · Conséquence

| Expérience | Faisable dans CET environnement, avec une clé Google ? |
|---|---|
| **E1** banque de plans (Veo) | **oui** |
| **E2** TTS français | **oui** |
| **E4** ASR français | **oui** |
| **E5** contrôle génératif (Veo) | **oui** |
| **E3** lip-sync | **NON — aucun fournisseur joignable, aucun équivalent Google** |
| **E6** évaluation humaine | non — exige des personnes, indépendant du réseau |
| **E7** régénération | non — dépend de E1 et E3 |
