# 10 · M03 — P0 Proof of Concept : résultats mesurés

> Phase expérimentale jetable. Le harnais est dans [`p0/`](../../p0/README.md).
> Tout ce qui suit est **mesuré**, sauf ce qui est explicitement marqué *modélisé*
> ou *non mesuré*.

---

## 0 · Verdict

> ## P0 STATUS : **FAIL** · PHASE 01 : **BLOCKED**

**Précision indispensable : ce n'est pas le pipeline qui a échoué.** Le pipeline a
tourné de bout en bout, dix fois, et a produit dix publicités 9:16 valides. Ce qui a
échoué, c'est **P0 en tant que preuve** : l'hypothèse décisive — H1, la qualité
perçue du chemin C — **n'a pas pu être mesurée**, faute de provider lip-sync et de
banque de plans réelle dans l'environnement d'exécution.

Donner « CONDITIONAL PASS » impliquerait que H1 est répondue. Elle ne l'est pas.
M03 §27 interdit de faire paraître l'expérience meilleure qu'elle n'est.

**Mais P0 a établi beaucoup**, et tout va dans le bon sens — voir §2 et §7.

---

## 1 · Ce qui a réellement tourné, et ce qui n'a pas tourné

| Étage | Exécuté ? | Preuve |
|---|---|---|
| Script + contrôle de factualité | **oui** | 10 scripts, 2 violations intentionnelles bloquées |
| Compositing produit (S1) | **oui** | similarité 0,785 · PSNR logo 24,6 dB |
| Montage, sous-titres ASS, CTA, loudnorm, rendu 1080×1920 | **oui** | 10 MP4, 9,7 à 15,1 s |
| QC rule-based (8 contrôles) | **oui** | 8/10 pubs au vert |
| Réparation ciblée | **oui** | 3 réparations, 4 contrôles remis au vert |
| Cost ledger + trace T0→T8 | **oui** | 168 opérations tracées |
| **TTS** | **non** | pas de clé — silence de durée réaliste, marqué `SYNTHETIC` |
| **Lip-sync** | **non** | pas de clé — audio muxé sans synchronisation |
| **Banque de plans réelle** | **non** | substituts géométriques, filigrane sur chaque frame |
| **ASR** (`audio_transcription`) | **non** | téléchargement du modèle bloqué par le proxy (403) |
| **Chemin génératif de contrôle** | **non** | pas de clé — le provider lève une erreur explicite |
| **Évaluation par 3 personnes** | **non** | évaluer des formes géométriques ne mesurerait rien |

**Garantie anti-fabrication.** Un provider sans clé ne renvoie jamais un résultat
plausible : il lève `MissingCredentials`, ou — en `--offline` explicite — un
substitut marqué `synthetic=True`, propagé jusqu'au manifeste. Le filigrane
« SYNTHETIC SHOT » est visible sur **chaque frame** des dix publicités. Aucun
résultat de ce rapport ne peut être confondu avec une mesure réelle de qualité.

---

## 2 · Les quatre hypothèses

| | Hypothèse | Objectif M02 | Résultat P0 |
|---|---|---|---|
| **H1** | Qualité « diffusable sans gêne » | — | **NON MESURÉE.** L'hypothèse décisive reste ouverte |
| **H2** | COGS < 1,00 $ | < 1,00 $ | **Modélisé 0,11 – 0,85 $** sur volumes réels. Sous le seuil dans les trois scénarios, avec 3,9× de marge sur le lip-sync |
| **H3** | Latence < 4 min · TTFP < 90 s | < 4 min | **Plancher déterministe mesuré : 7,96 s** de bout en bout. Le budget réseau restant est de ~3 min 50 s. Confortable, mais la latence réelle des providers reste inconnue |
| **H4** | Facteur de régénération < 1,4 | < 1,4 | **Non concluant.** Mesuré à 1,02, mais uniquement sur des étages déterministes qui ne défaillent pas aléatoirement. Le facteur est une propriété des étages génératifs, qui n'ont pas tourné |

---

## 3 · Fidélité produit — le résultat le plus solide de P0

C'était le point que M02 identifiait comme table stakes et que M01 n'avait pas.

