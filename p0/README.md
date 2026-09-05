# P0 — Advertising Engine Proof

> **Code jetable.** Écrit en Python — délibérément, et non dans la stack TypeScript
> du M02 — parce qu'il ne doit pas survivre à la Phase 01. Le langage signale
> l'intention.

Harnais expérimental du jalon **M03** : prouver que le chemin C
(banque de plans + TTS + lip-sync + compositing produit + montage) produit une
publicité 9:16 publiable, à faible coût, avec le vrai produit visible.

## Ce qui a réellement tourné

```bash
cd p0 && PYTHONPATH=src python3 -m p0.run --offline --all
PYTHONPATH=src python3 -m p0.costmodel
```

10 publicités produites, 168 opérations tracées, QC exécuté, réparations mesurées.
Résultats dans `out/` (ledger JSONL, manifestes, MP4, `results.json`, `costmodel.json`).

## ⚠ Ce que le mode `--offline` signifie

Aucune clé provider n'était disponible dans l'environnement d'exécution. En
`--offline` :

| Étage | Réellement exécuté ? |
|---|---|
| Script + factualité | **oui** |
| Compositing produit | **oui** |
| Montage, sous-titres, CTA, normalisation, rendu 1080×1920 | **oui** |
| QC rule-based (8 contrôles) | **oui** |
| Réparation ciblée | **oui** |
| Cost ledger et trace de latence | **oui** |
| **TTS** | non — silence de durée réaliste, marqué `SYNTHETIC` |
| **Lip-sync** | non — l'audio est muxé sans synchronisation |
| **Banque de plans** | non — substituts géométriques, filigrane visible sur chaque frame |
| **Chemin génératif de contrôle** | non — le provider lève une erreur explicite |

**Garantie anti-fabrication :** un provider sans clé ne renvoie jamais un résultat
plausible. Il lève `MissingCredentials`, ou — en `--offline` explicite — renvoie un
substitut marqué `synthetic=True`, propagé jusqu'au manifeste et jusqu'au rapport.
Un contrôle QC non exécutable est `SKIPPED`, jamais « passé ».

## Pour exécuter la vraie expérience

```bash
export ELEVENLABS_API_KEY=...   # ou le TTS retenu
export LIPSYNC_API_KEY=...
export VIDEO_API_KEY=...        # chemin génératif de contrôle
PYTHONPATH=src python3 -m p0.run --all      # sans --offline
```

Il faut en plus : une **banque de plans réelle** (10 plans du personnage, voir
`specs/03-shot-spec.md`), un **produit réel** (3 vues détourées) et **3 évaluateurs**
pour `eval/grid.csv`.

## Arborescence

```
specs/            8 spécifications (architecture, pipeline, contrats, plan,
                  produit, script, QC, régénération)
src/p0/           le harnais
data/scripts/     les 10 scripts (marché NE-fr, CTA WhatsApp)
out/              résultats mesurés
eval/             grille d'évaluation aveugle, prête, non remplie
FAILURE-LOG.md    10 défauts, dont 5 trouvés par le QC en exécutant
```
