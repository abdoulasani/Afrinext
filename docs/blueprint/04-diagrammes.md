# 04 · Diagrammes d'architecture

> Section 29 du master prompt. Huit diagrammes. Deux d'entre eux (Creative Orchestrator,
> User Journey) sont dessinés en détail dans leurs sections d'origine — ils sont repris ici
> en vue condensée, avec un renvoi.

---

## 1 · System Architecture

```
                              UTILISATEURS
              navigateur · mobile web · API clients (agences)
                                   │
                                   ▼
    ╔══════════════════════════════════════════════════════════════════╗
    ║               CLOUDFLARE   DNS · WAF · CDN · rate limit          ║
    ╚══════════════════════════════════════════════════════════════════╝
                    │                              │
                    ▼                              ▼
        ┌───────────────────────┐      ┌───────────────────────────────┐
        │  WEB · Next.js 15     │      │  API · Fastify                │
        │  SSR · SSE client     │─────▶│  REST /v1 · tRPC · SSE        │
        │  aperçu composite     │      │  auth · tenant · idempotency  │
        └───────────────────────┘      └───────────────┬───────────────┘
                                                       │
        ┌──────────────────────────────────────────────┼───────────────┐
        │                        │                     │               │
        ▼                        ▼                     ▼               ▼
┌───────────────┐      ┌─────────────────┐   ┌─────────────────┐  ┌─────────┐
│  PostgreSQL   │      │  Redis          │   │  R2 · objets    │  │ Stripe  │
│  + pgvector   │      │  files · cache  │   │  URLs signées   │  │         │
│  RLS activée  │      │  verrous · RL   │   │                 │  │         │
└───────┬───────┘      └────────┬────────┘   └────────┬────────┘  └─────────┘
        │                       │                     │
        │              ┌────────┴───────────┐         │
        │              ▼                    ▼         │
        │      ┌───────────────┐   ┌────────────────┐ │
        └─────▶│  WORKERS      │   │  RENDER        │◀┘
               │  orchestrateur│   │  FFmpeg        │
               │  IA · QC      │   │  CPU dédié     │
               │  0-N auto     │   │  0-N auto      │
               └───────┬───────┘   └────────────────┘
                       │
    ┌──────────────────┼──────────────────┬───────────────┬────────────┐
    ▼                  ▼                  ▼               ▼            ▼
┌────────┐      ┌────────────┐     ┌───────────┐   ┌──────────┐  ┌─────────┐
│  LLM   │      │  IMAGE     │     │  VIDÉO    │   │  VOIX    │  │ LIPSYNC │
│ Claude │      │ Google/    │     │ Veo·Omni· │   │ Eleven·  │  │ (si     │
│ Gemini │      │ Firefly    │     │ Kling     │   │ Cartesia │  │  besoin)│
└────────┘      └────────────┘     └───────────┘   └──────────┘  └─────────┘
                              PROVIDERS EXTERNES
                    (tous derrière le Capability Router · §Q)

    ── observabilité transverse ──────────────────────────────────────────
      OpenTelemetry (traces · métriques · logs) → Grafana · Sentry · PostHog
```

---

## 2 · AI Pipeline

