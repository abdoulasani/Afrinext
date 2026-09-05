# P0 · Spécification de plan (M03 §22.4)

```python
Shot(
  shot_id, kind, path, duration_s, fps, width, height,
  product_slot: 'hand_right' | 'front_center' | None,
  slot_box: (x, y, w, h),      # zone d'incrustation, en pixels 1080×1920
  mouth_box: (x, y, w, h),     # zone bouche — entrée du lip-sync
  synthetic: bool, source: str
)
```

Les 10 plans requis par M03 §05 :

| # | `kind` | slot produit | usage |
|---|---|---|---|
| 1 | `talking_medium` | — | corps de script |
| 2 | `talking_close` | — | hook |
| 3 | `holding_product` | `hand_right` | produit tenu (test A) |
| 4 | `showing_product` | `front_center` | produit présenté / hero (tests B et C) |
| 5 | `looking_product` | `hand_right` | regard sur le produit |
| 6 | `pointing` | `hand_right` | désignation |
| 7 | `reaction` | — | transition |
| 8 | `smiling` | — | bénéfice |
| 9 | `listening` | — | respiration |
| 10 | `cta` | — | clôture |

**Contrainte de production :** `slot_box` est ce qui rend le compositing possible
sans modèle. Un plan sans emplacement produit défini est inutilisable pour une
publicité e-commerce — c'est une contrainte de tournage, pas de logiciel.
