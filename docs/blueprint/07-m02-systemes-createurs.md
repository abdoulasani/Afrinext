# 07 · M02 — Systèmes créatifs (sections 08 → 16)

> Suite du [stress test](06-m02-stress-test.md). Ce fichier couvre les systèmes qui
> déterminent la **qualité créative** et le **coût** : évaluation, Creative Intelligence,
> Brand Memory, Character DNA, Product Consistency, Scene Intelligence, régénération ciblée,
> routage et planification budgétaire.

---

## 08 · Système d'évaluation de la publicité avant livraison

### 08.1 · L'avertissement d'abord

Un « creative score » non calibré est du théâtre. Si le score de 87/100 ne prédit rien, il
décore une interface et fait perdre la confiance dès que l'utilisateur constate qu'une pub à
92 performe moins bien qu'une à 71.

**Règle de conception :** le système est construit dès le premier jour pour être
**calibrable** — on stocke `features + score + résultat observé`, et on mesure la corrélation
dès qu'il y a du volume (§30). Tant qu'elle n'est pas mesurée, **le score est affiché comme
un diagnostic, jamais comme une prédiction de performance.**

### 08.2 · Deux natures d'évaluation, à ne jamais confondre

| | **RULE-BASED** | **MODEL-BASED** |
|---|---|---|
| Nature | déterministe, code | LLM / vision |
| Coût | 0 | 0,002 – 0,02 $ |
| Reproductible | oui, à l'octet | non |
| Rôle | **bloquant** | **consultatif** |
| Exemples | durée, nombre de mots, ratio, safe zones, LUFS, présence du CTA, allégation interdite, produit détecté dans N frames, sous-titres lisibles | force du hook, clarté du message, authenticité, adéquation à la marque, potentiel de rétention |

**Aucun score model-based ne bloque jamais une livraison.** Un LLM qui juge « hook faible »
peut se tromper ; un contrôle qui compte les mots ne se trompe pas. Les seuls blocages sont
rule-based : conformité, produit invisible, audio coupé, spécifications plateforme.

### 08.3 · Le point qui change l'économie : évaluer AVANT de générer

La majorité de ces scores se calculent **sur le script**, donc pour un coût quasi nul et
avant toute dépense vidéo.

```
ÉVALUATION PRÉ-GÉNÉRATION (sur le Script — 0,01 $, BLOQUANTE)
   hook · message · CTA · brand fit · platform fit · authenticity
   · conformité · budget de mots · structure
        ↓ si échec : réécriture, coût 0,04 $ au lieu de 6 $
ÉVALUATION POST-GÉNÉRATION (sur les scènes puis le rendu — CONSULTATIVE
   sauf les 4 blocages rule-based)
   product visibility · visual quality · identity · audio · retention
```

### 08.4 · Les dix scores

| Score | Nature | Calcul | Bloquant ? |
|---|---|---|---|
| **HOOK** | model + rule | Rule : la première réplique tient-elle en < 8 mots, y a-t-il un hook visuel *et* textuel, arrive-t-il avant 1,0 s. Model : jugement comparatif contre 20 hooks de référence de la verticale | non |
| **MESSAGE** | model | Une seule idée par clip ? Le mécanisme est-il énoncé ? Adéquation au niveau de conscience | non |
| **PRODUCT VISIBILITY** | **rule** | Détection du produit sur N frames échantillonnées + durée cumulée de présence + taille relative dans le cadre. Seuil par verticale | **oui** |
| **BRAND FIT** | model + rule | Rule : mots interdits, claims interdits, CTA conforme aux préférences. Model : cohérence de ton avec le Brand DNA | **oui** (partie rule) |
| **VISUAL QUALITY** | model | Mains, visage, yeux, artefacts, texte parasite, cohérence inter-scènes | non (déclenche une régénération, pas un blocage) |
| **RETENTION POTENTIAL** | model | Densité de rythme, position des ruptures, longueur des plans, courbe émotionnelle. **Le plus spéculatif — à calibrer en priorité** | non |
| **CTA** | rule | Un seul CTA, présent, concret, correspondant à l'objectif et au canal du marché | **oui** |
| **PLATFORM FIT** | **rule** | Ratio, durée, safe zones, résolution, lisibilité des sous-titres, loudness | **oui** |
| **AUTHENTICITY** | model | Ressemble-t-il à du contenu ou à une publicité ? Détection de formules commerciales, de rythme trop propre | non |
| **OVERALL** | agrégat | Pondéré par plateforme et objectif — pas une moyenne | non |

