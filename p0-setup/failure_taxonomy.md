# M05 · Taxonomie de panne (§20)

Catégories communes à E1 → E7. Toute erreur est classée dans **exactement une** catégorie.

| Catégorie | Déclencheur | Sév. typique | Réparation par défaut | Facturable ? |
|---|---|---|---|---|
| `AUTH` | 401 · 403 applicatif · clé invalide ou expirée | **P0** | aucune — arrêt, alerte | non |
| `NETWORK` | échec DNS · TCP/TLS refusé · **403 au CONNECT du proxy** | **P0** | aucune — arrêt, escalade infra | non |
| `RATE_LIMIT` | 429 · quota projet | P1 | backoff exponentiel, max 2 | non |
| `BILLING` | 402 · crédit épuisé · compte suspendu | **P0** | arrêt immédiat, alerte | non |
| `PROVIDER` | 5xx · panne annoncée · timeout côté fournisseur | P1 | retry puis bascule secondaire | parfois |
| `INPUT` | 400 · prompt refusé par la politique de contenu · format rejeté | P1 | reformulation puis re-soumission | non |
| `OUTPUT` | réponse vide · fichier corrompu · durée nulle | P1 | régénération niveau 5 | oui |
| `QUALITY` | score QC sous seuil (visuel, identité, produit) | P2 | réparation ciblée niveau 3-4 | selon niveau |
| `SYNC` | lip-sync visiblement faux · désalignement phonèmes | P1 | niveau 2 | oui |
| `AUDIO` | réplique tronquée · loudness hors norme · prononciation fausse | P1 | niveau 1 | oui |
| `VIDEO` | frames noires · artefacts · ratio ou fps incorrects | P2 | niveau 4 puis 5 | oui |
| `PRODUCT` | packaging déformé · logo absent · produit non visible | **P0 commercial** | niveau 3 (réincrustation, gratuite) | non |
| `QC` | contrôle non exécutable | P1 | `SKIPPED` — **jamais `PASS`** | non |
| `TIMEOUT` | dépassement du délai côté client | P1 | retry avec délai augmenté | parfois |
| `UNKNOWN` | non classable | P1 | journalisation complète, escalade humaine | — |

## Sévérités

| | Signification | Comportement |
|---|---|---|
| **P0** | perte d'argent, de données, risque juridique, ou expérience impossible | **arrêt** |
| **P1** | publicité non livrable | réparation puis escalade |
| **P2** | qualité dégradée mais livrable | réparation opportuniste |
| **P3** | gêne mineure | consigné, non bloquant |

## Constat M05

Sur 14 tests de connectivité exécutés : **13 `NETWORK`** (refus de `CONNECT` par le proxy) et
**1 `AUTH`** (Google, joignable, clé manquante). Aucun `BILLING`, aucun `PROVIDER`, aucun
`RATE_LIMIT` — donc **aucun problème imputable aux fournisseurs eux-mêmes**.
