# 03 · Plateforme — Sections L → Z

---

## L · Backend Architecture

### L1 · Décision — monolithe modulaire + workers séparés

**Décision :** un **monolithe modulaire TypeScript** (API + logique métier) et un **pool de
workers** partageant le même code, dans un monorepo. Pas de microservices.

**Alternatives :** (a) microservices par domaine · (b) serverless intégral · (c) monolithe
unique incluant les workers.

| Option | Pour | Contre | Verdict |
|---|---|---|---|
| Monolithe modulaire + workers | Une base de code, transactions locales, déploiement simple, frontières de modules qui deviendront des services si besoin | Le scaling est global (mais les workers scalent séparément — ce qui est le seul axe qui compte ici) | **Retenu** |
| Microservices | Scaling indépendant, isolation des pannes | Pour une équipe de 3-8 personnes : latence réseau, cohérence distribuée, 10 pipelines CI. Coût organisationnel injustifiable avant le product-market fit. | Rejeté (à reconsidérer vers 30 ingénieurs) |
| Serverless intégral | Zéro ops, scale à zéro | Les jobs vidéo durent 2-9 min ; le rendu FFmpeg est CPU-intensif et long. Limites de durée et démarrages à froid rédhibitoires. | Rejeté pour les workers ; acceptable pour l'API |
| Monolithe unique | Le plus simple | Un rendu FFmpeg qui sature le CPU dégrade l'API des utilisateurs. Inacceptable. | Rejeté |

**Pourquoi cette forme :** notre charge est fortement asymétrique. L'API est légère (requêtes
courtes, majoritairement des lectures) ; les workers sont lourds (minutes de CPU, appels
externes de plusieurs minutes). Les séparer est la seule décomposition dont on ait
réellement besoin — les autres sont prématurées.

### L2 · Runtime et framework

**Décision : Node.js 22 LTS + TypeScript strict + Fastify.**

- **Node vs Bun** — Bun est plus rapide au démarrage ; Node reste plus solide sur les
  bindings natifs (sharp, ffmpeg) et sur l'observabilité (OpenTelemetry). Sur nos charges, le
  goulot est le réseau externe, pas le runtime. **Node.**
- **Fastify vs Nest vs Hono** — Nest apporte une structure utile mais un poids de décorateurs
  et une opinion forte ; Hono est excellent en edge mais moins riche en écosystème serveur ;
  Fastify offre les performances, la validation par schéma native (qui s'aligne exactement
  sur notre principe de contrats typés) et un écosystème mature. **Fastify.**
- **Go/Rust pour les workers** — tentant pour le rendu, mais les workers passent 95 % de leur
  temps à attendre des API externes et à piloter FFmpeg en sous-processus. Un second langage
  coûterait plus qu'il ne rapporterait. **TypeScript partout.**

### L3 · Modules

```
apps/api            HTTP · auth · validation · rate limiting · webhooks
apps/worker         consommateurs de files · orchestrateur · providers
apps/render         workers FFmpeg (image conteneur distincte, CPU-optimisée)
apps/web            Next.js

packages/core       entités du domaine, machines à états, règles métier pures
packages/ai         nœuds LLM, Creative Knowledge Base, évals
packages/providers  adaptateurs LLM / image / vidéo / voix / lipsync / musique
packages/db         schéma Drizzle, migrations, politiques RLS
packages/jobs       moteur de DAG, définitions de files, idempotence
packages/billing    grand livre de crédits, tarification, Stripe
packages/media      utilitaires FFmpeg, sondes, génération ASS
packages/contracts  schémas Zod partagés API ↔ web ↔ workers
packages/observability  OTel, logs, métriques
```

**Règle de dépendance :** `core` ne dépend de rien. `providers` ne dépend que de `contracts`.
`api` et `worker` dépendent de tout. Une violation casse la CI. C'est ce qui garde ouverte
la porte de l'extraction en services.

---

## M · Frontend Architecture

**Décision : Next.js 15 (App Router) + React 19 + TypeScript + Tailwind + shadcn/ui.**

**Justification, décision par décision :**

- **Next.js vs Remix vs SPA Vite** — nous avons besoin de SEO sur les pages marketing, de
  streaming SSR sur des écrans qui attendent de l'IA, et d'un rendu serveur pour la première
  peinture. Next couvre les trois ; Remix aussi mais avec un écosystème plus étroit ; une SPA
  pure perdrait le SEO. **Next.**
- **État serveur : TanStack Query.** Notre état est majoritairement distant et asynchrone.
  Redux/Zustand ne serviraient qu'à un état local marginal (éditeur, formulaires).
- **Temps réel : SSE, pas WebSocket.** La progression des jobs est unidirectionnelle
  serveur→client. SSE passe les proxies, se reconnecte seul, ne demande aucune infrastructure
  supplémentaire. WebSocket serait justifié uniquement pour l'édition collaborative (V2).
- **Aperçu vidéo : lecture composite DOM**, pas de rendu. Les clips sont joués dans l'ordre
  avec les overlays et sous-titres en HTML/CSS par-dessus. Itération instantanée, coût nul.
  Le rendu serveur n'intervient qu'à l'export.
- **Rendu de l'attente.** Les écrans qui attendent l'IA sont l'essentiel de l'expérience :
  progression nommée par étape réelle, aperçus des clips à mesure qu'ils arrivent, jamais un
  spinner anonyme. C'est un choix produit avec des conséquences techniques — chaque nœud du
  DAG doit émettre un libellé lisible par un humain.

**Structure :**

```
app/
  (marketing)/                 landing, pricing, blog — statique, SEO
  (auth)/                      login, signup, invitations
  (app)/
    [workspace]/
      page.tsx                 dashboard — CREATE est l'élément dominant
      brands/[id]/             Brand DNA, produits, assets
      create/                  le parcours en 8 étapes (§D1)
      ads/[id]/                review, éditeur, variations, export
      characters/              bibliothèque et personnages du workspace
      campaigns/               campagnes et performance
      settings/                équipe, facturation, crédits, API
```

