# P0 · Architecture expérimentale (M03 §22.1)

> **Jetable par conception.** Écrit en Python — délibérément, et non dans la stack
> TypeScript du M02 — précisément parce que ce code ne doit pas survivre à la Phase 01.
> Le langage signale l'intention.

```
p0/
├── src/p0/
│   ├── models.py        contrats typés (Fact, ProductAsset, Shot, ScriptLine,
│   │                    AdScript, LedgerEntry, QCResult, AdManifest)
│   ├── ledger.py        cost ledger append-only (JSONL) + trace T0→T8
│   ├── assets.py        produit de marque synthétique + banque de 10 plans
│   ├── compose.py       compositing produit (S1) + montage + rendu ffmpeg
│   ├── qc.py            QC rule-based / model-based, contrôles SKIPPED explicites
│   ├── repair.py        politique de régénération à 6 niveaux
│   ├── run.py           orchestrateur : 1 pub de bout en bout, mesurée
│   └── providers/
│       ├── base.py      interfaces + MissingCredentials (jamais de simulation)
│       └── impl.py      TTS · lip-sync · vidéo générative (contrôle)
├── data/scripts/ads.json   les 10 scripts
├── out/                    résultats, ledger, manifestes, MP4
└── eval/                   grille d'évaluation aveugle
```

## Ce qui n'est PAS construit (M03 §21)

Aucun SaaS, aucun multi-tenant, aucun billing, aucune organisation, aucun dashboard,
aucune API publique, aucun analytics, aucune Brand Memory, aucun routeur adaptatif,
un seul personnage, aucun clonage.

## La garantie anti-fabrication

Un provider sans clé ne renvoie jamais un résultat plausible :

- **par défaut** il lève `MissingCredentials` et le run s'arrête ;
- **en `--offline` explicite**, il renvoie un substitut marqué `synthetic=True`,
  propagé jusqu'au `AdManifest.synthetic_stages` puis jusqu'au rapport.

Un contrôle QC qui ne peut pas s'exécuter est déclaré `SKIPPED` — jamais « passé ».
