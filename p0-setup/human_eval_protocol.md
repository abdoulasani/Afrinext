# M05 · Protocole d'évaluation humaine aveugle (§21)

## Panel

**Minimum 3 évaluateurs francophones, idéal 5.** Profil recherché : locuteurs du marché visé
(Niger / Afrique de l'Ouest francophone), non impliqués dans le projet, sans expertise
technique en IA — ce sont des spectateurs, pas des ingénieurs.

## Aveuglement — ce que l'évaluateur ne doit jamais savoir

Ni le fournisseur, ni le modèle, ni le chemin de production (C ou génératif), ni le coût, ni
l'architecture, ni quelle publicité est « la nôtre ». Les fichiers sont renommés `P01.mp4` …
`Pnn.mp4` et l'ordre est **randomisé indépendamment pour chaque évaluateur**.

Le filigrane « SYNTHETIC SHOT » présent sur les rendus M03/M04 **doit disparaître** avant
toute évaluation — il révèle la méthode de production et invalide l'aveuglement.

## Grille · 1 à 5

| Critère | 1 | 5 |
|---|---|---|
| **HOOK** | je scrolle immédiatement | je m'arrête net |
| **CLARITY** | je n'ai pas compris ce qui est vendu | limpide dès la première seconde |
| **NATURALNESS** | ça sonne artificiel | on dirait une vraie personne |
| **PRODUCT FIDELITY** | le produit paraît faux ou déformé | il paraît réel et net |
| **VISUAL QUALITY** | amateur | professionnel |
| **AUDIO QUALITY** | pénible à écouter | agréable et clair |
| **LIP SYNC** | décalage flagrant | invisible |
| **BRAND FIT** | ne va pas avec le produit | parfaitement cohérent |
| **CTA** | je ne sais pas quoi faire | je sais exactement quoi faire |
| **PUBLISHABILITY** | jamais je ne publierais ça | je publierais tel quel |

## La question qui décide

> **« Seriez-vous à l'aise de publier cette publicité pour une vraie entreprise ? »**
>
> `YES` · `YES WITH MINOR EDIT` · `NO`

## Métriques calculées

```
PUBLISHABILITY RATE = (YES + YES_WITH_MINOR_EDIT) / total des jugements
BLIND MEAN SCORE    = moyenne des 10 critères, tous évaluateurs
ACCORD INTER-JUGES  = écart-type par publicité — un écart > 1,2 signale un désaccord
                      à examiner avant de conclure quoi que ce soit
```

## Seuils, fixés AVANT de voir les résultats

| Seuil | Valeur | Justification |
|---|---|---|
| **H1 = PASS** | Publishability Rate **≥ 60 %** ET Blind Mean Score **≥ 3,5/5** ET aucun critère médian < 3,0 | 60 % correspond à « la majorité des publicités sont utilisables », qui est la promesse produit. Un critère médian sous 3,0 signale un défaut systémique qu'une moyenne globale masquerait |
| **H1 = FAIL** | Publishability Rate < 35 % **ou** Product Fidelity médiane < 3,0 | en dessous, le chemin C ne tient pas sa promesse |
| **H1 = INCONCLUSIVE** | entre les deux, ou accord inter-juges insuffisant | |

> Ces seuils sont posés **maintenant, avant l'expérience**, précisément pour qu'ils ne
> puissent pas être choisis après coup pour obtenir un PASS.

## Déroulement

1. Retirer les filigranes, renommer, randomiser par évaluateur (`p0/eval/key.csv` reste secret).
2. Transmettre les fichiers **en direct** — aucune URL publique (§23).
3. Chaque évaluateur remplit sa ligne dans `p0/eval/grid.csv`, seul, sans discussion préalable.
4. Agréger, calculer, publier **avant** toute interprétation.

## Biais à déclarer

Panel de 3 à 5 personnes : l'échantillon est petit et non représentatif du marché. Le
résultat est un **signal fort**, pas une mesure statistique. Il tranche H1 parce qu'aucune
alternative moins coûteuse n'existe — pas parce qu'il est rigoureux au sens statistique.