---

## N · Database Schema

**PostgreSQL 16**, avec `pgvector` (embeddings faciaux et, plus tard, similarité de
créas). ORM : **Drizzle**.

**Drizzle vs Prisma :** Prisma a une meilleure DX brute ; Drizzle génère du SQL prévisible,
supporte proprement les **politiques RLS** (essentielles à notre isolation, §V) et n'impose
pas de moteur de requêtes intermédiaire. Sur un produit dont l'isolation multi-tenant est un
argument de vente, la lisibilité du SQL généré l'emporte. **Drizzle.**

### N1 · Le schéma

```sql
-- ═══ IDENTITÉ & TENANCE ══════════════════════════════════════════════
users(id, email UNIQUE, name, avatar_url, locale, created_at, last_seen_at)

workspaces(id, name, slug UNIQUE, plan, credits_balance,
           credit_limit_monthly, spend_cap_cents_daily, status,
           stripe_customer_id, created_at)

memberships(id, workspace_id→workspaces, user_id→users,
            role ENUM('owner','admin','editor','viewer'),
            invited_by, accepted_at, UNIQUE(workspace_id,user_id))

api_keys(id, workspace_id, name, key_hash, scopes[], last_used_at,
         expires_at, revoked_at)

-- ═══ MARQUE & PRODUIT ════════════════════════════════════════════════
brands(id, workspace_id, name, website_url, industry,
       default_character_id→characters, default_language, created_at)

brand_dna(id, brand_id→brands, version, data JSONB, confidence JSONB,
          assumptions JSONB, source ENUM('crawl','manual','import'),
          created_by, created_at, UNIQUE(brand_id, version))
  -- versionné : on ne modifie jamais en place, on ajoute une version

products(id, brand_id, name, description, price_cents, currency, url,
         category, usp JSONB, offer JSONB, asset_ids[], created_at)

voice_of_customer(id, brand_id, product_id NULL, pains JSONB, desires JSONB,
                  objections JSONB, click_moments JSONB,
                  source ENUM('reviews','manual','inferred'), created_at)

-- ═══ PERSONNAGES ═════════════════════════════════════════════════════
characters(id, workspace_id NULL, name, origin ENUM('library','generated',
           'consented_clone'), sheet JSONB, reference_asset_id→assets,
           face_embedding vector(512), usage_rights JSONB, status,
           created_at)
  -- workspace_id NULL = bibliothèque globale, lisible par tous les tenants

character_consents(id, character_id, subject_name, document_asset_id,
                   signed_at, scope JSONB, expires_at, verified_by, verified_at)

voices(id, workspace_id NULL, name, descriptor TEXT, language, accent,
       provider, provider_voice_id, preview_asset_id, created_at)

-- ═══ CAMPAGNES & CRÉAS ═══════════════════════════════════════════════
campaigns(id, workspace_id, brand_id, name, objective, platforms[],
          budget_cents, status, created_at)

creative_concepts(id, campaign_id NULL, brand_id, product_id NULL,
                  angle JSONB, mechanism JSONB, awareness_level SMALLINT,
                  estimated_strength NUMERIC, rationale TEXT,
                  similarity_group TEXT, status ENUM('proposed','selected',
                  'rejected','used'), created_at)
  -- les 12 angles y vivent tous ; 3 sont remontés, tous sont conservés
  -- (mémoire des angles déjà joués, alimentation des variations)

scripts(id, concept_id→creative_concepts, version, language, platform,
        total_duration_sec, dominant_emotion, cialdini_triggers[],
        clips JSONB, edit_notes JSONB, why_it_converts TEXT,
        validation JSONB, created_at)

ads(id, workspace_id, campaign_id, brand_id, concept_id, script_id,
    character_id, parent_ad_id NULL,     -- variations : arbre de filiation
    variation_of ENUM('hook','avatar','voice','cta','pace','angle',
                      'scene','duration') NULL,
    title, status ENUM('draft','generating','review','ready','published',
                       'failed','partially_completed'),
    platform, aspect_ratio, duration_sec, tier ENUM('draft','standard','premium'),
    final_render_id→renders, cost_cents, created_at, published_at)

-- ═══ PRODUCTION ══════════════════════════════════════════════════════
scenes(id, ad_id→ads, clip_index, role, duration_sec, says, word_count,
       seen, gesture, gesture_timing, on_screen_text, overlay JSONB,
       prompt_text TEXT, prompt_parts JSONB,
       status, selected_generation_id→generations,
       UNIQUE(ad_id, clip_index))

generations(id, scene_id→scenes NULL, ad_id, kind ENUM('video','image',
            'voice','music','lipsync'),
            provider_id→providers, model, request JSONB, response JSONB,
            input_hash TEXT,               -- cache & idempotence
            asset_id→assets NULL, attempt SMALLINT,
            status, qc JSONB, cost_cents, latency_ms,
            error JSONB, created_at, completed_at)
  INDEX(input_hash) WHERE status='succeeded'   -- le cache de régénération

assets(id, workspace_id NULL, kind ENUM('image','video','audio','document',
       'font','logo'), storage_key, bucket, mime, bytes, width, height,
       duration_ms, checksum, provenance JSONB,   -- C2PA, provider, licence
       rights JSONB, created_by, created_at, deleted_at)

edit_plans(id, ad_id, version, plan JSONB, created_by ENUM('ai','user'),
           created_at)

renders(id, ad_id, edit_plan_id, aspect_ratio, resolution, asset_id,
        duration_ms, status, qc JSONB, cost_cents, created_at)

-- ═══ JOBS ════════════════════════════════════════════════════════════
jobs(id, workspace_id, ad_id NULL, type, status, priority,
     max_cost_cents, reserved_credits, spent_credits,
     progress JSONB,                       -- {step, label, pct} pour l'UI
     idempotency_key UNIQUE, created_by, created_at, completed_at)

job_nodes(id, job_id→jobs, node_key, depends_on TEXT[], status,
          attempt SMALLINT, max_attempts SMALLINT, input_hash,
          input_ref JSONB, output_ref JSONB, cost_cents,
          provider_ref TEXT, error JSONB, started_at, ended_at,
          UNIQUE(job_id, node_key))

-- ═══ PROVIDERS ═══════════════════════════════════════════════════════
providers(id, kind ENUM('llm','image','video','voice','lipsync','music'),
          name, capabilities JSONB, cost_model JSONB, priority SMALLINT,
          enabled BOOL, health JSONB, regions[], updated_at)

provider_events(id, provider_id, kind ENUM('success','error','timeout',
                'rate_limit','policy_block'), latency_ms, cost_cents,
                job_node_id, created_at)
  -- alimente le circuit breaker et le scoring du routeur

-- ═══ FACTURATION ═════════════════════════════════════════════════════
subscriptions(id, workspace_id, stripe_subscription_id, plan,
              status, current_period_start, current_period_end,
              seats, cancel_at_period_end)

credit_transactions(id, workspace_id, delta_credits,   -- +achat / -conso
                    kind ENUM('grant','purchase','reservation','settlement',
                              'refund','expiry','adjustment'),
                    job_id NULL, generation_id NULL, render_id NULL,
                    balance_after, note, created_at)
  -- GRAND LIVRE APPEND-ONLY : le solde est un agrégat, jamais une valeur
  -- mise à jour à la main ; workspaces.credits_balance est un cache

usage_daily(workspace_id, day, credits_used, videos_generated,
            seconds_generated, ads_completed, cost_cents,
            PRIMARY KEY(workspace_id, day))

-- ═══ PERFORMANCE (V1/V2) ═════════════════════════════════════════════
ad_platform_links(id, ad_id, platform, external_ad_id, account_id,
                  linked_at)

performance_metrics(id, ad_id, platform, date, impressions, clicks,
                    spend_cents, conversions, revenue_cents,
                    video_views_3s, video_views_100pct,
                    hook_rate NUMERIC, hold_rate NUMERIC,
                    UNIQUE(ad_id, platform, date))

creative_features(ad_id PK, angle_type, hook_type, hook_word_count,
                  character_id, character_age_band, duration_sec,
                  clip_count, awareness_level, cialdini_triggers[],
                  cta_type, platform)
  -- table dénormalisée : c'est ce qui rend l'analyse de patterns triviale

-- ═══ AUDIT & CONFORMITÉ ══════════════════════════════════════════════
audit_log(id, workspace_id, actor_id, actor_type ENUM('user','system','api'),
          action, resource_type, resource_id, metadata JSONB,
          ip, user_agent, created_at)

content_flags(id, ad_id NULL, asset_id NULL, kind ENUM('forbidden_claim',
              'likeness_risk','policy_block','manual_review'),
              severity, details JSONB, resolved_by, resolved_at, created_at)
```

