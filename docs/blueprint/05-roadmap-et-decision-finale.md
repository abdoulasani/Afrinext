# 05 · Roadmap, différenciation et décision finale

---

## 1 · MVP — ce qui doit être construit, exactement

**Objectif unique du MVP :** prouver qu'une entreprise peut passer d'une **URL** à une
**publicité vidéo diffusable** en moins de 15 minutes, et qu'elle en refait une deuxième.

**Portée — délibérément étroite :**

| Inclus | Exclu du MVP |
|---|---|
| Ingestion par URL + saisie manuelle de secours | Shopify, catalogues, analyse concurrentielle |
| Brand DNA généré + éditable | Multi-marché, gouvernance, validation |
| 12 angles générés → 3 concepts affichés | Notation calibrée sur données réelles |
| Script 4-7 clips, **15 s et 30 s uniquement** | 45/60 s, multilingue |
| **Une seule plateforme cible : TikTok/Reels 9:16** | Meta feed, YouTube, LinkedIn, ratios multiples |
| Bibliothèque de **16 personnages propriétaires** | Clonage consenti, personnages générés |
| 1 provider vidéo principal + 1 fallback | Routage multi-provider complet |
| Tiers **draft** et **standard** | Premium |
| QC : visuel, identité, audio (ASR), technique | QC marketing avancé, scoring prédictif |
| Régénération ciblée par clip | Timeline éditable |
| EditPlan automatique + rendu FFmpeg (sous-titres, musique, CTA, logo) | Éditeur complet, templates de marque |
| Export MP4 9:16 | Publication vers ads managers |
| Crédits, réservation, plafonds, Stripe | Marque blanche, sièges, API publique |
| Workspace mono-marque, invitations basiques | Rôles fins, SSO |
| Observabilité complète et tableaux de coût | — |

**Ce qui n'est PAS négociable même dans le MVP** (et qu'on est tenté de couper) :

1. **Le grand livre de crédits et les quatre verrous anti-emballement** (§G5). Sans eux, un
   bug coûte des milliers d'euros avant qu'on s'en aperçoive.
2. **La validation déterministe du script** (N6). C'est le levier de marge n°1.
3. **La vérification audio par ASR.** 0,002 $ le clip pour détecter l'échec le plus fréquent.
4. **RLS PostgreSQL.** Se rajouter après coup, c'est une migration douloureuse et une fenêtre
   de risque.
5. **La politique de personnages propriétaires** (§00.3). Rétrofitter la conformité sur une
   base d'avatars illicites est impossible.
6. **Le funnel d'analytics produit** (§W). Sans lui on optimise à l'aveugle.

**Définition de « done » du MVP :** 20 utilisateurs pilotes non accompagnés produisent chacun
au moins 2 publicités, dont ≥ 70 % sont jugées diffusables telles quelles, avec un coût moyen
mesuré et un facteur de régénération < 2,0.

---

## 2 · V1 — après validation

Déclenché uniquement si le MVP atteint sa définition de done.

- **Marque :** Shopify/WooCommerce, catalogue produits, analyse concurrentielle, guidelines
- **Créatif :** 45/60 s, toutes plateformes, tous ratios, multilingue (marché ≠ langue
  utilisateur), variantes de hook natives
- **Personnages :** clonage consenti avec workflow de preuve, personnages générés, tenues et
  décors variables, voix personnalisées
- **Production :** 3+ providers avec routage complet, tier premium, chemin B (voix + lip-sync)
- **Éditeur :** timeline multi-pistes éditant l'`EditPlan`, templates de marque, bibliothèque
  B-roll, agent conversationnel de montage (qui édite le plan, pas la vidéo)
- **Campagnes :** variations 1-clic sur 8 dimensions, arbre de filiation, comparaison
- **Intégrations :** connecteurs Meta et TikTok Ads — **ingestion des métriques uniquement**,
  pas encore de recommandations
- **Équipe :** rôles complets, invitations, commentaires et validation
- **API publique** + webhooks + marque blanche pour les agences

---

## 3 · V2 — les fonctionnalités avancées

- **Creative Intelligence complète** (§K) : patterns, diagnostic hook rate / hold rate,
  « créez 5 nouvelles créas d'après votre pattern gagnant »
- **Génération performance-informed** : les concepts sont classés par ce qui a réellement
  marché pour ce workspace et cette verticale
