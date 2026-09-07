# 12 · M07 v2 — Levée opérationnelle des bloqueurs

> Objectif unique : transformer B1, B2, B3 en READY. **Résultat : BLOCKED.**
> Les trois exigent une action que je ne peux pas exécuter depuis cette session.
> Tout le reste — outillage, protocoles, preuves — est livré et vérifié.

---

## 1 · Registre des bloqueurs

| ID | Bloqueur | État | Action requise | Owner | Coût | Retest | Statut |
|---|---|---|---|---|---|---|---|
| **B1** | Credentials Google Cloud | aucune clé ; **API joignable** (HTTP 403 « Please use API Key ») | créer un projet GCP, activer 3 APIs, clé restreinte, poser `GOOGLE_API_KEY` | **utilisateur** | 0 $ (setup) | `run_smoke.py --all` | **BLOCKED** |
| **B2** | Accès lip-sync | 11 hôtes refusés au `CONNECT` du proxy | autoriser l'endpoint (admin org) **ou** exécuter `bootstrap.sh` ailleurs | **utilisateur / admin org** | ~8 $ (gate 3) | `curl` sur `api.sync.so` ≠ `000` | **BLOCKED** |
| **B3** | Évaluateurs humains | aucun ; protocole et outillage complets | recruter 3 à 5 francophones du marché visé | **utilisateur** | 0 $ | `aggregate.py` avec ≥ 3 évaluateurs | **BLOCKED** |

Aucun `PASS` n'est employé : **aucun test d'acceptation réel n'a réussi.**

---

## 2 · B2 — pourquoi ce bloqueur ne peut pas être levé ici

La documentation du proxy de sortie est sans ambiguïté :

> *« The destination host is not allowed by your organization's egress policy for this
> session. **Do not retry or route around it** — report the blocked host. »*
> — `/root/.ccr/README.md`

Le proxy a enregistré **13 refus de `CONNECT`** (`policy denial`). Conformément à §05 et à
cette consigne, **je n'ai ni retenté ni contourné.** C'est une décision d'administration de
l'organisation, pas un problème technique.

### Décision : option B — exécuter ailleurs

| | Option | Changement d'architecture | Faisable par moi ? |
|---|---|---|---|
| A | Autoriser l'endpoint dans la politique d'egress | **nul** | non — admin org |
| **B** | **Exécuter le harnais existant sur une machine à HTTPS ouvert** | **nul** | **retenue** |
| C | Trouver un fournisseur déjà joignable | moyen | aucun candidat : Google n'a pas d'offre lip-sync |

Le paquet de lancement (`bootstrap.sh`, syntaxe vérifiée) **ne reconstruit rien** : il clone,
installe quatre dépendances, teste l'accès réseau, puis lance le pre-flight et les smoke
tests existants.

**Une seule chose reste à écrire** : la méthode `LipSyncProvider.sync()` contre l'API du
fournisseur retenu (~40 lignes). Elle est volontairement absente — M03 §06 interdit d'écrire
un appel spéculatif contre un fournisseur non choisi.

---

## 3 · Ce qui est livré et vérifié

| Livrable | Vérification |
|---|---|
| **B1 · checklist de handoff** | 8 éléments exacts : action console, APIs, méthode d'auth, variable, permission au moindre privilège, commande de smoke test, signal de succès, signal d'échec |
| **B2 · paquet de lancement** | `bootstrap.sh` — **syntaxe validée** (`bash -n`) ; teste l'accès réseau avant tout transport |
| **B3 · kit E6 complet (A→H)** | consignes, identifiants anonymes, randomisation **indépendante par évaluateur**, grille vierge, note de confidentialité, rétention, soumission, agrégation |
| **B3 · agrégateur** | **testé** sur données factices : seuils H1 correctement appliqués → `INCONCLUSIVE` (taux 0,567 < 0,60). Sans données : retourne `BLOCKED`, jamais un résultat fabriqué |
| **Sécurité (§11)** | **PASS** — 90 fichiers, 13 motifs, arbre de travail **et historique git**, 0 trouvaille |
| **Budget (§10)** | 0,00 $ dépensé · 60 $ pré-H1 non engagés · **les 205 $ BASE ne sont pas autorisés** |
| **Pre-flight (§13)** | relancé sans modification de la logique : **4/11**, inchangé |

---

## 4 · Rapport final (§17)