### N2 · Les quatre décisions de modélisation qui comptent

1. **`brand_dna` versionné, jamais modifié en place.** Une publicité doit rester
   reproductible : on doit pouvoir dire « cette pub a été écrite avec la version 3 du Brand
   DNA ». Même logique pour `scripts` et `edit_plans`.
2. **`credit_transactions` est un grand livre en ajout seul.** Le solde est un agrégat.
   `workspaces.credits_balance` n'est qu'un cache reconstruisible. C'est la seule façon
   d'auditer une contestation de facturation, et ça élimine toute une classe de bugs de
   concurrence.
3. **`generations.input_hash` est la clé du cache.** Régénérer un clip dont rien n'a changé
   ne doit rien coûter. Sur un utilisateur qui itère sur son hook, ça économise 80 % du COGS
   de l'itération.
4. **`creative_features` est dénormalisée à dessein.** L'analyse de patterns (§K) devient une
   requête SQL de dix lignes au lieu d'un pipeline de dépliage JSONB. On accepte la
   duplication contre la simplicité analytique.

---

## O · API Architecture

**Décision : REST versionnée (`/v1`) pour l'API publique · tRPC entre `web` et `api` · SSE
pour la progression · webhooks sortants pour les intégrations.**

- **REST publique** parce que les clients d'agences et les intégrations (Zapier, Make, n8n)
  attendent du REST. GraphQL apporterait de la flexibilité de lecture dont nos écrans, très
  cadrés, n'ont pas besoin, au prix d'un contrôle de coût des requêtes.
- **tRPC en interne** parce que web et api partagent le monorepo : typage de bout en bout
  gratuit, zéro génération de client.
- **SSE** pour la progression (§M).
- **Webhooks sortants** signés (HMAC-SHA256, horodatage, tolérance 5 min, fenêtre anti-rejeu).

### O1 · Surface publique

```
POST   /v1/brands                        créer une marque (url | description | assets)
GET    /v1/brands/:id/dna                le Brand DNA courant
PATCH  /v1/brands/:id/dna                correction utilisateur → nouvelle version

POST   /v1/ads                           ★ l'endpoint principal
       { brandId, objective, platform, durationSec, tier,
         characterId?, conceptId?, autoSelectConcept?: boolean }
       → 202 { jobId, adId }
GET    /v1/ads/:id                       état, clips, coût, rendus
GET    /v1/ads/:id/events                SSE — progression temps réel
POST   /v1/ads/:id/concept               ★ le gate : choisir le concept
POST   /v1/ads/:id/scenes/:i/regenerate  régénération ciblée d'un clip
PATCH  /v1/ads/:id/scenes/:i             modifier la réplique → recompile + regen
POST   /v1/ads/:id/variations            { dimension, count } → n publicités filles
POST   /v1/ads/:id/render                { aspectRatio, resolution }
GET    /v1/ads/:id/download              URL signée, expiration 15 min

GET    /v1/characters                    bibliothèque + personnages du workspace
POST   /v1/characters                    créer (generated | consented_clone)

GET    /v1/campaigns/:id/performance     métriques agrégées
POST   /v1/integrations/meta/connect     OAuth ads

GET    /v1/credits                       solde, réservé, historique
GET    /v1/usage                         consommation par jour / par pub
```

