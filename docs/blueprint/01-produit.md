# 01 · Produit — Sections A → E

---

## A · Executive Summary

**Ce que nous construisons :** un *AI Advertising Operating System*. Une entreprise
donne son URL ; la plateforme rend une publicité vidéo finie, prête à diffuser — sans
caméra, sans acteur, sans studio, sans compétence marketing.

**Le pari central.** Le marché est saturé de générateurs. HeyGen génère des avatars,
Synthesia génère des présentateurs, Arcads et Creatify génèrent des UGC, Runway et Kling
génèrent des plans. Tous commencent au *milieu* du problème : ils supposent que vous savez
déjà quoi dire. Or 80 % du résultat d'une publicité tient à l'**angle** — à qui vous parlez
et par quelle douleur vous entrez (§00 de la méthode *Ads That Sell*). **Notre produit
commence par la stratégie et finit par le fichier `.mp4`.** C'est la seule position qui
justifie un abonnement récurrent plutôt qu'un achat de crédits chez un générateur.

**Les quatre décisions structurantes :**

1. **Un seul point de décision humaine** — le choix du concept créatif. Tout le reste
   (analyse, angles, script, découpage, prompts, génération, QC, montage) est un pipeline
   asynchrone. C'est directement l'enseignement du workflow analysé : il n'a qu'un gate.
2. **Model-agnostic par capability**, pas par plus petit dénominateur commun. Les modèles
   vidéo changent tous les trimestres ; le produit ne doit pas changer avec eux. Voir §Q.
3. **Le personnage est une entité de première classe, pas un fichier image.** Une
   `CharacterSheet` structurée et versionnée, plus une identité visuelle ancrée. C'est ce
   qui rend une marque reconnaissable sur 40 publicités.
4. **Personnages 100 % propriétaires ou consentis.** Le workflow source part d'une capture
   d'écran d'une personne réelle. Nous n'en héritons pas. C'est une contrainte légale et,
   accessoirement, le début d'un moat (voir §00.3).

**Où est le moat.** Pas dans les modèles — ils sont loués par tout le monde. Il est dans
(1) la base de connaissance créative encodée et évaluée, (2) le graphe d'assets par marque
qui grandit à chaque publicité, (3) la boucle de performance qui relie les angles produits
aux résultats mesurés. Les trois se renforcent avec l'usage et aucun ne s'achète.

**Ce que ça coûte, honnêtement.** La génération vidéo premium coûte cher —
ordre de grandeur : **0,10 à 0,50 $ par seconde de vidéo générée**, avec un facteur de
regénération réel de 1,6 à 2,2×. Une publicité finie de 30 s revient donc à **8 à 50 $ de
COGS bruts**. Aucun forfait illimité n'est viable. L'architecture de crédits, la génération
d'aperçus en modèle bas coût et le cache de réutilisation ne sont pas des optimisations :
ce sont des conditions de survie. Voir §T et §U.

**Portée de la Phase 1.** Ce document est un blueprint, pas du code. Il fixe l'architecture,
le schéma, les frontières de service, la séquence de construction et les arbitrages. Le
MVP défini en §Roadmap est délibérément plus étroit que la vision : il livre
*URL → publicité diffusable* pour un seul format, avec une bibliothèque de personnages
restreinte et un montage déterministe. Tout le reste attend la validation.

---

## B · Product Vision

### La phrase

> *Une entreprise décrit son activité une fois. La plateforme devient son équipe marketing,
> sa direction créative, son studio et ses créateurs UGC — en permanence.*

### Ce que le produit N'EST PAS

Explicitement, et le master prompt a raison d'insister : ni un générateur d'avatars, ni un
générateur vidéo, ni un éditeur vidéo, ni un Canva, ni un CapCut, ni un HeyGen, ni un
Synthesia. Ces produits vendent une **capacité**. Nous vendons un **résultat** : des
publicités qui performent, produites en continu.

