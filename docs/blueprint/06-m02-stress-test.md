# 06 · M02 — Product & Architecture Stress Test

> Deuxième passe critique sur le M01. **L'objectif n'est pas de défendre le M01 : c'est
> d'essayer de le casser.** Comité simulé : Principal SaaS Architect · AI Systems Architect ·
> AI Video Engineer · Product Manager · UX Designer · Growth Strategist · FinOps/AI Cost
> Engineer · Security Architect · CTO · Venture Strategist.
>
> Aucun code n'est écrit. La Phase 01 reste bloquée jusqu'à arbitrage.

---

## 0 · Verdict global

**Le M01 est une bonne architecture logicielle et un produit insuffisamment confronté au
marché.**

Les décisions d'ingénierie tiennent : le DAG explicite, les sorties typées, le contrôle
financier avant dépense et la RLS résistent au stress test — je n'ai pas trouvé d'argument
sérieux pour les défaire. **Cinq décisions produit et une décision d'architecture vidéo ne
tiennent pas.**

La faille centrale est celle-ci :

> Le M01 a conçu un produit **générique et mondial**, positionné frontalement contre des
> acteurs installés, avec une **architecture vidéo 3 à 8 fois plus chère que la leur**, sans
> la fonctionnalité que leur marché considère comme acquise (**le produit dans la main**), et
> en plaçant son moment magique **à la minute 9** alors qu'il est disponible gratuitement à
> la minute 1.

Aucun de ces quatre points n'est un détail d'implémentation. Chacun se corrige maintenant,
sur le papier, ou se paie dans six mois en réécriture.

**Ce que M02 conclut :**

| | |
|---|---|
| **Maintenu sans changement** | D1 (DAG), D2 (sorties typées), D5 (contrôle financier), V2 (monolithe modulaire), V3 (R2), V5 (RLS) |
| **Amendé** | D3 (routage providers → il manque un chemin), D4 (personnages → moins nombreux, plus profonds), D6 (gate → déplacé), V4 (Clerk → maintenu mais avec une réserve), V6 (périmètre MVP → réécrit), V7 (maintenu, re-justifié) |
| **Rejeté** | V1 tel que formulé (« stratégie avant vidéo » → il faut une tranche verticale, pas une couche horizontale) · la grille tarifaire du §U · la structure du build order en 10 phases séquentielles |
| **Ajouté** | Chemin C de génération vidéo · pipeline produit-en-scène · pré-contrôle de politique de contenu · boucle de retour terrain · question de positionnement (§9) |

---

## 1 · Réalité du marché — ce que le M01 n'a pas vérifié

Le M01 affirmait : *« Le marché est saturé de générateurs \[…\] tous commencent au milieu du
problème : ils supposent que vous savez déjà quoi dire. »*

**C'est partiellement faux, et c'était vérifiable.** Vérification faite :

| Concurrent | Ce qu'il fait déjà | Conséquence pour nous |
|---|---|---|
| **Creatify** | URL produit → scrape → scripts → avatars → **variantes en lot**. Tableau de bord de performance *AdMax* avec suivi ROAS. Ratios 9:16, 16:9, 1:1. | Notre « URL → pub » n'est pas nouveau. Notre « boucle de performance » non plus, sur le principe. |
| **Arcads** | Script → vidéo, **300+ acteurs IA**, différenciation revendiquée sur le réalisme (micro-expressions, regard, gestes). Pas d'analytics ni d'intégration ads. | Une bibliothèque de 16 personnages n'impressionne personne. La variété n'est pas le terrain de jeu. |
| **MakeUGC / Newface / Viralinn** | **« Product in hand »** : l'avatar tient et présente le produit réel à partir d'une photo. Newface parle même de « templates auto-apprenants qui packagent des structures publicitaires qui gagnent ». | La fonctionnalité que le M01 n'a pas est celle que le marché considère comme acquise. |

**Et le prix :**

> Creatify : gratuit (10 crédits) · **Starter 39 $/mois ≈ 5 vidéos** · **Pro 99 $/mois ≈ 15
> vidéos** · Enterprise sur devis. Coût par pub finie observé : **1,65 à 3,90 $**.
> Arcads : 110 $ à 410 $/mois.

Comparé à la grille indicative du M01 (§U3) : **Starter 99 $ pour 2-3 pubs, Pro 299 $ pour
8-10 pubs.** Nous sommes **3 fois plus chers pour moitié moins de production**.

<!-- Sources : creatify.ai/pricing · wireflow.ai/blog/creatify-pricing ·
     shhots.ai/blog/creatify-pricing · wireflow.ai/blog/arcads-vs-creatify ·
     novoads.ai/en/blog/arcads-vs-creatify · shhots.ai/blog/best-ai-avatar-solutions-for-ugc-product-ads
     · viralinn.com/best/best-ai-avatars-for-ugc-product-ads · newface.ai/features/ai-avatar-ugc-product-ads
     Chiffres issus de comparatifs secondaires : à revérifier sur les pages officielles avant
     tout engagement. L'ordre de grandeur, lui, est cohérent entre sources indépendantes. -->

**Ce n'est pas un problème de pricing. C'est un problème d'architecture.** Ils vendent une pub
à 2 $ parce qu'ils ne génèrent pas 6 clips vidéo génératifs premium par publicité. Le M01 a
choisi le chemin technique le plus cher **comme chemin par défaut**. Voir F02 et §7.

---

## 2 · Registre des problèmes

Format demandé : PROBLÈME · IMPACT · PROBABILITÉ · SÉVÉRITÉ · SOLUTION · PRIORITÉ.

---

### F01 · Le produit ne peut pas montrer le produit — **CRITIQUE**