- **Tests A/B natifs** avec allocation budgétaire suggérée
- **Continuité longue durée** des personnages sur des dizaines de campagnes
- **Publication directe** dans les ads managers
- **Entreprise :** SSO, résidence des données, audit, validation multi-niveaux
- **Benchmarks anonymisés par verticale** (opt-in explicite)

---

## 4 · Future Moat — ce qui rend le produit difficile à copier

Section 23 du master prompt. **La consigne est d'éliminer les avantages facilement copiables.
Faisons-le honnêtement.**

### Ce qui n'est PAS un moat (et qu'il ne faut pas raconter comme tel)

| Prétendu avantage | Pourquoi c'est faux |
|---|---|
| « Les meilleurs modèles IA » | Loués par tout le monde, le même jour |
| « Une belle interface » | Copiable en 3 mois |
| « Rapide et facile » | Tout le monde le dit |
| « Multi-provider » | Une décision d'ingénierie, pas un actif |
| « Bibliothèque d'avatars » | Copiable en quelques semaines de génération |
| « Nos prompts » | Un prompt fuit à la première capture d'écran |

### Ce qui EST un moat, par solidité décroissante

1. **Le graphe angle → performance, par workspace.** « Voici ce qui a marché sur vos 340
   publicités » n'existe nulle part ailleurs et grandit tout seul. Un concurrent démarre à
   zéro même s'il copie tout le reste. **C'est le moat principal.**
2. **Le graphe d'assets de marque.** Brand DNA versionné, personnages, produits, angles déjà
   joués, ce qui a été validé et refusé. Migrer signifie tout reconstruire — coût de
   changement réel et croissant.
3. **La Creative Knowledge Base évaluée.** Pas les prompts (copiables), mais **la suite
   d'évals et la boucle d'amélioration** : les jeux de référence, les seuils de non-régression,
   l'historique de ce qui a dégradé la qualité. C'est deux ans de travail accumulé et
   invisible de l'extérieur.
4. **Les données de coût et de fiabilité par provider.** Quel modèle échoue sur quel type de
   plan, quel facteur de régénération réel, quel prompt style rend le mieux : ça se paie en
   millions de générations, pas en lecture de documentation.
5. **La bibliothèque de personnages propriétaires et consentis.** Copiable techniquement,
   mais l'infrastructure juridique (contrats, consentements, audit) est un vrai fossé pour un
   concurrent qui voudrait vendre à des entreprises.
6. **L'orchestration et la reprise partielle.** Livrer une pub à 5 clips sur 6 plutôt qu'une
   erreur semble un détail ; c'est en réalité des mois d'ingénierie de fiabilité qu'un
   concurrent découvre trois mois après son lancement.
7. **Le coût par publicité livrée.** Si notre facteur de régénération est à 1,4 et celui d'un
   concurrent à 2,2, nous avons 35 % de marge en plus sur le même prix — ou 35 % de prix en
   moins. Un avantage structurel invisible et durable.
8. **L'intégration verticale stratégie → production → performance.** Chaque couche améliore la
   suivante. Un assemblage de 5 outils séparés ne peut pas fermer cette boucle.
9. **Le switching cost opérationnel des agences.** Workspaces clients, marque blanche,
   personnages par client : une agence qui a 40 comptes chez nous ne part pas.
10. **Les effets de réseau de données par verticale** (V2, opt-in) : plus de marques d'un
    secteur → meilleurs benchmarks → meilleures recommandations → plus de marques.

### La réponse aux deux questions du master prompt

**« Pourquoi nous plutôt que 5 outils séparés ? »** Parce que les 5 outils ne se parlent pas.
Le générateur d'images ne sait pas quel angle a été choisi ; le générateur vidéo ne sait pas
que le clip 3 a été refait ; l'éditeur ne sait pas quel est le CTA ; et aucun ne sait ce qui a
performé le mois dernier. **La valeur n'est pas dans les briques, elle est dans l'état
partagé.** C'est exactement ce que démontre le workflow analysé : 4 outils, 0 état partagé,
45 minutes de presse-papier humain pour compenser.

**« Pourquoi continuer à payer chaque mois ? »** Parce que le compte devient plus utile chaque
mois : le Brand DNA s'affine, les personnages sont établis, les angles joués sont mémorisés,
et — à partir de la V2 — le système sait ce qui convertit pour cette marque précise. Un
générateur vaut le même prix le premier et le trentième mois. Notre produit vaut plus cher le
trentième.

---

## 5 · THE RECOMMENDED ARCHITECTURE

