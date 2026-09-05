# 08 · M02 — Produit et marché (sections 17 → 25)

---

## 17 · MVP Stress Test — trois versions, une décision

### 17.1 · Les quatre contraintes que le MVP doit satisfaire simultanément

1. Assez petit pour être construit · 2. Assez impressionnant pour être vendu ·
3. Assez automatisé pour démontrer la vision · 4. Assez économique pour tester le business.

Le MVP du M01 échouait sur le point 2 (pas de produit en scène, pas de WOW avant la minute 9)
et sur le point 4 (COGS 8× le marché). Trois options :

### 17.2 · Comparaison

| | **MVP A — ultra minimal** | **MVP B — complet raisonnable** | **MVP C — WOW-first, étroit** |
|---|---|---|---|
| **Contenu** | URL → Brand Memory → 12 angles → 3 concepts → script → **feuille de prompts à copier**. Aucune vidéo produite par nous. | Le pipeline complet du M02 : chemin C, 4 personnages, produit en scène, montage, variations, 2 verticales, 2 formats, multi-marché | URL → Brand Memory → 3 concepts **gratuits sans compte** → 1 publicité complète (chemin C, produit incrusté) → 3 variations de hook. **1 verticale, 1 marché, 1 format** |
| **Délai** | 3-4 semaines | 14-18 semaines | **8-11 semaines** |
| **Difficulté** | faible | élevée | moyenne |
| **COGS / pub** | 0 (aucune génération) | ~0,60-1,00 $ | ~0,50-0,90 $ |
| **Investissement initial** | ~0 | banque de plans 4 persos + 2 verticales | **banque de plans 4 persos, 1 verticale** |
| **Risque** | ne teste **rien** de ce qui est risqué (qualité vidéo, coût, cohérence) | le risque est de découvrir trop tard que le chemin C n'est pas assez beau, après 4 mois | contenu : la qualité du chemin C est tranchée dès la P0, avant de construire |
| **Effet WOW** | ★★☆☆☆ — impressionne un marketeur, pas un entrepreneur | ★★★★★ | ★★★★★ **sur son segment** |
| **Vendable ?** | non — c'est un consultant, pas un produit | oui | **oui** |
| **Ce qu'il valide** | la qualité stratégique uniquement | tout, mais tard | **les 4 inconnues + la disposition à payer** |

### 17.3 · Décision

> **MVP C.**

**Pourquoi pas A :** il évite précisément les risques qu'il faut lever. Une belle stratégie
livrée sous forme de prompts à copier-coller, c'est le workflow de la vidéo source avec une
interface — nous savons déjà que ça marche, et nous savons déjà que ça ne se vend pas comme
un SaaS premium.

**Pourquoi pas B :** il ajoute multi-verticale, multi-format et multi-marché *avant* d'avoir
prouvé qu'une seule combinaison fonctionne. Chacun de ces axes multiplie la surface de test
et l'investissement en banque de plans, pour zéro information supplémentaire sur la question
qui compte : *est-ce que le résultat est assez bon pour être publié ?*

**Pourquoi C :** il concentre tout l'effort sur la démonstration — le WOW gratuit avant
inscription, une publicité réellement diffusable, et les variations qui transforment l'outil
en habitude. Il est **plus étroit que B et plus impressionnant que B**, parce que l'effort
retiré de la largeur est remis dans la profondeur.

**Le pari explicite de C :** mieux vaut être excellent pour une verticale sur un marché que
correct pour quinze verticales sur le monde entier. Si C ne se vend pas sur son segment, B
ne se serait pas vendu non plus — il aurait juste coûté six semaines de plus pour l'apprendre.

---

## 18 · Le test « URL → publicité »

### 18.1 · Le pipeline complet, avec ses taux de réussite réels