```
ENTRÉE : une URL, des images, ou trois lignes de texte
   │
   ▼
┌────────────────────┐   crawl (JS rendering si nécessaire)
│  INGESTION         │   OCR des images produit · lecture de catalogue
└─────────┬──────────┘   → contenu marqué NON FIABLE (§S3)
          ▼
┌────────────────────┐   LLM + vision
│  brand.extract     │──▶ BrandDNA { voice, audience, usp, pains,
└─────────┬──────────┘             claims interdits, confidence, assumptions }
          ▼
┌────────────────────┐
│  brand.voc         │──▶ VoiceOfCustomer { pains, desires, objections }
└─────────┬──────────┘     verbatim si avis disponibles, sinon hypothèse marquée
          ▼
┌────────────────────┐   Creative Knowledge Base : angles + awareness + mechanism
│  strategy.angles   │──▶ AngleSet[8..12] + Mechanism + awarenessLevel
└─────────┬──────────┘   déduplication par similarityGroup
          ▼
┌────────────────────┐   heuristiques + historique de performance (V1)
│  strategy.rank     │──▶ ConceptCard[3]  ← ce que l'utilisateur voit
└─────────┬──────────┘
          ▼
   ╔═══════════════════════╗
   ║  ★ GATE HUMAIN ★      ║   le seul arrêt du pipeline
   ╚═══════════┬═══════════╝
               ▼
┌────────────────────┐   CKB : structure + copy + production
│  script.write      │──▶ Script { clips[4..7], durées ∈ grille provider }
└─────────┬──────────┘
          ▼
┌────────────────────┐   DÉTERMINISTE · aucun LLM · aucun coût
│  script.validate   │   durées · budget de mots · says non vide · claims
└─────────┬──────────┘   · 4-7 clips · 24-40 s · zéro [bracket]
          │  ÉCHEC ──▶ retour à script.write (max 2) ──▶ escalade humaine
          ▼ OK
┌────────────────────┐   templates par famille de provider · 0 coût
│  prompt.compile    │──▶ ClipPrompt[]  = caméra + action + script + voix + accent
└─────────┬──────────┘   ancrages de personnage recopiés VERBATIM
          ▼
    ══▶ PIPELINE VIDÉO (diagramme 3)
          ▼
┌────────────────────┐
│  qc.*              │   visuel · identité · audio · marketing · plateforme
└─────────┬──────────┘
          ▼
┌────────────────────┐
│  edit.plan         │──▶ EditPlan (dérivé du Script à 90 %)
└─────────┬──────────┘
          ▼
       RENDU → publicité finale

COÛT IA TEXTE TOTAL : 0,20 – 0,60 $   ·   COÛT VIDÉO : 6 – 30 $
       └── d'où la règle : dépenser généreusement ici pour économiser là ──┘
```

---

## 3 · Video Pipeline

```
ClipPrompt[i] + CharacterSheet + tier (draft | standard | premium)
        │
        ▼
┌──────────────────────┐
│  CAPABILITY ROUTER   │  filtre dur → santé → tier → score → sélection
└──────────┬───────────┘  sortie : provider + chaîne de fallback [p2, p3]
           │
    ┌──────┴───────────────────────────────┐
    ▼                                      ▼
CHEMIN A · audio natif              CHEMIN B · silencieux + voix
┌──────────────────────┐            ┌──────────────────────────┐
│ submit(prompt+image) │            │ submit(prompt sans texte)│
│   ↓ poll             │            │   ↓                      │
│ clip AVEC voix       │            │ clip muet                │
└──────────┬───────────┘            │   ↓                      │
           │                        │ VoiceProvider(VoiceProfile)│
           │                        │   ↓ piste voix           │
           │                        │ LipSyncProvider          │
           │                        │   ↓ clip synchronisé     │
           │                        └──────────┬───────────────┘
           └───────────────┬───────────────────┘
                           ▼
        ┌──────────────────────────────────────┐
        │  QC DU CLIP                          │
        │  · visuel   3-5 frames → modèle vision│
        │  · identité embedding vs référence    │
        │  · audio    ASR vs `says` attendu ★   │
        │  · technique durée · ratio · fps      │
        └──────────────┬───────────────────────┘
                       │
         ┌─────────────┴──────────────┐
      PASS                          FAIL
         │                            │
         ▼                            ▼
   asset conservé          ┌──────────────────────┐
   marqué selected         │ REGEN CIBLÉE         │  attempt < 2 ?
         │                 │ seed alt · provider  │  ── non ──▶ dégradation
         │                 │ suivant · durée +1   │            gracieuse (§G4)
         │                 └──────────┬───────────┘
         │                            └──▶ retour au router
         ▼
   tous les clips prêts → assets.collect → EditPlan → RENDU

★ la vérification ASR est le contrôle le plus rentable du système :
  0,002 $ pour détecter la réplique coupée, qui est l'échec n°1 en pratique
```

---

## 4 · Creative Orchestrator

> Vue condensée. **Le DAG complet, avec états, retries et compensation, est en §G2.**