```
╔══════════════════════════════════════════════════════════════════════════╗
║  STACK FINALE                                                            ║
╠══════════════════════════════════════════════════════════════════════════╣
║  Frontend      Next.js 15 (App Router) · React 19 · TypeScript strict    ║
║                Tailwind · shadcn/ui · TanStack Query · SSE               ║
║  Backend       Node.js 22 · TypeScript · Fastify                         ║
║                monolithe modulaire + workers séparés                     ║
║  Monorepo      pnpm + Turborepo                                          ║
║  Database      PostgreSQL 16 + pgvector · Drizzle ORM · RLS              ║
║  Cache/Files   Redis · BullMQ                                            ║
║  Orchestration DAG explicite persisté en Postgres (Temporal reconsidéré  ║
║                en V2 si le graphe dépasse ~20 nœuds)                     ║
║  Storage       Cloudflare R2 (egress nul — décisif pour la vidéo)        ║
║  Rendu         FFmpeg conteneurisé + sous-titres ASS                     ║
║                (Remotion en V1 pour les templates de marque)             ║
║  Auth          Clerk derrière une interface AuthProvider                 ║
║  Paiements     Stripe (encaissement) + grand livre de crédits interne    ║
║  IA texte      Claude (opus-5 / sonnet-5) principal · Gemini fallback    ║
║  IA image      modèle image Google · Adobe Firefly (option indemnisée)   ║
║  IA vidéo      Veo 3.1 · Gemini Omni Flash · Kling — via Capability      ║
║                Router, capabilities stockées en base de données          ║
║  IA voix       ElevenLabs · Cartesia                                     ║
║  Observabilité OpenTelemetry → Grafana Cloud · Sentry · PostHog          ║
║  Infra         Conteneurs · Vercel (web) · Fly.io/Railway (api+workers)  ║
║                Cloudflare (DNS/WAF/CDN) · Terraform                      ║
╚══════════════════════════════════════════════════════════════════════════╝
```

**Les six décisions dont tout le reste découle :**

1. **Le pipeline est un DAG explicite, pas un agent.** Déterministe, inspectable, chiffrable.
   Un agent qui décide d'appeler un modèle vidéo trois fois est un agent qui dépense 12 $ sans
   prévenir.
2. **Toute sortie IA est un objet typé et validé.** Le markdown est une vue. C'est ce qui
   sépare un skill d'un produit.
3. **Les providers sont routés par capabilities, déclarées en base.** Ajouter un modèle =
   un adaptateur + une ligne SQL.
4. **Le personnage est une `CharacterSheet` structurée, propriétaire ou consentie.** Jamais un
   sosie d'une personne réelle non consentante.
5. **L'argent est contrôlé avant d'être dépensé** — estimation, réservation, attribution,
   quatre verrous d'arrêt.
6. **Un seul gate humain.** Le choix du concept. Tout le reste est asynchrone.

---

## 6 · BUILD ORDER

Dix phases. Chacune produit quelque chose de démontrable. **Aucune phase ne commence avant
que la précédente n'ait atteint sa définition de done.**

### Phase 01 — Foundation

- **Objectif :** un squelette déployable, multi-tenant et sûr, sans aucune IA.
- **Contenu :** monorepo, `api`/`web`/`worker`/`render`, Postgres + Drizzle + **RLS dès le
  premier jour**, Clerk, workspaces et memberships, R2 et uploads signés, Redis + BullMQ avec
  un job factice, OTel + Sentry + PostHog, CI/CD, environnements de preview.
- **Dépendances :** aucune.
- **Risques :** sous-estimer la RLS et le multi-tenant, et vouloir « le rajouter plus tard ».
  C'est le piège classique et il coûte une migration douloureuse.
- **Done :** deux workspaces coexistent ; un test d'isolation cross-tenant échoue
  correctement pour **chaque** table ; un job traverse la file de bout en bout ; une trace
  complète est visible.

### Phase 02 — Brand Intelligence

- **Objectif :** URL → Brand DNA éditable et persisté.
- **Contenu :** crawler (avec rendu JS), extraction texte et images, `brand.extract`,
  `brand.voc`, versionnement du Brand DNA, UI de correction, chemin de secours manuel,
  traitement du contenu crawlé comme **données non fiables**.
- **Dépendances :** 01.
- **Risques :** sites JS-only, 403 anti-bot, marques trop minces pour en extraire quoi que ce
  soit. **Le chemin de secours manuel n'est pas optionnel** — il sera emprunté par ~20 % des
  utilisateurs.