**Principes transversaux :**

- Toute mutation coûteuse exige un en-tête `Idempotency-Key`, stocké 24 h.
- Toute réponse d'action longue est un `202` avec un `jobId` — jamais de requête bloquante.
- Toute réponse listant des ressources est paginée par curseur.
- Toute erreur suit un format unique `{ error: { code, message, details, requestId } }` où
  `code` est stable et documenté.
- Les URLs de médias sont **toujours signées et expirantes**, jamais publiques.

---

## P · Job / Queue Architecture

**Décision : BullMQ sur Redis, files séparées par classe de charge, concurrence bornée par
plan et par provider.**

```
FILES                      concurrence      pourquoi séparées
──────────────────────────────────────────────────────────────────────
q:brand         légère     20               rapide, non payante
q:strategy      légère     20               LLM, quelques secondes
q:script        légère     20               LLM, quelques secondes
q:video         LOURDE     bornée par       2-8 min, coûteuse, quotas
                           provider         providers à respecter
q:voice         moyenne    10
q:qc            légère     30               rapide, doit ne jamais être bloquée
q:render        CPU        = nb de vCPU     FFmpeg, workers dédiés
q:webhook       légère     50               sortants, avec retry
q:metrics       planifiée  5                ingestion périodique (V1)
```

**Pourquoi cette séparation :** si le QC partage la file des générations vidéo, un pic de
génération bloque le QC et donc l'avancement de tout le pipeline. La règle est simple : **ne
jamais mettre dans la même file une tâche de 3 secondes et une tâche de 6 minutes.**

### P1 · Garanties

| Garantie | Mécanisme |
|---|---|
| **Idempotence** | `idempotencyKey` par nœud + `input_hash` ; un provider rappelé avec le même hash sert le cache |
| **Retries** | Exponentiel avec jitter : 5 s → 15 s → 60 s. Max 2 pour les appels payants, 5 pour les gratuits. |
| **Timeouts** | Par provider, issus du `p95LatencySec` × 2,5 des capabilities |
| **Circuit breaker** | 5 échecs consécutifs ou > 30 % d'erreurs sur 5 min → provider ouvert 3 min → bascule fallback |
| **Complétion partielle** | Chaque clip est un nœud indépendant ; un échec n'invalide pas les autres |
| **Annulation** | Flag coopératif vérifié entre chaque appel externe ; libère les crédits réservés |
| **Progression** | Chaque nœud écrit `{step, label, pct}` dans `jobs.progress` → SSE |
| **Files mortes** | Après épuisement des retries : DLQ + alerte + entrée `content_flags` si pertinent |
| **Anti-emballement** | §G5 — quatre verrous indépendants |

### P2 · Redis vs alternatives

**BullMQ/Redis** : mature, observable, retries et rate limiting natifs, coût faible.
**pg-boss** (files dans Postgres) éliminerait Redis mais met la charge des files sur la base
transactionnelle — mauvaise idée quand celle-ci porte déjà le DAG. **SQS** est robuste mais
verrouille sur AWS et offre une DX médiocre. **Redis reste requis de toute façon** pour le
rate limiting, les verrous et le cache : autant en tirer les files.

---

## Q · AI Provider Abstraction

### Q1 · La forme de l'abstraction

Une abstraction naïve (`generate(prompt): video`) nivelle tout par le bas. La nôtre est en
trois couches :

```
┌─ COUCHE 3 · CAPABILITY REGISTRY ────────────────────────────────────┐
│  chaque provider PUBLIE ce qu'il sait faire (§H2)                   │
│  stocké en base (table providers) → modifiable sans déploiement     │
└─────────────────────────────────────────────────────────────────────┘
┌─ COUCHE 2 · ROUTER ─────────────────────────────────────────────────┐
│  besoin du clip + tier + santé + coût + plan → provider + fallbacks │
└─────────────────────────────────────────────────────────────────────┘
┌─ COUCHE 1 · ADAPTERS ───────────────────────────────────────────────┐
│  traduisent notre requête canonique ↔ l'API du provider             │
│  + normalisent les erreurs, les coûts, les artefacts                │
└─────────────────────────────────────────────────────────────────────┘
```

```ts
interface VideoProvider {
  readonly capabilities: VideoProviderCapabilities;
  compilePrompt(clip: Clip, character: CharacterSheet): string;  // spécifique !
  submit(req: CanonicalVideoRequest): Promise<ProviderHandle>;
  poll(handle: ProviderHandle): Promise<ProviderResult>;
  cancel(handle: ProviderHandle): Promise<void>;
  estimateCostCents(req: CanonicalVideoRequest): number;
  normalizeError(e: unknown): ProviderError;      // taxonomie commune
}
```

**Le point clé : `compilePrompt` appartient au provider, pas au cœur.** Un modèle attend un
paragraphe naturel, un autre une structure balisée. Forcer un format unique dégraderait la
qualité chez tous. Le cœur fournit des *données structurées* (`Clip` + `CharacterSheet`), le
provider les *sérialise à sa façon*. C'est exactement l'inverse du workflow analysé, où
l'humain écrivait un prompt spécifique à Google Flow.

### Q2 · Taxonomie d'erreurs normalisée

```
RETRYABLE        rate_limit · timeout · provider_5xx · transient_network
NON_RETRYABLE    invalid_request · content_policy · unsupported_capability
                 · insufficient_provider_quota
DEGRADED         partial_output · quality_below_threshold   → régénération
FATAL            auth_failure · account_suspended            → alerte ops immédiate
```

