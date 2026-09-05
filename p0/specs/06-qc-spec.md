# P0 · Spécification QC (M03 §22.7, §11)

## Règle de séparation

| | RULE-BASED | MODEL-BASED |
|---|---|---|
| Nature | déterministe | LLM / vision |
| Coût | 0 | payant |
| Statut | **bloquant** | consultatif |
| Reproductible | oui | non |

**Un contrôle non exécutable est `SKIPPED` — jamais `passed`.**

## Les contrôles implémentés

| Contrôle | Type | Seuil | Sév. | Réparation | Statut P0 |
|---|---|---|---|---|---|
| `script_factuality` | rule | 0 violation | **P0** | — (réécriture) | **exécuté** |
| `render_validity` | rule | décodable, > 0,5 s, > 10 ko | P0 | L5 | **exécuté** |
| `aspect_ratio` | rule | 1080×1920 | P1 | L0 | **exécuté** |
| `total_duration` | rule | cible ±15 % | P2 | L0 | **exécuté** |
| `scene_duration` | rule | ±25 % (min 0,35 s) | P2 | L0 ou **L1 selon cause** | **exécuté** |
| `black_frames` | rule | aucun segment | P1 | L5 | **exécuté** |
| `subtitle_validity` | rule | timings valides, longueur | P2 | L0 | **exécuté** |
| `cta_presence` | rule | présent | P1 | L0 | **exécuté** |
| `product_presence` | rule | corrélation ≥ 0,60 sur ≥ 2 frames | **P0** | L3 | **exécuté** |
| `logo_text_preservation` | rule | PSNR ≥ 22 dB | **P0** | L3 | **exécuté** |
| `audio_transcription` | rule | ASR = texte attendu | P1 | L1 | **SKIPPED** — aucun ASR (téléchargement de modèle bloqué) |
| `lip_sync` | model | — | P1 | L2 | **SKIPPED** — aucun provider branché |
| `visual_quality` | model | — | P2 | L4 | **SKIPPED** — non exécuté |

## Détail des deux contrôles produit

- **`product_presence`** — corrélation croisée normalisée entre la région incrustée
  et l'actif source, avec **recherche locale ±16 px** (correctif F-004 : un overlay
  animé se déplace ; un crop figé mesurait la mauvaise zone et produisait des faux
  positifs).
- **`logo_text_preservation`** — PSNR sur la seule boîte du logo. Avec la stratégie
  S1 (compositing), la valeur doit être élevée **par construction** : c'est
  précisément la thèse à démontrer, et c'est ce qui est mesuré.
