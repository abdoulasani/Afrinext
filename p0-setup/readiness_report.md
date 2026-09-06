# M05 · Rapport de readiness

## Tableau final (§28)

| Dépendance | Provider | Modèle | Accès | Testé | Statut | Coût | Bloqueur | Action suivante |
|---|---|---|---|---|---|---|---|---|
| **TTS** | Google Cloud TTS | `fr-FR` Neural2 / Chirp3-HD | **joignable**, clé absente | connectivité ✅ · smoke `SKIPPED` | **READY_ON_KEY** | ~0 $ (palier gratuit à confirmer) | clé API | créer un projet GCP, activer l'API, poser `GOOGLE_API_KEY` |
| **LIP-SYNC** | sync.so *(candidat)* | UNKNOWN | **BLOQUÉ** — `403 CONNECT` | non testable | **BLOCKED** | ~8 $ pour E3 | **politique réseau** | autoriser l'hôte, **ou** exécuter hors de cet environnement |
| **ASR** | Google Cloud STT | `fr-FR` | **joignable**, clé absente | connectivité ✅ · smoke `SKIPPED` | **READY_ON_KEY** | < 1 $ | clé API | même clé que le TTS |
| **VIDEO GENERATION** | Google Veo 3.1 Lite | `veo-3.1-lite` | **joignable**, clé absente | connectivité ✅ · smoke `SKIPPED` | **READY_ON_KEY** | ~20 $ (E5) | clé API | même clé |
| **CHARACTER** | Google Veo 3.1 Lite | `veo-3.1-lite` | **joignable**, clé absente | non testé | **READY_ON_KEY** | ~50 $ (E1) | clé API | générer, puis vérifier la cohérence d'identité |
| **SHOT BANK** | — | — | spécifiée | substituts en place | **SPEC_READY** | inclus dans E1 | assets réels | exécuter E1 |
| **PRODUCT ASSET** | interne | — | disponible | **validé sur 20 pubs** | **READY** | 0 $ | aucun | remplacer par un produit client réel pour l'expérience finale |
| **STORAGE** | disque local | — | disponible | ✅ | **READY** | ~0 $ | aucun | aucune |
| **RENDERING** | ffmpeg 7.0.2 | libx264 / AAC / ASS | disponible | **smoke PASS** | **READY** | 0,00025 $/pub | aucun | aucune |
| **HUMAN EVALUATION** | grille CSV locale | — | prête | grille vide | **READY_ON_PEOPLE** | 0 $ | 3 à 5 personnes | recruter des francophones du marché visé |

## Critères de sortie (§29)

| # | Critère | État |
|---|---|---|
| 1 | Tout provider critique identifié | ✅ |
| 2 | **Accès réel** | ❌ **aucun credential ; lip-sync bloqué au niveau réseau** |
| 3 | Credentials configurés sûrement | ✅ mécanisme prêt (`.env.example`, aucun secret au dépôt) — mais aucune clé fournie |
| 4 | **Smoke tests fonctionnels** | ❌ 1 PASS (rendu local) · 4 `SKIPPED` |
| 5 | Exigences personnage / plans définies | ✅ `character_manifest.json`, `shot_manifest.json` |
| 6 | Asset produit prêt | ✅ validé sur 20 publicités |
| 7 | Chemin ASR prêt | ✅ spécifié et codé — bloqué sur la clé |
| 8 | Évaluation humaine prête | ✅ protocole et seuils fixés **avant** l'expérience |
| 9 | Harnais E7 prêt | ✅ implémenté et mesuré en M03/M04 |
| 10 | Garde-fous budgétaires actifs | ✅ `DRY_RUN=true` par défaut |
| 11 | Schémas définis | ✅ `data_schema.md` |
| 12 | E1→E7 démarrables sans nouvelle refonte | ⚠️ **oui pour E1, E2, E4, E5 · non pour E3** |

**2 critères sur 12 en échec — et ce sont les deux qui définissent le PASS.**

## Verdict

```
M05 STATUS : BLOCKED
E1 READY : NO   (READY_ON_KEY — une clé Google suffit)
E2 READY : NO   (READY_ON_KEY — une clé Google suffit)
E3 READY : NO   ★ BLOQUÉ PAR LA POLITIQUE RÉSEAU, pas par un credential
E4 READY : NO   (READY_ON_KEY — une clé Google suffit)
E5 READY : NO   (READY_ON_KEY — une clé Google suffit)
E6 READY : NO   (READY_ON_PEOPLE — 3 à 5 francophones)
E7 READY : NO   (dépend de E1 et E3)
P0 EXECUTION : BLOCKED
```

## Les bloqueurs exacts, et l'action minimale pour chacun

| # | Bloqueur | Action minimale | Effet |
|---|---|---|---|
| **1** | Aucune clé Google Cloud | créer un projet, activer Text-to-Speech, Speech-to-Text et l'API Gemini, poser `GOOGLE_API_KEY` | **débloque E1, E2, E4, E5 — 4 expériences sur 7** |
| **2** | `api.sync.so` et tous les hôtes lip-sync refusés au `CONNECT` du proxy | autoriser l'hôte dans la politique réseau, **ou** exécuter le harnais sur une machine à réseau ouvert | **débloque E3, donc H1, donc E7** |
| **3** | Aucun évaluateur | recruter 3 à 5 francophones du marché visé | débloque E6, qui tranche H1 |

**Le bloqueur n°2 est le seul qui ne se résout pas avec de l'argent.**

## Ce que M05 a néanmoins produit

19 livrables sur 19 sont écrits. Le seul manque est l'**accès**, pas la préparation :

- matrice de 18 candidats providers avec sources citées et champs `UNKNOWN` assumés
- sélection PRIMARY/SECONDARY justifiée **par la contrainte réelle**, pas par la mode
- environnement et connectivité **mesurés**, avec preuve du refus proxy
- harnais de smoke tests exécutable, qui déclare `SKIPPED` et jamais `PASS` sans credential
- contrat de pipeline portant l'invariant M04 (la durée vient du synthétiseur)
- schémas, taxonomie de panne, observabilité, sécurité, consentement
- protocole d'évaluation avec **seuils H1 fixés avant l'expérience**
- budget LOW/BASE/HIGH et plan d'exécution séquencé avec points d'arrêt

**Coût jusqu'à la décision H1 : environ 60 $.**