| | |
|---|---|
| **Problème** | Le M01 hérite du skill source la règle « chaque clip est l'avatar qui parle face caméra ; le produit est un *overlay* au montage ». Il n'existe donc **aucun chemin technique pour que le personnage tienne, applique ou démontre le produit réel du client.** |
| **Impact** | Le segment prioritaire du MVP (§C1, PME e-commerce et DTC) ne peut pas produire ses publicités les plus efficaces. Un présentateur parfait à côté d'un produit incrusté en post-production convertit moins qu'un présentateur médiocre qui tient l'objet. C'est aussi la fonctionnalité que trois concurrents identifiés livrent déjà sous un nom commercial. |
| **Probabilité** | **Certaine.** Ce n'est pas un risque, c'est un manque constaté. |
| **Sévérité** | **Critique** — invalide l'usage principal du segment principal. |
| **Solution** | Ajouter un **pipeline produit** de première classe : ingestion de photos produit → détourage → génération d'un ou plusieurs **plans « produit en main » par produit** (une génération premium, amortie sur toutes les publicités du client) → réutilisation. Le produit devient une entité (`products.assets`) avec ses plans dérivés, exactement comme le personnage a sa `CharacterSheet`. Étendre le `Script` : un clip porte `productPresence: 'none' \| 'held' \| 'demonstrated' \| 'worn' \| 'applied'`. |
| **Priorité** | **P0 — dans le MVP.** Sans cela, le MVP n'est pas commercialisable auprès de sa cible. |

---

### F02 · L'architecture vidéo est hors marché — **CRITIQUE**

| | |
|---|---|
| **Problème** | Le M01 ne propose que deux chemins de génération, tous deux **génératifs par clip** (chemin A audio natif, chemin B silencieux + voix + lip-sync). Coût : 6 à 30 $ par publicité. Le marché vend la publicité finie **1,65 à 3,90 $**. Le tier « draft » du M01 (2,40 $) n'est pas un produit vendable : c'est un aperçu basse qualité. |
| **Impact** | Trois conséquences simultanées : marge impossible au prix du marché, latence de 6-9 minutes contre ~1 minute chez les concurrents, et dérive d'identité entre clips (§H4) qu'il faut compenser par du QC coûteux. |
| **Probabilité** | **Certaine** aux prix providers actuels. |
| **Sévérité** | **Critique** — c'est le modèle économique entier. |
| **Solution** | **Ajouter un chemin C : bibliothèque de plans pré-générés + TTS + lip-sync + compositing.** Nos personnages sont tournés **une seule fois**, en qualité premium, sur un large répertoire de plans (cadrages × gestes × décors × poses produit). Ensuite, produire une publicité = choisir des plans + synthétiser la voix + synchroniser les lèvres + incruster le produit. <br><br>**Ce chemin résout trois problèmes d'un coup :** le coût (≈ 0,30 à 0,80 $ la publicité), la latence (< 90 s), et la cohérence du personnage (c'est littéralement le même tournage). Le coût de constitution de la banque est amorti sur tous les clients : 4 personnages × ~40 plans en génération premium ≈ quelques centaines de dollars, **une fois**. |
| **Priorité** | **P0 — le chemin C devient le chemin par défaut du MVP.** Les chemins A et B du M01 deviennent le **tier premium**, vendu comme tel (« tournage sur mesure »), pas comme le mode normal. |

> **Inversion de la décision H6 du M01.** Le M01 faisait du génératif le défaut et du bon
> marché un aperçu dégradé. C'est l'inverse : le bon marché doit être **la production
> normale, de qualité livrable**, et le génératif l'option premium facturée.

---

### F03 · Le WOW est à la minute 9 alors qu'il est gratuit à la minute 1 — **CRITIQUE**

| | |
|---|---|
| **Problème** | Dans le parcours M01, le moment où l'utilisateur est censé être stupéfait est la livraison de la publicité — après 6 à 9 minutes d'attente et 6 à 30 $ de COGS. Or le moment le plus impressionnant du produit coûte **0,08 $** et arrive en **40 secondes** : la plateforme lui lit son propre business en retour. |
| **Impact** | Conversion : on demande à un inconnu d'attendre 9 minutes avant de comprendre pourquoi le produit est bon. Coût : on dépense la génération vidéo **avant** d'avoir converti. Confiance : si le Brand DNA est faux, l'utilisateur l'apprend après la vidéo, quand tout est à refaire. |
| **Probabilité** | Élevée — c'est le schéma d'abandon classique des produits à génération longue. |
| **Sévérité** | **Critique** pour l'acquisition. |
| **Solution** | Reconstruire l'entonnoir autour du **WOW gratuit** : URL → 40 s → une fiche qui dit à l'utilisateur des choses sur son business qu'il n'a jamais écrites (ses objections clients formulées dans leurs mots, son mécanisme, son niveau de conscience de marché), **puis** 3 concepts avec leur justification. Tout cela **avant inscription obligatoire et avant le moindre pixel généré**. Voir §5. |
| **Priorité** | **P0.** |

---

### F04 · La différenciation revendiquée n'est pas vérifiée — **CRITIQUE**