### Le test qui distingue les deux

Un générateur répond à « fais-moi une vidéo ». Un système publicitaire répond à
« **pourquoi celle-ci plutôt qu'une autre ?** ». Chaque écran du produit doit pouvoir
répondre à la seconde question. Si un écran ne sait justifier que la première, il appartient
à un concurrent.

### Les trois couches de valeur

```
COUCHE 3 · INTELLIGENCE      « voici ce qui marche pour VOUS »
                             performance → patterns → nouvelles créas
                             (le moat · V2)
─────────────────────────────────────────────────────────────────
COUCHE 2 · MÉMOIRE           « la plateforme connaît votre marque »
                             Brand DNA · personnages · assets · historique
                             (la rétention · V1)
─────────────────────────────────────────────────────────────────
COUCHE 1 · PRODUCTION        « de l'URL au .mp4 »
                             stratégie → script → clips → montage
                             (l'acquisition · MVP)
```

La couche 1 fait signer. La couche 2 fait rester. La couche 3 rend le remplacement coûteux.
On construit dans cet ordre, et **jamais** la 3 avant d'avoir du volume réel dans la 1.

### Les principes produit (arbitres de toute décision d'UI)

1. **Un défaut, pas une question.** Toute décision que l'IA peut prendre, elle la prend, et
   l'expose comme modifiable. Ne jamais renvoyer un questionnaire.
2. **Le prompt n'existe pas.** L'utilisateur ne voit jamais le mot « prompt », « modèle »,
   « seed », « lip-sync ». S'il doit les voir, nous avons échoué.
3. **Montrer le raisonnement, pas la mécanique.** « Cet angle attaque la fragmentation des
   outils, parce que vos avis clients en parlent 6 fois » — oui. « Température 0.7,
   gpt-image-2 » — non.
4. **Toute attente est explicable.** Une barre de progression nommée par étape réelle
   (« écriture du script », « clip 3/6 »), jamais un spinner générique.
5. **Rien n'est jeté.** Un clip raté, un angle non retenu, un script rejeté restent dans le
   graphe d'assets et deviennent des variations.
6. **Progressive disclosure.** Le dashboard montre `CREATE`. Les 40 réglages existent, deux
   niveaux plus bas.

---

## C · Target Users

Quatre segments, par ordre de priorité de mise sur le marché.

### C1 · PME e-commerce & DTC — *le segment d'entrée (MVP)*

- 1 à 30 personnes, produit physique ou digital, vend déjà en ligne
- Budget publicitaire 500 – 15 000 €/mois, dépense déjà chez Meta/TikTok
- **Douleur :** les créas s'épuisent en 2-3 semaines, un créateur UGC coûte 150-400 € la
  vidéo avec 10 jours de délai, le fondateur ne veut pas apparaître à l'écran
- **Ce qui les fait payer :** volume de créas à coût marginal quasi nul
- **Métrique de succès :** première publicité diffusable en moins de 15 minutes

### C2 · Solopreneurs & créateurs d'infoproduits

- 1 personne, produit digital, formation, coaching, SaaS naissant
- Budget 0 – 2 000 €/mois, très sensible au prix
- **Douleur :** ne sait pas écrire un hook, refuse d'être face caméra, pas de studio
- **Ce qui les fait payer :** la stratégie, plus que la vidéo — ils achètent le cerveau
- **Risque :** faible LTV, churn élevé. Plan d'entrée bas, pas de support humain.

### C3 · Agences & studios créatifs — *le segment à forte valeur (V1)*

- 5 à 50 personnes, gèrent 5 à 60 comptes clients
- Budget 2 000 – 20 000 €/mois d'outillage
- **Douleur :** la production créative ne scale pas linéairement avec les effectifs ; les
  clients réclament 20 variations par semaine
- **Ce qui les fait payer :** multi-workspace, marque blanche, rôles et permissions, API,
  export en masse