| Mesure | Médiane | Min | Seuil | Verdict |
|---|---|---|---|---|
| Similarité produit (corrélation croisée, recherche locale ±16 px) | **0,785** | 0,783 | 0,60 | ✅ large marge |
| Préservation logo/texte (PSNR sur la boîte du logo) | **24,6 dB** | 24,5 | 22 | ✅ |

Le packaging (« KARITÉ D'OR », « BEURRE DE KARITÉ PUR », « 200 g ») est **lisible sur
la vidéo finale** parce qu'il n'a jamais été redessiné : l'actif réel est masqué, mis
à l'échelle et incrusté.

**Le détecteur discrimine** : sur la publicité où un mauvais emplacement a été injecté
volontairement, la similarité tombe à 0,660 et le PSNR à 19,5 dB — sous les seuils,
détecté, réparé.

> **Conclusion partielle :** la stratégie S1 du M02 (compositing plutôt que génération
> conditionnée) est **validée mécaniquement**. La question ouverte n'est plus « le
> produit est-il fidèle ? » mais « l'incrustation est-elle crédible dans un vrai
> plan ? » — ce qui relève de H1.

---

## 4 · Coûts

### 4.1 · Coût réellement facturé : **0,00 $**

Aucun provider payant n'a été appelé. Le ledger l'enregistre. **Tout chiffre de coût
ci-dessous est modélisé** : prix catalogue non vérifiés appliqués aux **volumes
réellement mesurés**.

### 4.2 · Volumes mesurés (médiane sur 10 publicités)

`182 caractères TTS` · `5 clips lip-sync` · `13,0 s de vidéo` · `22 s CPU` ·
`13,1 s de durée finale` · `0,17 Mo` de rendu final

### 4.3 · Coût modélisé par publicité

| | Bas | **Base** | Haut |
|---|---|---|---|
| **Chemin C** | 0,113 $ | **0,286 $** | 0,847 $ |
| dont lip-sync | 0,100 | 0,250 | 0,750 |
| dont LLM (stratégie + script + QC) | 0,010 | 0,030 | 0,080 |
| dont TTS | 0,003 | 0,006 | 0,016 |
| dont CPU + stockage | 0,0001 | **0,00025** | 0,0004 |
| **Contrôle génératif** *(non mesuré)* | 1,050 $ | **2,630 $** | 6,580 $ |
| **Rapport** | 9,3× | **9,2×** | 7,8× |

**Deux enseignements :**

1. **Le coût du chemin C est presque entièrement du lip-sync** (87 % au scénario
   base). Tout le reste — compositing, montage, rendu, CPU, stockage — coûte
   **0,00025 $**, soit un quart de millième de dollar. La moitié déterministe du
   pipeline est économiquement gratuite. C'est mesuré, pas estimé.
2. **Seuil de rupture : le lip-sync peut coûter 0,193 $/clip — 3,9× le prix de
   base — avant que la publicité ne dépasse 1,00 $.** L'hypothèse économique du M02
   dispose donc d'une marge confortable.

### 4.4 · Infrastructure mensuelle estimée

| Volume | Variable | Socle | **Total** |
|---|---|---|---|
| 100 pubs/mois | 28,57 $ | 60 $ | **88,57 $** |
| 1 000 pubs/mois | 285,70 $ | 180 $ | **465,70 $** |
| 10 000 pubs/mois | 2 857 $ | 900 $ | **3 757 $** |

À 10 000 publicités par mois, le calcul et le stockage représentent **61 heures CPU
et 4,9 Go**. L'infrastructure n'est pas un sujet ; les providers sont tout le sujet.

---

## 5 · Latence

| Jalon | Médiane | p90 |
|---|---|---|
| **TTFP** (première scène disponible) | **0,45 s** | 0,51 s |
| Time to final render | 6,75 s | 8,06 s |
| Time to publishable (QC inclus) | **7,96 s** | 9,28 s |

Ce sont les temps **déterministes uniquement** : ils excluent la latence réseau du
TTS et du lip-sync, qui domineront en conditions réelles. Ils fixent un **plancher**,
et ce plancher est très bas : il reste ~3 min 50 s de budget pour atteindre la cible
de 4 minutes, et 89 s pour la cible de TTFP.

Le pic observé (22,5 s en tout) correspond aux publicités ayant subi une réparation —
ce qui est le comportement attendu.

---

## 6 · Régénération ciblée

| | |
|---|---|
| Réparations déclenchées | **3** sur 10 publicités |
| Sans dépense (niveaux 0, 3, 4) | **2 / 3 (67 %)** |
| Payantes (niveau 1) | 1 |
| Contrôles remis au vert | **4** |
| Latence par réparation | 6,3 à 7,3 s |

Les deux fautes injectées volontairement ont été détectées puis réparées :

| Faute injectée | Détectée par | Niveau appliqué | Résultat |
|---|---|---|---|
| Emplacement produit erroné | `logo_text_preservation` | **L3** réincrustation, gratuite | corrigé |
| Audio tronqué de 50 % | `scene_duration` | **L1** resynthèse d'une ligne, payante | corrigé |

**Mise en garde honnête :** 67 % de réparations gratuites n'est pas comparable à
l'objectif de 60 % du M02. Ce dernier porte sur des échecs **stochastiques** des
modèles génératifs, qui n'ont pas tourné ici. Ce que P0 démontre est plus modeste et
néanmoins utile : **le mécanisme de réparation ciblée fonctionne, diagnostique la
cause racine et applique le niveau le moins cher qui la traite.**

---

## 7 · Ce que P0 a découvert — les défauts

Dix défauts consignés dans [`p0/FAILURE-LOG.md`](../../p0/FAILURE-LOG.md). **Cinq ont
été trouvés par le QC lui-même en exécutant la chaîne**, et deux d'entre eux étaient
des défauts **du QC**, pas de la production :

| ID | Défaut | Enseignement |
|---|---|---|
| **F-001** | Toute scène avec produit durait 0,04 s | Une entrée image fixe sans `-loop 1` détruit la scène. Invisible sur un schéma |
| **F-002** | Deux formules de durée coexistaient (planificateur / synthétiseur) | Exactement la désynchronisation que le M02 redoutait — elle est apparue en 200 lignes de code |
| **F-003** | Le QC mesurait l'ancien emplacement après réparation | La vérité de contrôle doit être reconstruite, jamais patchée |
| **F-004** | Faux positif sur les plans animés | **Un contrôle qui mesure une région figée est faux dès que l'overlay bouge.** Corrigé par recherche locale |
| **F-005** | Les réparations ne réparaient rien | **Le niveau de réparation doit être choisi par cause racine, pas par nom de contrôle.** Un audio tronqué déclenchait une réparation de montage |

> **C'est l'argument central en faveur de la tranche verticale.** Aucun de ces cinq
> défauts n'était visible dans les 2 365 lignes d'architecture du M02. Ils sont
> apparus dans les deux premières heures d'exécution réelle.

---

## 8 · B5 — le budget de la banque de plans, mesuré

Modèle : 4 personnages × 10 plans × facteur de sélection 2,5 (on garde un plan sur
deux ou trois).

| | 1 marché | 3 marchés | Maintenance/an |
|---|---|---|---|
| Bas | 60 $ | 180 $ | 24 $ |
| **Base** | **160 $** | **480 $** | **64 $** |
| Haut | 400 $ | 1 200 $ | 160 $ |

**Ce chiffre est 10 à 30 fois inférieur à ce que le M02 laissait craindre.** C'est une
excellente nouvelle pour la construction — et **une mauvaise nouvelle pour la thèse du
moat**.

> **Correction au M02 §24.** Le M02 présentait la banque de plans localisée comme le
> moat n°2, « le seul actif capitalisé ». À 160 $ le marché, ce n'est pas une barrière :
> un concurrent la reconstitue en un week-end. **Ce qui reste défendable n'est pas le
> coût de génération, c'est ce que l'argent n'achète pas** : le casting et le
> consentement de vrais visages représentatifs, la curation qualité, et la donnée
> accumulée. Le classement des moats du M02 doit être révisé en conséquence.

---

## 9 · Comparaison chemin C vs génératif (M03 §16)

| Critère | Chemin C | Génératif |
|---|---|---|
| **Coût / pub** | 0,286 $ *(modélisé)* | 2,63 $ *(modélisé)* — **9,2×** |
| **Cohérence du personnage** | résolue par construction — c'est le même tournage | à garantir par QC d'identité |
| **Fidélité produit** | **0,785 / 24,6 dB, mesurée** | non mesurée ; risque connu de déformation du packaging |
| **Latence** | plancher 7,96 s mesuré | non mesurée ; typiquement plusieurs minutes |
| **Qualité perçue** | **NON MESURÉE** | **NON MESURÉE** |
| **Régénération** | non concluant | non mesurée |

**Cette comparaison est incomplète et le restera tant que les deux chemins n'auront
pas tourné pour de vrai.** Sur l'économie, l'écart est tel (9×) qu'il faudrait un
écart de qualité considérable pour renverser l'arbitrage. Mais c'est précisément ce
qui n'a pas été mesuré.

---

## 10 · Décision

### P0 STATUS : **FAIL**

P0 n'a pas produit sa preuve. H1 — l'hypothèse dont dépend tout le M02 — n'a pas été
mesurée. Trois des quatre hypothèses sont partiellement ou totalement ouvertes.

### PHASE 01 : **BLOCKED**

### Les expériences supplémentaires nécessaires

| # | Expérience | Ce qu'elle lève | Coût estimé | Durée |
|---|---|---|---|---|
| **E1** | **Banque de plans réelle** : 1 personnage, 10 plans, marché francophone ouest-africain, avec emplacements produit filmés | La condition d'existence de tout le reste | 40 – 100 $ | 1-2 j |
| **E2** | **TTS français réel** sur les 10 scripts, avec accent ouest-africain si disponible | Qualité audio, prononciation, rythme · coût réel | < 5 $ | 0,5 j |
| **E3** | **Lip-sync réel** sur les 50 clips | **H1** · coût réel · latence réelle | 3 – 15 $ | 1 j |
| **E4** | **ASR** pour activer `audio_transcription` | Le contrôle le plus rentable du pipeline, aujourd'hui `SKIPPED` | < 2 $ | 0,5 j |
| **E5** | **Chemin génératif de contrôle** : les mêmes 10 publicités | La comparaison §16, pour de vrai | 25 – 65 $ | 1 j |
| **E6** | **Évaluation aveugle par 3 personnes** avec `p0/eval/grid.csv` | **PUBLISHABILITY RATE** — le critère qui décide | 0 $ | 0,5 j |
| **E7** | Rejouer les 10 publicités **20 fois** | Le vrai facteur de régénération, sur des étages stochastiques | 60 – 200 $ | 1 j |

**Total : environ 135 à 390 $ et une semaine.** Le harnais est écrit, les scripts sont
écrits, les spécifications sont écrites, la grille d'évaluation est prête. **Il ne
manque que trois clés d'API, un personnage et trois personnes.**

### Ce qu'il ne faut pas conclure

- Ne pas conclure que le chemin C fonctionne : sa qualité n'a pas été vue.
- Ne pas conclure que le COGS est de 0,29 $ : rien n'a été facturé.
- Ne pas conclure que le facteur de régénération est de 1,02 : les étages qui
  défaillent n'ont pas tourné.

### Ce qu'il est légitime de conclure

- **Le compositing produit préserve le packaging** — mesuré, avec un détecteur qui
  discrimine.
- **La moitié déterministe du pipeline est économiquement gratuite** (0,00025 $/pub)
  et rapide (7,96 s) — mesuré.
- **Le contrôle de factualité bloque réellement** — deux violations intentionnelles
  interceptées à chaque exécution.
- **La réparation ciblée fonctionne** quand elle diagnostique la cause racine.
- **La banque de plans coûte 160 $ par marché**, pas des milliers — ce qui invalide
  l'argument de moat du M02 §24 et doit être corrigé.
- **Le risque économique du chemin C tient entièrement au prix du lip-sync**, avec
  3,9× de marge avant rupture.
