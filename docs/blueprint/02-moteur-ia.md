# 02 · Moteur IA — Sections F → K

---

## F · AI Architecture

### F1 · Principe directeur

> **Un LLM ne produit jamais de texte libre qui doit être re-parsé.** Chaque nœud IA du
> système a un contrat d'entrée typé, un contrat de sortie typé et un validateur
> déterministe. Le markdown est une vue, jamais un format d'échange.

C'est la différence de fond avec les deux skills analysés : ils produisent du markdown pour
un humain. Nous produisons des objets pour un pipeline. Le markdown reste disponible
(export, feuille de prompts téléchargeable) mais il est *dérivé* du JSON, jamais l'inverse.

### F2 · Les nœuds IA du système

| Nœud | Entrée | Sortie (typée) | Modèle recommandé | Coût/appel |
|---|---|---|---|---|
| `brand.extract` | HTML crawlé, images, texte | `BrandDNA` | LLM raisonnement moyen + vision | 0,02–0,08 $ |
| `brand.voc` | `BrandDNA` + avis/commentaires si dispo | `VoiceOfCustomer` | LLM raisonnement fort | 0,03–0,10 $ |
| `strategy.angles` | `BrandDNA` + `VoiceOfCustomer` + objectif + angles déjà joués | `AngleSet` (8-12) | LLM raisonnement fort | 0,05–0,15 $ |
| `strategy.rank` | `AngleSet` + historique de performance | `ConceptCard[]` (3) | LLM moyen + heuristiques | 0,01–0,03 $ |
| `script.write` | `ConceptCard` + `BrandDNA` + contraintes plateforme + grille de durées du provider | `Script` | LLM raisonnement fort | 0,04–0,12 $ |
| `script.review` | `Script` | `ValidationReport` | **déterministe (code)** + LLM en second passage | ~0 $ |
| `prompt.compile` | `Script` + `CharacterSheet` + capabilities provider | `ClipPrompt[]` | **déterministe (templates)** | 0 $ |
| `qc.visual` | frame du clip généré | `VisualQCReport` | modèle vision rapide | 0,002–0,01 $/clip |
| `qc.audio` | piste audio | `AudioQCReport` | ASR + DSP (déterministe) | ~0 $ |
| `qc.marketing` | `Script` + rendu | `MarketingQCReport` | LLM moyen | 0,01 $ |
| `edit.plan` | `Script` + clips + `BrandDNA` | `EditPlan` | LLM moyen + règles | 0,01–0,03 $ |
| `intelligence.patterns` | métriques + métadonnées créas | `PatternSet` | LLM + stats | V2 |

**Coût IA texte total par publicité : ~0,20 à 0,60 $.** Négligeable face aux 8-50 $ de
génération vidéo. **Conséquence d'architecture majeure : on peut se permettre d'être
généreux sur le raisonnement texte et avare sur la vidéo.** Générer 12 angles au lieu de 3,
faire deux passes de review, réécrire un script trois fois — tout ça coûte des centimes et
évite des dizaines de dollars de clips ratés. Le budget doit être déplacé en amont.

### F3 · Sélection des modèles — décision