```
                                                    réussite    intervention
                                                    attendue    humaine
https://exemple.com
   ↓
CRAWL                    rendu JS, robots, 403        75-85 %    repli manuel
   ↓
BUSINESS EXTRACTION      secteur, activité, ton       ~95 %      —
   ↓
PRODUCT EXTRACTION       nom, prix, images, variantes 60-90 %*   upload photos
   ↓                     *90 % e-commerce · 40 % services
BRAND ANALYSIS           voix, identité visuelle      ~90 %      correction
   ↓
AUDIENCE INFERENCE       persona, marché, langue      ~80 %      ★ confirmation
   ↓
OFFER DETECTION          prix, garantie, promo        50-70 %    ★ confirmation
   ↓
BRAND MEMORY v1          ─────────────────────────────────────────────────────
   ↓                     ╔═══════════════════════════════════════════════════╗
   ↓                     ║  ★ GATE UNIQUE : « c'est bien votre activité ? »  ║
   ↓                     ║  tout ce qui est marqué ★ ci-dessus est confirmé  ║
   ↓                     ║  ICI, en une fois, en un clic                     ║
   ↓                     ╚═══════════════════════════════════════════════════╝
CREATIVE STRATEGY        12 angles, mécanisme         ~95 %      —
   ↓
CONCEPT                  3 remontés, 1 pré-choisi     —          facultatif
   ↓
SCRIPT                   4-7 scènes, durées, mots     ~95 %      —
   ↓
SCENE SPECIFICATIONS     = le storyboard (§13)        ~98 %      —
   ↓
CHARACTER RESOLUTION     auto depuis audience+marché  ~90 %      facultatif
   ↓
PRODUCT PLACEMENT        S1 compositing               ~85 %      photo si absente
   ↓
SCENE GENERATION         chemin C                     ~92 %/scène —
   ↓
QC                       identité·produit·audio·tech  —          —
   ↓
EDITING                  EditPlan → rendu             ~98 %      —
   ↓
FINAL RENDER
```

### 18.2 · Réponse honnête à la question posée

**Le SaaS doit-il pouvoir produire une publicité exploitable à partir d'une seule URL ?**

- **E-commerce avec de vraies pages produit : oui.** Le seul point d'intervention est la
  confirmation groupée. C'est le cas nominal, et c'est pourquoi le MVP C cible cette
  verticale.
- **Services, restaurants, artisans, professions locales : non, pas seulement avec l'URL.**
  Le site n'a souvent ni photo exploitable, ni prix, ni offre. Il faut **une photo ou deux**.
  Le produit doit le demander explicitement, sans le présenter comme un échec.
- **Site vide, réseaux sociaux uniquement, page en JS pur : non.** Repli sur trois lignes de
  description + upload. Ce chemin doit être **aussi soigné que le chemin nominal**, parce
  qu'il concernera 15 à 25 % des utilisateurs — et davantage sur les marchés où beaucoup de
  PME n'ont pas de site du tout, seulement une page Facebook ou un numéro WhatsApp.

> **Conséquence produit importante pour le positionnement (§20) :** sur un marché où les PME
> n'ont souvent pas de site web, « URL → publicité » n'est pas le parcours principal.
> Le parcours principal devient **« page Facebook / catalogue WhatsApp / 3 photos →
> publicité »**. L'architecture ne change pas — seule la couche d'ingestion s'élargit.

---

## 19 · Multi-vertical — les Vertical Playbooks

### 19.1 · Principe : le playbook est de la donnée, pas du code

Créer une classe `RestaurantAdStrategy` par verticale conduit à quinze branches de code à
maintenir, tester et faire évoluer. **Le cœur du pipeline reste strictement identique ; seule
la connaissance change.**

