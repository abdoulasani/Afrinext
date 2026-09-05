# P0 · Diagramme de pipeline (M03 §22.2)

```
 T0 ────────────────────────────────────────────────────────────────────
   │
   ├─ FACTS (business)                    ProductAsset (3 vues + masques)
   │      │                                      │
 T1 ├─ STRATÉGIE (chargée depuis ads.json — pas de LLM en P0)
   │      │
 T2 ├─ SCRIPT ─────────► script_factuality ◄── FACTS
   │      │              (RULE · BLOQUANT · les affirmations non sourcées
   │      │               et les superlatifs sont rejetés avant dépense)
   │      ▼
   │   pour chaque ligne :
   │      │
 T3 │      ├─ TTS ──────────────────► audio.m4a
   │      │     · durée = f(mots)  · padding silence si sous la durée planifiée
   │      │
 T4 │      ├─ LIP-SYNC ─────────────► shot + audio synchronisés
   │      │     ⚠ NON EXÉCUTÉ en P0 : aucun provider branché
   │      │
 T5 │      └─ COMPOSITING PRODUIT ──► scene_n.mp4
   │            · S1 : l'asset RÉEL est masqué, mis à l'échelle, incrusté
   │            · le packaging n'est jamais redessiné par un modèle
   │            · modes : held (slot du plan) · hero (centré, léger mouvement)
 T6 │   ◄── PREMIER PIXEL (première scène disponible)
   │
 T7 ├─ MONTAGE ──► concat + sous-titres ASS + carte CTA + loudnorm → 1080×1920
   │
 T8 ├─ QC ──► rule-based (bloquant) + model-based (consultatif) + SKIPPED
   │      │
   │      └─ RÉPARATION CIBLÉE, du niveau le moins cher au plus cher
   │            L0 montage/timing/texte      ← gratuit
   │            L1 resynthèse audio          ← payant
   │            L2 lip-sync seul             ← payant
   │            L3 réincrustation produit    ← gratuit
   │            L4 remplacement de plan      ← gratuit
   │            L5 régénération complète     ← payant
   │
   └─ MANIFESTE (versions épinglées, étapes synthétiques, QC, timings, coûts)
```
