# 11 · M06 — Pre-flight et arrêt d'exécution

> M06 demandait d'exécuter E1 → E7 pour de vrai. **§1 impose un pre-flight avant toute
> exécution et un arrêt si une dépendance critique manque.** Le pre-flight a été exécuté.
> Il manque 7 dépendances critiques sur 11.

---

## 1 · Pre-flight (§1) — mesuré le 6 septembre 2026

| DEPENDENCY | STATUS | PROVIDER | TESTED | BLOCKER | ACTION |
|---|---|---|---|---|---|
| TTS | **BLOCKED** | google-tts | non | `GOOGLE_API_KEY` absente | créer le projet GCP, activer Text-to-Speech, poser la clé |
| ASR | **BLOCKED** | google-stt | non | `GOOGLE_API_KEY` absente | même clé |
| VIDEO_GEN | **BLOCKED** | google-veo | non | `GOOGLE_API_KEY` absente | même clé |
| CHARACTER | **BLOCKED** | google-veo | non | `GOOGLE_API_KEY` absente | même clé, puis vérifier l'identité |
| **LIPSYNC** | **BLOCKED** | aucun | non | **réseau : hôte refusé au `CONNECT` du proxy** | autoriser l'hôte, ou exécuter sur une machine ouverte |
| SHOT_BANK | **BLOCKED** | interne | oui | seuls des substituts géométriques existent | exécuter E1 |
| PRODUCT_ASSET | READY | interne | oui | — | aucune |
| STORAGE | READY | disque local | oui | — | aucune |
| RENDERING | READY | ffmpeg 7.0.2 | oui | — | aucune |
| EVALUATORS | **BLOCKED** | humains | non | environnement non interactif | recruter 3 à 5 francophones |
| BILLING_LIMITS | READY | garde-fous | oui | — | `DRY_RUN=true` par défaut |

**4 prêtes sur 11.** Rien n'a changé depuis M05 : aucune clé, aucune modification de la
politique réseau, aucun évaluateur.

## 2 · Rapport d'arrêt (STOP RULE)

| | |
|---|---|
| **BLOCKER** | (1) Aucun credential Google Cloud · (2) tous les hôtes lip-sync refusés au `CONNECT` du proxy · (3) aucun évaluateur humain |
| **IMPACT** | E1, E2, E3, E4, E5, E6, E7 non exécutables. **Aucune des quatre hypothèses ne peut être tranchée.** |
| **MINIMUM ACTION** | (1) une clé Google → débloque E1, E2, E4, E5 · (2) autoriser l'hôte lip-sync **ou** exécuter ailleurs → débloque E3 et E7 · (3) recruter 3 à 5 francophones → débloque E6 |
| **RETEST CRITERIA** | `python3 -m p0.execute --preflight` retourne 11/11 prêtes et le code de sortie 0 |

---

## 3 · Ce que M06 a construit à la place

L'expérience est désormais **exécutable en une commande** dès qu'une clé existe.

### Adaptateurs providers réels

| Classe | Expérience | Endpoint | État |
|---|---|---|---|
| `GoogleTTS` | E2 | `texttospeech.googleapis.com/v1/text:synthesize` | écrit, lève `MissingCredentials` sans clé |
| `GoogleASR` | E4 | `speech.googleapis.com/v1/speech:recognize` | écrit, horodatages mot à mot |
| `GoogleVeo` | E1, E5 | `generativelanguage.googleapis.com` (opération longue + polling) | écrit |

Aucun ne simule. Sans clé : `MissingCredentials`. **Jamais de résultat plausible fabriqué.**

### E4 réellement implémentée — WER

Le contrôle `audio_transcription`, `SKIPPED` depuis M03, est maintenant **implémenté** :
distance de Levenshtein sur les mots, comptage séparé des substitutions, suppressions et
insertions, mots manquants et ajoutés, seuil WER ≤ 0,25.

Vérifié sur des cas construits :

| Cas | WER |
|---|---|
| transcription identique | **0,000** |
| une substitution sur cinq mots | **0,200** |
| réplique tronquée (« écris-moi sur WhatsApp » au lieu de la phrase complète) | **0,429** |

Sans provider, il retourne toujours `SKIPPED` — jamais `PASS`.

### Orchestrateur avec garde-fous vérifiés

`python3 -m p0.execute --preflight | --stage E2 [--authorize]`

Les garde-fous **refusent réellement** la dépense. Vérifié avec une clé factice :

```
autorisation E1: coût estimé 5.0000 $ · dépensé aujourd'hui 0.00 $
                 REFUSÉE — coût estimé 5.00 $ > MAX_COST_PER_RUN_USD 2.0
```

Chaque décision est journalisée dans `out/authorizations.jsonl` avec le coût estimé, le
cumul du jour, les plafonds et le motif de refus.