```
ad.create
   │
   ├─ N1  brand.resolve ──────── cache 30 j ──┐
   ├─ N2  strategy.angles                     │  phase STRATÉGIE
   ├─ N3  strategy.rank                       │  ~2 min · < 1 $
   │                                          │
   ╞══ ★ GATE : WAITING_INPUT (TTL 7 j) ══════╡
   │                                          │
   ├─ N4  character.resolve                   │
   ├─ N5  script.write                        │  phase ÉCRITURE
   ├─ N6  script.validate  ◀── boucle max 2 ──┤  ~1 min · < 0,2 $
   ├─ N7  prompt.compile                      │
   ├─ N8  budget.reserve  ─── échec ──▶ PAUSED_INSUFFICIENT_CREDITS
   │                                          │
   ├─ N9  video.generate  × n clips (2-4 en parallèle)   phase PRODUCTION
   ├─ N10 qc.clip         × n  ─── fail ──▶ regen ciblée │  ~5 min · 6-30 $
   ├─ N11 assets.collect                      │
   │                                          │
   ├─ N12 edit.plan                           │  phase MONTAGE
   ├─ N13 render                              │  ~1 min · < 0,1 $
   ├─ N14 qc.final                            │
   └─ N15 budget.settle ──▶ ✅ ad.ready

CHAQUE NŒUD : attempt · maxAttempts · idempotencyKey · inputHash
              · outputRef · costCents · providerRef · error

L'inputHash est ce qui rend une reprise ou une régénération partielle GRATUITE
pour tous les nœuds dont les entrées n'ont pas changé.
```

---

## 5 · Database Relationships

```
                              ┌──────────┐
                              │  users   │
                              └────┬─────┘
                                   │ memberships (role)
                                   ▼
    ┌──────────────────────── workspaces ───────────────────────────┐
    │  plan · credits_balance · spend caps · stripe_customer_id     │
    └───┬────────┬──────────┬───────────┬──────────┬────────────────┘
        │        │          │           │          │
        ▼        ▼          ▼           ▼          ▼
  ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐ ┌──────────────────┐
  │ brands │ │charac- │ │ assets │ │api_keys│ │credit_transactions│
  │        │ │ ters   │ │        │ │        │ │  (append-only)    │
  └───┬────┘ └───┬────┘ └────────┘ └────────┘ └──────────────────┘
      │          │
      │          └── character_consents  (origin = consented_clone)
      │          └── face_embedding vector(512)  → QC d'identité
      │
      ├──▶ brand_dna (versionné : jamais modifié en place)
      ├──▶ products
      ├──▶ voice_of_customer
      └──▶ campaigns
              │
              └──▶ creative_concepts   (les 12 angles y vivent tous)
                        │
                        └──▶ scripts (versionné)
                                 │
                                 └──▶ ┌─────────────────────────┐
                                      │          ads            │
                                      │  parent_ad_id ──┐       │
                                      │  variation_of   │ arbre │
                                      │  ◀──────────────┘       │
                                      └───┬────────┬────────────┘
                                          │        │
                    ┌─────────────────────┘        └──────────┐
                    ▼                                         ▼
             ┌────────────┐                            ┌─────────────┐
             │  scenes    │  1 par clip                │ edit_plans  │ versionné
             │  clip_index│                            └──────┬──────┘
             └─────┬──────┘                                   ▼
                   │                                    ┌───────────┐
                   ▼                                    │  renders  │
            ┌───────────────┐                           └─────┬─────┘
            │  generations  │  n par scène (tentatives)       │
            │  input_hash ★ │──────────────────────────▶ assets
            │  qc · cost    │
            └───────┬───────┘
                    │ provider_id
                    ▼
             ┌────────────┐        ┌──────────────────┐
             │ providers  │◀───────│ provider_events  │ → circuit breaker
             │capabilities│        └──────────────────┘   & scoring du router
             └────────────┘

    ── production ──────────────────────────────────────────────────
    jobs ──▶ job_nodes (DAG persisté : node_key, depends_on, status)

    ── performance (V1/V2) ─────────────────────────────────────────
    ads ──▶ ad_platform_links ──▶ performance_metrics
    ads ──▶ creative_features (dénormalisée : l'analyse de patterns
                               devient une requête SQL simple)

    ── conformité ──────────────────────────────────────────────────
    audit_log · content_flags

    ★ RLS activée sur TOUTE table portant workspace_id.
      Seule exception au partage : characters WHERE workspace_id IS NULL
      (bibliothèque globale, lecture seule).
```

