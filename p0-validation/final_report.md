# M04 — P0 Validation Execution · Rapport final

> **Verdict d'exécution : BLOCKED / MISSING DEPENDENCY.**
> 6 dépendances bloquantes sur 9 sont absentes. E1, E3, E4, E5, E6, E7 n'ont pas pu
> être exécutées. E2 a été exécutée **partiellement, avec un moteur réel**.
> Aucun résultat n'est simulé.

---

## 1 · Readiness check (exécuté avant toute expérience)

| Dépendance | Exp. | Statut | Bloquant | Preuve |
|---|---|---|---|---|
| TTS neuronal (qualité produit) | E2 | **MISSING** | oui | aucune clé ; `api.elevenlabs.io` → HTTP 000 (injoignable) |
| **TTS local réel (espeak-ng 1.51)** | E2 | **AVAILABLE** | non | synthèse française vérifiée : RMS 3080, 44,8 % de trames voisées |
| Lip-sync provider | E3 | **MISSING** | **oui** | aucune clé ; `api.d-id.com` → HTTP 000 |
| Vidéo générative | E5 | **MISSING** | oui | aucune clé ; `api.replicate.com` → HTTP 000 |
| Banque de plans réelle + personnage | E1 | **MISSING** | oui | aucun asset humain ; aucun provider image joignable |
| ASR français | E4 | **MISSING** | oui | `huggingface.co` → 000 · `alphacephei.com` → 000 · pocketsphinx installé mais modèle **en-us** uniquement · vosk non installable (échec de build de `srt`) |
| Évaluateurs humains | E6 | **MISSING** | oui | environnement non interactif |
| ffmpeg | E1-E7 | AVAILABLE | non | 10 rendus 1080×1920 produits |
| Compute (4 vCPU / 16 Go) | E1-E7 | AVAILABLE | non | mesuré |

**Cause racine unique :** l'environnement d'exécution n'a **ni credentials providers ni
accès sortant** vers les API de génération. Ce n'est pas un problème technique du
pipeline — c'est un problème d'approvisionnement.

---

## 2 · Résultat par expérience

| Exp. | Objet | Statut | Ce qui a été obtenu |
|---|---|---|---|
| **E1** | Banque de plans réelle | **BLOCKED** | plans de substitution géométriques, filigrane `SYNTHETIC SHOT` sur chaque frame |
| **E2** | TTS français réel | **PARTIAL** | **50 lignes synthétisées en vraie parole française** par espeak-ng. Latence, durées et intégration mesurées. **La naturalité n'est pas évaluable** : espeak est un synthétiseur à formants, pas un modèle neuronal |
| **E3** | Lip-sync réel | **BLOCKED** | rien. **C'est l'expérience qui répond à H1** |
| **E4** | ASR | **BLOCKED** | rien. Et E4 est de toute façon en aval de E2 : un WER sur de l'audio espeak déterministe ne dirait rien du produit |
| **E5** | Benchmark génératif | **BLOCKED** | rien |
| **E6** | Évaluation humaine aveugle | **BLOCKED** | grille prête et vide (`p0/eval/grid.csv`) |
| **E7** | Régénération réelle | **BLOCKED** | rejouer 20 fois un pipeline déterministe donnerait 20 fois le même résultat |

---

## 3 · Ce que E2 a réellement apporté

Le passage du silence (M03) à de la **vraie parole** a immédiatement révélé un défaut
que M03 ne pouvait pas voir.

### F-011 · Le modèle de durée par nombre de mots ne planifie pas correctement

| | |
|---|---|
| **Observation** | Avec du vrai audio, `scene_duration` échoue sur **5 publicités sur 10**. Écarts de +0,54 s à +1,12 s, toujours dans le même sens : l'audio est **plus long** que prévu |
| **Cause racine** | Le débit médian mesuré est exactement conforme au modèle (2,60 mots/s), **mais la variance par ligne est forte**. Les lignes courtes sont dominées par le coût phonétique fixe, pas par le nombre de mots : « Écris-moi sur WhatsApp » (4 mots) était planifié à 1,60 s et dure 3,04 s |
| **Correction** | La durée d'une scène vient désormais **du synthétiseur**, pas d'une estimation. Le contrôle `scene_duration` vérifie l'invariant qui compte — *la scène ne tronque pas sa propre parole* — et le budget de mots devient un contrôle **consultatif** (`word_budget_deviation`, P3, non bloquant) qui remonte au rédacteur |
| **Impact mesuré** | Échecs `scene_duration` : **5 → 0**. Réparations déclenchées : **13 → 1** |

