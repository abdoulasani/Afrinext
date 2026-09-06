# M05 · Spécification du harnais de régénération (E7) (§22)

## Objectif

Mesurer le **facteur de régénération réel** sur des étages **stochastiques**. M03 et M04 ont
mesuré 1,00-1,02, mais sur des étages déterministes qui ne défaillent pas aléatoirement :
**ce chiffre n'a aucune valeur prédictive**. E7 n'a de sens qu'après E1, E2 et E3 réels.

## Plan d'exécution

| | |
|---|---|
| **Cible minimale** | 10 publicités × 10 exécutions = **100 runs** |
| **Cible idéale** | 10 × 20 = **200 runs** |
| **Variabilité** | seed non fixée sur les étages génératifs ; script, produit et personnage **identiques** |
| **Garde-fous** | `MAX_GENERATIONS_PER_DAY`, `MAX_DAILY_COST_USD`, arrêt automatique (§26) |

## Enregistrement — une ligne par tentative

```csv
generation_id,experiment_id,run_id,ad_id,attempt,stage,provider,model,
failure,failure_class,root_cause,repair_level,retry_of,
cost_usd,latency_ms,final_status,timestamp
```

## Niveaux de réparation

| Niveau | Portée | Facturé |
|---|---|---|
| **L0** | montage, timing, texte, sous-titres, normalisation | non |
| **L1** | resynthèse audio d'une ligne | oui |
| **L2** | resynchronisation labiale d'une scène | oui |
| **L3** | réincrustation produit d'une scène | non |
| **L4** | remplacement du plan par un autre de la banque | non |
| **L5** | régénération complète de la scène | oui |

Le niveau est choisi **par cause racine**, jamais par nom de contrôle — correctif M03 F-005.

## Métriques calculées

```
regeneration_factor      = tentatives totales / scènes livrées
first_pass_success_rate  = scènes OK au 1er essai / scènes totales
targeted_repair_rate     = réparations L0-L4 / réparations totales
full_regeneration_rate   = réparations L5 / réparations totales
free_repair_rate         = réparations non facturées / réparations totales
cost_of_failure          = coût moyen d'une tentative échouée
latency_of_failure       = latence moyenne d'une tentative échouée
```

## Seuils, fixés avant l'expérience

| Métrique | Cible M02 | Seuil d'alerte |
|---|---|---|
| `regeneration_factor` | < 1,4 | **> 2,2 → la grille tarifaire du M02 ne tient plus** |
| `free_repair_rate` | > 60 % | < 40 % → l'échelle de réparation n'apporte pas ce qui était prévu |
| `first_pass_success_rate` | > 70 % | < 50 % → problème de qualité en amont |

## État actuel

Le harnais **existe déjà** : boucle de réparation implémentée et mesurée en M03/M04, ledger
et trace opérationnels. Il ne manque que les étages stochastiques.
**E7 est READY côté logiciel, BLOCKED côté fournisseurs.**