```ts
type VerticalPlaybook = {
  id: string; vertical: string; version: number; marketCodes: string[] | '*';

  anglePriors: { angleType: string; weight: number; rationale: string }[];
  structureTemplates: { beatSignature: string; weight: number;
                        typicalDurationSec: number }[];
  proofTypes: ('demo'|'before_after'|'testimonial'|'stat'|'screenshot'|'ambience'
              |'menu'|'walkthrough'|'price_comparison')[];
  sceneArchetypes: { purpose: string; environment: string;
                     productPresence: string; camera: string }[];
  ctaTypes: { type: string; channel: string; weight: number }[];
  characterFit: { registers: string[]; ageBands: string[] };
  complianceRules: { forbiddenClaims: string[]; requiredDisclaimers: string[] };
  qualityWeights: Record<string, number>;      // pondérations §08.5
  kpiFocus: ('hook_rate'|'hold_rate'|'ctr'|'messages'|'bookings'|'installs')[];
};
```

### 19.2 · Exemples de divergence réelle entre playbooks

| Verticale | Angle dominant | Preuve | Présence produit | CTA typique |
|---|---|---|---|---|
| **E-commerce** | problème / mécanisme | démonstration, avant-après | `held`, `demonstrated` | acheter, lien |
| **Restaurant** | émotionnel / statut | ambiance, plat en gros plan | `onscreen` (le plat *est* le produit) | réserver, itinéraire, WhatsApp |
| **Immobilier** | bénéfice / statut | visite, plans, quartier | `onscreen` (le bien) | visiter, appeler |
| **SaaS / app** | douleur / mécanisme | capture d'écran, tableau de bord | `demonstrated` (overlay) | essai gratuit, installer |
| **Service local** | confiance / objection | témoignage, avant-après | `none` ou résultat | appeler, WhatsApp |
| **Formation** | identité / transformation | témoignage, résultat chiffré | `none` | s'inscrire, DM |
| **Beauté / mode** | identité / statut | application, port du produit | `applied`, `worn` | acheter |

### 19.3 · Livraison

**MVP : un seul playbook** (e-commerce), plus un playbook générique de repli.
**V1 : cinq.** **V2 : quinze, plus la possibilité pour une agence de créer les siens** — ce
qui devient un argument de rétention fort sur ce segment.

Un playbook est un enregistrement versionné, validé par la suite d'évals au même titre qu'un
prompt (§F5 du M01). **Le classificateur de verticale** (à partir du Brand Memory) sélectionne
le playbook ; l'utilisateur peut le corriger, et cette correction est un événement de Brand
Memory (§10).

---

## 20 · Localisation — le Market Context Engine

### 20.1 · Ce que le brief révèle

> *« Une publicité destinée au Niger ne doit pas nécessairement ressembler à une publicité
> destinée aux États-Unis. »*

Cette phrase règle en grande partie la question de positionnement ouverte en M02 §9 — et
d'une manière plus juste que la formulation que j'avais proposée. **Il ne s'agit pas de
choisir entre « mondial » et « africain ».** Il s'agit de faire du **contexte de marché un
paramètre de premier ordre du produit**, ce qu'aucun concurrent identifié ne fait, puis de
choisir un marché de tête où l'on est le seul.

### 20.2 · L'entité `MarketContext`

```ts
type MarketContext = {
  code: string;                      // 'NE-fr' · 'FR-fr' · 'US-en' · 'SN-fr' · 'MA-ar'
  language: string; accents: string[];
  currency: string; priceFormat: string; typicalPricePoints: number[];

  dominantPlatforms: ('tiktok'|'reels'|'facebook'|'whatsapp'|'youtube'|'snapchat')[];
  dominantDevice: 'mobile'|'desktop'; typicalBandwidth: 'low'|'medium'|'high';

  conversionChannel: 'link'|'whatsapp'|'dm'|'call'|'store'|'app';
  paymentMethods: ('card'|'mobile_money'|'cash_on_delivery'|'bank_transfer')[];

  culturalNotes: {
    formalityDefault: 'tu'|'vous'|'neutral';
    tabooTopics: string[];
    trustSignals: string[];          // ce qui rassure ICI : garantie, témoignage local,
                                     // boutique physique, paiement à la livraison…
    humorStyle: string;
    familyOrIndividualFraming: 'family'|'individual'|'community';
  };

  visualStyle: { settings: string[]; wardrobe: string[]; lighting: string;
                 colorPreferences: string[] };
  characterRepresentation: { ageBands: string[]; appearanceNotes: string };

  compliance: { adDisclosureRequired: boolean; restrictedCategories: string[] };
  kpiDefault: ('messages'|'calls'|'ctr'|'roas')[];
};
```