> **Conséquence pour le M02.** La table durée→mots héritée de `ads-method.md`, que le M01
> et le M02 traitaient comme faisant autorité pour le découpage, **est un guide
> d'écriture, jamais un planificateur de montage**. Ce point n'était visible qu'en
> synthétisant réellement.

---

## 4 · Tableau final

Périmètre mesuré : chaîne déterministe + TTS local réel. Lip-sync, banque réelle,
génératif et évaluation humaine **non mesurés**.

| Métrique | Cible | Résultat | Statut | Confiance | Notes |
|---|---|---|---|---|---|
| **Publishability Rate** | > 60 % | — | **BLOCKED** | — | E6 non exécutée |
| **Blind Mean Score** | ≥ 3,5/5 | — | **BLOCKED** | — | E6 non exécutée |
| **Product Fidelity** (similarité) | ≥ 0,60 | **0,785** (min 0,783) | **PASS** | **haute** | mesuré sur 10 pubs ; détecteur validé par faute injectée |
| **Product Fidelity** (PSNR logo) | ≥ 22 dB | **24,6 dB** | **PASS** | **haute** | le packaging n'est jamais redessiné |
| **Lip-sync Score** | — | — | **BLOCKED** | — | aucun provider |
| **Real COGS / ad** | < 1,00 $ | **0,00 $ facturé** | **INCONCLUSIVE** | — | aucun provider payant appelé ; modèle M03 inchangé (0,11-0,85 $) |
| **TTFP** | < 90 s | **1,56 s** (p95 1,96) | PASS *(portée)* | moyenne | hors latence réseau lip-sync |
| **Time to publishable** | < 4 min | **13,9 s** (p95 14,8) | PASS *(portée)* | moyenne | hors latence réseau lip-sync |
| **Regeneration Factor** | < 1,4 | 1,00 | **INCONCLUSIVE** | — | étages stochastiques non exercés |
| **First-pass success** | — | 9/10 après F-011 | INCONCLUSIVE | — | idem |
| **Targeted Repair Rate** | > 60 % sans dépense | **100 %** (1/1) | INCONCLUSIVE | faible | échantillon d'une réparation |
| **Failure Rate** | — | 2/10 (violations volontaires) | PASS | haute | le contrôle de factualité bloque réellement |

**FACT** : tout chiffre de la colonne Résultat provient d'une exécution tracée
(`p0-validation/*.csv`, 163 opérations).
**INFERENCE** : les colonnes Statut « portée » supposent que la latence réseau des
providers absents ne consommera pas les ~3 min 45 s de budget restant.
**ASSUMPTION** : les prix catalogue du modèle de coût M03 restent non vérifiés.

---

## 5 · Test économique

Coûts variables par publicité, modélisés sur volumes réels (M03), infrastructure
mesurée :

| Volume / mois | Coût variable | Socle infra | **Total** |
|---|---|---|---|
| 100 | 28,59 $ | 60 $ | **88,59 $** |
| 1 000 | 285,90 $ | 180 $ | **465,90 $** |
| 10 000 | 2 859 $ | 900 $ | **3 759 $** |
| 100 000 | 28 590 $ | 4 200 $ | **32 790 $** |

À 100 000 publicités/mois : **1 042 heures CPU et 98,6 Go**. Le calcul et le stockage
restent négligeables à toute échelle envisagée.

> **Principal risque économique : le prix du lip-sync.** Il représente ~87 % du coût
> variable. Seuil de rupture mesuré : **0,193 $/clip** — au-delà, la publicité dépasse
> 1,00 $. Cela laisse **3,9× de marge** sur le prix catalogue de référence, mais c'est
> le seul poste qui peut renverser le modèle, et il n'a pas été mesuré.

