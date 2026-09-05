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
| [06 · M02 — Stress test](docs/blueprint/06-m02-stress-test.md) | 16 findings, marché, one-click, gate, WOW |
| [07 · M02 — Systèmes créatifs](docs/blueprint/07-m02-systemes-createurs.md) | score créatif, Creative DNA, Brand Memory, produit, scènes, coûts |
| [08 · M02 — Produit et marché](docs/blueprint/08-m02-produit-marche.md) | MVP A/B/C, playbooks, Market Context, agences, UX, moat, pricing |
| [09 · M02 — Décision](docs/blueprint/09-m02-exploitation-et-decision.md) | failure modes, versioning, MVP final, **GO/NO-GO** |

## Rapports de jalon

À la fin de chaque jalon, un rapport PDF est produit pour revue par le senior developer :
décisions engageantes, points à valider, hypothèses à vérifier, formulaire de revue.

📄 **[M01 — Architecture & Product Blueprint](docs/reports/M01-blueprint-architecture.pdf)** ·
📄 **[M02 — Product & Architecture Stress Test](docs/reports/M02-stress-test.pdf)** ·
[convention et journal des jalons](docs/reports/README.md)

## Prochaine étape

**GO WITH CHANGES · PHASE 01 BLOCKED · PHASE 00 AUTHORIZED.**

**Phase P0 — tranche verticale jetable** : une publicité de bout en bout sur un produit de
test, non déployée, destinée à être jetée, pour mesurer coût réel, latence, facteur de
régénération et surtout **la qualité perçue du chemin C** — l'hypothèse dont tout dépend.

Elle démarre dès l'arbitrage de **B3 (marché de tête)** et **B4 (verticale de tête)**, qui
déterminent la langue, le CTA et le personnage de la tranche. Voir le
[rapport M02](docs/reports/M02-stress-test.pdf).
