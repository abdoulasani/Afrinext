# M05 · Budget d'exécution P0 (§25)

> **Ceci n'est pas une autorisation de dépense.** C'est une enveloppe chiffrée à approuver.
> Enveloppe de planification issue du M03 : **135 – 390 $**.

## Décomposition

| Poste | Base de calcul | LOW | BASE | HIGH | Gratuit ? |
|---|---|---|---|---|---|
| **E1 · banque de plans** | 10 plans retenus × facteur de sélection 2,5 = 25 générations de 4 s | 25 $ | **50 $** | 100 $ | non — Veo facturable |
| **E2 · TTS** | 50 lignes × ~182 caractères = ~9 100 caractères | < 1 $ | **< 1 $** | 2 $ | **oui** — Google offre un palier gratuit à vérifier |
| **E3 · lip-sync** | 50 clips × ~2,8 s = 140 s de vidéo | 3 $ | **8 $** | 25 $ | non |
| **E4 · ASR** | ~140 s d'audio = 0,04 h | < 1 $ | **< 1 $** | 1 $ | quasi |
| **E5 · contrôle génératif** | 10 pubs × 5 scènes × 2,8 s = 140 s en Veo Lite | 7 $ | **20 $** | 60 $ | non |
| **E6 · évaluation humaine** | 3 à 5 personnes, 30 à 50 visionnages | 0 $ | **0 $** | 0 $ | **oui** |
| **E7 · régénération** | 100 à 200 runs, TTS + lip-sync uniquement | 40 $ | **90 $** | 200 $ | non |
| **Stockage / calcul** | mesuré : 0,00025 $/pub, ~100 Go-mois maximum | < 1 $ | **< 1 $** | 2 $ | quasi |
| **Contingence** | 20 % | 15 $ | **34 $** | 80 $ | — |
| **TOTAL** | | **≈ 92 $** | **≈ 205 $** | **≈ 470 $** | |

Le scénario BASE tombe au milieu de l'enveloppe de planification. Le scénario HIGH la dépasse
de 20 % — d'où les garde-fous ci-dessous, qui interrompent avant d'y arriver.

## Ce qui est testable gratuitement

- Toute la chaîne déterministe : compositing, montage, rendu, QC, réparation *(déjà fait)*
- TTS via le palier gratuit Google, si confirmé
- L'évaluation humaine
- Les smoke tests de connectivité

## Ce qui exige des crédits payants

E1 (banque de plans), E3 (lip-sync), E5 (contrôle génératif), E7 (régénération) —
soit **~168 $ sur 205 $ au scénario BASE, dont E7 à lui seul 90 $**.

## Ce qui est bloqué même avec un budget

**E3 · lip-sync.** Aucun fournisseur n'est joignable depuis cet environnement. Payer ne
suffit pas : il faut soit une modification de la politique réseau, soit une autre machine.

## Garde-fous actifs (§12)

```
MAX_COST_PER_RUN_USD=2.00        arrêt d'un run au-delà
MAX_DAILY_COST_USD=25.00         arrêt de la journée au-delà
MAX_CLIPS_PER_RUN=12             borne le nombre de générations par publicité
MAX_RETRIES_PER_STAGE=2          borne les réparations payantes
MAX_GENERATIONS_PER_DAY=300      protège E7
DRY_RUN=true                     PAR DÉFAUT — aucun appel facturable tant qu'il n'est pas
                                 explicitement désactivé
```

`DRY_RUN=true` par défaut est le garde-fou le plus important : il rend impossible une
dépense accidentelle au premier lancement.

## Stratégie recommandée

**Séquencer, ne pas tout lancer.** E2 et E4 d'abord (quasi gratuits, valident la chaîne
audio). Puis E1 (50 $) — s'il échoue sur la cohérence du personnage, **s'arrêter là** : E3,
E5 et E7 n'ont plus d'objet. Puis E3, puis E6 qui tranche H1. E5 et E7 **seulement si H1
passe** : mesurer le facteur de régénération d'un pipeline dont la qualité est rejetée serait
de l'argent perdu.

Coût jusqu'à la décision H1 : **environ 60 $.**