> **Constat de configuration issu de ce test :** l'estimation de E1 (25 générations, 5,00 $)
> **dépasse le plafond par run de 2,00 $**. E1 doit donc être **exécutée par lots** (5 à 8
> plans par run) ou le plafond relevé explicitement. Ce n'est pas un défaut : c'est le
> garde-fou qui fonctionne, et il aurait fallu s'en apercevoir en dépensant.

---

## 4 · Retour d'architecture (§17)

Classement honnête à partir des preuves **réellement disponibles** (M03, M04).

| | Hypothèse | Verdict | Preuve |
|---|---|---|---|
| **A** | La durée réelle du TTS doit piloter la durée de scène | **VALIDÉE** | M04 F-011 : le budget de mots, exact en médiane (2,60 mots/s), est imprécis par ligne. Bascule sur la durée du synthétiseur → échecs `scene_duration` **5 → 0**, réparations **13 → 1**. Mesuré sur 10 publicités |
| **B** | Le compositing produit est plus sûr que la génération du packaging | **PARTIELLEMENT VALIDÉE** | Le compositing est mesuré : similarité 0,785, PSNR logo 24,6 dB sur 20 publicités, détecteur discriminant (faute injectée → 0,660 / 19,5 dB). **Mais l'alternative générative n'a jamais tourné** : « plus sûr que » n'est pas prouvé comparativement |
| **C** | La réparation ciblée réduit la régénération complète | **PARTIELLEMENT VALIDÉE** | 100 % des réparations observées sont de niveau L0-L3, **zéro L5**. Mais uniquement sur des étages déterministes, qui ne défaillent pas aléatoirement |
| **D** | La cohérence du personnage rend une banque de plans réutilisable | **INCONCLUSIVE** | **Jamais testée.** Les 10 plans sont des substituts géométriques. C'est la clé de voûte non vérifiée de tout le chemin C |
| **E** | Le lip-sync est commercialement acceptable | **INCONCLUSIVE** | Jamais exécuté. Aucun provider joignable |
| **F** | Le QC détecte de vrais défauts | **VALIDÉE** | Le QC a trouvé **5 défauts réels** pendant M03/M04 (F-001 à F-005), **dont deux dans le QC lui-même**. Il a intercepté les 2 violations de factualité volontaires à chaque exécution, et les 2 fautes injectées |
| **G** | L'économie soutient un SaaS premium | **INCONCLUSIVE** | **0,00 $ facturé.** Modélisé 0,11–0,85 $ avec 3,9× de marge avant rupture, mais le poste dominant (~87 %, le lip-sync) n'a jamais été mesuré |

**Deux validées, deux partiellement, trois inconclusives.** Aucune n'est réfutée — mais
**D et E, les deux qui fondent le chemin C, sont précisément celles qui n'ont pas pu être
testées.**

---

## 5 · Décision (§18)

| | |
|---|---|
| **H1** — une publicité du chemin C est-elle réellement publiable ? | **INCONCLUSIVE** |
| **H2** — COGS < 1,00 $ | **INCONCLUSIVE** |
| **H3** — latence < 4 min, TTFP < 90 s | **INCONCLUSIVE** — plancher déterministe 13,9 s mesuré, soit 6 % du budget ; la latence provider reste inconnue |
| **H4** — facteur de régénération < 1,4 | **INCONCLUSIVE** |

### P0 STATUS : **FAIL** · PHASE 01 : **BLOCKED**

Inchangé depuis M03. Ce n'est pas une régression : **aucune expérience décisive n'a pu être
exécutée**, donc aucune information nouvelle sur les hypothèses.

---

## 6 · La question finale

> **« Une vraie entreprise publierait-elle ces publicités ? »**

**Réponse : incertain — et voici exactement ce qui reste incertain.**

Ce que nous savons, mesuré :

- Le **produit apparaît fidèlement** : le packaging reste lisible parce qu'il n'est jamais
  redessiné. 0,785 de similarité, 24,6 dB de PSNR logo, sur 20 publicités.
- Le **script ne ment pas** : le contrôle de factualité bloque les allégations non sourcées
  et les superlatifs interdits, à chaque exécution.
- La **chaîne technique tient** : 20 publicités 9:16 produites de bout en bout, montage,
  sous-titres, CTA, normalisation, en 13,9 s médiane.
- La **moitié déterministe est économiquement gratuite** : 0,00025 $ par publicité.

Ce que nous ignorons, et qui décide de tout :

1. **À quoi ressemble un vrai personnage sur ces plans** — la banque est géométrique.
2. **Si le lip-sync est crédible** — jamais exécuté.
3. **Si un humain accepterait de publier** — aucun n'a été interrogé.
4. **Ce que ça coûte vraiment** — 0,00 $ facturé.

Autrement dit : **nous avons prouvé que la machine fonctionne. Nous n'avons rien prouvé sur
ce qu'elle produit.** Et la question posée porte entièrement sur le second point.

Trois choses lèvent l'incertitude, dans cet ordre : une clé Google (E1, E2, E4), un accès
lip-sync (E3), trois évaluateurs (E6). **Environ 60 $ et deux jours.**