### 20.3 · Ce que le `MarketContext` paramètre concrètement

| Étage du pipeline | Ce qui change |
|---|---|
| **Script** | langue, registre (`tu`/`vous`), format de prix, signaux de confiance, cadrage familial ou individuel |
| **CTA** | **le canal lui-même** : « lien en bio » vs **« écrivez-moi sur WhatsApp »** avec deep link `wa.me` |
| **Personnage** | sélection par représentativité du marché — enjeu de **conversion** (levier *liking* de Cialdini), pas seulement d'équité |
| **Décor et garde-robe** | un intérieur, une rue, une boutique **du marché servi** — la banque de plans est donc segmentée par marché |
| **Voix et accent** | français d'Afrique de l'Ouest ≠ français de France : ce sont deux profils de voix distincts |
| **Format et poids** | bande passante faible → bitrate et durée adaptés, sous-titres obligatoires |
| **Mesure du succès** | **messages reçus** plutôt que ROAS — mesurable sans API publicitaire, ce qui lève une dépendance majeure |
| **Playbook** | le playbook est sélectionné par `(vertical × market)`, pas par verticale seule |

### 20.4 · Conséquence sur la banque de plans — le point coûteux, dit franchement

Si le personnage, le décor et la voix dépendent du marché, alors **la banque de plans est un
actif par marché**. Quatre personnages pour un marché, ce n'est pas quatre personnages pour
tous les marchés.

C'est un coût réel — et **c'est aussi précisément le moat** : constituer une banque de plans
crédible pour l'Afrique de l'Ouest francophone est un investissement qu'aucun acteur
américain n'a de raison de faire à court terme, et qui ne se copie pas en un week-end.

**Décision : un seul `MarketContext` complet au MVP, mais l'entité existe dès le premier
jour** dans le schéma, dans le script et dans la sélection de personnage. Ajouter un marché
doit être : un enregistrement `MarketContext` + une banque de plans + des profils de voix.
**Jamais une modification du cœur.** C'est le même critère d'acceptation que pour les
providers.

---

## 21 · Agences — l'architecture M01 tient-elle ?

### 21.1 · Le scénario à absorber

100 clients · 500 produits · plusieurs milliers de créas · permissions · crédits ·
duplication de campagne · réutilisation de workflow · export en masse · collaboration.

### 21.2 · Verdict : **non, l'architecture M01 ne le supporte pas.** Trois manques précis

| # | Manque | Conséquence | Correction |
|---|---|---|---|
| **1** | **Il n'y a pas de niveau au-dessus du workspace.** M01 : `Workspace → Brands`. Une agence a besoin de `Organisation → Workspaces (= clients) → Brands`, avec crédits mutualisés et facturation unique. | Une agence de 100 clients devrait créer 100 comptes séparés et 100 abonnements | **Ajouter `organizations` maintenant** — la colonne coûte quasi rien aujourd'hui, la migration coûtera cher plus tard |
| **2** | **Aucune équité de file.** Une agence lançant 500 générations occupe toute la file `q:video` et fait attendre tous les autres clients. | Le « voisin bruyant » dégrade l'expérience de tous, y compris des clients payants | **Ordonnancement équitable par tenant** + classes de priorité par plan. Peu coûteux si fait tôt, très coûteux à rétrofitter |
| **3** | **Rien ne permet de réutiliser un travail.** Chaque publicité repart du parcours complet. | Une agence qui applique la même recette à 40 clients refait 40 fois le même travail | **`CampaignBlueprint`** : un modèle réutilisable figeant objectif, playbook, structure, personnage, style de montage — applicable à N marques en un geste |

### 21.3 · Ce qui, en revanche, tient déjà