---

## 6 · Job Queue

```
      API : POST /v1/ads                     ┌─────────────────────────┐
            │  Idempotency-Key               │  jobs        (DAG head) │
            ▼                                │  job_nodes   (DAG body) │
      créer job + nœuds ────────────────────▶│  PostgreSQL             │
            │                                └───────────┬─────────────┘
            ▼                                            │ source de vérité
      enfiler les nœuds READY                            │ (Redis n'est qu'un
            │                                            │  transport)
            ▼                                            │
    ╔═══════════════════════════════════════════╗        │
    ║              REDIS · BullMQ               ║        │
    ╟───────────────────────────────────────────╢        │
    ║ q:brand      légère    conc. 20           ║        │
    ║ q:strategy   légère    conc. 20           ║        │
    ║ q:script     légère    conc. 20           ║        │
    ║ q:video      LOURDE    conc. par provider ║◀───────┤ rate limit
    ║ q:voice      moyenne   conc. 10           ║        │ par provider
    ║ q:qc         légère    conc. 30  ★        ║        │
    ║ q:render     CPU       conc. = vCPU       ║        │
    ║ q:webhook    légère    conc. 50           ║        │
    ╚═══════════════════════════════════════════╝        │
            │                    │                       │
            ▼                    ▼                       │
    ┌───────────────┐    ┌───────────────┐               │
    │ worker pool   │    │ render pool   │               │
    │ (auto 0-N)    │    │ (CPU, auto)   │               │
    └───────┬───────┘    └───────┬───────┘               │
            │                    │                       │
            ▼                    ▼                       │
    ┌─────────────────────────────────────┐              │
    │ écrire résultat + coût + progression│──────────────┘
    │ marquer les nœuds suivants READY    │
    └─────────────────┬───────────────────┘
                      │
          ┌───────────┴───────────┐
       SUCCÈS                  ÉCHEC
          │                       │
          ▼                       ▼
   nœuds suivants        retryable ? ── oui ──▶ backoff 5s/15s/60s + jitter
   enfilés                    │
          │                   non
          ▼                    ▼
   … → job COMPLETED     compensation (libérer crédits) → DLQ + alerte

★ q:qc est délibérément séparée et très concurrente : si le QC attendait
  derrière les générations vidéo, tout le pipeline se bloquerait derrière
  la tâche la plus lente. Ne jamais mélanger une tâche de 3 s et une de 6 min.

PROGRESSION : jobs.progress {step, label, pct} ──▶ SSE ──▶ UI
              libellés destinés à l'humain : « Tournage 4/6 », jamais « node N9 »
```

---

## 7 · Provider Abstraction

