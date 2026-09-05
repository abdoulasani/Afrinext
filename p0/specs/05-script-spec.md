# P0 · Spécification de script (M03 §22.5, §07)

```python
AdScript(ad_id, hook_type, language='fr', market='NE-fr',
         lines=[ScriptLine(index, role, text, duration_s, shot_kind,
                           product_presence, on_screen_text)],
         cta_channel='whatsapp', facts_used=[...])
```

## Structure imposée · ~15 s · 9:16

`HOOK → PROBLEM/DESIRE → PRODUCT → BENEFIT/PROOF → CTA`

## Budget de mots

Débit retenu pour le français publicitaire : **2,6 mots/seconde**.
`duration_s = max(1,6 ; mots / 2,6)`, et l'audio synthétisé est **complété par du
silence** s'il tombe sous la durée planifiée — au lieu de laisser deux formules
diverger (défaut F-002 constaté puis corrigé).

## Séparation FACTS / CREATIVE — non négociable

| | |
|---|---|
| **FACTS** | fournis par l'entreprise : marque, produit, contenance, composition, prix, livraison, contact. **Seule source autorisée de toute affirmation.** |
| **CREATIVE** | angle, hook, formulation, rythme, ordre. Libre, tant qu'il n'affirme rien. |

Le contrôle `script_factuality` (rule-based, **bloquant**, coût nul) rejette :

- tout **chiffre** absent des `facts` ;
- tout **superlatif ou garantie** de la liste noire (`meilleur`, `n°1`, `garanti`,
  `miracle`, `prouvé scientifiquement`, `100% efficace`, `guérit`, …).

**Deux scripts sur dix contiennent volontairement une violation** (AD05 : « plus de
2000 femmes » non sourcé ; AD09 : « le meilleur… garanti »). Ils servent de témoin :
un QC qui ne bloque rien ne prouve rien. Les deux ont été bloqués à chaque exécution.
