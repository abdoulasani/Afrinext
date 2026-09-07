# M07_EVIDENCE — paquet de levée opérationnelle

M07 v2 avait un seul objectif : **transformer B1, B2 et B3 en états READY réels.**
Verdict : **BLOCKED** — les trois exigent une action hors de cette session.

Rien n'est simulé. Aucun secret n'est présent (scan §11 : **PASS**).

```
blocker_register.csv          registre vivant · 3 bloqueurs · états BLOCKED/IN PROGRESS/READY/UNTESTED
google/    B1_handoff_checklist.md      les 8 éléments exacts, à privilèges minimaux
lipsync/   B2_findings.md               constat, caractérisation, décision (option B)
           launch_elsewhere.md          paquet de lancement complet
           bootstrap.sh                 script vérifié (syntaxe OK), ne reconstruit rien
evaluators/ A_instructions_evaluateurs.md   consignes, en français, aveuglement expliqué
            B_identifiants_evaluateurs.csv  R1..R5, statut À RECRUTER
            C_key_randomisation.csv         ordre randomisé INDÉPENDAMMENT par évaluateur
            D_grille_notation.csv           grille vierge, 5 × 10 lignes
            E_confidentialite_consentement.md
            F_G_procedures.md               rétention, soumission, agrégation
            aggregate.py                    testé ; refuse de conclure sans données
preflight/ preflight_after_m07.txt          recheck M06 · 4/11 (inchangé)
cost/      budget_state.json                0,00 $ dépensé · 60 $ pré-H1 non engagés
security/  scan_secrets.py                  13 motifs, arbre + historique git
           secret_scan.json                 90 fichiers · 0 trouvaille · PASS
```

## Reproduire

```bash
python3 M07_EVIDENCE/security/scan_secrets.py      # attendu : PASS
cd p0 && PYTHONPATH=src python3 -m p0.execute --preflight   # attendu aujourd'hui : 4/11
```
