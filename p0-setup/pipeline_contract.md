# M05 · Contrat de pipeline (§17)

> **RÈGLE CRITIQUE, issue de M04 F-011 : la durée d'une scène dérive de la durée réelle de
> l'audio généré. Jamais d'une estimation par nombre de mots.** Le budget de mots reste un
> guide d'écriture, contrôlé de façon **consultative** (`word_budget_deviation`, P3).

---

## SCRIPT → TTS

| | |
|---|---|
| **Entrée** | `ScriptLine{index, role, text, shot_kind, product_presence, on_screen_text}` + `voice_profile{provider, language_code, voice_name}` |
| **Sortie** | `audio.m4a` (AAC 44,1 kHz mono) + `{actual_duration_s, synth_latency_ms, cost_usd, provider, model, voice}` |
| **Métadonnées** | `experiment_id`, `ad_id`, `scene_index`, `script_version`, `created_at` |
| **Invariant** | `actual_duration_s` **est** la durée de référence de la scène en aval |
| **États d'échec** | `AUTH`, `RATE_LIMIT`, `INPUT` (texte refusé), `OUTPUT` (audio vide ou < 0,3 s) |

## TTS → LIP-SYNC

| | |
|---|---|
| **Entrée** | `shot.mp4` (1080×1920, 25 fps, bouche visible) + `audio.m4a` |
| **Sortie** | `synced.mp4`, **durée = durée audio ±0,1 s** |
| **Invariant** | la vidéo ne tronque jamais l'audio ; si le plan est plus court, il est bouclé ou étendu, jamais l'audio coupé |
| **États d'échec** | `SYNC` (désalignement), `PROVIDER`, `TIMEOUT`, `OUTPUT` |

## LIP-SYNC → COMPOSITING PRODUIT

| | |
|---|---|
| **Entrée** | `synced.mp4` + `ProductAsset{views, masks, logo_box}` + `slot_box` du plan + `mode ∈ {held, hero}` |
| **Sortie** | `scene.mp4` + `placement{x, y, w, h}` — **le placement retourné est la vérité utilisée par le QC** |
| **Invariant** | stratégie **S1** : l'actif réel est masqué, mis à l'échelle et incrusté. Le packaging n'est **jamais** redessiné |
| **États d'échec** | `PRODUCT` (packaging déformé, logo absent, occlusion > 40 %), `INPUT` (pas de `slot_box`) |

## COMPOSITING → EDIT

| | |
|---|---|
| **Entrée** | `scene[]` ordonnées + `sub_lines[(start, end, text)]` + `cta_text` + `MarketContext` |
| **Sortie** | `final.mp4` 1080×1920, 25 fps, LUFS −14, sous-titres ASS brûlés, carte CTA |
| **Invariant** | durée finale = Σ des durées de scène ±2 % ; safe zones respectées |
| **États d'échec** | `VIDEO` (frames noires, ratio faux), `AUDIO` (loudness), `OUTPUT` |

## EDIT → QC

| | |
|---|---|
| **Entrée** | `final.mp4` + `subs.ass` + `facts{}` + `ProductAsset` + `slots[(t, box)]` |
| **Sortie** | `QCResult[]` — chacun `{check, kind: rule\|model, passed, value, threshold, severity, repair}` |
| **Invariant** | un contrôle non exécutable est **`SKIPPED`**, jamais `passed` |
| **États d'échec** | `QC` |

## QC → FINAL AD

| | |
|---|---|
| **Entrée** | `QCResult[]` + `RepairPolicy` |
| **Sortie** | `PUBLISHABLE` \| `NEEDS_EDIT` \| `FAIL` + `AdManifest` (versions épinglées) |
| **Invariant** | une publicité n'est `PUBLISHABLE` que si **tous** les contrôles bloquants passent : factualité, produit visible, logo préservé, CTA présent, ratio, rendu valide, audio non tronqué |
| **États d'échec** | escalade humaine après 2 tours de réparation (M03 §27) |

---

## Diagramme de durée — l'invariant M04

```
texte  ──► TTS ──► audio.m4a
                      │
                      ├── actual_duration_s  ◄── SOURCE DE VÉRITÉ UNIQUE
                      │
                      ├──► durée de la scène vidéo
                      ├──► fenêtre du sous-titre
                      ├──► position dans la timeline
                      └──► durée totale attendue de la publicité

budget de mots (2,6 mots/s)  ──► guide D'ÉCRITURE uniquement
                             ──► contrôle CONSULTATIF word_budget_deviation (P3)
                             ──► ne planifie RIEN
```