```
M07 v2 STATUS : BLOCKED

BLOCKER REGISTER
  B1 GOOGLE      — BLOCKED   (API joignable, credential absent)
  B2 LIP-SYNC    — BLOCKED   (politique d'egress de l'organisation)
  B3 EVALUATORS  — BLOCKED   (aucun évaluateur recruté)

PROVIDER READINESS
  TTS       — BLOCKED
  ASR       — BLOCKED
  VEO       — BLOCKED
  LIP-SYNC  — BLOCKED

REAL SMOKE TESTS
  TTS       — SKIPPED   · aucune clé · p0-setup/smoke_tests/results/smoke_results.json
  ASR       — SKIPPED   · aucune clé
  VEO       — SKIPPED   · aucune clé
  LIP-SYNC  — SKIPPED   · hôte refusé au CONNECT
  RENDU LOCAL — PASS    · artefact réel produit (seul test qui a pu réussir)

HUMAN EVALUATION
  évaluateurs confirmés = 0
  protocole = READY   (kit A→H complet, agrégateur testé)

SECURITY : PASS   (90 fichiers · 13 motifs · arbre + historique git · 0 trouvaille)

BUDGET
  dépensé            0,00 $
  restant pré-H1    60,00 $
  prochaine dépense autorisée : aucune — gate 1 bloquée sur B1

M06 PRE-FLIGHT : 4/11 READY

P0 : STILL BLOCKED

DÉCISION FINALE :
« M07 BLOCKED — bloqueurs restants : B1 Google, B2 lip-sync, B3 évaluateurs. »
```

---

## 5 · Pour chaque bloqueur

### B1 · Google Cloud

| | |
|---|---|
| **IMPACT** | E1, E2, E4, E5 non exécutables — 4 expériences sur 7 |
| **ACTION MINIMALE** | projet GCP + facturation + activer `texttospeech`, `speech`, `generativelanguage` + clé d'API **restreinte à ces 3 APIs** + poser `GOOGLE_API_KEY` en local. **Ne jamais coller la clé dans le chat.** |
| **RETEST EXACT** | `cd p0-setup/smoke_tests && GOOGLE_API_KEY=… python3 run_smoke.py --all` |
| **SUCCÈS ATTENDU** | `[PASS] P0-E2-SMOKE … HTTP 200` · `[PASS] P0-E4-SMOKE … transcription: "Bonjour…"` · `[PASS] P0-E5-SMOKE … Veo: [...]` |
| **COÛT** | quelques centimes pour le smoke test |
| **TEMPS** | 15 à 30 minutes |

### B2 · Lip-sync

| | |
|---|---|
| **IMPACT** | E3 non exécutable ⇒ **H1 indécidable** ⇒ E7 sans objet. C'est le bloqueur décisif |
| **ACTION MINIMALE** | **A** faire autoriser `api.sync.so` (ou l'hôte retenu) dans la politique d'egress · **ou B** exécuter `M07_EVIDENCE/lipsync/bootstrap.sh` sur une machine à HTTPS ouvert |
| **RETEST EXACT** | `curl -s -o /dev/null -w '%{http_code}' -m 10 https://api.sync.so/` |
| **SUCCÈS ATTENDU** | **toute valeur autre que `000`** (403, 404, 200… signifient que l'hôte répond) |
| **COÛT** | 0 $ pour l'accès ; ~8 $ pour E3 |
| **TEMPS** | 10 minutes (option B) à quelques jours (option A, selon l'organisation) |

### B3 · Évaluateurs

| | |
|---|---|
| **IMPACT** | E6 non exécutable ⇒ **H1 indécidable** |
| **ACTION MINIMALE** | 3 à 5 francophones : comprennent le français, jugement indépendant, peuvent regarder 10 vidéos de 15 s, disponibles ~20 min, **sans lien avec l'équipe de production**. Aucune donnée personnelle requise |
| **RETEST EXACT** | `python3 M07_EVIDENCE/evaluators/aggregate.py responses.csv key.csv` |
| **SUCCÈS ATTENDU** | ≥ 3 évaluateurs, verdict H1 calculé selon les seuils de M05 |
| **COÛT** | 0 $ |
| **TEMPS** | 1 à 3 jours de recrutement, 20 min par évaluateur |

---

## 6 · Distinctions maintenues (§15)

| | |
|---|---|
| Configuré ≠ testé | aucune configuration n'existe, donc rien n'est testé |
| API joignable ≠ sortie utilisable | Google est joignable ; **aucune sortie n'a été produite** |
| Un smoke test ≠ qualité commerciale | seul le rendu local a produit un artefact |
| Évaluateurs recrutés ≠ E6 réussie | 0 recruté ; le protocole seul est prêt |
| 11/11 READY ≠ P0 PASS | nous sommes à **4/11** |

**M07 n'a pas été optimisé pour obtenir un PASS.** Deux des trois bloqueurs ne dépendent
d'aucun travail technique supplémentaire de ma part : ils dépendent d'un compte, d'une
politique réseau et de trois personnes.
