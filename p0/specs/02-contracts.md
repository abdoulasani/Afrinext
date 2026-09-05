# P0 · Contrats d'entrée / sortie (M03 §22.3)

| Étage | Entrée | Sortie | Invariant vérifié |
|---|---|---|---|
| Script | `AdScript` + `facts{}` | `ScriptLine[]` | chaque chiffre du texte existe dans `facts` ; aucun superlatif de la liste noire |
| TTS | `text`, `voice_id` | `audio.m4a` + `cost_usd` + `synthetic` | durée ≥ durée planifiée (padding sinon) |
| Lip-sync | `shot.mp4`, `audio.m4a` | `synced.mp4` | même durée que l'audio |
| Compositing | `Shot(slot_box)`, `ProductAsset`, `audio` | `scene.mp4` + `placement{x,y,w,h}` | le `placement` est renvoyé et sert de vérité au QC produit |
| Montage | `scene[]`, `sub_lines[]`, `cta` | `final.mp4` + `subs.ass` | 1080×1920, 25 fps, LUFS −14 |
| QC | `final.mp4`, specs | `QCResult[]` | tout contrôle non exécutable est `SKIPPED`, jamais `passed` |
| Réparation | `QCResult[]` | niveau + action | on tente toujours le niveau le moins cher d'abord |

**Règle transversale :** aucune étape ne renvoie de texte libre à re-parser. Tout
est typé (`dataclass`), et le manifeste épingle ce qui a produit quoi.
