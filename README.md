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
| [10 · M03 — P0 résultats](docs/blueprint/10-m03-p0-results.md) | tranche verticale exécutée, mesures réelles, **P0 FAIL** |
| [11 · M06 — Pre-flight et arrêt](docs/blueprint/11-m06-preflight-stop.md) | pre-flight 4/11, retour d'architecture A→G, question finale |
| [12 · M07 — Levée opérationnelle](docs/blueprint/12-m07-unblocking.md) | registre des bloqueurs, handoffs, kit E6, sécurité |

## Rapports de jalon

À la fin de chaque jalon, un rapport PDF est produit pour revue par le senior developer :
décisions engageantes, points à valider, hypothèses à vérifier, formulaire de revue.

📄 **[M01 — Architecture & Product Blueprint](docs/reports/M01-blueprint-architecture.pdf)** ·
📄 **[M02 — Product & Architecture Stress Test](docs/reports/M02-stress-test.pdf)** ·
📄 **[M03 — P0 Proof of Concept](docs/reports/M03-p0-proof.pdf)** ·
📄 **[M04 — P0 Validation Execution](docs/reports/M04-validation-execution.pdf)** ·
📄 **[M05 — Provider Procurement](docs/reports/M05-provider-procurement.pdf)** ·
📄 **[M06 — P0 Real Execution : arrêt au pre-flight](docs/reports/M06-preflight-stop.pdf)** ·
📄 **[M07 v2 — Operational Unblocking](docs/reports/M07-unblocking.pdf)** ·
[convention et journal des jalons](docs/reports/README.md)

## Prochaine étape

**M04 : BLOCKED / MISSING DEPENDENCY · H1→H4 INCONCLUSIVE · PHASE 01 BLOCKED.**

Le harnais [`p0/`](p0/README.md) produit dix publicités 9:16 de bout en bout, désormais
avec de la **vraie parole française** (espeak-ng), et mesure la fidélité produit
(0,785 · 24,6 dB), la latence complète (13,9 s jusqu'au publiable) et les coûts.
Le readiness check de M04 identifie **6 dépendances bloquantes absentes** : ni
credentials, ni accès sortant vers les API de génération. E1, E3, E4, E5, E6, E7 n'ont
pas pu être exécutées.

**M05** a préparé l'expérience : [19 livrables](p0-setup/README.md) — matrice de 18
providers, contrats de pipeline, schémas, taxonomie de panne, protocole d'évaluation avec
seuils H1 fixés d'avance, budget séquencé et smoke tests exécutables.

**M07 v2** a préparé la levée : checklist de handoff Google, paquet de lancement portable
(`bootstrap.sh`), kit d'évaluation E6 complet avec agrégateur testé, scan de sécurité
**PASS** (90 fichiers, historique git inclus). Preuves : [`M07_EVIDENCE/`](M07_EVIDENCE/README.md).

**Les trois bloqueurs exigent une action hors session** :

1. **B1 — clé Google Cloud.** L'API est joignable, seul le credential manque.
   Une clé débloque E1, E2, E4, E5. *(15-30 min)*
2. **B2 — accès lip-sync.** 11 hôtes refusés au `CONNECT` par la politique d'egress de
   l'organisation ; la documentation du proxy interdit de contourner. Allowlist, ou
   exécuter `M07_EVIDENCE/lipsync/bootstrap.sh` sur une machine ouverte. *(10 min à qq jours)*
3. **B3 — 3 à 5 évaluateurs francophones.** *(1-3 jours)*

**B2 et B3 conditionnent H1.** Enveloppe demandée : **~60 $ pré-H1** — pas les 205 $.
Données : [`p0-validation/`](p0-validation/final_report.md) · [`p0-setup/`](p0-setup/readiness_report.md).