- **Pourquoi c'est le meilleur segment :** LTV la plus élevée, churn le plus bas, et ils
  apportent le volume de données qui alimente la couche 3

### C4 · Équipes marketing en entreprise (V2)

- Contraintes de conformité, validation juridique, gouvernance de marque, SSO, SLA
- Cycle de vente long ; à ne pas poursuivre avant que la conformité (§S) et l'audit
  ne soient réellement en place

### Anti-personas — à qui nous ne vendons pas

- Les créateurs de contenu cherchant à cloner leur propre visage pour du contenu organique
  (c'est HeyGen ; marché différent, attentes différentes)
- Les studios de production cinéma (Runway, contrôle plan par plan)
- Toute personne voulant générer des sosies de personnes réelles — refus par conception

---

## D · Core User Journey

### D1 · Le parcours nominal — « Create my ad »

```
┌── 0 · SIGNUP ────────────────────────────────────────────── 30 s ──┐
│  email / Google · aucune carte bancaire · 1 workspace créé         │
└────────────────────────────────────────────────────────────────────┘
                                  ↓
┌── 1 · TELL US ABOUT YOUR BUSINESS ───────────────────────── 20 s ──┐
│  UNE zone de saisie. On accepte :                                  │
│    · une URL          ← 80 % des cas, le chemin recommandé         │
│    · des photos produit                                            │
│    · un texte libre                                                │
│    · un flux e-commerce (Shopify / WooCommerce)  [V1]              │
│  Aucun formulaire. Aucun champ obligatoire au-delà d'un seul.      │
└────────────────────────────────────────────────────────────────────┘
                                  ↓
┌── 2 · AI UNDERSTANDS YOUR BRAND ──────────────────────── 40-70 s ──┐
│  Crawl + extraction → BRAND DNA (§F2), affiché en fiche éditable : │
│    voix de marque · audience · positionnement · USP · douleurs     │
│    · émotions visées · identité visuelle · piliers de message      │
│    · claims interdits · préférences de CTA                         │
│  L'utilisateur corrige en ligne s'il veut. Persisté pour toujours. │
└────────────────────────────────────────────────────────────────────┘
                                  ↓
┌── 3 · WHAT DO YOU WANT? ─────────────────────────────────── 10 s ──┐
│  Objectif (vendre · leads · WhatsApp · notoriété · lancement · …)  │
│  Plateforme (TikTok · Reels · Shorts · Meta feed · YouTube)        │
│  Durée (15 · 30 · 45 · 60 s)                                       │
│  → 3 clics, tous pré-remplis par un défaut déduit du Brand DNA     │
└────────────────────────────────────────────────────────────────────┘
                                  ↓
┌── 4 · AI CREATIVE STRATEGY ───────────────────────────── 60-90 s ──┐
│  Voice of customer (pains / desires / objections)                  │
│  → 8-12 angles générés en interne, les 3 meilleurs remontés        │
│  Chaque concept affiché avec :                                     │
│    hook · angle · déclencheur émotionnel · audience · CTA          │
│    · force estimée · POURQUOI ça devrait marcher                   │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │  ★ LE SEUL GATE HUMAIN DU PARCOURS ★                         │  │
│  │  « Choisissez un concept »  ·  ou « Générer les 3 »           │  │
│  └──────────────────────────────────────────────────────────────┘  │
│  (« voir les 12 angles » est un lien discret, pas l'écran par      │
│   défaut — 12 choix paralysent, 3 décident)                        │
└────────────────────────────────────────────────────────────────────┘
                                  ↓
┌── 5 · CHOOSE YOUR PRESENTER ─────────────────────────────── 15 s ──┐
│  4-6 personnages pré-sélectionnés, filtrés par l'audience du       │
│  Brand DNA (âge, genre, registre, région) — pas par nos goûts.     │
│  Alternative en un clic : NO-FACE MODE (§I5)                       │
│  Une fois choisi, il devient le personnage par défaut de la marque │
└────────────────────────────────────────────────────────────────────┘
                                  ↓
┌── 6 · GENERATE ────────────────────────────── 6-9 min, asynchrone ─┐
│  Progression nommée, étape par étape :                             │
│    ✓ Script écrit         (6 clips · 38 s)                         │
│    ✓ Plans préparés       (6 prompts validés)                      │
│    ⟳ Tournage 4/6         ← clips en parallèle, 2-4 en vol         │
│    · Contrôle qualité                                              │
│    · Montage                                                       │
│  L'utilisateur peut fermer l'onglet. Notification e-mail/push.     │
└────────────────────────────────────────────────────────────────────┘
                                  ↓
┌── 7 · REVIEW ────────────────────────────────────────── 1-3 min ───┐
│  Lecteur + timeline légère. Actions par clip :                     │
│    ↻ regénérer CE clip   ✎ changer la réplique   ⇄ autre prise     │
│  Actions globales : sous-titres · musique · CTA · logo · ratio     │
└────────────────────────────────────────────────────────────────────┘
                                  ↓
┌── 8 · EXPORT / VARIATIONS ─────────────────────────────────────────┐
│  Télécharger 9:16 · 1:1 · 4:5 · 16:9                               │
│  « CREATE VARIATIONS » → 3 hooks × même corps, en 1 clic           │
│  Publier vers Meta / TikTok Ads Manager  [V1]                      │
└────────────────────────────────────────────────────────────────────┘
```

**Objectif de bout en bout : moins de 15 minutes, dont moins de 2 minutes d'attention
humaine.** Le workflow analysé en demandait 45 à 60, entièrement attentives.

### D2 · Le second parcours — celui qui compte pour la rétention

La première publicité vend le produit. La deuxième le rend indispensable, parce que
**le Brand DNA et le personnage existent déjà** :

```
Dashboard → CREATE → l'objectif est le seul choix → 3 concepts → GENERATE
                                                     ↑
                          concepts informés par ce qui a déjà été produit
                          (les angles déjà utilisés sont écartés ou marqués)
```

Temps cible : **moins de 4 minutes, dont 20 secondes d'attention**.

### D3 · Les parcours d'échec, conçus explicitement

| Situation | Comportement du produit |
|---|---|
| L'URL ne crawle pas (JS-only, 403, site vide) | Bascule immédiate sur « décrivez votre activité en 2 lignes » + upload d'images. Jamais d'erreur brute. |
| 2 clips sur 6 échouent au QC | Régénération automatique de **ces clips uniquement** (max 2 tentatives), les autres sont conservés. L'utilisateur voit « clip 4 refait ». |
| Le provider vidéo est en panne | Bascule automatique vers le provider de rang suivant présentant les mêmes capabilities. L'utilisateur ne l'apprend jamais. |
| Crédits épuisés en cours de job | Le job **se met en pause**, ne se perd pas. Écran d'achat contextualisé : « il reste 2 clips, 40 crédits ». |
| L'utilisateur déteste le résultat | « Autre angle » relance depuis l'étape 4 en réutilisant Brand DNA + personnage — donc quelques minutes, pas quarante. |
| Claim sensible détecté (santé, finance) | Le script baisse la promesse et augmente la preuve (§10 de la méthode) + bandeau « à faire valider ». Jamais de blocage silencieux. |

---

## E · Feature Architecture

Sept modules. Chacun est une frontière de service et une frontière d'équipe.

```
┌─────────────────────────────────────────────────────────────────────┐
│  1 · BRAND INTELLIGENCE                                             │
│     ingestion URL/images/texte/catalogue · extraction Brand DNA     │
│     · analyse concurrentielle [V1] · voice of customer              │
│     · bibliothèque d'assets de marque · claims interdits            │
├─────────────────────────────────────────────────────────────────────┤
│  2 · CREATIVE STRATEGY ENGINE                                       │
│     12 types d'angles · mécanisme · niveau de conscience            │
│     · sophistication du marché · notation et classement des         │
│     concepts · déduplication des angles · mémoire des angles joués  │
├─────────────────────────────────────────────────────────────────────┤
│  3 · SCRIPT ENGINE                                                  │
│     découpage en clips · budget de mots par durée · hook/corps/CTA  │
│     · adaptation plateforme · texte à l'écran · plan d'overlays     │
│     · auto-review 12 points · variantes de hook                     │
├─────────────────────────────────────────────────────────────────────┤
│  4 · CHARACTER SYSTEM                                               │
│     CharacterSheet · bibliothèque propriétaire · clonage consenti   │
│     · ancrage d'identité · profils de voix · mode no-face           │
├─────────────────────────────────────────────────────────────────────┤
│  5 · PRODUCTION ENGINE                                              │
│     compilation de prompts · routage de providers · file de jobs    │
│     · génération parallèle · QC visuel/audio/marketing              │
│     · régénération ciblée · voix · musique · SFX                    │
├─────────────────────────────────────────────────────────────────────┤
│  6 · EDITOR & DELIVERY                                              │
│     Edit Plan déclaratif · rendu déterministe · sous-titres         │
│     · overlays · branding · multi-ratio · export · publication      │
├─────────────────────────────────────────────────────────────────────┤
│  7 · CAMPAIGN & INTELLIGENCE                                        │
│     campagnes · variations · ingestion des métriques [V1]           │
│     · patterns gagnants [V2] · recommandations [V2]                 │
└─────────────────────────────────────────────────────────────────────┘
         ↑ tous s'appuient sur ↓
┌─────────────────────────────────────────────────────────────────────┐
│  PLATEFORME : auth · multi-tenant · crédits · jobs · storage        │
│               · providers · observabilité · facturation             │
└─────────────────────────────────────────────────────────────────────┘
```

### Carte des fonctionnalités par version

| Module | MVP | V1 | V2 |
|---|---|---|---|
| **1 · Brand** | crawl URL, Brand DNA, édition manuelle | catalogue produits, Shopify, analyse concurrents, guidelines de marque | Brand DNA multi-marché, gouvernance, validation |
| **2 · Strategy** | 12 angles → 3 concepts, mécanisme, awareness | mémoire des angles joués, notation calibrée sur données réelles | recommandations issues de la performance |
| **3 · Script** | 1 script/concept, 4-7 clips, 15/30 s, 1 plateforme | 45/60 s, toutes plateformes, variantes de hook, multi-langue | tests A/B de script, scripts « performance-informed » |
| **4 · Character** | 12-20 personnages propriétaires, 8 profils de voix | clonage consenti, tenue/décor variables, voix custom | continuité longue durée, personnages de marque exclusifs |
| **5 · Production** | 1 provider vidéo + 1 fallback, QC automatique, regen ciblée | 3+ providers, tiers preview/final, lip-sync dédié, musique | scoring de qualité prédictif avant génération |
| **6 · Editor** | Edit Plan auto + rendu, sous-titres, CTA, 9:16 | timeline éditable, tous ratios, templates de marque, B-roll | montage assisté par la performance |
| **7 · Campaign** | 1 pub = 1 projet | campagnes, variations 1-clic, connecteurs Meta/TikTok | Creative Intelligence complète |

**Ce que nous refusons de construire, et pourquoi :**

- **Un éditeur vidéo complet (type CapCut).** Coût énorme, différenciation nulle, et
  contraire au principe « l'IA cache la complexité ». Nous livrons un montage automatique
  correct + des retouches ciblées.
- **Nos propres modèles de génération.** Capital-intensif, avantage éphémère de 6 mois. Nous
  louons ; notre valeur est au-dessus.
- **Un marketplace de créateurs.** Autre business, autre opération.
- **Le clonage de visage libre.** Voir §00.3.