- **Done :** sur 30 sites réels de verticales différentes, ≥ 80 % produisent un Brand DNA
  jugé exact par un humain ; les 20 % restants basculent proprement sur la saisie manuelle.

### Phase 03 — Creative Engine

- **Objectif :** Brand DNA → 12 angles → 3 concepts → script validé. **Aucune vidéo.**
- **Contenu :** Creative Knowledge Base structurée (portage de `ads-method.md`),
  `strategy.angles` avec déduplication, `strategy.rank`, `script.write`, **`script.validate`
  déterministe**, `prompt.compile`, la suite d'évals (§F5), l'UI des concepts et du gate.
- **Dépendances :** 02.
- **Risques :** angles génériques et interchangeables — le principal risque qualité du
  produit. Mitigation : déduplication par `similarityGroup`, jeu de référence de 40 produits,
  LLM-as-judge sur la diversité, préférence humaine hebdomadaire.
- **Done :** sur 40 produits de référence, ≥ 8 angles réellement distincts par produit ; 100 %
  des scripts passent la validation déterministe ; deux marketeurs indépendants jugent les
  concepts « utilisables » dans ≥ 70 % des cas. **C'est la phase la plus importante du
  produit : c'est elle qui le distingue d'un générateur.**

### Phase 04 — Character System

- **Objectif :** une bibliothèque de personnages exploitable et juridiquement propre.
- **Contenu :** modèle `CharacterSheet`, génération et validation de 16 personnages
  propriétaires, embeddings faciaux, profils de voix, sélection automatique depuis
  `BrandDNA.audience`, détection de visage à l'ingestion, mode no-face (au moins Voice Only et
  Product Demo).
- **Dépendances :** 01 (03 en parallèle possible).
- **Risques :** biais de représentation (voir §I3) · dérive de cohérence entre clips · qualité
  inégale des personnages générés.
- **Done :** 16 personnages couvrant la matrice âge × genre × registre ; sélection automatique
  jugée pertinente dans ≥ 80 % des cas ; embeddings en place et testés.

### Phase 05 — Video Generation

- **Objectif :** ClipPrompt → clip vidéo validé par le QC.
- **Contenu :** Capability Registry en base, Router, deux adaptateurs, chemin A, QC visuel /
  identité / audio (ASR) / technique, régénération ciblée, circuit breaker, tiers draft et
  standard, réservation de crédits, les quatre verrous anti-emballement.
- **Dépendances :** 03, 04.
- **Risques :** **c'est la phase où l'argent réel commence à sortir.** Un bug de retry coûte
  cher immédiatement. Ne jamais déployer cette phase sans les verrous de §G5 actifs et testés.
- **Done :** ajouter un troisième provider = un adaptateur + une ligne SQL, sans toucher au
  cœur ; taux de réussite QC ≥ 85 % au premier essai ; facteur de régénération mesuré et
  affiché dans le tableau de bord interne ; le kill switch coupe un provider en < 5 s.

### Phase 06 — AI Editor & Delivery

- **Objectif :** clips → publicité finale téléchargeable.
- **Contenu :** génération de l'`EditPlan`, rendu FFmpeg, sous-titres ASS alignés par ASR,
  musique sous licence, CTA, logo, safe zones, QC final, export 9:16, aperçu composite dans le
  navigateur.
- **Dépendances :** 05.
- **Risques :** lisibilité des sous-titres selon les plateformes · loudness · temps de rendu ·
  polices et droits.
- **Done :** publicité de 30 s rendue en < 60 s ; conforme aux specs TikTok et Reels ; 20 pubs
  de test validées par un humain sans retouche manuelle.

**→ À ce stade, le MVP est fonctionnellement complet. Fermer la boucle avant d'avancer.**

### Phase 07 — Campaigns & Variations

- **Objectif :** transformer une publicité en système de créas.
- **Contenu :** campagnes, arbre de filiation des variations, variations 1-clic sur hook /
  personnage / voix / CTA / durée, comparaison côte à côte, export en lot, ratios multiples.
- **Dépendances :** 06.
- **Risques :** explosion des coûts si les variations ne réutilisent pas le cache
  `input_hash` — une variation de hook ne doit régénérer **que le clip 1**.
- **Done :** 3 variations de hook produites pour < 1,5× le coût d'une seule publicité.

### Phase 08 — Billing & Plans