| | |
|---|---|
| **Problème** | Le M01 fonde son positionnement sur « nous commençons par la stratégie, eux commencent au milieu ». Creatify fait déjà URL → angles → scripts → avatars → variantes en lot **et** un tableau de bord ROAS. Le M01 §4 listait comme moat n°1 « le graphe angle → performance » : c'est précisément ce que vend *AdMax*. |
| **Impact** | Le pitch ne survit pas à une comparaison faite par un prospect en dix minutes. Pire : il oriente la construction vers un produit indifférencié. |
| **Probabilité** | Certaine — c'est vérifiable publiquement. |
| **Sévérité** | **Critique** — stratégique. |
| **Solution** | Deux options honnêtes, et une seule est bonne : <br>**(a)** Concurrencer frontalement sur la qualité créative et l'exécution — coûteux, lent, sans avantage structurel. <br>**(b)** **Se positionner sur un marché que ces acteurs ne servent pas**, et où la boucle de valeur est différente. Voir §9 : le nom du dépôt (*Afrinext*), le marché francophone et africain, la vente conversationnelle WhatsApp + mobile money. <br>Dans les deux cas : **retirer de tout document la revendication « nous commençons par la stratégie »** comme facteur de différenciation. |
| **Priorité** | **P0 — décision à prendre avant la Phase 01.** |

---

### F05 · Six phases avant qu'un utilisateur voie quoi que ce soit — **ÉLEVÉ**