**Décision :** Claude (`claude-opus-5` pour la stratégie et le script, `claude-sonnet-5`
pour l'extraction, le QC marketing et le plan de montage) comme LLM principal, derrière une
abstraction `LLMProvider`.

**Alternatives :** GPT-class d'OpenAI · Gemini · modèles open-weight auto-hébergés
(Llama/Mistral/Qwen).

**Trade-offs :**

| Option | Pour | Contre |
|---|---|---|
| Claude en principal | Meilleur suivi d'instructions longues et structurées (nos prompts système font 3-8k tokens) ; sorties JSON stables ; prompt caching qui amortit la Creative Knowledge Base injectée | Dépendance fournisseur ; coût > modèles ouverts |
| GPT en principal | Écosystème, function calling mature | Résultats équivalents sur nos tâches, pas d'avantage décisif |
| Gemini en principal | Contexte long, prix agressif, cohérence avec les modèles image/vidéo Google | Moins régulier sur le respect strict de format dans nos tests de référence |
| Open-weight auto-hébergé | Coût marginal ~0, pas de fuite de données | Le coût texte est déjà négligeable (§F2) ; on paierait des GPU pour économiser 0,30 $ par pub. **Mauvais arbitrage.** |

**Recommandation : Claude en principal, Gemini en fallback chaud, abstraction obligatoire.**
Parce que la qualité de la sortie structurée est le facteur limitant, pas le prix, et parce
que le **prompt caching** est décisif : la Creative Knowledge Base représente plusieurs
milliers de tokens réinjectés à chaque appel, et le cache la rend quasi gratuite après le
premier appel.

### F4 · Creative Knowledge Base — le remplacement de `ads-method.md`

`ads-method.md` est notre actif le plus précieux et, sous sa forme actuelle, le moins
exploitable. Refonte :

```
knowledge/
  angles/          12 types · définition · quand l'utiliser · exemples par verticale
  awareness/       5 niveaux Schwartz · 5 niveaux de sophistication · règles de matching
  mechanism/       problem mechanism · solution mechanism · patterns de métaphore
  persuasion/      7 leviers Cialdini · règle du max 2 · paires recommandées
  structure/       transformation A→B · slippery slide · open loops · fascinations
  copy/            spécificité · reason why · dimensionalisation · test « so what »
  production/      grilles de durée · budgets de mots · règles de hook/hold
  compliance/      claims sensibles par verticale · formulations à bannir
```

Chaque fragment est **versionné, adressable, et sélectionné par pertinence** — on n'injecte
pas les 12 types d'angles quand le niveau de conscience est « most aware ». Chaque
modification passe par la **suite d'évals** (§F5).

**Pourquoi ce n'est pas un RAG vectoriel :** le corpus fait quelques dizaines de milliers de
tokens et sa structure est connue et stable. Une sélection par règles (verticale × niveau de
conscience × objectif) est plus prévisible, plus rapide et plus débogable qu'une recherche
sémantique. Le RAG entrera quand le corpus deviendra dynamique — c'est-à-dire quand il
contiendra les patterns issus de la performance réelle (V2).

### F5 · Évaluation — non négociable

Un prompt sans éval est du code sans test. Trois niveaux :

1. **Assertions déterministes** (dans la CI, à chaque commit) : le JSON valide-t-il le
   schéma ? Les durées ∈ {grille provider} ? Les mots ≤ plafond ? Zéro `[bracket]` résiduel ?
   4-7 clips ? 24-40 s ? Aucun claim de la liste interdite ?
2. **LLM-as-judge sur un jeu de référence** (nightly) : 40 produits de référence couvrant
   physique/digital/service/app × 6 verticales. Notation angle-diversité, force du hook,
   présence du mécanisme, adéquation au niveau de conscience. Seuil de non-régression.
3. **Préférence humaine** (hebdomadaire, échantillon) : comparaison par paires sur les
   concepts produits. C'est le seul juge fiable de « est-ce que ça vend ».

**Aucune modification de la Creative Knowledge Base ni d'un prompt système ne part en
production sans passage au vert des niveaux 1 et 2.**

### F6 · Structures de données centrales

```ts
// —— Marque ————————————————————————————————————————————————
type BrandDNA = {
  id: string; brandId: string; version: number;
  voice: { tone: string[]; register: 'formal'|'casual'|'expert'|'playful';
           vocabulary: string[]; forbiddenWords: string[] };
  audience: { primary: Persona; secondary?: Persona;
              markets: string[];            // ISO ; pilote la langue du script
              languages: string[] };
  positioning: string; usp: string[];
  painPoints: string[]; desiredEmotions: string[];
  visualIdentity: { palette: string[]; logoAssetId?: string;
                    styleRefs: string[]; doNotShow: string[] };
  messagingPillars: string[];
  forbiddenClaims: string[];                // légal — bloquant au QC
  ctaPreferences: { type: string; text: string[]; destination?: string }[];
  offer?: { price?: string; guarantee?: string; bonus?: string[];
            urgency?: string; scarcity?: string };
  confidence: Record<string, number>;       // 0-1 par champ : pilote ce qu'on
  assumptions: string[];                    // demande à confirmer dans l'UI
};

type Persona = { ageRange: [number, number]; gender?: string;
                 role: string; context: string; sophisticationLevel: 1|2|3|4|5 };

// —— Stratégie —————————————————————————————————————————————
type VoiceOfCustomer = {
  pains: Claim[]; desires: Claim[]; objections: Claim[];
  clickMoments: Claim[];                    // « ce qui m'a décidé »
};
type Claim = { text: string; source: 'verbatim'|'hypothesis'; sourceUrl?: string };

type Angle = {
  id: string; rank: number;
  type: 'problem'|'identity'|'mechanism'|'benefit'|'objection'|'emotional'
      |'status'|'fear'|'convenience'|'price'|'comparison'|'myth';
  name: string;
  hook: string;                             // ≤ 4 s à l'oral — validé
  emotionalTrigger: string;
  targetSegment: string;
  awarenessLevel: 1|2|3|4|5;
  rationale: string;                        // le « pourquoi ça devrait marcher »
  estimatedStrength: number;                // 0-1
  similarityGroup: string;                  // dédup : 2 angles du même groupe = 1 angle
};

type Mechanism = { culprit: string; problemMechanism: string;
                   solutionMechanism: string; metaphor: string };

// —— Script ————————————————————————————————————————————————
type Script = {
  id: string; angleId: string; conceptId: string;
  language: string;                         // langue du MARCHÉ, pas de l'utilisateur
  platform: 'tiktok'|'reels'|'shorts'|'meta_feed'|'youtube'|'linkedin';
  totalDurationSec: number;
  dominantEmotion: string;
  awarenessLevel: 1|2|3|4|5;
  cialdiniTriggers: string[];               // max 2 — validé
  clips: Clip[];
  editNotes: { pace: string; music: string; subtitleStyle: string };
  whyItConverts: string;
};

type Clip = {
  index: number;
  role: 'hook'|'problem'|'agitate'|'solution'|'mechanism'|'proof'|'benefit'|'cta';
  durationSec: number;                      // ∈ grille du provider sélectionné
  says: string;                             // JAMAIS vide — invariant du système
  wordCount: number;                        // calculé, validé contre le plafond
  seen: string;                             // cadrage et posture
  gesture: string | null;
  gestureTiming: 'before'|'during'|null;    // pilote la position dans le prompt
  onScreenText: string | null;
  overlay: Overlay | null;                  // b-roll PAR-DESSUS, jamais à la place
};

type Overlay = { kind: 'screen_recording'|'product_shot'|'before_after'|'stat_card';
                 assetId?: string; startOffsetSec: number; durationSec: number };

// —— Production ————————————————————————————————————————————
type ClipPrompt = {
  clipIndex: number; durationSec: number;
  text: string;                             // le prompt compilé, une seule ligne
  parts: { camera: string; action: string|null; script: string;
           voice: string; accent: string|null };
  referenceImageAssetId: string;            // la MÊME pour tous les clips
  providerHints: { model: string; aspectRatio: string; fps: number;
                   resolution: string; audio: boolean };
};
```

**L'invariant qui tient tout le système** — hérité directement de `02-script.md` et à ne
jamais casser :

> `Script.clips[i]` ⟶ `ClipPrompt[i]` ⟶ `Generation[i]` ⟶ `EditPlan.timeline[i]`
>
> Un clip dont `says` est vide n'a pas de prompt à écrire. Le b-roll est un `Overlay`, pas
> un clip. Casser ça, c'est arriver en production avec un tiers de la publicité sans rien à
> générer.

---

## G · Creative Orchestrator Architecture

### G1 · Modèle d'exécution — décision

**Décision :** l'orchestrateur est un **DAG explicite persisté en PostgreSQL**, exécuté par
des workers BullMQ, avec états, dépendances et compensation.

**Alternatives :** (a) Temporal · (b) AWS Step Functions · (c) chaînage naïf de jobs BullMQ ·
(d) un agent LLM qui décide des étapes.

| Option | Pour | Contre | Verdict |
|---|---|---|---|
| DAG en base + BullMQ | Inspectable en SQL, débogable par le support, aucun nouveau runtime, reprise partielle triviale, coût nul | On écrit le moteur (≈ 1 500 lignes) | **Retenu pour MVP et V1** |
| Temporal | Durabilité de premier ordre, retries et timeouts natifs, versionnement de workflow | Cluster à opérer, courbe d'apprentissage réelle, modèle mental « code = workflow » qui complique l'inspection produit | **À réévaluer en V2**, quand le DAG dépassera ~20 nœuds ou les workflows dureront > 1 h |
| Step Functions | Managé, visuel | Verrouillage AWS, limites de payload, coût par transition, DX médiocre | Rejeté |
| Chaînage naïf | Trivial | Aucune reprise partielle, aucune visibilité, ingérable dès le premier échec | Rejeté |
| Agent LLM autonome | Flexible | Non déterministe, non testable, non chiffrable, latence imprévisible. **Le pire choix possible pour un pipeline qui dépense de l'argent réel.** | Rejeté sans appel |

**Pourquoi :** notre pipeline est un **graphe fixe** avec des branches connues. Ce n'est pas
un problème d'agent, c'est un problème de workflow. Un agent qui « décide » d'appeler Veo
trois fois est un agent qui coûte 12 $ sans prévenir.

### G2 · Le DAG de production

```
                            ┌─────────────┐
                            │  ad.create  │
                            └──────┬──────┘
                                   ▼
                    ┌──────────────────────────┐
                    │  N1 brand.resolve        │  cache: BrandDNA existant ?
                    │  (crawl · extract · VoC) │  → skip si < 30 j et non modifié
                    └──────────┬───────────────┘
                               ▼
                    ┌──────────────────────────┐
                    │  N2 strategy.angles      │  8-12 angles, dédupliqués
                    └──────────┬───────────────┘
                               ▼
                    ┌──────────────────────────┐
                    │  N3 strategy.rank → 3    │
                    └──────────┬───────────────┘
                               ▼
                    ╔══════════════════════════╗
                    ║  ★ GATE HUMAIN ★         ║  job en WAITING_INPUT
                    ║  choix du concept        ║  TTL 7 j, relance e-mail à 24 h
                    ╚══════════┬═══════════════╝
                               ▼
                    ┌──────────────────────────┐
                    │  N4 character.resolve    │  perso par défaut de la marque
                    └──────────┬───────────────┘  ou choix explicite
                               ▼
                    ┌──────────────────────────┐
                    │  N5 script.write         │  écrit vers la grille de durées
                    └──────────┬───────────────┘  du provider retenu en N6
                               ▼
                    ┌──────────────────────────┐
                    │  N6 script.validate      │  DÉTERMINISTE — bloquant
                    │  durées · mots · says    │  échec → retour N5 (max 2)
                    │  · clips · claims        │  2e échec → escalade humaine
                    └──────────┬───────────────┘
                               ▼
                    ┌──────────────────────────┐
                    │  N7 prompt.compile       │  0 appel LLM, 0 coût
                    └──────────┬───────────────┘
                               ▼
                    ┌──────────────────────────┐
                    │  N8 budget.reserve       │  réservation atomique des crédits
                    └──────────┬───────────────┘  échec → PAUSED_INSUFFICIENT_CREDITS
                               ▼
        ┌──────────┬───────────┼───────────┬──────────┐   parallélisme borné
        ▼          ▼           ▼           ▼          ▼   (2-4 selon le plan)
    ┌───────┐  ┌───────┐   ┌───────┐   ┌───────┐  ┌───────┐
    │ clip1 │  │ clip2 │   │ clip3 │   │ clip4 │  │ clip5 │  N9 video.generate
    └───┬───┘  └───┬───┘   └───┬───┘   └───┬───┘  └───┬───┘
        ▼          ▼           ▼           ▼          ▼
    ┌───────┐  ┌───────┐   ┌───────┐   ┌───────┐  ┌───────┐
    │  QC   │  │  QC   │   │  QC   │   │  QC   │  │  QC   │  N10 qc.clip
    └───┬───┘  └───┬───┘   └───┬───┘   └───┬───┘  └───┬───┘
        │          │      FAIL │           │          │
        │          │           ▼           │          │
        │          │      ┌─────────┐      │          │      régénération
        │          │      │ regen 3 │──────┘          │      CIBLÉE — les
        │          │      └────┬────┘                 │      autres clips
        └──────────┴───────────┴──────────────────────┘      sont conservés
                               ▼
                    ┌──────────────────────────┐
                    │  N11 assets.collect      │  attend TOUS les clips OK
                    └──────────┬───────────────┘  (ou dégradation : voir G4)
                               ▼
                    ┌──────────────────────────┐
                    │  N12 edit.plan           │  EditPlan déclaratif JSON
                    └──────────┬───────────────┘
                               ▼
                    ┌──────────────────────────┐
                    │  N13 render              │  FFmpeg, déterministe
                    └──────────┬───────────────┘
                               ▼
                    ┌──────────────────────────┐
                    │  N14 qc.final            │  ratio · durée · safe zones
                    └──────────┬───────────────┘  · loudness · lisibilité sous-titres
                               ▼
                    ┌──────────────────────────┐
                    │  N15 budget.settle       │  consomme le réservé, rend le reste
                    └──────────┬───────────────┘
                               ▼
                          ✅  ad.ready
```

### G3 · Modèle d'état des nœuds

```
PENDING → READY → RUNNING → ┬→ SUCCEEDED
                            ├→ FAILED_RETRYABLE → (backoff) → READY
                            ├→ FAILED_PERMANENT → compensate → job FAILED
                            └→ WAITING_INPUT ────→ (webhook UI) → READY

Job : DRAFT → QUEUED → RUNNING → WAITING_INPUT → RUNNING →
      ┬→ COMPLETED
      ├→ PARTIALLY_COMPLETED   (dégradation acceptée, §G4)
      ├→ PAUSED_INSUFFICIENT_CREDITS
      ├→ CANCELLED             (par l'utilisateur — libère les crédits réservés)
      └→ FAILED
```

Chaque nœud porte : `attempt`, `maxAttempts`, `idempotencyKey`, `inputHash`, `outputRef`,
`costCents`, `providerRef`, `startedAt`, `endedAt`, `error`.

`inputHash` est central : **si un nœud est relancé avec exactement les mêmes entrées, on sert
le résultat en cache au lieu de repayer.** Sur la régénération d'un clip après édition d'une
réplique, seuls les clips modifiés ont un hash différent — les autres sont gratuits.

### G4 · Dégradation gracieuse plutôt qu'échec

Règle produit : **une publicité à 5 clips sur 6 vaut infiniment mieux qu'une erreur.**

| Situation | Comportement |
|---|---|
| 1 clip échoue définitivement après 2 régénérations | Le montage se fait sans lui, la réplique est réabsorbée par le clip voisin si possible ; sinon la pub est livrée plus courte, marquée `PARTIALLY_COMPLETED`, et **le clip n'est pas facturé** |
| ≥ 2 clips échouent | Le job passe en revue humaine interne (alerte support) et l'utilisateur reçoit un message honnête + crédits restitués |
| Le QC final échoue sur un critère cosmétique | Livraison + avertissement, jamais de blocage |
| Le QC final échoue sur un critère de conformité (claim interdit) | **Blocage** — c'est le seul cas où on refuse de livrer |

### G5 · Contrôle d'emballement — la protection la plus importante du système

Sans garde-fous, un bug de boucle de retry peut coûter des milliers d'euros en une nuit.
Quatre verrous indépendants, tous obligatoires :

1. **Réservation avant exécution** (N8) : aucun appel provider payant ne part sans crédits
   déjà réservés sur le workspace.
2. **Plafond par job** : `maxCostCents` inscrit dans le job à la création. Dépassement =
   arrêt immédiat, pas de « juste un peu plus ».
3. **Plafond par workspace et par fenêtre glissante** (heure / jour / mois), configurable,
   avec valeur par défaut agressive sur les comptes trial.
4. **Kill switch global par provider** — un flag en base coupe instantanément tous les appels
   à un provider (incident de prix, boucle, panne).

Chacun est indépendant : le passage de l'un ne dispense pas des autres.

---

## H · Video Generation Architecture

### H1 · Le problème réel

Les modèles vidéo ne sont pas interchangeables. Ils diffèrent sur : les durées acceptées, la
présence ou non d'audio natif, la qualité du lip-sync, le respect d'une image de référence,
les ratios, la résolution, la latence (30 s à 8 min), le prix (×10 entre tiers), les
politiques de contenu, et la stabilité de l'API. Une interface « plus petit dénominateur
commun » nous ferait perdre exactement ce qui fait la qualité.

### H2 · Décision — abstraction par capabilities

**Décision :** chaque provider déclare un **descripteur de capabilities**, et un **routeur**
choisit le provider en fonction des besoins du clip, du tier demandé et de la santé du
provider. Pas d'interface uniforme rigide.

```ts
type VideoProviderCapabilities = {
  id: string;                               // 'veo-3.1' | 'omni-flash' | 'kling-3' …
  durationsSec: number[] | { min: number; max: number; step: number };
  aspectRatios: string[];
  maxResolution: '720p'|'1080p'|'4k';
  nativeAudio: boolean;                     // génère la voix ? sinon → VoiceProvider + lipsync
  lipSyncQuality: 0|1|2|3;
  referenceImage: { supported: boolean; maxCount: number;
                    identityFidelity: 0|1|2|3 };
  motionControl: { camera: boolean; gestures: boolean };
  promptStyle: 'natural'|'structured';      // pilote le compilateur de prompt
  costPerSecondCents: number;
  p50LatencySec: number; p95LatencySec: number;
  contentPolicy: { faces: boolean; minors: false; brands: 'restricted'|'allowed' };
  regions: string[];                        // résidence des données
};
```

**Le routeur** résout, dans l'ordre :

```
1. FILTRE DUR      capabilities incompatibles → éliminé
                   (durée impossible, ratio absent, politique de contenu)
2. FILTRE SANTÉ    circuit breaker ouvert / taux d'erreur > seuil → éliminé
3. FILTRE TIER     draft → modèles rapides et bon marché
                   final → modèles à haute fidélité d'identité
4. SCORE           w1·qualité + w2·(1/coût) + w3·(1/latence) + w4·succès_historique
                   pondérations par plan tarifaire
5. SÉLECTION       meilleur score ; les 2 suivants deviennent la chaîne de fallback
```

**Alternatives écartées :** (a) un seul provider — risque existentiel de dépendance, prix
subis, panne = produit mort ; (b) interface uniforme « generate(prompt, duration) » — nivelle
par le bas et interdit d'exploiter le lip-sync natif ou la fidélité d'identité, qui sont
précisément nos critères de qualité.

### H3 · Deux chemins de génération

```
CHEMIN A · MODÈLE AUDIO-NATIF          CHEMIN B · SILENCIEUX + VOIX + LIP-SYNC
(Veo 3.1, Omni Flash…)                 (Kling, Runway, Seedance…)

prompt (caméra+action+script+voix)      prompt (caméra+action, sans réplique)
  + image de référence                    + image de référence
        ↓                                        ↓
   1 appel → clip avec voix              clip muet
        ↓                                        ↓
       QC                                VoiceProvider (ElevenLabs / Cartesia)
                                          → piste voix à partir du VoiceProfile
                                                 ↓
                                          LipSyncProvider → clip synchronisé
                                                 ↓
                                                QC

Moins d'étapes, moins de points          Contrôle fin de la voix, réutilisable,
d'échec, latence plus faible.            moins cher par seconde, meilleur multi-
Voix moins contrôlable, non              lingue. Plus de latence, plus d'étapes.
réutilisable entre clips.
```

**Recommandation : chemin A par défaut (MVP), chemin B disponible dès V1** et obligatoire
pour le multilingue, la voix de marque personnalisée et les marchés où le modèle audio-natif
ne couvre pas la langue.

### H4 · Cohérence du personnage — le vrai problème technique

Réinjecter la même image de référence, comme dans le workflow analysé, donne une cohérence
*approximative* : la coiffure dérive, l'âge apparent bouge, la tenue change entre clips. Sur
6 clips, ça se voit. Cinq mécanismes cumulés :

1. **Image de référence identique** sur tous les clips (le minimum, déjà fait par le workflow)
2. **Ancrage textuel** — les mêmes descripteurs d'apparence, **verbatim**, dans chaque prompt,
   issus de la `CharacterSheet` (jamais reformulés par un LLM)
3. **Verrouillage décor et tenue** — un `SceneLock` figé pour toute la publicité
4. **Voix identique caractère pour caractère** dans chaque prompt (règle déjà présente dans
   `03-video-prompts.md` — excellente, on la garde telle quelle)
5. **QC d'identité** — similarité d'embedding facial entre le clip généré et l'image de
   référence ; en dessous du seuil, régénération automatique avec seed alternative

Le point 5 est ce qui manque totalement au workflow source, et c'est celui qui transforme
« souvent cohérent » en « cohérent ».

### H5 · Contrôle qualité — les quatre familles

| Famille | Vérifie | Méthode | Coût |
|---|---|---|---|
| **Visuel** | mains/doigts, visage, yeux, artefacts, texte parasite, produit visible, résolution | échantillonnage de 3-5 frames + modèle vision + heuristiques | ~0,005 $/clip |
| **Identité** | est-ce le même personnage que la référence ? | embedding facial + distance cosinus | ~0 $ |
| **Audio** | réplique complète (non coupée), synchronisation labiale, loudness, bruit, prononciation | ASR + comparaison au `says` attendu + mesure LUFS | ~0,002 $/clip |
| **Marketing** | hook en 1 s, clarté, CTA unique, cohérence de marque, claims | LLM sur script + rendu | ~0,01 $/pub |
| **Plateforme** | ratio, durée, safe zones, sous-titres lisibles, résolution | déterministe (FFprobe + géométrie) | 0 $ |

**La vérification audio la plus rentable :** transcrire le clip généré et comparer au `says`
attendu. Si la fin manque, la génération a coupé la phrase — c'est l'échec n°1 en pratique,
il est détectable pour 0,002 $ et il évite de livrer une pub cassée. C'est exactement ce que
la table de budget de mots de `02-script.md` cherche à prévenir en amont ; ici on le vérifie
en aval.

### H6 · Tiers de génération — le levier économique principal

```
DRAFT           modèle rapide · 480-720p · sans audio ou voix TTS bas coût
                ~0,08 $/s   →   pub 30 s ≈ 2,40 $
                usage : aperçu, itération d'angle, tests A/B de hook

STANDARD        modèle équilibré · 720p · audio natif
                ~0,20 $/s   →   pub 30 s ≈ 6 $
                usage : production courante

PREMIUM         meilleur modèle · 1080p · fidélité d'identité maximale
                ~0,45 $/s   →   pub 30 s ≈ 13,50 $
                usage : créa destinée à du budget média significatif
```

**Le parcours par défaut génère en DRAFT jusqu'à la validation du concept, puis rend en
STANDARD.** Cette seule règle divise le COGS par 2 à 3 sur les utilisateurs qui itèrent —
c'est-à-dire tous. Elle doit être dans le MVP, pas dans une optimisation ultérieure.

---

## I · Avatar / Character System

### I1 · Le personnage comme entité, pas comme fichier

```ts
type CharacterSheet = {
  id: string; workspaceId: string | null;   // null = bibliothèque globale
  name: string; version: number;
  origin: 'library'|'generated'|'consented_clone';
  consent?: { documentAssetId: string; signedAt: string;
              subjectName: string; scopeExpiresAt: string | null };

  identity: {                               // les 6C, structurés
    apparentAge: [number, number];
    gender: string; ethnicity?: string;     // dérivé de l'AUDIENCE, pas d'un défaut
    face: string; hair: string; skin: string; body: string;
    distinctiveFeatures: string[];          // ancrages verbatim, jamais reformulés
  };
  wardrobe: { default: string; variants: Record<string, string> };
  setting:  { default: string; variants: Record<string, string> };
  camera:   { defaultFraming: string; lensLook: string };
  lighting: string;
  voiceProfile: {
    descriptor: string;                     // verbatim dans chaque prompt
    accent: string | null;
    providerVoiceId?: string;               // si chemin B (§H3)
    language: string;
  };
  personality: { vibe: string; speakingStyle: string; gestureRepertoire: string[] };

  anchors: {                                // ce qui garantit la continuité
    referenceImageAssetId: string;
    faceEmbedding: number[];                // pour le QC d'identité
    seedHint?: number;
  };
  usageRights: { commercial: boolean; territories: string[]; expiresAt: string|null };
};
```

**Pourquoi structuré plutôt qu'un prompt texte :** c'est ce qui rend le mode CHANGE-ONLY
fiable. « Change seulement la tenue » = modifier `wardrobe.default` et **recompiler**. Les
autres champs sont recopiés à l'octet près, par du code, pas par la bonne volonté d'un LLM.
Le skill `avatar-6c-prompt-engine` a la bonne méthode ; il lui manque la structure.

### I2 · Trois origines, une seule politique

| Origine | Comment | Droits | Disponible |
|---|---|---|---|
| **`library`** | Générés en interne à partir de prompts, sans référence photographique d'une personne réelle. Validés, figés, versionnés. | Propriété de la plateforme, licence commerciale accordée à tous les tenants | MVP — 12 à 20 personnages |
| **`generated`** | L'utilisateur décrit ou ajuste ; nous générons à partir de la bibliothèque ou de zéro | Propriété du workspace | V1 |
| **`consented_clone`** | Le visage de l'utilisateur ou d'un modèle sous contrat, avec preuve de consentement horodatée et auditable | Propriété du workspace, périmètre et durée limités | V1 |

**Aucune quatrième voie.** L'upload d'une photo de tiers passe par une détection de visage →
demande d'attestation de droits → refus si absence. Voir §00.3 pour le détail juridique.

### I3 · Composition de la bibliothèque (MVP)

Non pas « ce que nous trouvons joli », mais **une couverture de marché** :

```
âges        20-25 · 26-34 · 35-45 · 46-60
genres      féminin · masculin · non spécifié
registres   pro/expert · casual/relatable · luxe/premium · jeune/énergique
contextes   bureau · maison · extérieur urbain · atelier/boutique · voiture
origines    couverture représentative des marchés cibles réels
```

Minimum viable : **16 personnages** (4 âges × 2 genres × 2 registres) avec chacun 2 tenues et
2 décors. Cible V1 : 60.

**Note critique sur le biais.** Le skill source impose « European model-level beauty » en dur.
C'est à la fois un choix d'équité discutable et une **erreur commerciale** : la persuasion en
UGC repose sur le levier *liking* de Cialdini — « on achète à des gens qui nous ressemblent »
(§06 de la méthode). Un personnage qui ne ressemble pas à l'audience convertit moins. La
sélection du personnage doit donc être dérivée de `BrandDNA.audience`, jamais d'un défaut
esthétique codé en dur.

### I4 · Sélection automatique

```
BrandDNA.audience (âge, genre, marché, registre)
        + objectif (vendre → relatable · notoriété → aspirationnel)
        + verticale (B2B SaaS → pro · beauté → lifestyle)
        + performance historique du workspace [V1]
                    ↓
        4-6 personnages proposés, le premier pré-sélectionné
```

L'utilisateur peut toujours passer outre. Son choix devient le défaut de la marque, et
**c'est un signal fort** : dès la deuxième publicité, l'étape disparaît.

### I5 · No-Face Mode

Huit variantes, toutes construites sur le même pipeline — ce qui change, c'est le compilateur
de prompt et l'`EditPlan`, pas l'architecture :

| Mode | Ce qui est généré | Voix | Note |
|---|---|---|---|
| **AI Presenter** | personnage complet | native ou TTS | le mode par défaut |
| **Hands Only** | mains manipulant le produit | voix off | excellent pour le e-commerce physique |
| **POV** | vue à la première personne | voix off | fort taux de rétention sur TikTok |
| **Product Demo** | plans produit animés | voix off | ne nécessite aucun personnage |
| **Lifestyle** | scènes d'usage, personnages de dos/flous | voix off | |
| **Voice Only** | b-roll + texte animé | voix off | le moins cher — pas de génération de personnage |
| **Text Story** | typographie animée + musique | aucune | quasi gratuit, très efficace en organique |
| **Virtual Customer** | témoignage d'un personnage de la bibliothèque | native | attention : marquage « acteur » obligatoire |

**Contrainte structurelle :** en mode voix off, l'invariant « chaque clip est le personnage
qui parle » ne tient plus. Le Script Engine bascule alors sur un second format, `VOScript`,
où les clips portent `voiceover` + `visual` au lieu de `says` + `seen`. **Deux formats, deux
compilateurs, un seul orchestrateur** — le reste du pipeline est inchangé.

---

## J · AI Editor Architecture

### J1 · Décision fondatrice — Edit Plan déclaratif

**Décision :** le montage est un **document JSON déclaratif** (`EditPlan`), produit par l'IA
et rendu par un moteur **déterministe**. L'IA ne « fait » jamais le montage ; elle écrit le
plan.

**Alternative observée dans la vidéo :** un agent conversationnel qui monte (« ajoute des
sous-titres et un zoom à chaque changement de clip »). C'est séduisant en démo et intenable
en production : non reproductible, non versionnable, non testable, impossible à corriger
finement, et chaque modification relance un LLM.

**Notre approche conserve l'ergonomie de l'agent sans ses défauts :** l'utilisateur peut
toujours écrire « mets des sous-titres plus gros » — mais le LLM **édite le plan**, et c'est
le moteur déterministe qui rend. Même UX, résultat reproductible, diff visible, annulation
gratuite.

```ts
type EditPlan = {
  version: number; adId: string;
  canvas: { aspectRatio: '9:16'|'1:1'|'4:5'|'16:9'; width: number; height: number; fps: 30 };
  tracks: {
    video:     VideoClipRef[];              // les clips générés, dans l'ordre du script
    overlays:  OverlayItem[];               // b-roll, screen recordings, before/after
    text:      TextItem[];                  // hooks, on-screen text, CTA
    subtitles: SubtitleTrack;               // mot à mot, style issu du Brand DNA
    music:     MusicItem[];
    sfx:       SfxItem[];
    branding:  BrandingItem[];              // logo, couleurs, end card
  };
  transitions: TransitionItem[];            // dont le « zoom à chaque changement de clip »
  audio: { duckingDb: number; targetLufs: -14; normalize: true };
  safeZones: { top: number; bottom: number };  // par plateforme
};
```

### J2 · Génération automatique du plan

L'`EditPlan` n'est presque pas « inventé » : il est **dérivé** du `Script`, qui contient déjà
tout ce qu'il faut.

```
Script.clips[i].onScreenText   → tracks.text[i]
Script.clips[i].overlay        → tracks.overlays[i]  (timing et durée déjà présents)
Script.clips[i].says           → sous-titres, alignés par ASR sur l'audio réel
Script.editNotes.pace          → durées de transitions
Script.editNotes.music         → sélection dans la bibliothèque musicale
BrandDNA.visualIdentity        → police, couleurs, position du logo
platform                       → safe zones, ratio, style de sous-titres
Script.clips[last].role='cta'  → end card
```

Le LLM n'intervient que pour les choix esthétiques résiduels (quel morceau, quelle intensité
de transition) — et ses choix sont bornés par des énumérations, pas libres.