- **Objectif :** encaisser, avec des marges vérifiées.
- **Contenu :** Stripe, plans, allocations, recharges, alertes de solde, plafonds par
  workspace, tableaux de bord de marge, pause propre sur crédits insuffisants.
- **Dépendances :** 05 (les coûts réels doivent être mesurés avant de fixer les prix).
- **Risques :** **fixer la grille avant d'avoir mesuré le facteur de régénération réel.** Si
  celui-ci dépasse 2,2, il faut retravailler le QC, pas ajuster les prix.
- **Done :** marge brute mesurée ≥ 60 % sur 100 publicités réelles ; aucune fuite possible
  (test : un compte trial ne peut pas dépasser son plafond, quel que soit le scénario).

### Phase 09 — Team, Agency & API

- **Objectif :** ouvrir le segment agence (la meilleure LTV).
- **Contenu :** rôles complets, invitations, multi-marque, marque blanche, API publique
  versionnée, webhooks, journal d'audit, clés API à portée limitée.
- **Dépendances :** 08.
- **Risques :** l'API publique fige des contrats — la versionner dès le premier jour.
- **Done :** trois agences pilotes gèrent ≥ 5 clients chacune ; l'API produit une publicité de
  bout en bout sans passer par l'interface.

### Phase 10 — Creative Intelligence

- **Objectif :** fermer la boucle de performance.
- **Contenu :** connecteurs Meta et TikTok, ingestion de métriques, `creative_features`,
  diagnostic hook rate / hold rate, patterns avec intervalles de confiance, recommandations,
  benchmarks anonymisés opt-in.
- **Dépendances :** 09, **et au moins ~500 publicités diffusées avec métriques**.
- **Risques :** conclusions statistiquement vides, promesses prédictives invérifiables, faible
  taux de connexion des comptes publicitaires. **Ne rien afficher sous les seuils de
  significativité.**
- **Done :** pour un workspace ayant ≥ 20 publicités mesurées, le système produit un
  diagnostic qu'un media buyer expérimenté juge exact et actionnable.

---

## 7 · Les cinq risques qui peuvent tuer ce produit

Dits franchement, avec leur mitigation.

1. **La qualité vidéo n'est pas encore au niveau du « diffusable sans retouche ».** Les mains,
   les yeux, les répliques coupées, la dérive d'identité restent des échecs fréquents.
   *Mitigation :* QC agressif, régénération ciblée, dégradation gracieuse, et surtout **ne pas
   promettre plus que ce qu'on livre**. Un produit qui promet « prêt à diffuser » et livre
   « presque » perd la confiance en une pub.
2. **La marge.** Si le facteur de régénération réel est de 2,5, la grille tarifaire ne tient
   pas. *Mitigation :* mesurer avant de fixer les prix (Phase 08 dépend de la Phase 05), et
   investir en amont plutôt qu'en aval.
3. **La dépendance aux providers.** Un changement de prix ×2 ou une fermeture d'accès est un
   événement de survie. *Mitigation :* abstraction réelle (critère d'acceptation Phase 05),
   au moins deux providers vidéo actifs en permanence, et suivi du coût par seconde générée
   comme métrique de direction.
4. **La commoditisation.** OpenAI, Google ou Meta peuvent sortir « décrivez votre pub » demain.
   *Mitigation :* le moat n'est pas dans la génération mais dans la stratégie, la mémoire de
   marque et la boucle de performance (§4). C'est aussi pourquoi la Phase 03 passe avant la
   Phase 05 : on construit d'abord ce qui n'est pas commoditisable.
5. **Le juridique.** Droit à l'image, EU AI Act, politiques plateformes. *Mitigation :* §00.3
   et §S4, appliqués dès la Phase 04. Ce n'est pas un sujet à traiter « quand on aura des
   clients entreprise » — c'est un sujet de conception.

---

## 8 · La question à garder en tête

> **« Comment faire en sorte qu'un entrepreneur puisse créer une publicité professionnelle en
> quelques clics, sans caméra, sans acteur, sans studio et sans compétences marketing ou
> vidéo ? »**

La réponse tient en une phrase : **en déplaçant tout l'effort de l'utilisateur vers un
pipeline déterministe, et en ne lui laissant que la seule décision qu'une machine ne devrait
pas prendre à sa place — quelle histoire raconter.**

Le workflow analysé le prouve à l'envers : il n'a qu'une vraie décision humaine, le choix de
l'angle, et quarante minutes de travail mécanique autour. Notre produit garde la décision et
supprime les quarante minutes.