| | |
|---|---|
| **Problème** | Le build order M01 est **horizontal** : fondations complètes, puis brand complet, puis stratégie complète, puis personnages, puis vidéo, puis montage. Le premier utilisateur voit une publicité à la fin de la Phase 06. |
| **Impact** | Des mois sans signal marché. Toutes les hypothèses (qualité créative, facteur de régénération, disposition à payer, taux d'extraction Brand DNA) restent non validées pendant toute cette période. C'est le mode d'échec classique des projets bien architecturés. |
| **Probabilité** | Élevée. |
| **Sévérité** | **Élevée** — risque d'exécution. |
| **Solution** | Remplacer par une **tranche verticale d'abord** : Phase 01 = « une publicité, de bout en bout, pour un seul produit de test, avec un personnage codé en dur, un angle codé en dur et un montage minimal ». Laide, étroite, mais **entière**. Elle mesure immédiatement le facteur de régénération, la latence réelle, le coût réel et la qualité perçue — les quatre inconnues qui conditionnent tout le reste. Voir §8. |
| **Priorité** | **P0 — restructuration du build order.** |

---

### F06 · Le gate humain est au mauvais endroit — **ÉLEVÉ**

| | |
|---|---|
| **Problème** | Le M01 place l'unique intervention humaine sur le **choix du concept créatif**. Mais un utilisateur froid, à sa première visite, n'a **aucune base** pour arbitrer entre trois angles publicitaires — c'est précisément la compétence qu'il vient acheter. On lui demande de faire le travail d'un directeur créatif pour valider le travail de notre directeur créatif. |
| **Impact** | Friction cognitive au pire endroit de l'entonnoir, hésitation, abandon. Et le risque réel n'est pas « mauvais angle » : c'est **« l'IA a mal compris ce que je vends »** — une erreur que l'utilisateur, lui, est parfaitement qualifié pour détecter en cinq secondes. |
| **Probabilité** | Élevée. |
| **Sévérité** | Élevée — UX et conversion. |
| **Solution** | Déplacer le gate : **confirmation de la compréhension du business** (bon marché, rapide, très haute valeur, construit la confiance) devient le point de contrôle explicite ; le **choix du concept devient auto-sélectionné avec surcharge facultative**. Analyse complète en §4. |
| **Priorité** | **P0.** |

---

### F07 · Seize personnages : mauvais arbitrage — **ÉLEVÉ**

| | |
|---|---|
| **Problème** | Le M01 prévoit 16 personnages au MVP (4 âges × 2 genres × 2 registres), chacun avec 2 tenues et 2 décors. Arcads en propose plus de 300 et se différencie sur le **réalisme**, pas sur le nombre. Seize est simultanément **trop** (16 × QC × validation juridique × cohérence à produire) et **dérisoire** face à l'offre existante. |
| **Impact** | Effort dispersé, qualité moyenne partout, aucun avantage. |
| **Probabilité** | Certaine. |
| **Sévérité** | Élevée — allocation de ressources. |
| **Solution** | **Quatre personnages, extrêmement aboutis**, avec pour chacun une banque de plans profonde (cadrages, gestes, décors, poses produit) — ce qui devient précisément l'actif dont dépend le chemin C (F02). La profondeur par personnage est ce qui produit la qualité ; le nombre est une course perdue d'avance. Élargir seulement après validation. |
| **Priorité** | **P1 — amende D4 et V6.** |

---

### F08 · Aucun pont pendant l'attente ; le TTFP n'est pas défini — **ÉLEVÉ**

| | |
|---|---|
| **Problème** | Le M01 dit « l'utilisateur peut fermer l'onglet, il recevra une notification ». C'est une gestion de l'attente, pas une expérience. Aucune métrique de **time-to-first-pixel** n'est définie. |
| **Impact** | Abandon en première session, où se joue la conversion. |
| **Probabilité** | Élevée. |
| **Sévérité** | Élevée. |
| **Solution** | Deux mesures : **(1)** révélation progressive — le script s'écrit **en streaming** sous les yeux de l'utilisateur, le premier clip s'affiche dès qu'il est prêt, pas à la fin ; **(2)** **TTFP < 90 s** devient un objectif produit contraignant, au même titre que le coût. Avec le chemin C (F02), il devient atteignable. |
| **Priorité** | **P1.** |

---

### F09 · L'essai gratuit est un vecteur d'abus non couvert — **ÉLEVÉ**

| | |
|---|---|
| **Problème** | Le M01 offre 300 crédits (≈ 3 $ de COGS) à l'inscription, sans carte bancaire. Les quatre verrous anti-emballement du §G5 protègent le *workspace*, pas l'*entonnoir* : rien n'empêche 500 inscriptions jetables. Les produits de génération vidéo sont une cible connue de la culture de crédits. |
| **Impact** | Fuite de COGS proportionnelle au succès marketing — le pire moment pour la découvrir. |
| **Probabilité** | Moyenne à élevée dès la première campagne d'acquisition. |
| **Sévérité** | Élevée (financière). |
| **Solution** | Le WOW gratuit de F03 est **texte uniquement** (0,08 $), sans limite raisonnable — c'est lui qui fait l'acquisition. La **première génération vidéo** exige : e-mail vérifié + domaine ou empreinte d'appareil, sortie **filigranée et en 480p**, et une seule par compte. Carte bancaire requise pour la sortie propre. |
| **Priorité** | **P1.** |

---

### F10 · Les blocages de politique de contenu ne sont pas anticipés — **MOYEN**

| | |
|---|---|
| **Problème** | Les modèles vidéo refusent régulièrement : marques citées, allégations santé, mineurs, certaines mises en scène. Le M01 traite `content_policy` comme une classe d'erreur *a posteriori*. Or on peut être bloqué au clip 4 après avoir payé les clips 1 à 3. |
| **Impact** | COGS perdu, publicité incomplète, expérience cassée sur les verticales sensibles (santé, beauté, finance) — qui sont précisément les plus gros acheteurs de publicité. |
| **Probabilité** | Élevée sur certaines verticales. |
| **Sévérité** | Moyenne. |
| **Solution** | **Pré-contrôle de politique** dans le nœud `script.validate` (déjà déterministe, déjà bloquant, coût nul) : classifieur texte + liste noire par provider, avant `budget.reserve`. Reformuler ou changer de provider **avant** de dépenser. |
| **Priorité** | **P1 — extension d'un nœud existant, coût d'implémentation faible.** |

---

### F11 · Le crédit indexé sur le COGS est une erreur de packaging — **MOYEN**

| | |
|---|---|
| **Problème** | Le M01 pose « 1 crédit = 0,01 $ de COGS interne » et facture à la **seconde générée**. L'utilisateur ne raisonne pas en secondes ; il raisonne en publicités. Et indexer l'unité de vente sur notre coût nous expose directement aux variations de prix des providers. |
| **Impact** | Grille illisible, comparaison défavorable avec des concurrents qui affichent « 15 vidéos par mois », et refonte tarifaire à chaque mouvement de prix fournisseur. |
| **Probabilité** | Certaine. |
| **Sévérité** | Moyenne. |
| **Solution** | **Facturer à la publicité finie**, avec des unités abstraites découplées du COGS (ex. : 1 pub standard 30 s = 100 crédits, quel que soit le chemin technique employé). Le choix du chemin A, B ou C devient **notre** décision d'optimisation de marge, invisible du client. Le grand livre interne continue de suivre le COGS réel par génération — c'est de la comptabilité, pas du packaging. |
| **Priorité** | **P1 — remplace le §U2/U3 du M01.** |

---

### F12 · La Phase 06 (montage et rendu) est sous-estimée — **MOYEN**

| | |
|---|---|
| **Problème** | Le M01 traite l'`EditPlan` et le rendu comme une phase parmi dix. En réalité : sous-titres alignés au mot (donc ASR forcé), styles lisibles sur toutes les plateformes, safe zones, ducking audio, normalisation LUFS, incrustation de logo, end card, multi-ratio. C'est plusieurs semaines, et c'est **la couche que l'utilisateur juge en premier** — un montage médiocre disqualifie une bonne génération. |
| **Impact** | Retard, ou livraison d'un montage amateur qui détruit la perception de qualité. |
| **Probabilité** | Élevée. |
| **Sévérité** | Moyenne. |
| **Solution** | Reconnaître le coût réel et **réduire le périmètre** : au MVP, **un seul style de sous-titres**, une seule end card, un seul ratio, trois morceaux de musique. La variété vient après. Et faire du montage un élément de la tranche verticale de la Phase 01 (F05), pas une phase terminale — c'est là qu'on découvre les vrais problèmes. |
| **Priorité** | **P1.** |

---

### F13 · Fonctionnalités trop précoces ou inutiles — **MOYEN**

Le stress test demandait aussi ce qu'il faut **retirer**. Liste :

| Élément M01 | Verdict | Raison |
|---|---|---|
| **8 modes no-face** (§I5) | **Réduire à 1** au MVP | Chaque mode est un compilateur de prompt et un format de script distincts. Huit modes = huit pipelines à tester. Garder « Product Demo / voix off », qui sert aussi les clients sans personnage. |
| **16 personnages** | Réduire à 4 | F07 |
| **Tier premium** au MVP | Reporter | Avec le chemin C par défaut, le premium est un upsell V1 |
| **`pgvector` au MVP** | Conserver | Nécessaire au QC d'identité, coût nul |
| **Brand DNA versionné** | Conserver | Coût quasi nul, valeur d'audit réelle |
| **Timeline éditable** | Déjà reporté en V1 | Correct |
| **Creative Intelligence** | Déjà reporté en V2 | Correct — et honnêtement traité dans le M01 |
| **Analyse concurrentielle** | Déjà en V1 | Correct |
| **Multi-marché / multilingue** | Dépend de §9 | Si le positionnement francophone est retenu, ce n'est **pas** une fonctionnalité V1 : c'est le MVP |

---

### F14 · Le risque juridique majeur n'est pas celui que le M01 traite — **MOYEN**

| | |
|---|---|
| **Problème** | Le M01 traite très correctement le droit à l'image (§00.3). Il ne traite pas le risque le plus probable en exploitation : **notre personnage énonce une allégation fausse sur le produit d'un client**, le client la diffuse, un consommateur ou un régulateur s'en saisit. Qui répond ? |
| **Impact** | Contentieux, suspension de compte publicitaire du client, atteinte de réputation. |
| **Probabilité** | Moyenne, mais croissante avec le volume et avec les verticales santé/finance. |
| **Sévérité** | Moyenne à élevée. |
| **Solution** | Trois couches : **(1)** blocage dur sur les allégations interdites au QC final — déjà prévu, à rendre non contournable ; **(2)** CGU transférant la responsabilité éditoriale au client avec **accusé de lecture explicite avant le premier export** ; **(3)** journalisation de ce qui a été livré, quand, à qui — `audit_log` existe déjà, il suffit d'y verser les exports. |
| **Priorité** | **P2 — avant l'ouverture commerciale, pas avant la Phase 01.** |

---

### F15 · Aucune boucle de vérité dans le MVP — **MOYEN**

| | |
|---|---|
| **Problème** | Le produit promet des publicités **qui performent** et livre des fichiers. Rien, dans le MVP, ne dit si elles ont été diffusées ni ce qu'elles ont donné. La Creative Intelligence est reportée en V2 — décision correcte — mais on peut avoir **la donnée** bien avant d'avoir le produit d'analyse. |
| **Impact** | On construit pendant des mois sans savoir si la qualité créative est bonne. Et le moat de la §4 M01 (graphe angle → performance) ne commence à se remplir qu'en V2. |
| **Probabilité** | Certaine. |
| **Sévérité** | Moyenne, mais **c'est l'occasion manquée la moins chère du M01**. |
| **Solution** | Deux lignes de code produit : après téléchargement, à J+7, une question unique — *« Vous l'avez diffusée ? Comment ça a marché ? »* avec quatre réponses possibles. Cela amorce `creative_features` + un signal de performance déclaratif dès le premier utilisateur, et crée un point de contact de rétention. |
| **Priorité** | **P1 — coût d'implémentation dérisoire, valeur stratégique élevée.** |

---

### F16 · Personne n'est désigné pour entretenir les actifs créatifs — **FAIBLE mais réel**

| | |
|---|---|
| **Problème** | Le M01 suppose implicitement que la Creative Knowledge Base, la bibliothèque de personnages, la banque de plans et les évals sont maintenues par des ingénieurs. Ce n'est pas un travail d'ingénieur. |
| **Impact** | Dérive de qualité silencieuse, personne ne possédant l'actif le plus différenciant. |
| **Probabilité** | Élevée à moyen terme. |
| **Sévérité** | Faible à court terme, structurelle à long terme. |
| **Solution** | Identifier dès maintenant un rôle **Creative Ops** (interne ou externalisé) responsable de : jeu de référence des évals, curation des angles, validation des personnages et des plans, veille sur les formats qui marchent. C'est une implication de recrutement, pas une tâche de développement. |
| **Priorité** | **P2.** |

---

### Synthèse du registre

| Prio | Findings | Nature |
|---|---|---|
| **P0** | F01 produit-en-scène · F02 chemin C · F03 WOW en minute 1 · F04 positionnement · F05 tranche verticale · F06 gate déplacé | Bloquants — à trancher avant la Phase 01 |
| **P1** | F07 · F08 · F09 · F10 · F11 · F12 · F13 · F15 | Corrections de périmètre et de packaging |
| **P2** | F14 · F16 | Avant ouverture commerciale |

---

## 3 · Stress test du « one click »

### Parcours A — l'idéal théorique

```
L'utilisateur colle une URL et clique CREATE MY AD.
                        ↓
        90 secondes plus tard, une publicité finie.
                        ↓
   Zéro choix. Zéro upload. Zéro attente perçue. Zéro correction.
```

### Parcours B — ce qui est réellement faisable aujourd'hui

```
1  URL collée                                          [0 s]      aucune saisie
2  Analyse et compréhension du business                [~40 s]    streaming visible
3  ★ CONFIRMATION : « c'est bien votre activité ? »    [~10 s]    1 clic (F06)
4  3 concepts proposés, le 1er pré-sélectionné         [~50 s]    0 clic si accord
5  Script écrit en streaming                           [~25 s]    lecture, pas d'action
6  Personnage choisi automatiquement                   [0 s]      surchargeable
7  ⚠ Photo produit — SI produit physique               [~30 s]    UPLOAD INÉVITABLE
8  Production des clips (chemin C)                     [~60-90 s] premier clip à ~30 s
9  Montage et rendu                                    [~30 s]
10 Publicité prête                                     [total ~4 min]
11 Révision facultative                                          0 clic possible
```

**Total réaliste : 3 à 5 minutes, dont environ 15 secondes d'action humaine.** Avec
l'architecture M01 non amendée : **7 à 12 minutes**, dont 2 minutes d'action.

### Les frictions, une par une

| # | Friction | Inévitable ? | Traitement |
|---|---|---|---|
| **Choisir** un concept | Non | Auto-sélection + surcharge (§4) |
| **Confirmer** la compréhension du business | **Oui, et souhaitable** | C'est le gate. Un clic. Il achète la confiance et évite une régénération complète |
| **Uploader** une photo produit | **Oui, pour un produit physique** | Atténuable : extraction automatique depuis l'URL (pages produit, Open Graph, flux Shopify). N'exiger un upload que si l'extraction échoue |
| **Attendre** | Oui | Réductible à ~4 min et **masquable** par la révélation progressive (F08) |
| **Corriger** un Brand DNA faux | Parfois | Édition en ligne au moment du gate — donc avant toute dépense |
| **Régénérer** un clip raté | Parfois | Automatique et invisible sous le seuil de QC ; visible seulement si l'utilisateur le demande |
| **Valider** avant export | Oui, en pratique | Ce n'est pas une friction : c'est le moment de fierté. Ne pas le supprimer |
| **Comprendre** quelque chose | **Non — jamais** | Aucun terme technique. « Brand DNA », « concept », « clip », « prompt » sont du jargon interne : à renommer dans l'interface |

### Où doit se situer le compromis

> **Automatiser tout ce qui relève de la compétence que l'utilisateur vient acheter.
> Ne demander que ce que lui seul sait.**

Il ne sait pas : quel angle convertit, comment écrire un hook, quelle caméra, quelle voix,
quel rythme, quel CTA. → **L'IA décide, sans demander.**

Il sait, et lui seul : ce qu'il vend, à qui, à quel prix, ce qui est faux dans la
description, à quoi ressemble son produit, ce qu'il n'a pas le droit de promettre.
→ **Un seul point de confirmation, groupé, en une fois, avant toute dépense.**

C'est exactement l'inverse du placement du M01.

---

## 4 · Le gate humain — analyse des quatre options

| | **A · L'IA décide tout** | **B · L'IA propose, l'humain choisit** (M01) | **C · Auto-choix + surcharge** | **D · Génération directe, intervention après** |
|---|---|---|---|---|
| **Conversion** | Excellente : zéro friction | **Faible** : on demande un arbitrage expert à un novice | **Excellente** | Bonne, mais l'échec est cher |
| **UX** | Magique mais opaque | Lourde en première visite, appréciée en 5ᵉ | Magique **et** contrôlable | Magique, puis frustrante si le résultat est à côté |
| **Coût** | Risqué : on dépense avant validation | **Le plus sûr** : rien n'est dépensé avant l'accord | Sûr si la confirmation business précède | **Le pire** : on paie 100 % des générations avant tout retour |
| **Qualité** | Dépend entièrement du classement automatique | Meilleure si l'utilisateur est compétent — rarement le cas au 1ᵉʳ usage | Bonne : le classement automatique + correction possible | Aléatoire |
| **Vitesse** | Maximale | −30 à 60 s et une rupture d'attention | Quasi maximale | Maximale jusqu'au premier raté |
| **Sensation de magie** | Forte | **Affaiblie** : choisir, c'est travailler | **La plus forte** : « il a choisi, et il avait raison » | Forte puis fragile |
| **Contrôle utilisateur** | Nul | Fort | Fort mais facultatif | Tardif et coûteux |

### Recommandation

**Deux gates, tous deux différents de celui du M01 :**

1. **Gate n°1 — confirmation de la compréhension du business.** *Obligatoire, gratuit,
   rapide (un clic), avant toute dépense.* C'est la seule chose que l'utilisateur est
   qualifié pour juger instantanément, et l'erreur qu'il coûte le plus cher de laisser
   passer. Il achète aussi la confiance : voir la machine restituer son activité mieux
   qu'il ne l'aurait fait est le WOW n°1 (§5).

2. **Gate n°2 — choix du concept : option C.** Le meilleur concept est **pré-sélectionné et
   annoncé** (« j'ai choisi celui-ci, voici pourquoi »), les deux autres restent visibles à
   un clic. L'utilisateur ne fait rien s'il est d'accord — ce qui sera le cas de la majorité
   à la première publicité.

**Évolution dans le temps :** dès la deuxième publicité, l'utilisateur a du contexte et
*veut* choisir. Le produit bascule alors naturellement vers l'option B, sans changement
d'architecture — c'est un réglage de préférence, pas un autre parcours.

**Ce qui rend cette recommandation tenable : le coût de se tromper doit être faible.** Avec
le chemin C (F02), changer d'avis après génération coûte moins d'un dollar et 90 secondes.
C'est ce qui autorise l'auto-choix. Avec l'architecture M01 (12 $ et 9 minutes), l'auto-choix
serait irresponsable — **et c'est pourquoi le M01 avait raison d'imposer un gate,
étant donné son architecture. En corrigeant l'architecture, on peut supprimer la friction.**

> Le gate du M01 n'était pas une erreur de design UX. C'était une **conséquence** d'une
> erreur d'architecture vidéo. Corriger F02 libère F06.

---

## 5 · Le vrai WOW moment

Six candidats, évalués sur l'effet produit, le coût et la faisabilité au MVP.

| # | Moment | Effet | Coût | MVP ? |
|---|---|---|---|---|
| **1** | **La restitution du business.** 40 s après l'URL, la plateforme affiche les objections de ses clients **formulées dans leurs mots**, le coupable derrière leur problème, et le niveau de conscience de son marché. Des choses qu'il n'a jamais écrites nulle part. | ★★★★★ « il connaît mes clients mieux que moi » | **0,08 $** | **Oui — le WOW principal** |
| **2** | **Les 3 concepts avec leur justification.** Pas trois idées : trois notes de stratège, avec hook, angle, déclencheur émotionnel, et *pourquoi ça devrait marcher*. | ★★★★★ « c'est le travail d'une agence » | 0,15 $ | **Oui** |
| **3** | **Le premier clip.** Le personnage prononce **son** hook, **son** produit en main. Le passage de l'abstrait au réel. | ★★★★★ « c'est vraiment ma pub » | 0,10 $ (chemin C) | **Oui, si F01 et F02 sont faits** |
| **4** | **Les variations en un clic.** Trois hooks différents sur le même corps, en 90 secondes. | ★★★★ « je ne pourrai plus travailler autrement » | 0,30 $ | **Oui** — et c'est ce que vend Creatify |
| **5** | **La deuxième publicité.** Quatre minutes, aucune question posée, tout est déjà connu. Le WOW de la **mémoire**. | ★★★★ « il se souvient de tout » | — | **Oui, gratuit** — c'est le prédicteur de rétention |
| **6** | **Le diagnostic de performance.** « Votre hook rate est sous la médiane de votre secteur — voici 3 nouveaux hooks. » | ★★★★★ | — | **Non — V2**, et il faut du volume |

### La conclusion stratégique

**Le WOW le plus fort du produit est aussi le moins cher, et il ne contient aucune vidéo.**

Les moments 1 et 2 coûtent **0,23 $ ensemble** et produisent plus d'effet que la publicité
finie — parce qu'ils démontrent une **compréhension**, et que personne n'attend d'une machine
qu'elle comprenne. La vidéo, elle, est attendue : c'est ce qu'on est venu chercher.

**Conséquence sur l'entonnoir, à appliquer :**

```
URL  →  WOW 1 + WOW 2  →  inscription  →  WOW 3  →  paiement  →  WOW 4, 5
        ↑                  ↑                        ↑
        gratuit,           demandée seulement       demandé après
        sans compte        APRÈS la démonstration   la première vidéo
        0,23 $             de valeur                livrée
```

Le M01 plaçait l'inscription en étape 0 et le premier WOW en étape 6. **C'est l'entonnoir
exactement à l'envers.**

---

## 6 · Verdict sur les décisions du M01

| Réf. | Décision M01 | Verdict M02 | Motif |
|---|---|---|---|
| **D1** | DAG explicite, pas d'agent | ✅ **Maintenu** | Aucune contestation ne tient. Renforcé par le chemin C, qui rend le graphe plus court et plus prévisible |
| **D2** | Sorties IA typées et validées | ✅ **Maintenu** | Décision la plus solide du M01 |
| **D3** | Routage providers par capabilities | ⚠️ **Amendé** | Le principe tient, mais il manquait un chemin entier (chemin C, F02). Le registre doit décrire des **chemins de production**, pas seulement des modèles vidéo |
| **D4** | Personnages propriétaires ou consentis | ⚠️ **Amendé** | Politique juridique maintenue et re-justifiée. Volume réduit de 16 à 4, profondeur augmentée (F07). La bibliothèque n'est pas un moat — **la banque de plans, si** |
| **D5** | Contrôle financier avant dépense | ✅ **Maintenu** | À étendre à l'entonnoir d'inscription (F09) |
| **D6** | Un seul gate : le concept | ❌ **Remplacé** | Deux gates, dont un déplacé sur la compréhension du business (F06, §4) |
| **V1** | Stratégie avant vidéo | ⚠️ **Reformulé** | L'intention est juste, la traduction en build order est fausse : il faut une **tranche verticale**, pas une couche horizontale (F05) |
| **V2** | Monolithe modulaire + workers | ✅ **Maintenu** | |
| **V3** | Cloudflare R2 | ✅ **Maintenu** | Renforcé : le chemin C multiplie la relecture d'assets, donc l'egress |
| **V4** | Clerk au MVP | ⚠️ **Maintenu avec réserve** | Correct, mais F03 impose un parcours **avant inscription** — vérifier que le produit fonctionne en session anonyme avant de s'engager |
| **V5** | RLS dès la Phase 01 | ✅ **Maintenu** | |
| **V6** | Périmètre MVP | ❌ **Réécrit** | Voir §7 |
| **V7** | Coût de la bibliothèque propriétaire | ✅ **Maintenu et renforcé** | Le chemin C en fait un **actif de production amorti**, plus seulement une contrainte de conformité. La justification économique rejoint la justification juridique |

---

## 7 · MVP révisé

### Ce qui entre, ce qui sort

| | M01 | **M02** |
|---|---|---|
| Chemin de production | Génératif par clip (6-30 $/pub) | **Banque de plans + TTS + lip-sync (0,30-0,80 $/pub)** ; génératif = premium V1 |
| Produit en scène | ❌ absent | ✅ **plans « produit en main » par produit** |
| Personnages | 16 en surface | **4 en profondeur** + banque de plans |
| Gate | choix du concept | **confirmation business** + concept auto-choisi |
| WOW | pub finie (min. 9) | **restitution du business (min. 1), sans compte** |
| Inscription | étape 0 | **après la démonstration de valeur** |
| Modes no-face | 8 | **1** (product demo / voix off) |
| Tiers | draft + standard | **un seul tier livrable** ; premium en V1 |
| Facturation | crédits indexés sur la seconde | **crédits par publicité finie** |
| Sous-titres / montage | complet | **1 style, 1 end card, 1 ratio, 3 musiques** |
| Variations | V1 | **MVP** — c'est un WOW et c'est ce que vend le marché |
| Retour terrain | ❌ | ✅ **une question à J+7** |
| Pré-contrôle politique | ❌ | ✅ dans `script.validate` |
| Latence cible | 6-9 min | **< 4 min, TTFP < 90 s** |

### Ce qui reste inchangé du M01

RLS et multi-tenant dès le premier jour · grand livre de crédits et verrous anti-emballement ·
validation déterministe du script · vérification audio par ASR · politique de personnages ·
observabilité et funnel produit. **Ces six points étaient justes et le stress test les
confirme.**

### Définition de « done » du MVP révisé

Inchangée dans l'esprit, resserrée dans les chiffres : **20 pilotes non accompagnés
produisent chacun ≥ 2 publicités, ≥ 70 % jugées diffusables telles quelles, coût moyen
< 1,50 $ par publicité, latence médiane < 4 min, TTFP < 90 s.**

---

## 8 · Build order révisé

Le M01 empilait dix couches horizontales. M02 propose **une tranche verticale, puis des
élargissements**.

| Phase | Objet | Ce qui change vs M01 |
|---|---|---|
| **P0 · Tranche verticale** | Une publicité de bout en bout : produit de test codé en dur, 1 personnage, 1 angle, montage minimal, sortie 9:16. **Non déployée, non multi-tenant, jetable.** | **Nouveau.** Mesure immédiatement les 4 inconnues : coût réel, latence réelle, facteur de régénération, qualité perçue. Rien d'autre ne démarre avant |
| **P1 · Fondations** | Monorepo, RLS, auth, files, storage, observabilité | Ex-Phase 01, inchangée — mais **après** P0 |
| **P2 · Banque de plans + chemin C** | 4 personnages, tournage du répertoire, TTS, lip-sync, compositing, pipeline produit-en-scène | **Nouveau et central.** Absorbe les ex-Phases 04 et 05 |
| **P3 · Compréhension + stratégie** | Crawl, Brand DNA, VoC, angles, concepts, script, validation déterministe, pré-contrôle politique, évals | Ex-Phases 02 et 03 fusionnées |
| **P4 · Montage et livraison** | EditPlan, rendu, sous-titres, export | Ex-Phase 06, périmètre réduit (F12) |
| **P5 · Entonnoir et WOW** | Parcours anonyme, streaming, TTFP, inscription différée, anti-abus, variations, retour J+7 | **Nouveau.** C'est la phase de conversion, absente du M01 |
| **P6 · Facturation** | Stripe, plans par publicité finie, plafonds, marges | Ex-Phase 08, **après** avoir mesuré les coûts en P0 et P2 |
| **P7 · Équipe, agences, API** | | Ex-Phase 09 |
| **P8 · Premium génératif** | Chemins A et B du M01 en upsell | Ex-Phase 05, **rétrogradée** |
| **P9 · Creative Intelligence** | | Ex-Phase 10, inchangée |

**Le changement le plus important est P0.** Une semaine ou deux de code jetable qui répond à
la question dont dépendent toutes les autres : *combien coûte réellement une publicité chez
nous, et est-elle bonne ?*

---

## 9 · La question de positionnement

C'est la conclusion la plus importante du M02, et **elle appelle une décision qui ne
m'appartient pas.**

Le M01 a conçu un produit mondial et générique. Face à Creatify (39-99 $/mois, URL → pub,
variantes, ROAS) et Arcads (300 acteurs, réalisme), un nouvel entrant générique doit être
meilleur sur leur terrain, avec moins de moyens et un an de retard. **C'est perdable.**

Deux signaux pointent ailleurs :

1. **Le dépôt s'appelle *Afrinext*.**
2. **Le marché ouest-africain et francophone a une structure publicitaire différente** :
   plus de 200 millions d'internautes, plus de 90 % du trafic publicitaire sur mobile, et
   surtout un parcours d'achat dominant qui n'existe pas dans les produits américains —
   **découverte sur les réseaux, conversation et conversion sur WhatsApp, paiement en mobile
   money**. Les PME y adoptent l'IA en français et en langues locales.

Ce que cela changerait concrètement dans le produit :

| | Produit générique (M01) | Produit positionné |
|---|---|---|
| CTA par défaut | « lien en bio », « visitez le site » | **« écrivez-moi sur WhatsApp »** — avec deep link et numéro |
| Objectif principal | vendre en ligne | **générer des conversations** |
| Langues | anglais, puis multilingue V1 | **français dès le MVP**, langues locales ensuite |
| Personnages | représentativité générique | **représentatifs du marché servi** — ce qui n'est pas un sujet d'équité mais de conversion (levier *liking* de Cialdini) |
| Preuve | ROAS | **messages reçus**, mesurable sans API publicitaire |
| Concurrence directe | Creatify, Arcads, MakeUGC | **aucun acteur localisé identifié** |

Le point remarquable : **le M01 avait déjà « Get WhatsApp messages » dans sa liste
d'objectifs** (§D1, étape 3) — l'intuition était là, mais rien n'a été construit dessus.

**Recommandation du comité :** trancher cette question **avant** la Phase 01, parce qu'elle
modifie le MVP (langue, CTA, personnages, mesure de succès) et non seulement le marketing.
Un produit positionné sur un marché mal servi avec une architecture à 0,50 $ la publicité est
défendable. Un produit générique à 3 $ la publicité face à Creatify à 2 $ ne l'est pas.

**Ce n'est pas une décision d'architecte.** C'est la vôtre.

---

## 10 · Limites de cette analyse

Dit franchement, parce qu'un stress test qui cache ses angles morts ne vaut rien :

1. **Les prix et fonctionnalités des concurrents proviennent de comparatifs secondaires**
   (blogs de comparaison), pas des pages officielles. Les ordres de grandeur concordent entre
   sources indépendantes, mais **à revérifier directement avant toute décision tarifaire**.
2. **Le coût du chemin C (0,30-0,80 $) est une estimation**, pas une mesure. C'est
   précisément ce que la Phase P0 doit établir. Si le lip-sync de qualité coûte plus cher que
   prévu, l'écart avec le chemin génératif se réduit et l'arbitrage change.
3. **La qualité perçue du chemin C n'est pas démontrée.** Le lip-sync sur plan pré-généré
   peut être excellent ou visiblement artificiel selon les outils. C'est le risque n°1 de
   cette recommandation, et P0 doit le trancher **avant** de construire P2.
4. **Les données sur le marché ouest-africain viennent d'analyses sectorielles**, pas d'une
   étude terrain. La direction est plausible ; la validation demande des entretiens avec dix
   PME cibles — ce qui coûte une semaine et évite six mois d'erreur.
5. **Je n'ai pas testé les modèles vidéo.** Tout ce qui concerne la fidélité d'identité, le
   respect d'une image de référence produit et les taux de blocage de politique de contenu
   est du raisonnement, pas de la mesure.