### J3 · Moteur de rendu — décision

**Décision :** FFmpeg dans des workers conteneurisés, sous-titres et texte via **ASS**
(sous-titres avancés) pour le MVP ; **Remotion** ajouté en V1 pour les compositions de marque
riches.

| Option | Pour | Contre |
|---|---|---|
| FFmpeg + ASS | Rapide (rendu 30 s en ~10-20 s CPU), très peu cher, déterministe, sans navigateur | Typographie et animations limitées ; l'ASS est austère à écrire |
| Remotion (React → vidéo) | Composition riche, animations libres, réutilise nos compétences front | Chromium headless par frame : 5 à 15× plus lent et plus cher ; empreinte mémoire élevée |
| Shotstack / Creatomate (API) | Zéro infrastructure | Coût par rendu, dépendance sur le cœur du produit, contrôle limité |
| Éditeur navigateur (WebCodecs) | Aperçu instantané | Ne remplace pas le rendu final ; incompatibilités navigateurs |

**Recommandation : FFmpeg pour la V1 du rendu, aperçu navigateur en lecture composite
(les clips joués dans l'ordre avec overlays DOM) pour l'itération instantanée, Remotion
introduit uniquement pour les templates de marque premium.** L'aperçu navigateur est ce qui
donne la sensation « temps réel » sans payer un rendu à chaque modification.

### J4 · Timeline utilisateur

**MVP :** pas de timeline. Une liste de clips, chacun avec `↻ regénérer`, `✎ modifier la
réplique`, `⇄ autre prise`, plus des réglages globaux (sous-titres, musique, CTA, ratio).
C'est 90 % de la valeur pour 10 % du travail.

**V1 :** timeline multi-pistes en lecture/écriture, alimentée par l'`EditPlan` — l'UI édite
le JSON, jamais la vidéo. C'est ce qui permet à l'agent conversationnel et à la souris de
coexister sans conflit.

---

## K · Creative Intelligence

### K1 · Avertissement honnête

C'est la couche la plus séduisante à concevoir et la plus facile à construire trop tôt. Elle
exige trois choses qu'on n'a pas au lancement :

1. **Du volume** — au moins ~500 créas diffusées avec métriques exploitables avant qu'un
   pattern ne soit statistiquement autre chose qu'une illusion
2. **Des connecteurs** — API Marketing Meta et TikTok, avec OAuth, revue d'application et
   maintenance permanente
3. **De la volonté utilisateur** — expérience du marché : une minorité seulement connecte
   son compte publicitaire

**Recommandation : concevoir le schéma maintenant, brancher l'ingestion en V1, ne livrer les
recommandations qu'en V2, et ne jamais promettre de « ROAS prédictif ».** Une promesse
prédictive invérifiable détruit la confiance plus vite qu'elle ne convertit.

### K2 · Ce qui est mesurable et exploitable

```
INGESTION                      ATTRIBUTION                  PATTERNS
──────────                     ───────────                  ────────
Meta Ads API      ┐            chaque créa porte            angle × verticale
TikTok Ads API    ├─→ métrique  · angleType                 hook (type, longueur)
CSV manuel        │  par créa   · hookType                  personnage (âge/genre)
Pixel/UTM         ┘             · characterId               durée, rythme
                                · durationSec               position du CTA
CTR · CPC · CPA                 · platform                  niveau de conscience
ROAS · hook rate                · awarenessLevel
hold rate · CVR                 · cialdiniTriggers
```

**Les deux métriques qui pilotent réellement l'itération** (§09 de la méthode) :

- **Hook rate** (% au-delà de 3 s) → si mauvais, on change le hook, **rien d'autre**
- **Hold rate** (% jusqu'à la fin) → si mauvais, on change le rythme et le milieu de script

Ce diagnostic est directement actionnable par le produit : « votre hook rate est à 18 %,
la médiane de votre verticale est 26 % — voici 3 nouveaux hooks pour le même corps » →
un bouton, une génération partielle (seul le clip 1 est régénéré), un coût de 1 $.

**C'est le cœur de la boucle de rétention et c'est peu coûteux à produire** — parce que
l'architecture modulaire (§09, « créatif modulaire ») permet de ne régénérer qu'un clip.

### K3 · Statistiques honnêtes

Avec 20 créas, aucun pattern n'est significatif. Règles :

- Seuil minimum d'impressions et de conversions avant d'afficher un pattern
- Intervalles de confiance affichés, jamais un chiffre nu
- Comparaison à la médiane de la verticale (données agrégées et anonymisées, opt-in explicite)
- Formulation prudente : « les angles *mécanisme* ont eu un hook rate supérieur sur 7 de vos
  9 créas » — jamais « les angles mécanisme convertissent 40 % mieux »

### K4 · Pourquoi c'est le moat

Chaque publicité produite enrichit trois graphes : le graphe d'assets de la marque, le graphe
angle→performance du workspace, et le graphe agrégé anonymisé de la plateforme. Un concurrent
peut copier l'UI en trois mois, louer les mêmes modèles le jour même — mais il ne peut pas
copier « ce qui a marché pour vos 340 publicités ». **Cette donnée n'existe qu'ici et elle
grandit toute seule.** C'est le seul avantage de cette liste qui ne soit pas copiable.