C'est la traduction en taxonomie commune qui rend le circuit breaker et le fallback
possibles. Sans elle, chaque provider impose sa gestion d'erreur au cœur.

### Q3 · Providers retenus au lancement

| Rôle | Principal | Fallback | Critère de choix |
|---|---|---|---|
| **LLM** | Claude (`claude-opus-5` / `claude-sonnet-5`) | Gemini | fiabilité du format structuré, prompt caching |
| **Image** | Modèle image Google (classe Nano Banana Pro) | Adobe Firefly | Firefly comme option « commercially safe » indemnisée pour les comptes entreprise |
| **Vidéo** | Veo 3.1 (classe premium, audio natif) | Gemini Omni Flash (rapide/économique), Kling (fallback) | audio natif + fidélité d'identité |
| **Voix** | ElevenLabs | Cartesia | couverture linguistique, latence |
| **Lip-sync** | provider dédié (chemin B) | — | uniquement si modèle vidéo sans audio natif |
| **Musique** | bibliothèque sous licence | génération IA (V1) | le risque de droits sur la musique générée est encore mal stabilisé — on commence par du licencié |

**Note stratégique :** ce tableau est périmé dans six mois. C'est précisément l'argument de
l'abstraction. Le **descripteur de capabilities vit en base de données** : ajouter un provider
doit être un adaptateur (≈ 200 lignes) + une ligne SQL, **pas un déploiement du cœur**. Cette
propriété est un critère d'acceptation de la Phase 05 du build order.

---

## R · Storage Architecture

**Décision : Cloudflare R2 comme stockage objet principal.**

**Pourquoi pas S3 :** l'egress. Nous servons des vidéos, plusieurs fois par publicité
(aperçus, révisions, téléchargements, variations). À 0,09 $/Go, S3 facturerait l'egress plus
cher que le stockage lui-même. **R2 a un egress à zéro.** Sur un produit vidéo, c'est une
différence structurelle, pas une optimisation. S3 reste supérieur pour l'intégration à
l'écosystème AWS — que nous n'utilisons pas au cœur.

```
BUCKETS
  uploads/       fichiers utilisateur bruts        · privé · scan antivirus
  characters/    images de référence, sheets       · privé · longue durée
  generations/   clips bruts des providers         · privé · TTL 90 j (tier draft : 14 j)
  renders/       exports finaux                    · privé · durée de vie du compte
  public/        vignettes, aperçus musique        · CDN
```

**Règles :**

- **Aucun objet n'est public.** Tout accès passe par une URL signée, expirant en 15 minutes,
  émise après vérification d'appartenance au tenant.
- **Uploads directs** par URL présignée — le fichier ne transite jamais par l'API.
- **Chemin déterministe :** `{workspaceId}/{kind}/{yyyy}/{mm}/{assetId}.{ext}` — l'isolation
  est lisible dans le chemin, ce qui rend les erreurs d'autorisation détectables à l'œil.