RLS et isolation · rôles et permissions (à étendre au niveau organisation) · grand livre de
crédits (à mutualiser) · versioning · API publique.

### 21.4 · Décision

**Les manques 1 et 2 se corrigent dans le MVP à coût quasi nul** (une colonne, une clé de
file). Le manque 3 est une fonctionnalité V1. **Ne pas construire l'offre agence maintenant —
mais ne pas se fermer la porte**, car c'est le segment à la meilleure LTV et au churn le plus
bas.

---

## 22 · Premium UX

### 22.1 · Challenge de la liste d'écrans

La liste proposée compte 13 écrans. **C'est un produit d'expert, pas un produit premium.**
Un produit premium ne se reconnaît pas au nombre d'écrans mais à l'absence d'écrans inutiles.

| Écran proposé | Verdict MVP | Devient |
|---|---|---|
| Dashboard | **oui** | dominé par un seul bouton |
| Brand | **oui** | une fiche, pas une section |
| Products | fusionné | onglet dans Brand |
| Campaigns | **non** | apparaît quand il y a > 5 publicités |
| Create Ad | **oui** | le parcours, pas un écran |
| Creative Concepts | fusionné | une étape du parcours |
| Generation | fusionné | une étape du parcours |
| Review | **oui** | l'écran le plus important du produit |
| Editor | fusionné | des actions dans Review |
| Assets | **non** | V1 |
| Characters | **oui** | mais atteint depuis Review, pas depuis la navigation |
| Analytics | **non** | V2 |
| Billing | **oui** | minimal |

> **Six écrans au MVP : Dashboard · Brand · Create (parcours) · Review · Characters ·
> Billing.** Sept si l'on compte l'écran public d'analyse gratuite.

### 22.2 · Le vocabulaire — un problème premium sous-estimé

« Brand DNA », « concept », « clip », « prompt », « gate », « tier » sont du jargon interne.
Un produit premium parle la langue de son utilisateur.

| Interne | Interface |
|---|---|
| Brand DNA / Brand Memory | **Votre marque** |
| Creative concept | **Idée de pub** |
| Angle | **Approche** |
| Clip / scene | **Séquence** |
| Character | **Présentateur** |
| Regeneration | **Refaire** |
| Credits | **Publicités restantes** (§25) |
| Tier | rien du tout — invisible |

### 22.3 · Les cinq premières minutes

```
0:00  Page d'accueil. Un champ. « L'adresse de votre site, ou décrivez votre activité. »
      Aucune inscription demandée. Aucun choix.
0:10  L'analyse démarre, visible, en streaming. Pas un spinner : du texte qui s'écrit.
0:50  ★ WOW 1 — « Voici ce que vend votre entreprise, à qui, et ce qui bloque vos clients. »
      Trois objections de ses clients, formulées dans leurs mots. Il ne les a jamais écrites.
1:10  ★ GATE — « C'est juste ? » [Oui, continuer] · [Corriger]     ← un clic
1:15  Écriture des idées de pub, en streaming.
2:00  ★ WOW 2 — trois idées de pub, avec leur hook et POURQUOI elles devraient marcher.
      La première est déjà sélectionnée.
2:10  « Créer cette pub » → inscription demandée ICI, et pas avant.
2:40  Génération. La première séquence apparaît à ~1 min. Progression nommée.
4:30  ★ WOW 3 — sa publicité. Son produit. Son message.
5:00  « Créer 3 variantes du hook » — un clic.
```

### 22.4 · La première publicité, puis les dix suivantes

| | Ce qui se passe |
|---|---|
| **1ʳᵉ pub** | Le parcours ci-dessus. Une seule décision. Le produit se présente en se faisant. |
| **2ᵉ pub** | Marque connue, présentateur connu, angles déjà joués mémorisés. `CREATE → objectif → 3 idées → générer`. **Moins de 4 minutes, 20 secondes d'attention.** |
| **3ᵉ à 10ᵉ** | Les variations deviennent le mode d'usage dominant. L'utilisateur ne crée plus des publicités, il **fait tourner un système**. C'est là que naît l'habitude — et le moment où « Campaigns » apparaît naturellement dans la navigation, parce qu'il en a maintenant besoin. |

