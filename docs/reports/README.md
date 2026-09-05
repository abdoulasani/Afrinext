# Rapports de jalon

À la fin de chaque jalon, un rapport PDF est produit ici et transmis au senior developer pour
revue. Il valide, ou renvoie des corrections.

## Journal des jalons

| Jalon | Objet | Date | Commit | Statut |
|---|---|---|---|---|
| **M01** | [Architecture & Product Blueprint](M01-blueprint-architecture.pdf) | 2026-09-05 | `12b61a6` | Terminé — en attente de revue |
| **M02** | [Product & Architecture Stress Test](M02-stress-test.pdf) | 2026-09-05 | `bae26f3`+ | Terminé — GO WITH CHANGES · Phase 01 bloquée sur B1→B5 |
| **M03** | [P0 Proof of Concept](M03-p0-proof.pdf) | 2026-09-05 | `d671d3b`+ | **P0 FAIL · Phase 01 BLOCKED** — H1 non mesurée, expériences E1→E7 requises |

## Contenu obligatoire d'un rapport

Un rapport de jalon n'est pas un résumé du travail : c'est un **document de revue**. Il doit
permettre au relecteur de trancher sans relire tout le dépôt. Structure fixe :

1. **Objet du jalon** — ce qui devait être produit, et selon quelle consigne
2. **Sources / entrées** — ce sur quoi le travail s'appuie, et comment cela a été traité
3. **Livrables** — fichiers, volumes, commit, branche
4. **Décisions engageantes** — pour chacune : retenu · alternatives · raison · réversibilité
5. **Points nécessitant une validation explicite** — numérotés `V1…Vn`, avec une
   recommandation et la conséquence d'un choix différent
6. **Hypothèses chiffrées à vérifier** — avec la méthode de vérification
7. **Points de désaccord** — ce qui est mauvais ou risqué, y compris dans les sources reçues
8. **Ce qui n'a pas été fait — et pourquoi**
9. **Prochaine étape proposée** — avec sa définition de « done » et sa condition de démarrage
10. **Formulaire de revue** — cases validé / à corriger, verdict global, signature

Deux règles : **rien n'est enjolivé** (un chiffre non vérifié est signalé comme tel), et
**chaque point à valider porte une recommandation** — on ne renvoie pas une question ouverte
au relecteur sans position.

## Produire un rapport

```bash
cp docs/reports/TEMPLATE.html docs/reports/M02-<slug>.html
# éditer le contenu
./scripts/build-report.sh docs/reports/M02-<slug>.html
```

Le script rend le HTML en PDF A4 via Chromium headless et écrit le fichier à côté de la
source. Le HTML et le PDF sont tous deux versionnés : le HTML reste éditable et diffable, le
PDF est ce qui part en revue.

La mise en forme est commune à tous les rapports et vit dans `_style.css` — ne pas la
dupliquer dans les rapports.
