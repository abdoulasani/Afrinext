# P0 · Politique de régénération ciblée (M03 §22.8, §12)

> **NEVER REGENERATE WHAT DOES NOT NEED TO BE REGENERATED.**

| Niveau | Portée | Facturé ? |
|---|---|---|
| **L0** | montage, timing, sous-titres, normalisation | **non** |
| **L1** | resynthèse audio d'**une** ligne | oui |
| **L2** | resynchronisation labiale d'**une** scène | oui |
| **L3** | réincrustation produit sur **une** scène | **non** |
| **L4** | remplacement du plan par un autre de la banque | **non** |
| **L5** | régénération complète de la scène | oui |

## L'algorithme

1. Collecter les échecs QC non `SKIPPED`.
2. **Diagnostiquer la cause racine avant de choisir le niveau** — correctif F-005.
   Exemple : `scene_duration` en échec se répare en **L0** si le montage a dérivé,
   mais en **L1** si l'audio est réellement plus court que prévu. Choisir par nom
   de contrôle plutôt que par cause conduit à une réparation qui ne répare rien —
   c'est ce qui a été observé avant correction.
3. Appliquer le niveau le moins cher parmi ceux qui peuvent traiter la cause.
4. Re-monter (L0, toujours gratuit) et re-passer le QC.
5. Maximum **2 tours**. Ensuite : escalade, arrêt de la dépense (M03 §27).

## Ce que le `script_factuality` ne répare pas

Une allégation interdite n'est pas un défaut de production : c'est un défaut
d'écriture. Elle est **exclue de la boucle de réparation** et remonte à l'écriture.
Vérifié : AD05 et AD09 restent en échec après deux tours, comme attendu.