---

## 23 · Magic vs Control — les trois modes

| | **AUTO** (défaut) | **GUIDED** | **PRO** |
|---|---|---|---|
| **Pour qui** | tout le monde à la 1ʳᵉ publicité | à partir de la 3ᵉ, ou sur demande | agences, marketeurs, power users |
| **Marque** | extraite, confirmée en un clic | éditable champ par champ | éditable + versions + import |
| **Concept** | **auto-choisi et annoncé** | 3 proposés, l'utilisateur choisit | 12 angles visibles, sélection multiple |
| **Script** | invisible, écrit et validé | visible, éditable ligne à ligne | éditable + durées + rôles de scène |
| **Présentateur** | auto | choix parmi 4-6 filtrés | bibliothèque complète + tenue + décor |
| **Scènes** | invisibles | vignettes + bouton « refaire » | `SceneSpecification` éditable, caméra, geste, plan |
| **Montage** | automatique | réglages globaux (sous-titres, musique, CTA) | timeline (V1) |
| **Providers / tiers** | invisibles | invisibles | choix du niveau de qualité, coût affiché |
| **Décisions demandées** | **1** | 4-5 | autant qu'il veut |

**Règle de bascule :** le mode n'est pas un choix imposé à l'inscription — personne ne sait
répondre à cette question avant d'avoir utilisé le produit. Le système **propose** de passer
en GUIDED quand il détecte que l'utilisateur corrige systématiquement la même chose, et en
PRO quand il dépasse un volume. **Le mode est une conséquence observée, pas une question
posée.**

---

## 24 · Moat Map

### 24.1 · Classement par difficulté de copie

| Difficulté | Éléments | Pourquoi |
|---|---|---|
| **Facile** (semaines) | **UI** · **prompts** · bibliothèque d'avatars de surface | Une capture d'écran suffit pour l'UI ; un prompt fuit dès qu'il est affiché ; générer 20 avatars est trivial |
| **Moyen** (mois) | **workflow** · **orchestration** · **provider routing statique** · **vertical playbooks** | De l'ingénierie sérieuse mais reproductible par une bonne équipe qui sait ce qu'elle veut construire |
| **Difficile** (année+) | **Character DNA + banque de plans** · **Product Consistency Engine** · **Brand Memory** · **routing adaptatif** | Demandent du capital de production (tournages), de la donnée d'usage accumulée, et beaucoup d'itérations de qualité invisibles de l'extérieur |
| **Très difficile** (années, ou jamais) | **données de performance propriétaires** · **boucles de rétroaction** · **données de correction utilisateur** · **banque de plans localisée par marché** · **suite d'évals et son historique** | N'existent que par l'usage. Un concurrent qui copie tout le produit démarre avec un historique vide |

### 24.2 · Les trois moats les plus importants

> **1 · Brand Memory et les données de correction.**
> Chaque fois qu'un client corrige une phrase, refuse un concept ou change un présentateur,
> il enrichit un actif qui n'existe que chez nous et qui rend son compte plus difficile à
> quitter chaque semaine. Coût d'implémentation : une table. C'est **le meilleur rapport
> valeur/effort de tout le produit**, et le M01 le jetait.

> **2 · La banque de plans localisée + Character DNA.**
> C'est le seul moat qui soit un **actif capitalisé** au sens comptable : des tournages payés
> une fois, amortis sur des millions de générations. Localisée par marché, elle devient une
> barrière géographique — pas seulement technique. Elle porte aussi, gratuitement, la
> cohérence de personnage et la moitié de notre avantage de coût.

> **3 · Le flywheel Creative DNA → performance.**
> Nous connaissons la structure de chaque publicité **par construction**, pas par
> rétro-ingénierie. Chaque publicité diffusée avec un résultat rapporté est une paire
> (structure, résultat) que personne d'autre ne possède pour ce marché et cette verticale.

