# Afrinext

**AI Advertising Operating System** — une plateforme qui transforme une URL d'entreprise en
publicité vidéo UGC diffusable, sans caméra, sans acteur et sans compétences marketing.

## État du projet

**Phase 1 — conception.** L'architecture et le blueprint produit sont terminés ; aucun code
applicatif n'a encore été écrit.

📐 **[Architecture & Product Blueprint →](docs/blueprint/README.md)**

| | |
|---|---|
| [00 · Analyse des sources](docs/blueprint/00-analyse-sources.md) | workflow de référence, skills existants, risques juridiques |
| [01 · Produit](docs/blueprint/01-produit.md) | vision, utilisateurs, parcours, fonctionnalités |
| [02 · Moteur IA](docs/blueprint/02-moteur-ia.md) | orchestrateur, génération vidéo, personnages, éditeur |
| [03 · Plateforme](docs/blueprint/03-plateforme.md) | backend, données, API, sécurité, coûts, déploiement |
| [04 · Diagrammes](docs/blueprint/04-diagrammes.md) | 8 diagrammes d'architecture |
| [05 · Roadmap](docs/blueprint/05-roadmap-et-decision-finale.md) | MVP → V2, stack finale, ordre de construction |
| [06 · M02 — Stress test](docs/blueprint/06-m02-stress-test.md) | passe critique : 16 findings, MVP et build order révisés |

## Rapports de jalon

À la fin de chaque jalon, un rapport PDF est produit pour revue par le senior developer :
décisions engageantes, points à valider, hypothèses à vérifier, formulaire de revue.

📄 **[M01 — Architecture & Product Blueprint](docs/reports/M01-blueprint-architecture.pdf)** ·
📄 **[M02 — Product & Architecture Stress Test](docs/reports/M02-stress-test.pdf)** ·
[convention et journal des jalons](docs/reports/README.md)

## Prochaine étape

**Phase P0 — tranche verticale jetable** (build order révisé par le M02) : une publicité de
bout en bout sur un produit de test, pour mesurer coût réel, latence, facteur de régénération
et qualité perçue avant toute construction durable.

Bloquée jusqu'à arbitrage des points V8 à V15 du
[rapport M02](docs/reports/M02-stress-test.pdf), en particulier **V14 — positionnement
marché**, qui conditionne la langue et le CTA du produit.