- **Cycle de vie :** les clips bruts en tier draft sont purgés à 14 jours (ils sont
  régénérables et représentent l'essentiel du volume). Les rendus finaux sont conservés.
  Cette seule règle divise la facture de stockage par ~4.
- **Provenance :** chaque asset porte `provenance` (provider, modèle, prompt hash, date) et
  les rendus finaux sont signés **C2PA**. Coût : faible. Bénéfice : conformité EU AI Act et
  argument de vente entreprise.

---

## S · Security Architecture

### S1 · Authentification

**Décision : Clerk pour le MVP, derrière une interface `AuthProvider`.**

Arbitrage assumé : Clerk coûte par utilisateur actif, mais fournit organisations, invitations,
SSO et MFA en quelques jours. **Sur un produit dont le COGS variable est de 8 à 50 $ par
publicité, économiser 0,02 $/MAU d'authentification est une erreur de priorité.** L'interface
d'abstraction permet de migrer vers Better Auth ou WorkOS quand le volume le justifie —
typiquement au-delà de 20 000 MAU ou à l'arrivée d'exigences SSO entreprise.

### S2 · Autorisation

Modèle RBAC simple, appliqué **deux fois** :

```
owner   tout, y compris facturation et suppression du workspace
admin   tout sauf facturation
editor  créer et modifier des publicités, ne peut pas inviter
viewer  lecture et téléchargement uniquement
```

- **Couche applicative** : middleware de politique sur chaque route.
- **Couche base de données** : **Row-Level Security PostgreSQL**, `workspace_id` posé dans le
  contexte de session. Un oubli de `WHERE workspace_id = ?` ne peut alors pas fuiter des
  données d'un autre tenant. C'est une ceinture *et* des bretelles, et c'est justifié : la
  fuite inter-tenant est le seul incident qui tue un SaaS B2B.

### S3 · La checklist

| Risque | Contre-mesure |
|---|---|
| Fuite inter-tenant | RLS + `workspace_id` obligatoire dans chaque requête + tests d'isolation en CI |
| Accès direct aux médias | URLs signées expirantes uniquement, jamais de bucket public |
| Fuite de clés provider | Secrets en KMS/Secrets Manager, jamais en variables d'environnement de conteneur applicatif, rotation trimestrielle, chiffrement des clés API tenant au repos |
| Falsification de webhook | HMAC-SHA256 + horodatage + fenêtre anti-rejeu de 5 min |
| Abus / brûlage de crédits | Rate limiting par IP, utilisateur et workspace + les 4 verrous de §G5 |
| Upload malveillant | Vérification du type MIME réel (magic bytes), limite de taille, analyse antivirus, ré-encodage systématique des médias |
| Injection de prompt via contenu crawlé | Le contenu crawlé est traité comme **données non fiables** : jamais concaténé dans les instructions système, toujours encadré et étiqueté ; les sorties sont validées par schéma |
| Usurpation d'identité (deepfake) | Détection de visage à l'ingestion, attestation de droits, refus des correspondances de célébrités, C2PA sur les sorties |
| Claims interdits | Liste par verticale + validation bloquante au QC final |
| Exfiltration par API key | Portée limitée, expiration, journal `last_used_at`, révocation immédiate |

### S4 · Conformité

RGPD (base légale, minimisation, effacement, registre des traitements, DPA avec chaque
sous-traitant IA), **EU AI Act art. 50** (divulgation des contenus synthétiques : C2PA +
option de mention visible), droit à l'image (§00.3), politiques Meta/TikTok sur les médias
synthétiques, et résidence des données UE en option — d'où le champ `regions` dans les
capabilities des providers.

---

## T · Cost Architecture

### T1 · La réalité économique, sans enjolivement

C'est la section la plus importante du document pour la survie de l'entreprise.

```
COÛTS PAR PUBLICITÉ DE 30 s (6 clips)     · ordres de grandeur, à re-benchmarker

IA texte (stratégie, script, QC, plan)     0,20 – 0,60 $
Génération vidéo · DRAFT      6×5s×0,08     ≈ 2,40 $
Génération vidéo · STANDARD   6×5s×0,20     ≈ 6,00 $
Génération vidéo · PREMIUM    6×5s×0,45     ≈ 13,50 $
Facteur de régénération réel                × 1,6 – 2,2
Voix (si chemin B)                          0,05 – 0,20 $
Rendu (CPU, ~20 s)                          0,01 – 0,03 $
Stockage + livraison (R2)                   ≈ 0,01 $

COGS RÉEL, STANDARD, avec régénérations   ≈  10 – 14 $
COGS RÉEL, PREMIUM, avec régénérations    ≈  22 – 30 $
```

**Trois conséquences non négociables :**

1. **Aucun plan illimité. Jamais.** Un forfait « publicités illimitées à 49 $/mois » perd de
   l'argent au troisième utilisateur actif. C'est l'erreur qui tue ce type de produit.
2. **Le facteur de régénération est le levier n°1.** Le faire passer de 2,0 à 1,4 économise
   30 % du COGS — plus que n'importe quelle négociation tarifaire avec un provider. D'où
   l'investissement massif en amont : validation déterministe du script, QC prédictif,
   contraintes de mots. **Chaque euro dépensé à empêcher une mauvaise génération en économise
   trois.**
3. **Le tier draft doit être le défaut.** L'itération se fait à 2,40 $, le rendu final à 6 $.

### T2 · Les leviers de réduction, par impact décroissant

| # | Levier | Gain | Où |
|---|---|---|---|
| 1 | Validation déterministe avant toute génération payante | −25 à 35 % | N6, §F5 |
| 2 | Draft par défaut, premium sur demande | −40 à 60 % sur l'itération | §H6 |
| 3 | Cache par `input_hash` sur les régénérations | −60 à 80 % du coût d'itération | §N2.3 |
| 4 | Régénération ciblée d'un seul clip (jamais toute la pub) | −83 % par correction | §G2 |
| 5 | Prompt caching LLM sur la Creative Knowledge Base | −70 % du coût texte | §F3 |
| 6 | Routage vers le provider le moins cher à capabilities égales | −10 à 25 % | §H2 |
| 7 | Purge des clips draft à 14 jours | −75 % du stockage | §R |
| 8 | Réutilisation des assets de marque (logo, produit, personnage) | variable, croît avec l'usage | graphe d'assets |

### T3 · L'AI Cost Controller

Un composant, quatre responsabilités :

1. **Estimer avant** — tout job affiche son coût estimé avant d'être lancé, et l'écrit dans
   `jobs.max_cost_cents`.
2. **Réserver** — les crédits sont bloqués avant le premier appel payant.
3. **Attribuer** — chaque `generation` porte son `cost_cents` réel, rattaché à un job, à une
   pub, à un workspace, à un provider. On sait toujours qui a dépensé quoi.
4. **Arrêter** — les quatre verrous de §G5.

**Tableaux de bord internes obligatoires dès le jour 1 :** coût par publicité livrée, coût par
workspace, marge par plan, facteur de régénération par provider, dérive du coût par seconde
générée. Sans ces cinq courbes, on découvre le problème de marge sur le relevé bancaire.

---

## U · Billing & Credits Architecture

### U1 · Décision — crédits prépayés + abonnement

**Décision : abonnement mensuel incluant une allocation de crédits, plus des recharges à
l'unité. Stripe pour l'encaissement, notre grand livre pour la comptabilité des crédits.**

**Alternatives :** (a) facturation à l'usage pure · (b) forfait illimité · (c) usage metering
Stripe natif.

| Option | Verdict |
|---|---|
| Usage pur | Anxiogène : l'utilisateur hésite avant chaque clic, ce qui tue précisément l'itération dont dépend la qualité. Rejeté comme modèle principal. |
| Illimité | Économiquement impossible (§T1). Rejeté. |
| Metering Stripe natif | La latence de synchronisation empêche de bloquer *avant* la dépense. Nous devons refuser une génération en temps réel. **Le grand livre doit être chez nous** ; Stripe encaisse. |
| **Crédits prépayés + abonnement** | L'utilisateur voit un solde, pas un compteur qui tourne. Nous contrôlons la dépense en temps réel. **Retenu.** |

### U2 · Modèle de crédits

**1 crédit = 0,01 $ de COGS interne.** Un ratio simple, stable, et qui survit au changement de
providers : quand un modèle baisse de prix, la grille de crédits reste juste.

```
Génération vidéo DRAFT      · 8 crédits / seconde
Génération vidéo STANDARD   · 20 crédits / seconde
Génération vidéo PREMIUM    · 45 crédits / seconde
Voix                        · 2 crédits / 100 caractères
Rendu / export              · 5 crédits
Stratégie + script          · GRATUIT   ← décision produit délibérée
```

**Pourquoi la stratégie est gratuite :** elle coûte des centimes (§F2) et c'est notre
différenciateur. Un utilisateur doit pouvoir explorer 12 angles et 3 concepts sans réfléchir
au coût. Il ne paie que ce qui est réellement cher : les pixels. C'est aussi ce qui rend
crédible la promesse « votre stratège créatif », plutôt que « votre générateur ».

### U3 · Grille tarifaire — méthode, pas prix arbitraires

Le master prompt demande explicitement de ne pas fixer de prix arbitrairement. La méthode :

```
prix_plan  =  (crédits_inclus × 0,01 $)  ÷  (1 − marge_brute_cible)  +  coût_plateforme

avec marge_brute_cible = 65 % au lancement → 75 % à maturité
     (marge SaaS classique 80 %+ inatteignable ici : notre COGS est réel)
```

| Plan | Crédits/mois | ≈ pubs STANDARD | COGS | Prix indicatif à 70 % de marge |
|---|---|---|---|---|
| **Free trial** | 300 (une fois) | 1 en draft | 3 $ | 0 $ — coût d'acquisition assumé |
| **Starter** | 3 000 | 2-3 | 30 $ | ≈ 99 $ |
| **Pro** | 10 000 | 8-10 | 100 $ | ≈ 299 $ |
| **Business** | 30 000 | 25-30 | 300 $ | ≈ 799 $ |
| **Agency** | 100 000 + sièges + marque blanche | 80-100 | 1 000 $ | ≈ 2 400 $ + par siège |

**À valider impérativement avant lancement :** ces chiffres reposent sur les coûts providers
à la date de rédaction. Il faut **re-benchmarker le coût réel par seconde générée** et mesurer
le **facteur de régénération observé** sur 50 publicités de test. Si le facteur dépasse 2,2,
la grille ne tient pas et il faut retravailler le QC avant de lancer, pas ajuster les prix.

**Règles de fonctionnement :** report des crédits non utilisés limité à un mois (évite
l'accumulation spéculative) · recharges à l'unité avec léger surcoût · alerte à 20 % et 5 %
de solde · jamais de solde négatif · **jamais de coupure en cours de job** — un job démarré
va au bout des crédits réservés.

---

## V · Multi-tenancy

**Décision : base de données partagée, schéma partagé, `workspace_id` sur chaque table
tenant, isolation appliquée par RLS PostgreSQL.**

| Option | Isolation | Coût | Opérations | Verdict |
|---|---|---|---|---|
| Base par tenant | Maximale | Très élevé | Migrations × N | Rejeté (sauf exigence entreprise ponctuelle) |
| Schéma par tenant | Élevée | Moyen | Complexité des migrations, limites de connexions | Rejeté |
| **Ligne par tenant + RLS** | Bonne si rigoureuse | Faible | Simple | **Retenu** |

**Ce qui rend l'approche sûre :**

- RLS activée sur **toutes** les tables portant `workspace_id`, sans exception
- `SET LOCAL app.workspace_id` posé par le middleware à chaque transaction
- Un test d'intégration en CI qui, pour chaque table, tente une lecture cross-tenant et
  **doit** échouer
- Les clés de stockage contiennent le `workspaceId` (§R) — une erreur d'autorisation devient
  visible dans le chemin
- Les caches Redis sont préfixés par `workspaceId`
- La bibliothèque globale de personnages (`workspace_id IS NULL`) est le **seul** partage
  autorisé, en lecture seule, et il est explicite dans la politique RLS

**Hiérarchie :** `Workspace → Brands → Products → Campaigns → Ads → Variations`. Les
personnages, voix et assets vivent au niveau workspace (partagés entre marques), sauf ceux de
la bibliothèque globale.

---

## W · Analytics

Deux systèmes distincts, à ne jamais confondre :

**1 · Analytics produit** (comment le SaaS est utilisé) — PostHog.
Événements clés : `signup`, `brand_created`, `dna_generated`, `concepts_shown`,
`concept_selected` ← **l'événement d'activation**, `generation_started`,
`first_ad_completed` ← **l'activation réelle**, `ad_downloaded`, `variation_created`,
`credits_purchased`, `second_ad_started` ← **le prédicteur de rétention**.

**La métrique nord :** *nombre d'utilisateurs ayant complété une deuxième publicité dans les
14 jours.* La première publicité mesure la curiosité ; la deuxième mesure la valeur.

**2 · Analytics créatives** (comment les publicités performent) — notre base, §K.

**Funnel d'instrumentation obligatoire dès le MVP**, parce que c'est lui qui dira où le
produit casse :

```
signup → brand créé → DNA généré → concepts affichés → concept choisi
       → génération lancée → pub complétée → téléchargée → 2e pub
```

Chaque marche perdue est un problème produit identifiable. Sans ce funnel, on optimise à
l'aveugle.

---

## X · Observability

**Décision : OpenTelemetry comme instrumentation unique · Sentry pour les erreurs ·
Grafana Cloud (ou équivalent) pour traces, métriques et logs.**

**Le trace ID suit la publicité de bout en bout** — de la requête HTTP jusqu'au dernier appel
provider. C'est indispensable : quand un utilisateur écrit « ma pub est bizarre », le support
doit pouvoir ouvrir une trace unique montrant les 15 nœuds, les prompts, les réponses
providers, les scores QC et les coûts.

**Les métriques qui déclenchent une alerte :**

```
MÉTIER          taux de complétion des publicités < 92 %
                temps médian de bout en bout > 12 min
                facteur de régénération > 2,2         ← alerte de marge
                coût moyen par publicité > seuil de plan
PROVIDERS       taux d'erreur par provider > 5 %
                p95 de latence > 2× la ligne de base
                circuit breaker ouvert                ← page immédiate
QUALITÉ         taux d'échec QC par famille
                taux d'échec de vérification audio    ← détecte les coupures de réplique
SYSTÈME         profondeur des files, âge du plus vieux job en attente
                DLQ non vide                          ← page immédiate
                erreurs 5xx, latence API p95
```

**Enregistrement systématique de chaque appel IA** (prompt, réponse, modèle, tokens, coût,
latence, hash) dans un stockage à rétention courte : c'est ce qui rend le débogage de qualité
possible, et c'est la matière première des évals.

---

## Y · Deployment Architecture

**Décision : conteneurs partout, Next.js sur Vercel, API et workers sur un PaaS conteneurisé
(Fly.io ou Railway) au lancement, chemin de sortie vers AWS ECS/EKS documenté.**

```
                        Cloudflare (DNS · WAF · CDN)
                                    │
              ┌─────────────────────┼─────────────────────┐
              ▼                     ▼                     ▼
      ┌──────────────┐      ┌──────────────┐      ┌──────────────┐
      │  web         │      │  api         │      │  R2          │
      │  Next.js     │      │  Fastify     │      │  objets      │
      │  Vercel      │      │  2-N inst.   │      │              │
      └──────────────┘      └──────┬───────┘      └──────────────┘
                                   │
              ┌────────────────────┼────────────────────┐
              ▼                    ▼                    ▼
      ┌──────────────┐     ┌──────────────┐     ┌──────────────┐
      │  Postgres    │     │  Redis       │     │  workers     │
      │  managé      │     │  managé      │     │  0-N (auto)  │
      │  + réplica   │     │              │     ├──────────────┤
      └──────────────┘     └──────────────┘     │  render      │
                                                │  CPU dédié   │
                                                └──────────────┘
```

**Pourquoi ce choix :** l'équipe au lancement fait 3 à 8 personnes. Un cluster Kubernetes
consommerait un mi-temps d'ingénierie pour un bénéfice nul à cette échelle. **Le critère
d'adoption de Kubernetes est organisationnel, pas technique** : quand plusieurs équipes
déploieront indépendamment. Tout étant conteneurisé et sans état, la migration reste un
changement d'orchestrateur, pas une réécriture.

**Environnements :** `local` (Docker Compose : Postgres, Redis, MinIO) · `preview`
(éphémère par PR, providers en mock) · `staging` (providers réels, budget plafonné) ·
`production`.

**Discipline de déploiement :** migrations en avant seulement et rétrocompatibles ·
déploiement bleu-vert de l'API · **drain des workers** (jamais tuer un worker en cours de
job : on cesse de consommer et on attend la fin) · feature flags pour les nouveaux providers
et prompts · rollback en une commande.

---

## Z · Folder Structure

```
afrinext/
├── apps/
│   ├── web/                       Next.js 15 · App Router
│   │   ├── app/                   (marketing) (auth) (app)
│   │   ├── components/            ui · create · editor · brand · character
│   │   ├── lib/                   client tRPC · SSE · hooks
│   │   └── styles/
│   ├── api/                       Fastify
│   │   ├── src/routes/            v1/* · trpc/* · webhooks/*
│   │   ├── src/middleware/        auth · tenant · ratelimit · idempotency
│   │   └── src/plugins/
│   ├── worker/                    consommateurs de files
│   │   ├── src/processors/        brand · strategy · script · video · qc · edit
│   │   └── src/orchestrator/      moteur de DAG · nœuds · compensation
│   └── render/                    workers FFmpeg (Dockerfile distinct)
│       └── src/                   pipelines · ass · concat · normalize
│
├── packages/
│   ├── core/                      entités · machines à états · règles pures
│   │   └── src/                   brand · concept · script · character · ad · credit
│   ├── ai/
│   │   ├── src/nodes/             brand.extract · strategy.angles · script.write · …
│   │   ├── src/knowledge/         Creative Knowledge Base (versionnée)
│   │   │   ├── angles/ awareness/ mechanism/ persuasion/
│   │   │   └── structure/ copy/ production/ compliance/
│   │   ├── src/compilers/         script → ClipPrompt (par famille de provider)
│   │   ├── src/validators/        validation déterministe (durées, mots, claims)
│   │   └── evals/                 jeux de référence · juges · seuils de régression
│   ├── providers/
│   │   ├── src/llm/               claude · gemini
│   │   ├── src/image/             google · firefly
│   │   ├── src/video/             veo · omni · kling
│   │   ├── src/voice/             elevenlabs · cartesia
│   │   ├── src/router/            capabilities · scoring · fallback · breaker
│   │   └── src/errors/            taxonomie normalisée
│   ├── db/                        schéma Drizzle · migrations · RLS · seeds
│   ├── jobs/                      moteur DAG · files · idempotence · retries
│   ├── billing/                   grand livre · tarification · Stripe
│   ├── media/                     ffmpeg · ffprobe · ass · sondes
│   ├── contracts/                 schémas Zod partagés
│   └── observability/             OTel · logger · métriques
│
├── infra/
│   ├── docker/                    Dockerfiles par app
│   ├── compose/                   développement local
│   └── terraform/                 R2 · Postgres · Redis · DNS · secrets
│
├── docs/
│   ├── blueprint/                 ce document
│   ├── adr/                       Architecture Decision Records
│   └── runbooks/                  incidents · panne provider · dépassement de coût
│
└── scripts/                       seed de la bibliothèque de personnages · benchmarks
                                   providers · calculateur de coûts
```

**Trois règles de structure qui comptent :**

1. **`packages/ai/evals` est du code de production, pas un dossier de test.** Il conditionne
   les déploiements.
2. **`packages/providers` ne connaît pas le domaine.** Il ne dépend que de `contracts`. C'est
   ce qui rend l'ajout d'un provider indolore.
3. **`apps/render` a son propre Dockerfile et son propre profil de scaling.** Ne jamais le
   fusionner avec `apps/worker` : les profils CPU sont incompatibles.