### 24.3 · Ce qu'il faut cesser de présenter comme un moat

Le multi-provider · l'architecture · la qualité de l'UI · « nous faisons la stratégie » ·
la taille de la bibliothèque d'avatars. Ce sont des **conditions d'entrée**, pas des
avantages. Les revendiquer devant un investisseur ou un client averti affaiblit le discours.

---

## 25 · Business Model Stress Test

### 25.1 · Les cinq modèles

| | **A · Crédits purs** | **B · Abonnement + quota** | **C · Paiement à la pub** | **D · Abonnement + crédits** | **E · Hybride par palier** |
|---|---|---|---|---|---|
| **Simplicité** | ★★☆ « c'est combien, un crédit ? » | ★★★★★ « 15 pubs par mois » | ★★★★☆ | ★★★☆ | ★★★☆ |
| **Marge** | ★★★★ | ★★★☆ (risque de sur-usage) | ★★★★★ | ★★★★ | ★★★★★ |
| **Prévisibilité (nous)** | ★★☆ | ★★★★★ | ★★☆ | ★★★★ | ★★★★ |
| **Prévisibilité (client)** | ★★☆ | ★★★★★ | ★★★☆ | ★★★★ | ★★★★ |
| **Risque de mauvaise surprise** | **élevé** | **nul** | faible | faible | faible |
| **Freine l'itération ?** | **oui — le pire défaut** | non | **oui** | peu | peu |
| **Adapté aux pics (agence)** | ★★★★★ | ★★☆ | ★★★★ | ★★★★★ | ★★★★★ |

### 25.2 · Le défaut rédhibitoire du modèle à crédits — et donc du M01

Un compteur qui tourne **freine l'itération**. Or l'itération est exactement ce qui produit
une bonne publicité : la méthode elle-même dit que 80 % des créas ne marchent pas et que le
volume bat le génie. **Un modèle tarifaire qui décourage l'essai combat le produit.**

C'est la vraie raison de rejeter la §U du M01 — au-delà de l'argument de lisibilité (F11).

### 25.3 · Recommandation par palier

| Plan | Modèle | Unité affichée | Pourquoi |
|---|---|---|---|
| **Découverte** | gratuit | **analyse illimitée** + 1 publicité filigranée | L'analyse coûte 0,23 $ et fait la vente. La vidéo coûte cher : une seule, marquée |
| **Starter** | **B — abonnement + quota** | « 15 publicités par mois » | Simplicité maximale, zéro surprise, zéro frein à l'itération |
| **Pro** | **B + recharges** | « 50 publicités + packs » | Quota généreux, dépassement possible sans blocage |
| **Business** | **D — abonnement + crédits** | quota + réserve mutualisée | Usage irrégulier, plusieurs marques |
| **Agency** | **E — hybride** | siège + réserve mutualisée à l'organisation + dégressivité | Pics de production, 100 clients, facturation unique |

**Les variations ne consomment pas un quota entier.** Une variation de hook coûte < 0,15 $
(§16.4) : la facturer comme une publicité entière serait absurde et découragerait précisément
l'usage qui crée l'habitude. Règle : **3 variations = 1 publicité au quota.**

### 25.4 · La méthode de prix, corrigée

```
prix_plan = (pubs_incluses × COGS_médian_mesuré) ÷ (1 − marge_cible) + coût_plateforme
```

Avec un COGS médian visé **< 1 $** (§16.4), au lieu des 10-14 $ du M01, la même marge de 70 %
donne des prix **compatibles avec le marché** (Creatify : 39 $ / 5 vidéos, 99 $ / 15 vidéos)
tout en laissant de la place pour un tier premium génératif réellement différencié.

> **Rien de tout cela n'est décidable avant que la phase P0 n'ait mesuré le COGS réel.**
> C'est la raison pour laquelle la facturation reste tardive dans le build order.