### 08.5 · Pondérations, par objectif

La pondération n'est pas universelle. Un score unique pour tous les cas est un score faux.

| Objectif | Hook | Message | Produit | Rétention | CTA |
|---|---|---|---|---|---|
| Notoriété | 35 % | 20 % | 10 % | 25 % | 10 % |
| Vente directe | 25 % | 20 % | 25 % | 10 % | 20 % |
| Conversations (WhatsApp) | 30 % | 20 % | 15 % | 10 % | **25 %** |
| Leads | 30 % | 25 % | 10 % | 15 % | 20 % |

---

## 09 · Creative Intelligence — le Creative DNA

### 09.1 · L'avantage structurel que personne d'autre n'a

Les outils qui analysent des publicités doivent **rétro-ingénierer** leur structure à partir
de la vidéo finie : c'est cher, imprécis et lent.

> **Nous connaissons la structure par construction.** Nous l'avons écrite. Le Creative DNA
> n'est pas extrait — il est **émis** par le pipeline, gratuitement, à la génération.

C'est le vrai fondement de la Creative Intelligence, et il est bien plus solide que celui du
M01 (qui se contentait d'une table `creative_features` dénormalisée).

### 09.2 · Le Creative DNA

```ts
type CreativeDNA = {
  adId: string; version: number;

  // ── Structure : la séquence de beats, c'est l'ADN principal
  beats: {
    index: number;
    role: 'hook'|'problem'|'agitate'|'mechanism'|'demo'|'proof'|'benefit'|'objection'|'cta';
    hookType?: 'curiosity'|'pain'|'contrarian'|'result'|'question'|'stat'|'callout'|'demo';
    durationSec: number;
    wordCount: number;
    productPresence: 'none'|'held'|'demonstrated'|'worn'|'applied'|'onscreen';
    cameraType: string;
    emotionalTone: string;
  }[];
  beatSignature: string;          // ex. "hook.curiosity>problem>demo>proof>cta" — comparable

  // ── Stratégie
  angleType: string; awarenessLevel: 1|2|3|4|5; sophisticationLevel: 1|2|3|4|5;
  mechanismPresent: boolean; cialdiniTriggers: string[]; dominantEmotion: string;

  // ── Exécution
  characterId: string; characterAgeBand: string; characterGender: string;
  voiceProfileId: string; language: string; marketCode: string;
  totalDurationSec: number; beatCount: number;
  pacing: { avgBeatSec: number; cutsPerMinute: number; hookLatencyMs: number };
  subtitleStyle: string; musicMood: string;

  // ── Offre et CTA
  ctaType: string; ctaChannel: 'link'|'whatsapp'|'dm'|'call'|'store'|'app';
  offerPresent: boolean; urgencyPresent: boolean; proofType: string[];

  // ── Provenance (rejoint §29)
  scriptVersion: string; knowledgeBaseVersion: string; playbookId: string;
  providerPath: 'A'|'B'|'C'; generationCostCents: number;
};
```

`beatSignature` est la clé : une chaîne courte et comparable qui permet de regrouper des
milliers de publicités par **structure narrative**, pas par mots-clés.

### 09.3 · L'architecture d'apprentissage

```
   CreativeDNA (gratuit, à la génération)
             +
   Résultat observé (déclaratif J+7, puis API ads en V1)
             ↓
   ┌─────────────────────────────────────────────────────────┐
   │  MODÈLE HIÉRARCHIQUE À TROIS NIVEAUX                     │
   │                                                          │
   │   global      ← tous workspaces, tous marchés            │
   │      ↓ informe (a priori)                                │
   │   vertical × marché   ← ex. restaurant × Niger           │
   │      ↓ informe                                           │
   │   workspace   ← cette marque précisément                 │
   └─────────────────────────────────────────────────────────┘
             ↓
   Rétrécissement bayésien : un workspace avec 6 publicités
   emprunte au niveau vertical ; avec 200, il parle pour lui-même.
```

**Pourquoi hiérarchique :** c'est ce qui permet de dire quelque chose d'utile à un client qui
n'a que six publicités — le cas de 90 % des clients. Un modèle plat exigerait des centaines
de créas par compte avant de servir à quoi que ce soit.

### 09.4 · Ce que le système peut dire, et ce qu'il ne doit jamais dire

| Autorisé | Interdit |
|---|---|
| « Vos hooks de type *curiosity* ont un hold rate supérieur sur 7 de vos 9 publicités » | « Les hooks *curiosity* convertissent 40 % mieux » |
| « Dans votre verticale, la structure `hook>demo>proof>cta` domine, avec un intervalle large » | « Cette structure est la meilleure » |
| « Nous n'avons pas assez de données pour conclure » | de la fausse précision |

**Le seul instrument causal dont nous disposons est la variation A/B** produite par notre
propre générateur de variations : même marque, même produit, même période, un seul élément
changé. Tout le reste est corrélationnel et doit être présenté comme tel.

---

## 10 · Brand Memory — challenge du Brand DNA

### 10.1 · Ce qui ne va pas dans le Brand DNA du M01

C'est un **instantané**. Versionné, certes, mais figé : extrait une fois du site, corrigé une
fois par l'utilisateur, puis relu tel quel indéfiniment. Il ne sait pas ce qui a été produit,
ce qui a été corrigé, ce qui a marché, ni ce que l'utilisateur a refusé.

> **La donnée la plus précieuse du produit est celle que le M01 jetait : les corrections de
> l'utilisateur.** Chaque fois qu'il réécrit une phrase, refuse un concept, change un
> personnage ou supprime un mot, il nous enseigne sa marque. Le M01 traitait cela comme de
> l'interface. C'est du signal, et c'est propriétaire.

### 10.2 · Brand Memory V1 — dans le MVP

Event-sourcé. Le Brand DNA devient une **projection** d'un flux d'événements, pas une table.

```
brand_memory_events (append-only)
  kind: 'extracted' | 'user_edited' | 'concept_rejected' | 'concept_accepted'
      | 'script_edited' | 'character_chosen' | 'character_rejected'
      | 'word_removed' | 'claim_blocked' | 'ad_exported' | 'ad_deleted'
      | 'outcome_reported'
  payload, actorId, adId?, createdAt
        ↓ projection
BrandDNA courant  +  contraintes apprises  +  angles déjà joués
```

Ce que V1 apprend concrètement, sans aucun modèle d'apprentissage :

| Signal observé | Ce que le système en déduit |
|---|---|
| L'utilisateur supprime systématiquement le mot « révolutionnaire » | ajout à `forbiddenWords` après 2 occurrences |
| Il rejette 3 concepts de type *fear* | dépriorisation des angles *fear* pour cette marque |
| Il change toujours le personnage pour le même | ce personnage devient le défaut de la marque |
| Il raccourcit systématiquement les CTA | préférence de longueur de CTA enregistrée |
| Il édite le prix dans 2 scripts | le prix du Brand DNA est marqué douteux → reconfirmation demandée |

**Coût d'implémentation : une table et une projection.** Valeur : la deuxième publicité est
mesurablement meilleure que la première, ce que l'utilisateur ressent immédiatement.

### 10.3 · V2 et au-delà

| | Contenu |
|---|---|
| **V1 · MVP** | événements, corrections, angles joués, contraintes apprises, bibliothèque d'assets, personnage par défaut |
| **V2** | liaison aux résultats (quels hooks ont marché) · détection de dérive de ton · re-crawl périodique du site avec diff proposé · mémoire par produit et non seulement par marque · mémoire d'offre (quelles promotions ont converti) |
| **Futur** | Brand Memory **exportable et portable** (un actif que le client possède, ce qui paradoxalement augmente la confiance et la rétention) · agent proactif : « votre page produit a changé, voici 3 publicités adaptées » · mémoire partagée entre marques d'une même agence, avec cloisonnement explicite |

---

## 11 · Character Intelligence — le Character DNA

### 11.1 · Extension de la `CharacterSheet` du M01

```ts
type CharacterDNA = CharacterSheet & {
  // ── Positionnement
  demographicPositioning: {
    ageBand: string; gender: string; marketFit: string[];   // codes marché
    registerFit: ('expert'|'relatable'|'premium'|'youthful')[];
    verticalFit: string[];
  };

  // ── Ce qui rend le personnage utilisable en production (chemin C)
  shotBank: {
    shotId: string;
    framing: 'closeup'|'medium'|'wide'|'walking'|'seated';
    gesture: string | null;
    environment: string;
    wardrobe: string;
    productSlot: 'none'|'hand_right'|'hand_left'|'both_hands'|'table'|'applied';
    durationSec: number; assetId: string;
    mouthNeutral: boolean;      // exploitable en lip-sync
  }[];

  // ── Historique et performance (alimenté par §09 et §30)
  campaignHistory: { adId: string; brandId: string; vertical: string; date: string }[];
  performance: {
    byVertical: Record<string, { ads: number; avgHookRate?: number; ci?: [number,number] }>;
    byMarket:   Record<string, { ads: number; acceptanceRate: number }>;
  };

  // ── Exclusivité (offre commerciale)
  exclusivity: { mode: 'shared'|'workspace_locked'|'brand_exclusive';
                 lockedTo?: string; since?: string };
};
```

### 11.2 · « Ce personnage fonctionne bien pour ce type d'entreprise »

C'est une requête, pas de la magie :

```sql
-- classement des personnages pour une marque donnée
SELECT c.id,
       coalesce(w.acceptance_rate, v.acceptance_rate, g.acceptance_rate) AS score
FROM characters c
LEFT JOIN char_perf_workspace w ON … -- ce workspace (prioritaire si volume suffisant)
LEFT JOIN char_perf_vertical  v ON … -- même verticale × même marché
LEFT JOIN char_perf_global    g ON … -- repli
WHERE c.market_fit @> ARRAY[:market] AND c.status = 'active'
ORDER BY score DESC LIMIT 6;
```

Même logique de rétrécissement hiérarchique qu'en §09.3.

### 11.3 · Cohérence entre vidéos — les cinq mécanismes, par ordre d'efficacité

| # | Mécanisme | Efficacité | Disponible |
|---|---|---|---|
| **1** | **Banque de plans** — le personnage n'est pas re-généré, il est *rejoué*. La cohérence est un fait, pas un objectif | ★★★★★ | chemin C, MVP |
| 2 | Ancrages textuels verbatim recopiés par du code, jamais reformulés par un LLM | ★★★☆☆ | chemins A/B |
| 3 | Image de référence identique sur tous les plans | ★★★☆☆ | chemins A/B |
| 4 | `SceneLock` : décor et tenue figés pour toute la publicité | ★★★☆☆ | tous |
| 5 | **QC d'identité** : distance d'embedding facial vs référence, seuil, régénération | ★★★★☆ | tous — c'est le filet de sécurité |

**C'est le premier bénéfice non économique du chemin C :** le problème de cohérence de
personnage, qui est le problème n°1 du M01 (§H4), disparaît par construction.

---

## 12 · Product Consistency Engine

### 12.1 · Le constat technique, sans détour

> **Les modèles génératifs actuels ne reproduisent pas fidèlement un packaging portant du
> texte et un logo.** Ils produisent un objet *plausible*, pas *le vôtre*. Les proportions
> dérivent, le texte devient du faux texte, le logo mute.

Pour une marque, une publicité montrant un produit approximatif est pire qu'une publicité
sans produit. **Toute architecture qui espère que « le modèle finira par bien le faire » est
une architecture qui ment au client.**

### 12.2 · Trois stratégies, classées par fidélité

| | Stratégie | Fidélité | Coût | Quand |
|---|---|---|---|---|
| **S1** | **Compositing** — l'image réelle du produit est incrustée dans le plan, avec correspondance d'échelle, de perspective, d'ombre et de colorimétrie | **★★★★★ pixel-exact** | quasi nul | **défaut** pour tout produit portant texte, logo ou packaging |
| **S2** | **Génération conditionnée par image** — le modèle reçoit le produit en référence | ★★★☆☆ | moyen | produits sans texte : vêtement, aliment, objet simple |
| **S3** | **Description textuelle seule** | ★☆☆☆☆ | nul | **jamais** pour un produit de marque. Acceptable pour un produit générique d'illustration |

**Décision : S1 par défaut, S2 en repli explicite, S3 interdit sur produit identifié.**

Cette décision s'articule naturellement avec le chemin C : les plans de la banque sont
tournés avec un **emplacement produit** (`productSlot`) — main droite, main gauche, table,
application — filmé avec un objet neutre. Le produit réel du client y est incrusté. Un plan,
tous les clients.

### 12.3 · Le pipeline

```
INGESTION                    ┌──────────────────────────────────────┐
photos produit (upload,      │ 1 · extraction                        │
Open Graph, flux Shopify)  → │   détourage · fond alpha · recadrage  │
                             │   normalisation colorimétrique        │
                             └───────────────┬──────────────────────┘
                                             ▼
                             ┌──────────────────────────────────────┐
                             │ 2 · référentiel produit               │
                             │   packshots multi-angles (3-5)        │
                             │   descripteur texte canonique         │
                             │   empreinte : histogramme couleur,    │
                             │   ratio, OCR du texte du packaging,   │
                             │   signature du logo                   │
                             └───────────────┬──────────────────────┘
                                             ▼
                             ┌──────────────────────────────────────┐
                             │ 3 · placement                         │
                             │   S1 compositing dans un plan à       │
                             │   productSlot compatible              │
                             │   (échelle · perspective · ombre)     │
                             │   ou S2 génération conditionnée       │
                             └───────────────┬──────────────────────┘
                                             ▼
                             ┌──────────────────────────────────────┐
                             │ 4 · VALIDATION — product similarity   │
                             │   • OCR : le texte du packaging       │
                             │     est-il lisible et correct ?  ← ★  │
                             │   • signature logo présente ?         │
                             │   • ratio et proportions dans ±8 %    │
                             │   • distance colorimétrique < seuil   │
                             │   • occlusion < 40 %                  │
                             │   • durée de présence ≥ seuil         │
                             └───────────────┬──────────────────────┘
                                   PASS ◄────┴────► FAIL
                                    │                 │
                                    ▼                 ▼
                            scène acceptée   régénération ciblée :
                                             S2 → S1, ou autre plan
                                             (jamais toute la pub)
```

★ **Le contrôle OCR est le plus discriminant et le moins cher.** Si le nom de la marque sur le
packaging est illisible ou erroné, la scène est refusée — c'est exactement le mode d'échec
que les clients remarquent en premier.

### 12.4 · Ce qu'on ne construit pas au MVP

Les **embeddings produit** (recherche de similarité vectorielle sur l'objet) sont séduisants
et prématurés : avec S1 en compositing, le produit est *le même fichier*, donc la similarité
est triviale. Les embeddings ne servent que pour S2, qui est le repli. **Reporté.** Voir §32.

---

## 13 · Scene Intelligence — la `SceneSpecification`

### 13.1 · Simplification préalable

Le brief demande `SCRIPT → STORYBOARD → SHOT DESIGN → GENERATION → VALIDATION → REPAIR`.
**Six étapes sont trop.** Le storyboard et le shot design produiraient deux artefacts
intermédiaires distincts qu'il faudrait maintenir, versionner et resynchroniser à chaque
modification du script.

> **Décision : la `SceneSpecification` EST le storyboard.** Le script produit directement des
> `SceneSpecification[]`. Le « shot design » est le remplissage des champs caméra/lumière/
> mouvement de cette même structure, fait par des règles déterministes à partir du rôle du
> beat. Quatre étapes réelles : **Script → SceneSpec → Génération → Validation/Repair.**

### 13.2 · Le schéma

```ts
type SceneSpecification = {
  id: string; adId: string; index: number; version: number;

  // ── Intention
  purpose: 'hook'|'problem'|'agitate'|'mechanism'|'demo'|'proof'|'benefit'|'objection'|'cta';
  emotionalObjective: string;            // « inquiéter », « rassurer », « donner envie »
  narrativeFunction: string;             // en une phrase, pour l'humain et pour le LLM

  // ── Contraintes dures
  durationSec: number;                   // ∈ grille du chemin retenu
  aspectRatio: string;

  // ── Contenu
  dialogue: { text: string; language: string; wordCount: number;
              voiceProfileId: string; accent: string | null } | null;
  voiceover: { text: string; voiceProfileId: string } | null;  // mode no-face
  onScreenText: string | null;

  // ── Casting et décor
  actor: { characterId: string; wardrobeKey: string;
           shotId?: string } | null;     // shotId présent ⇒ chemin C
  environment: { key: string; timeOfDay: string; setDressing: string[] };
  lighting: string;

  // ── Produit
  product: { productId: string; presence: 'none'|'held'|'demonstrated'|'worn'|'applied'|'onscreen';
             slot: string; strategy: 'S1'|'S2'|'S3';
             minVisibleSec: number } | null;

  // ── Réalisation
  camera: { move: string; framing: string; lensLook: string };
  movement: { gesture: string | null; timing: 'before'|'during'|null };
  transitionIn: string; transitionOut: string;

  // ── Overlay (b-roll par-dessus, jamais à la place)
  overlay: { kind: string; assetId?: string;
             startOffsetSec: number; durationSec: number } | null;

  // ── ★ Ce qui rend la scène auto-réparable
  acceptance: {                          // critères vérifiables, propres à CETTE scène
    identitySimilarityMin?: number;
    productSimilarityMin?: number;
    productVisibleSecMin?: number;
    asrMatchMin?: number;                // transcription vs dialogue attendu
    noTextArtifacts: boolean;
  };
  repairPolicy: {                        // que faire si tel critère échoue
    onIdentityFail: RepairAction;
    onProductFail: RepairAction;
    onAudioFail: RepairAction;
    onVisualFail: RepairAction;
    maxAttempts: number;                 // par défaut 2
  };
};

type RepairAction =
  | 'reuse_alternate_shot'      // chemin C : autre plan de la banque — quasi gratuit
  | 'recomposite_product'       // refaire uniquement l'incrustation — gratuit
  | 'regenerate_audio_only'
  | 'regenerate_lipsync_only'
  | 'regenerate_scene'
  | 'rewrite_line_and_scene'
  | 'edit_plan_only'            // recadrage, retiming — gratuit
  | 'escalate';
```

**Le point de conception :** chaque scène **porte ses propres critères d'acceptation et sa
propre stratégie de réparation**. C'est ce qui rend la §14 possible sans code conditionnel
géant dans l'orchestrateur.

---

## 14 · Targeted Regeneration Engine

### 14.1 · L'échelle de réparation, du moins cher au plus cher

> **Règle absolue : toujours tenter la réparation la moins chère capable de traiter la cause
> diagnostiquée. Ne jamais régénérer ce qui n'a pas besoin de l'être.**

```
NIVEAU 0 · GRATUIT — aucune génération
   recadrage · retiming · réordonnancement · sous-titres · musique
   · vitesse · trim · changement de transition          → EditPlan seul

NIVEAU 1 · QUASI GRATUIT — réutilisation d'actifs existants
   autre plan de la banque · réincrustation produit
   · autre prise déjà générée                            → chemin C uniquement

NIVEAU 2 · FAIBLE — un seul média régénéré
   audio seul · lip-sync seul · voix seule

NIVEAU 3 · MOYEN — une scène
   régénération de la scène, conditionnement renforcé

NIVEAU 4 · ÉLEVÉ — écriture + scène
   réécriture de la réplique puis régénération de la scène

NIVEAU 5 · ARRÊT
   escalade humaine (§27) — jamais de boucle infinie
```

### 14.2 · Table de diagnostic → réparation

| Échec détecté | Détecté par | Cause probable | Réparation | Niveau |
|---|---|---|---|---|
| Produit déformé, texte du packaging illisible | OCR + signature logo | S2 utilisé sur produit texturé | **Basculer en S1 (compositing)** | 1 |
| Produit peu visible | durée de présence | mauvais `productSlot` | autre plan avec slot adapté | 1 |
| Lip-sync mauvais | modèle vision + alignement | provider lip-sync | régénérer le lip-sync seul | 2 |
| Réplique coupée à la fin | **ASR vs `dialogue.text`** | dépassement du budget de mots | raccourcir la réplique + régénérer audio | 2 puis 4 |
| Identité du personnage dérive | distance d'embedding | modèle génératif instable | autre plan (C) ou nouvelle seed (A/B) | 1 ou 3 |
| Hook faible | score model-based | script | **réécrire le script + scène 1 uniquement** | 4 |
| Rythme mou | analyse de durées | montage | **EditPlan seul** | **0** |
| Mauvais style de marque | brand fit rule | contraintes de scène | modifier les contraintes + régénérer la scène | 3 |
| Mains ou visage aberrants | modèle vision | aléa du modèle | autre plan / nouvelle seed | 1 ou 3 |
| Sous-titres illisibles | contraste + géométrie | style | **EditPlan seul** | **0** |
| Mauvais CTA | rule | script | réécrire la dernière scène | 4 |
| Blocage de politique du provider | erreur provider | formulation | reformuler + rerouter | 3 |
| Loudness hors norme | mesure LUFS | mixage | **normalisation, EditPlan** | **0** |

**Constat économique :** avec le chemin C, la majorité des échecs se réparent aux niveaux 0
et 1, c'est-à-dire **sans dépense**. C'est ce qui fait tomber le facteur de régénération —
la variable la plus sensible du modèle (M01 §T).

---

## 15 · Provider Routing — statique, adaptatif, apprenant

### 15.1 · Les trois étages, et quand chacun devient légitime

| Étage | Mécanisme | Prérequis | Livraison |
|---|---|---|---|
| **STATIC** | filtre dur sur capabilities + score pondéré fixe (coût, latence, qualité déclarée) | aucun | **MVP** |
| **ADAPTIVE** | le score intègre des statistiques d'exploitation en ligne : taux de succès, latence observée, taux de blocage de politique, profondeur de file, circuit breaker. Décroissance exponentielle sur 14 jours | quelques centaines de générations | **MVP tardif / V1** |
| **LEARNING** | bandit contextuel : le contexte est `{genre du présentateur × type de scène × langue × présence produit × marché}`. Échantillonnage de Thompson, exploration plancher 5-10 %, sous contrainte budgétaire | **quelques milliers de générations par contexte** | **V2** |

### 15.2 · Le cas d'usage cité — « femme + démonstration produit + français »

C'est exactement le type de contexte où un routeur apprenant gagne. Mais soyons honnêtes sur
le volume : pour distinguer deux providers sur ce contexte avec un minimum de confiance, il
faut de l'ordre de **200 à 400 générations dans ce contexte précis**. Avec 20 contextes, cela
représente plusieurs milliers de générations. **Avant cela, un routeur « apprenant » apprend
du bruit** et coûte de l'argent en exploration.

**Solution intermédiaire, peu coûteuse et disponible dès la V1 — l'évaluation fantôme :**
sur 2 à 5 % des scènes, générer la **même scène chez un second provider en tier draft** et
comparer les scores QC. On construit ainsi une matrice de comparaison par contexte pour
quelques centaines de dollars par mois, **sans dégrader l'expérience client** — le client
reçoit toujours la sortie du provider principal.

### 15.3 · Ce que le routeur doit consommer, et ce qu'il ne doit pas

| Consomme | Ne consomme pas |
|---|---|
| capabilities déclarées, coût, latence p50/p95 | l'avis d'un LLM sur « quel provider serait le meilleur » |
| taux de succès QC par contexte | des préférences codées en dur par un développeur |
| taux de blocage de politique | des règles non traçables |
| profondeur de file et quotas | |
| disponibilité géographique et résidence des données | |

Toute décision du routeur est **journalisée avec ses entrées** (§28) — sinon on ne peut ni
la déboguer ni l'améliorer.

---

## 16 · Cost Intelligence — le Generation Budget Planner

### 16.1 · Le défaut du M01

Le M01 avait un contrôleur de coûts **réactif** : il estime, réserve, plafonne, coupe. Il ne
**planifie** pas. Un plafond empêche la catastrophe ; il n'optimise rien.

### 16.2 · Le planificateur

Avant que la moindre scène ne soit produite :

```
ENTRÉE : SceneSpecification[] · tier demandé · plan du workspace · historique du workspace

┌────────────────────────────────────────────────────────────────┐
│ 1 · INVENTAIRE DE RÉUTILISATION   ← exécuté EN PREMIER          │
│    Pour chaque scène, existe-t-il déjà :                        │
│      · une génération avec le même input_hash ?        → 0 $    │
│      · un plan de banque compatible ?                  → ~0 $   │
│      · une scène d'une pub précédente réutilisable ?   → 0 $    │
│      · un recadrage / retiming d'un actif existant ?   → 0 $    │
│    ⇒ souvent 30 à 60 % des scènes d'une variation                │
├────────────────────────────────────────────────────────────────┤
│ 2 · PLAN PAR SCÈNE                                              │
│    chemin (A/B/C) · provider · tier · budget de tentatives      │
│    les scènes critiques (hook, CTA) reçoivent plus de budget    │
│    que les scènes de milieu                                     │
├────────────────────────────────────────────────────────────────┤
│ 3 · ESTIMATION                                                  │
│    coût attendu · coût maximum · coût cible                     │
│    tentatives attendues = f(historique du contexte)             │
├────────────────────────────────────────────────────────────────┤
│ 4 · ARBITRAGE                                                   │
│    si coût max > budget du plan :                               │
│      dégrader le tier des scènes non critiques,                 │
│      augmenter la réutilisation, réduire le nombre de scènes,   │
│      ou demander à l'utilisateur — jamais dépasser silencieusement│
└────────────────────────────────────────────────────────────────┘

SORTIE : GenerationPlan immuable. L'orchestrateur ne peut pas en sortir.
```

### 16.3 · Aperçu bon marché → contrôle → final premium

Le M01 proposait déjà draft → standard. Le planificateur le rend **sélectif** :

```
Toutes les scènes en aperçu bon marché  →  QC + score  →
   scènes validées : conservées telles quelles si le tier suffit
   scènes critiques (hook, CTA, démonstration produit) : refaites en tier supérieur
   scènes rejetées : réparées au niveau le moins cher (§14)
```

**Résultat : on paie le premium uniquement là où il change quelque chose.** Un plan large et
statique du hook n'a pas besoin de la même qualité qu'un gros plan sur le produit.

### 16.4 · L'objectif chiffré

| Indicateur | Cible MVP | Comment |
|---|---|---|
| Coût médian par publicité livrée | **< 1,00 $** | chemin C + réutilisation + réparation niveau 0-1 |
| Facteur de régénération | **< 1,4** | validation déterministe amont + réparation ciblée |
| Part des réparations sans dépense (niveaux 0-1) | **> 60 %** | banque de plans + EditPlan |
| Coût d'une variation de hook | **< 0,15 $** | seule la scène 1 est refaite |

Ces quatre chiffres sont les indicateurs de santé économique du produit. Ils doivent être
visibles sur un tableau de bord interne **dès la première publicité générée**.
