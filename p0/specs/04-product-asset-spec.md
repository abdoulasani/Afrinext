# P0 · Spécification d'actif produit (M03 §22.6)

```python
ProductAsset(
  product_id, name, brand,
  views: {'front': png_rgba, 'side': png_rgba, 'back': png_rgba},
  masks: {'front': alpha_png, ...},
  packaging_text: ["KARITÉ D'OR", "BEURRE DE KARITÉ PUR", "200 g"],  # vérité terrain QC
  logo_box: (x, y, w, h),
  synthetic: bool
)
```

## Exigences d'ingestion

1. **PNG avec canal alpha** (détourage) — le masque est dérivé du canal alpha.
2. **Trois vues minimum**, fond neutre, éclairage homogène.
3. **`packaging_text` déclaré** : c'est la vérité terrain contre laquelle le QC
   vérifiera plus tard la lisibilité (OCR, non disponible en P0).
4. **`logo_box` déclaré** : zone mesurée en PSNR pour la préservation du logo.

## La règle qui gouverne tout (M03 §08)

> **Le texte du packaging n'est jamais recréé par un modèle génératif.**
> L'actif réel est masqué, mis à l'échelle, incrusté. Le modèle ne « dessine »
> jamais la marque.