---

## 6 · Décision

| | |
|---|---|
| **H1** — une publicité du chemin C peut-elle être réellement publiable ? | **INCONCLUSIVE** — aucune donnée, ni pour ni contre. E3 et E6 non exécutées |
| **H2** — COGS < 1,00 $ | **INCONCLUSIVE** — 0,00 $ facturé ; le poste dominant n'a pas été mesuré |
| **H3** — latence < 4 min, TTFP < 90 s | **INCONCLUSIVE** — plancher mesuré à 13,9 s, soit 6 % du budget. Indication très favorable, mais la latence lip-sync (5 clips) est le risque de planning non mesuré |
| **H4** — facteur de régénération < 1,4 | **INCONCLUSIVE** — les étages qui défaillent aléatoirement n'ont pas tourné |

### P0 STATUS : **FAIL**
### PHASE 01 : **BLOCKED**

Aucune des quatre hypothèses n'est tranchée. Le critère ultime — *« un vrai commerçant
publierait-il cette publicité ? »* — n'a pas pu être posé à un seul être humain.

---

## 7 · Échec → cause → action corrective

| Échec | Cause racine | Action corrective | Impact attendu | Coût | Délai | Critère de retest |
|---|---|---|---|---|---|---|
| E1, E3, E5 non exécutées | Aucun credential provider **et** aucun accès sortant vers les API de génération depuis cet environnement | Ouvrir des comptes (TTS neuronal, lip-sync, vidéo) et **exécuter le harnais dans un environnement disposant d'un accès réseau sortant** — poste local ou CI avec secrets | Lève H1, H2, H4 | 135 – 390 $ | 3-4 j | 10 pubs produites avec les 3 providers réels, ledger non nul |
| E4 non exécutée | Hôtes de modèles ASR injoignables ; seul un modèle acoustique **anglais** disponible | Utiliser un ASR d'API (même provider que le TTS) plutôt qu'un modèle local | Active le contrôle QC le plus rentable | < 2 $ | 0,5 j | WER mesuré sur 50 lignes, contrôle passant de SKIPPED à PASS/FAIL |
| E6 non exécutée | Environnement non interactif | Faire remplir `p0/eval/grid.csv` par 3 à 5 francophones, en aveugle | **Tranche H1** | 0 $ | 0,5 j | Publishability Rate et Blind Mean Score calculés |
| E7 non exécutée | Pipeline déterministe : rejouer ne produit aucune variance | Rejouer 20× **après** E1-E3 | Tranche H4 | 60 – 200 $ | 1 j | Facteur de régénération sur ≥ 200 générations |
| `word_budget_deviation` sur 4 lignes/50 | Le budget de mots reste imprécis sur les lignes courtes | Calibrer le budget par **rôle de ligne** (les CTA courts coûtent plus cher en temps que leur nombre de mots ne le suggère) | Meilleure prévisibilité du montage | 0 $ | 0,5 j | < 2 lignes sur 50 hors tolérance |

---

## 8 · Ce que M04 a néanmoins consolidé

1. **La fidélité produit tient sur 10 publicités** : 0,785 de similarité, 24,6 dB de
   PSNR logo, et un détecteur qui discrimine (faute injectée → 0,660 / 19,5 dB).
2. **La chaîne accepte de la vraie parole** : 50 lignes synthétisées, 11 ms de latence
   médiane, intégration sans défaut après correction F-011.
3. **Un défaut d'architecture a été trouvé grâce au vrai audio** (F-011) et corrigé :
   échecs 5 → 0, réparations 13 → 1.
4. **Le contrôle de factualité bloque toujours** les deux violations volontaires.
5. **Le data package est complet et exploitable** : `readiness.json`, `ads.json`,
   `tts_manifest.json` (50 entrées réelles), `cost_ledger.csv` (163 opérations),
   `latency_trace.csv` (T0→T8), `failure_log.csv` — et les manifestes bloqués portent
   chacun `status: BLOCKED` avec sa cause, jamais un `PASS` de complaisance.
