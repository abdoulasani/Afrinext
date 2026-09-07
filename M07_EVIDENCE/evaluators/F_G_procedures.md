# Procédures — rétention (F), soumission (G), agrégation (H)

## F · Rétention

| Élément | Règle | Responsable |
|---|---|---|
| Grilles remplies (`responses.csv`) | conservées **12 mois**, puis supprimées | Afrinext |
| Table de correspondance `key.csv` (anon ↔ ad_id) | conservée avec les résultats — **elle ne contient aucune donnée personnelle**, seulement un mapping technique | Afrinext |
| Identité des évaluateurs | **jamais enregistrée** | — |
| Vidéos transmises aux évaluateurs | supprimées par l'évaluateur après l'évaluation ; aucune copie publique n'existe | évaluateur |
| Rapport agrégé | conservé indéfiniment — il ne contient que des agrégats | Afrinext |

## G · Soumission

1. **Transmission** — les 10 vidéos sont envoyées **en direct** à chaque évaluateur
   (transfert de fichiers, clé USB, message privé). **Aucune URL publique**, aucun
   partage indexable.
2. **Nommage** — les fichiers sont `P01.mp4` … `P10.mp4`. **L'ordre est randomisé
   indépendamment pour chaque évaluateur** : le `P03` de R1 n'est pas le `P03` de R2.
3. **Filigrane** — tout filigrane de production (`SYNTHETIC SHOT`) **doit être retiré**
   avant transmission : il révèle la méthode et casse l'aveuglement.
4. **Grille** — chaque évaluateur reçoit `D_grille_notation.csv` pré-remplie avec son
   identifiant et ses 10 lignes, et la renvoie complétée.
5. **Réception** — les grilles sont concaténées dans un unique `responses.csv`.
6. **Aucune discussion** entre évaluateurs avant que tous aient rendu.

## H · Agrégation

```bash
python3 aggregate.py responses.csv key.csv
```

Produit `aggregate_report.json` et affiche :

- **Publishability Rate** = (OUI + OUI AVEC RETOUCHE) / total des jugements
- **Blind Mean Score** = moyenne des 10 critères, tous évaluateurs
- min / médiane / moyenne / écart-type **par critère**
- **Accord inter-juges** = écart-type moyen des scores par vidéo
- **Verdict H1**, selon les seuils **fixés en M05, avant toute donnée**

### Seuils — non modifiables après résultats

| Verdict | Condition |
|---|---|
| **PASS** | Publishability ≥ **60 %** ET Blind Mean ≥ **3,5/5** ET aucun critère médian < **3,0** |
| **FAIL** | Publishability < **35 %** OU Fidélité produit médiane < **3,0** |
| **INCONCLUSIVE** | entre les deux · ou accord inter-juges (écart-type) > **1,2** · ou moins de 3 évaluateurs |

Le script **refuse de produire un verdict** s'il n'y a aucune réponse : il retourne
`BLOCKED`, jamais un résultat fabriqué.

### Désaveuglement

Il n'intervient **qu'après** le calcul. `key.csv` reste scellé jusque-là.
