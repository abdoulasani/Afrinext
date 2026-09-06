# M05 · Plan d'exécution P0 (§27.19)

## Chemin critique

```
   ┌────────────────────────────────────────────────────────────────────┐
   │  PRÉALABLE · lever le blocage réseau                               │
   │  Option A : autoriser l'hôte lip-sync dans la politique du proxy   │
   │  Option B : exécuter le harnais sur une machine à réseau ouvert    │
   │  ⟶ SANS CELA, RIEN CI-DESSOUS N'EST EXÉCUTABLE POUR E3             │
   └───────────────────────────┬────────────────────────────────────────┘
                               ▼
   E2 · TTS Google fr-FR ─────────────────────► ~0 $   0,5 j
   E4 · ASR Google fr-FR ─────────────────────► ~0 $   0,5 j
        └─ valide la chaîne audio et active audio_transcription
                               ▼
   E1 · banque de plans via Veo ──────────────► ~50 $  1-2 j
        └─ ★ POINT D'ARRÊT : si la cohérence du personnage échoue,
             l'hypothèse « banque de plans » du M02 tombe. STOP.
                               ▼
   E3 · lip-sync sur 50 clips ────────────────► ~8 $   1 j
                               ▼
   E6 · évaluation aveugle, 3-5 personnes ────► 0 $    0,5 j
        └─ ★ TRANCHE H1. Si FAIL → STOP, retour à l'architecture.
                               ▼
   E5 · contrôle génératif ───────────────────► ~20 $  1 j
   E7 · régénération 100-200 runs ────────────► ~90 $  1 j
        └─ seulement si H1 = PASS
                               ▼
                    DÉCISION P0 · PHASE 01
```

**Coût jusqu'à la décision H1 : ~60 $. Coût total si H1 passe : ~205 $.**

## Séquencement — pourquoi cet ordre

1. **Le moins cher d'abord.** E2 et E4 coûtent presque rien et valident la moitié audio.
2. **Le point de rupture ensuite.** E1 teste la cohérence du personnage, qui est le
   fondement du chemin C. Un échec ici rend E3, E5 et E7 sans objet.
3. **H1 avant l'économie.** E6 tranche la question de qualité. Mesurer le facteur de
   régénération d'un pipeline dont la qualité est rejetée serait de l'argent perdu.
4. **E5 et E7 en dernier**, uniquement si le produit est jugé publiable.

## Conditions d'arrêt automatique (§26)

| Condition | Action |
|---|---|
| Coût cumulé > `MAX_DAILY_COST_USD` | arrêt de la journée, alerte |
| Coût d'un run > `MAX_COST_PER_RUN_USD` | abandon du run, crédits non consommés restitués |
| 3 échecs consécutifs de même classe (`AUTH`, `BILLING`, `NETWORK`) | arrêt — problème d'infrastructure, pas de qualité |
| Sortie manifestement inutilisable sur 3 générations d'affilée | arrêt, revue humaine |
| Credentials invalides | arrêt immédiat |
| Consentement manquant sur un asset | l'asset n'entre pas dans le jeu de données |
| Dépense inattendue (delta > 50 % de l'estimation) | arrêt, réconciliation de la facture |
| Condition de confidentialité violée | arrêt, purge |

## Identifiants (§13)

`P0-E1-001` … `P0-E7-001` · `run_{YYYYMMDD}_{hash}` · `AD01`…`AD10`.
Tout artefact référence `experiment_id`, `run_id`, `ad_id`, `provider`, `model`,
`asset_version`, `script_version`, `timestamp`.

## Ce qui est prêt aujourd'hui

| Élément | État |
|---|---|
| Harnais de production (10 pubs de bout en bout) | ✅ validé sur 20 exécutions |
| Compositing produit S1 + validation | ✅ 0,785 / 24,6 dB mesurés |
| QC rule-based, 9 contrôles | ✅ |
| Boucle de réparation à 6 niveaux, par cause racine | ✅ |
| Cost ledger + trace T0→T8 | ✅ |
| 10 scripts marché NE-fr, CTA WhatsApp | ✅ |
| Produit de test avec branding | ✅ |
| Grille d'évaluation aveugle | ✅ prête, vide |
| Smoke tests providers | ✅ écrits, `SKIPPED` sans clé |
| Garde-fous de coût | ✅ spécifiés, `DRY_RUN=true` par défaut |
| **Accès providers** | ❌ **le seul manque** |