```
                    LE CŒUR NE CONNAÎT AUCUN PROVIDER
                                   │
                     il exprime un BESOIN, pas un appel
                                   │
                                   ▼
   ┌───────────────────────────────────────────────────────────────────┐
   │  CanonicalRequest                                                  │
   │  { kind:'video', clip, character, durationSec, aspectRatio,        │
   │    tier, language, needsNativeAudio, identityFidelityMin, region } │
   └───────────────────────────────┬───────────────────────────────────┘
                                   ▼
   ┌───────────────────────────────────────────────────────────────────┐
   │  CAPABILITY REGISTRY   (table `providers` — modifiable sans deploy)│
   │                                                                    │
   │  veo-3.1     durées[8] · audio natif ✓ · identité 3 · 0,45 $/s     │
   │  omni-flash  durées[3..10] · audio ✓ · identité 2 · 0,15 $/s       │
   │  kling-3     durées[5,10] · audio ✗ · identité 2 · 0,10 $/s        │
   │  …                                                                 │
   └───────────────────────────────┬───────────────────────────────────┘
                                   ▼
   ┌───────────────────────────────────────────────────────────────────┐
   │  ROUTER                                                            │
   │   1. filtre dur      capabilities incompatibles → éliminé          │
   │   2. filtre santé    breaker ouvert / erreurs > seuil → éliminé    │
   │   3. filtre tier     draft → rapide/pas cher · final → fidélité    │
   │   4. score           w1·qualité + w2·1/coût + w3·1/latence         │
   │                      + w4·succès_historique  (pondéré par plan)    │
   │   5. sélection       principal + [fallback1, fallback2]            │
   └───────────────────────────────┬───────────────────────────────────┘
                                   ▼
   ┌──────────────┬──────────────┬──────────────┬──────────────────────┐
   │  ADAPTER A   │  ADAPTER B   │  ADAPTER C   │  ADAPTER D           │
   │              │              │              │                      │
   │ compilePrompt│ compilePrompt│ compilePrompt│  ← PROPRE À CHACUN   │
   │   naturel    │  structuré   │   naturel    │    (c'est le point)  │
   │ submit/poll  │ submit/poll  │ submit/poll  │                      │
   │ normalizeErr │ normalizeErr │ normalizeErr │                      │
   └──────┬───────┴──────┬───────┴──────┬───────┴──────────────────────┘
          ▼              ▼              ▼
   ┌──────────────────────────────────────────────────────────────────┐
   │  TAXONOMIE D'ERREURS COMMUNE                                      │
   │  RETRYABLE · NON_RETRYABLE · DEGRADED · FATAL                     │
   │        │            │            │          │                     │
   │     backoff     fallback     régénérer   alerte ops               │
   └──────────────────────────────────────────────────────────────────┘
          │
          ▼
   ┌──────────────────────────────────────────────────────────────────┐
   │  provider_events → circuit breaker + scoring + tableaux de coût   │
   └──────────────────────────────────────────────────────────────────┘

   CRITÈRE D'ACCEPTATION (Phase 05) :
   ajouter un provider = 1 adaptateur (~200 lignes) + 1 ligne SQL.
   AUCUNE modification du cœur, AUCUN déploiement de `packages/core`.
```

---

## 8 · User Journey

> Vue condensée. **Le parcours détaillé, avec durées et écrans, est en §D1.**

```
 ┌────────┐   ┌──────────┐   ┌──────────┐   ┌──────────┐   ┌──────────┐
 │ SIGNUP │──▶│ BUSINESS │──▶│ BRAND DNA│──▶│ OBJECTIF │──▶│ CONCEPTS │
 │  30 s  │   │  1 champ │   │  40-70 s │   │  3 clics │   │  60-90 s │
 └────────┘   │   20 s   │   │  éditable│   │pré-remplis│  └────┬─────┘
              └──────────┘   └──────────┘   └──────────┘        │
                                                                 ▼
                                                   ╔═════════════════════╗
                                                   ║ ★ CHOIX DU CONCEPT ★║
                                                   ║   le SEUL gate      ║
                                                   ╚══════════┬══════════╝
                                                              ▼
 ┌──────────┐   ┌────────────────────┐   ┌──────────┐   ┌──────────────┐
 │PERSONNAGE│──▶│     GENERATE       │──▶│  REVIEW  │──▶│   EXPORT     │
 │   15 s   │   │  6-9 min async     │   │  1-3 min │   │ 4 ratios     │
 │ (une fois│   │  progression nommée│   │ regen par│   │ + VARIATIONS │
 │ par marque)  │  fermable          │   │ clip     │   │ + publication│
 └──────────┘   └────────────────────┘   └──────────┘   └──────────────┘

 ─────────────────────────────────────────────────────────────────────────
 PREMIÈRE PUBLICITÉ   < 15 min au total · < 2 min d'attention humaine
 (workflow manuel analysé : 45-60 min, entièrement attentives)

 DEUXIÈME PUBLICITÉ   Brand DNA ✓  personnage ✓  angles joués mémorisés
 ┌────────┐   ┌──────────┐   ┌──────────┐   ┌──────────┐
 │ CREATE │──▶│ OBJECTIF │──▶│ CONCEPTS │──▶│ GENERATE │   < 4 min
 └────────┘   └──────────┘   └──────────┘   └──────────┘   20 s d'attention
                                                            ↑
                                              c'est CE parcours qui retient,
                                              et c'est la couche MÉMOIRE
                                              qui le rend possible (§B)
```
