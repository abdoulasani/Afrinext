# p0-setup — Paquet de readiness M05

Préparation de l'expérience P0. **Aucun SaaS n'est construit ici** (M05 §30).

| # | Livrable | Fichier |
|---|---|---|
| 1 | Matrice providers | `provider_matrix.csv` |
| 2 | Sélection | `provider_selection.md` |
| 3 | Readiness + tableau final | `readiness_report.md` |
| 4 | Manifeste personnage | `character_manifest.json` |
| 5 | Manifeste plans | `shot_manifest.json` |
| 6 | Manifeste produit | `product_manifest.json` |
| 7 | Variables d'environnement | `.env.example` |
| 8 | Environnement + connectivité | `environment_report.md` · `.json` |
| 9 | Smoke tests | `smoke_tests/run_smoke.py` |
| 10 | Contrat de pipeline | `pipeline_contract.md` |
| 11 | Schémas de données | `data_schema.md` |
| 12 | Observabilité | `observability_spec.md` |
| 13 | Taxonomie de panne | `failure_taxonomy.md` |
| 14 | Protocole d'évaluation | `human_eval_protocol.md` |
| 15 | Harnais de régénération | `regeneration_harness_spec.md` |
| 16 | Sécurité | `security_checklist.md` |
| 17 | Registre des risques | `provider_risk_register.md` |
| 18 | Budget | `p0_budget.md` |
| 19 | Plan d'exécution | `p0_execution_plan.md` |
| — | Registre de consentement | `consent_register.csv` |
| — | Preuve du refus proxy | `proxy_status_evidence.json` |

## Reproduire les mesures

```bash
python3 p0-setup/probe.py                       # environnement + connectivité
python3 p0-setup/smoke_tests/run_smoke.py --all # smoke tests
```

## État

**M05 STATUS : BLOCKED.** 19 livrables sur 19 écrits ; l'accès aux providers manque.
Le bloqueur décisif est le **lip-sync**, refusé au niveau `CONNECT` du proxy — un
problème de politique réseau, pas de budget.
