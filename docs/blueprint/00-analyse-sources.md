# 00 · Analyse des sources

> Sections 25 et 26 du master prompt. Cette analyse précède l'architecture : tout ce
> qui suit en découle. Rien ici n'est deviné — la vidéo a été décomposée image par
> image (15 min 28 s, échantillonnage 1 image / 12 s) et les deux `SKILL.md` ont été
> lus intégralement, références comprises.

---

## 1 · Ce que fait réellement la vidéo

**Titre à l'écran :** *How to Generate Realistic UGC Ads with AI* — 5 étapes, présentées
comme « Record → Generate → Publish », en réalité 6 blocs de travail.

### Le workflow observé, étape par étape

| # | Étape | Outil à l'écran | Entrée | Sortie | Temps humain |
|---|---|---|---|---|---|
| 1 | Trouver une image de référence | **Pinterest** (recherches « woman in podcast », « woman in office », « B roll ») + clic droit → *Save Video Frame As* | intention vague | 1 `.png` d'une personne réelle | 3-10 min, 100 % manuel |
| 2a | Écrire le prompt image | **ChatGPT Work** + skill `avatar-6c-prompt-engine` (uploadé en `.zip`/`SKILL.md` dans l'onglet *Skills*) | image de référence | prompt texte 9:16, méthode 6C | 1 min + 1 question de clarification |
| 2b | Générer l'avatar | **Adobe Firefly**, modèle *GPT Image 2*, ratio *Vertical (9:16)*, qualité *Medium*, `Reference images (0/6)` | prompt + référence | avatar `.png` — le personnage définitif | 20 crédits / essai, plusieurs essais |
| 3 | Angles publicitaires | **ChatGPT Work** + skill `ugc-ad-engine` — prompt réel : `ugc ad engine → i want to make ad for gravitywrite. https://gravitywrite.com/` | une URL | Voice of customer (pains / desires / objections), **12 angles numérotés**, mécanisme, niveau de conscience, **puis STOP** | 1 min 32 s de génération |
| 4 | Script | même conversation — l'utilisateur répond `I select this angle: The Solo Marketing Team` | choix d'angle | script découpé en **6 clips / 38 s**, durées 4/6/8/10 s, `Says: / Seen: / Gesture: / On-screen text: / Overlay:`, + **feuille de prompts `.md` téléchargeable** (`gravitywrite-solo-marketing-team-prompts.md`) | 1 décision humaine |
| 5 | Génération vidéo | **Adobe Firefly → Generate video**, modèle **Gemini Omni Flash** (alternatives visibles : *Veo 3.1*, *Veo 3.1 Fast*, *Firefly Video*, *Kling 3.0*), 720p, 9:16, 24 FPS, durée 3→10 s, `References → Images` = l'avatar | 1 bloc de prompt collé par clip | 1 `.mp4` par clip, 180-240 crédits par génération | **copier / coller / attendre / télécharger × 6** |
| 6 | Montage | **Éditeur vidéo agentique** (GravityWrite) : *New video project* → upload des 6 clips → *Create first cut* avec cases *Remove filler words / Remove spoken mistakes / Add captions* → puis chat : « *Now, add on-screen captions and also every time you move to a new clip, make sure there is a zoom in or zoom out effect* » | 6 `.mp4` | 1 publicité finale 0:25, téléchargeable | 5-10 min |

### Ce que la vidéo prouve (et qui est précieux)

1. **La stratégie précède la production.** L'ordre angle → script → prompts → clips →
   montage n'est pas cosmétique : c'est ce qui fait qu'une pub convertit. La majorité des
   outils du marché commencent à l'étape 5.
2. **Un seul point de décision humaine.** Tout le workflow ne demande qu'**une** chose à
   l'humain : *quel angle ?* Le reste est mécanique. C'est exactement le profil d'un produit
   one-click.
3. **La cohérence du personnage passe par l'image de référence**, réinjectée dans *chaque*
   génération de clip. C'est le seul mécanisme de continuité visuelle du workflow.
4. **Le prompt vidéo a une grammaire fixe** : `caméra + action + script + voix + accent`.
   Une grammaire, ça se compile — donc ça s'automatise entièrement.
5. **Les durées sont un domaine fini** : 4, 6, 8 ou 10 s. Le script est écrit *pour* ces
   durées (~1,8-2,0 mots/s). C'est une contrainte de production remontée jusqu'à l'écriture —
   très bonne pratique, à conserver telle quelle.

### Les limites du workflow — ce qu'il faut casser

| Limite observée | Conséquence | Verdict |
|---|---|---|
| **Étape 1 : capture d'écran d'une influenceuse réelle sur Pinterest** puis génération d'un sosie | Utilisation de l'image d'une personne réelle sans consentement, sans licence. Interdit par le droit à l'image (UE/France, Californie AB 602 / Tennessee ELVIS Act, GDPR art. 9 sur les données biométriques). | **À supprimer du produit.** Non négociable. Détail en §3 ci-dessous. |
| 3 outils, 4 onglets, 2 systèmes de crédits, aucun état partagé | Rien n'est réutilisable : refaire une pub = refaire le tour complet | Remplacé par un graphe d'assets persistant |
| Copier-coller manuel × 6 clips | ~10-15 min de presse-papier, erreurs de collage, prompts désynchronisés | Remplacé par un orchestrateur de jobs |
| Aucun contrôle qualité | Un clip avec 6 doigts ou une phrase coupée n'est vu qu'au montage, après paiement des crédits | Remplacé par un QC automatique + régénération ciblée |
| Aucune mémoire de marque | Chaque pub repart de zéro | Remplacé par le Brand DNA |
| Aucune boucle de performance | Personne ne sait quel angle a gagné | Remplacé par Creative Intelligence (V2) |
| Le montage dépend d'un agent tiers propriétaire | Résultat non déterministe, non reproductible, non versionné | Remplacé par un Edit Plan déclaratif + rendu déterministe |
| Une seule variation produite | Or la méthode elle-même (§09 du master) exige du volume modulaire | Remplacé par les variations 1-clic |

### Automatisable vs. humain — la vraie ligne de partage

```
100 % AUTOMATISABLE                         DÉCISION HUMAINE (à garder)
────────────────────────                    ──────────────────────────────
· analyse du business / URL                 · le choix de l'angle        ← le seul vrai gate
· voice of customer                         · validation avant publication
· génération des 12 angles                  · claims légaux/médicaux sensibles
· mécanisme, niveau de conscience           · l'identité du personnage récurrent
· script + découpage + durées               (choisi une fois, pas à chaque pub)
· assemblage des prompts vidéo
· appels providers, retries, QC
· montage, sous-titres, musique, CTA
· variations, formats, ratios
```

**La question posée par le master prompt — « comment transformer ce workflow manuel en
expérience SaaS one-click ? » — a donc une réponse précise :** on ne supprime pas le gate
d'angle, on le *déplace*. Il devient l'écran « choisissez votre concept » (3 concepts
proposés, 1 clic), et **tout le reste devient un pipeline de jobs asynchrone**. Le workflow
de la vidéo passe de ~45-60 min et 4 outils à **1 clic + 6-9 min d'attente**.

---

## 2 · Analyse des deux SKILL.md

Deux skills distincts, deux niveaux de maturité très différents.

### `avatar-6c-prompt-engine` (fourni seul)

| | |
|---|---|
| **Ce qu'il fait** | Transforme une image de référence en prompt d'image hyperréaliste, via la méthode 6C : Character, Camera, Clothing, Context, Cinematic light, Consistency anchors |
| **Entrées** | 1 image de référence (ou une description), + une réponse à une question unique : « même chose, ou tu veux changer quelque chose ? » |
| **Sorties** | 1 prompt anglais dans un unique bloc de code, rien avant, rien après |
| **Dépendances** | Un modèle de vision (lecture de l'image) + un modèle d'image en aval (Nano Banana Pro, GPT Image, Firefly) |
| **Vraie valeur** | La checklist 6C et le vocabulaire « iPhone realism » (`direct harsh iPhone flash`, `candid dump vibe`, `slight grain`, pores/taches de rousseur). C'est ce vocabulaire qui fait la différence entre une image qui sent le rendu 3D et une image qui passe pour une photo. |

**Limites, sans complaisance :**

- **Le mode CHANGE-ONLY est déclaratif, pas structurel.** « Change seulement la tenue »
  repose sur la bonne volonté du LLM à recopier les 5 autres C à l'identique. En production,
  sur 200 avatars, ça dérive. Il faut un **objet `CharacterSheet` structuré** (JSON) dont on
  ne modifie qu'un champ, et dont le prompt n'est qu'une *sérialisation*.
- **Aucune notion d'identité persistante.** Le skill produit un prompt, pas un personnage.
  Rien ne garantit que le prompt A et le prompt B décrivent la même personne.
- **Zéro garde-fou légal.** Il accepte volontiers une photo d'une personne réelle en entrée.
  Dans un SaaS commercial, c'est le vecteur de risque n°1.
- **Le biais esthétique est codé en dur** : « European model-level beauty » apparaît dans les
  règles *et* dans l'exemple de référence. Pour une plateforme vendue à des entreprises
  mondiales — a fortiori sur des marchés africains, asiatiques ou latino-américains — c'est à
  la fois un problème d'équité et un problème commercial : les pubs qui convertissent
  ressemblent à l'audience ciblée. **À remplacer par une dérivation démographique pilotée par
  l'audience du Brand DNA.**
- **« Ne mentionne jamais l'IA »** est une règle de qualité de prompt, mais elle entre en
  collision frontale avec les obligations de divulgation (EU AI Act art. 50, politiques Meta
  et TikTok sur les médias synthétiques). Dans le produit, le disclosure est une **couche de
  sortie** (watermark C2PA, mention « créé avec l'IA »), pas une décision du prompt.

### `ugc-ad-engine` (fourni en `.zip`, 8 fichiers, ~1 290 lignes)

| | |
|---|---|
| **Ce qu'il fait** | Pipeline complet produit → angles → *(gate)* → script → feuille de prompts vidéo |
| **Entrées** | Détails produit (ou URL) + 1 image d'avatar |
| **Sorties** | Bloc stratégie, script formaté, fichier `.md` de prompts (1 bloc de code par clip) |
| **Structure** | `SKILL.md` (routeur de phases) + `references/` : `01-angles`, `02-script`, `03-video-prompts`, `ads-method` (le master, 12 sections), `video-prompt-guide` (bibliothèque de caméras/gestes/voix), `prompt-sheet-template`, `steps-to-generate-video` |

**Ce qui est excellent et se réutilise tel quel :**

1. **`ads-method.md` — c'est l'actif de valeur.** 12 types d'angles, voice of customer,
   5 niveaux de conscience de Schwartz, 5 niveaux de sophistication de marché, mécanisme
   unique (Todd Brown), équation de valeur (Hormozi), Cialdini, structure de transformation,
   copywriting avancé, créatif modulaire, hook rate / hold rate. **C'est la base de
   connaissance du produit.** Aucun concurrent n'a ça encodé proprement.
2. **La bibliothèque de prompts vidéo verbatim** — 13 mouvements de caméra, ~20 gestes,
   8 profils de voix, tous testés, tous terminés par la ligne anti-coupe
   (`Single continuous take, no cuts or scene changes`). C'est de la connaissance
   opérationnelle chèrement acquise. **À importer comme table, pas comme markdown.**
3. **La table durée → nombre de mots** (4 s ≤ 9 mots, 6 s ≤ 13, 8 s ≤ 17, 10 s ≤ 22, à
   ~1,8-2,0 mots/s). C'est une **contrainte vérifiable programmatiquement** : elle devient
   une règle de validation dans le QC, pas une consigne à un LLM.
4. **La règle « chaque clip est l'avatar qui parle face caméra »** et « le b-roll est un
   overlay, jamais un clip ». C'est ce qui rend le script mappable 1:1 sur les prompts —
   script clip 3 = prompt block 3. **C'est le contrat d'interface entre le Script Engine et
   le Video Engine.** À conserver comme invariant du système.
5. **La checklist d'auto-review en 12 points** avant livraison du script → devient le
   **Marketing QC** automatisé.
6. **Le gate unique** — un seul arrêt, sur l'angle. C'est déjà la bonne UX produit.

**Ce qu'il faut refactorer sans état d'âme :**

| Problème | Pourquoi ça casse en SaaS | Refonte |
|---|---|---|
| La sortie est du **markdown pour humain** | On ne peut pas orchestrer du markdown. Un parseur sur du texte libre casse à la première variation de formatage. | Sortie **JSON structuré et typé** (`AngleSet`, `Script`, `ClipPrompt[]`), validé par schéma (Zod/JSON Schema). Le markdown devient une *vue*. |
| **Chargement progressif de fichiers** (« ne lis pas en avance ») | Astuce de fenêtre de contexte pour un agent conversationnel. Dans un backend, chaque phase est un appel isolé avec son propre prompt système. | Le routeur de phases disparaît : 3 nœuds distincts dans l'orchestrateur, chacun avec son contexte minimal. |
| **`ads-method.md` en prompt** (211 lignes injectées à chaque appel) | Coût en tokens à chaque génération, non testable, non versionné, impossible de savoir quelle section a produit quel résultat | **Creative Knowledge Base** versionnée : sections adressables, sélection par pertinence (niveau de conscience, type de produit), + **suite d'évals** pour valider chaque modification |
| **Le `.zip` de skill est le mécanisme de distribution** | Il faut un compte ChatGPT Work, uploader un zip, faire confiance à un tiers pour le stockage | Le savoir vit dans notre backend. L'utilisateur ne voit jamais un prompt. |
| **Aucune gestion d'échec** | Si le LLM sort un clip de 11 s ou une réplique de 25 mots, personne ne le voit avant la génération payante | **Validation déterministe** avant tout appel provider : durées ∈ {4,6,8,10}, mots ≤ plafond, `Says` non vide, aucun `[bracket]` résiduel, 4-7 clips, 24-40 s |
| **Aucune mémoire** | Chaque conversation repart de zéro | Brand DNA + Character + historique de performance persistants |
| **Une seule sortie par run** | La méthode elle-même (§09 « créatif modulaire ») exige 3 hooks × 2 bodies × 2 closes | Générateur de variations natif |
| **Hypothèses `[assumption]` en texte libre** | Invisibles en production | Champ `assumptions[]` typé, remonté dans l'UI comme « à confirmer » |
| Durées **codées en dur pour Google Flow** (4/6/8/10 s) | Firefly/Omni accepte 3→10 s, Veo 3.1 fait 8 s, Kling fait 5/10 s. La contrainte appartient au provider, pas au script. | La durée devient une **capability du provider**, négociée par le routeur ; le script écrit vers la grille du provider sélectionné |
| **Rien sur la voix off, la musique, les sous-titres, le CTA visuel, les formats** | Le skill s'arrête au prompt vidéo | Couvert par l'AI Editor |

**Ce qui manque totalement pour un produit commercial :** multi-tenant, crédits et
facturation, files d'attente, reprise sur erreur, QC visuel, cohérence de personnage
vérifiée, conformité légale et disclosure, gestion des droits sur les assets, analytics de
performance, collaboration d'équipe, API publique, et surtout **un mécanisme qui empêche un
utilisateur de brûler 200 € de crédits en 4 minutes**.

---

## 3 · Le risque juridique que la vidéo introduit — et que le produit doit éliminer

C'est le point le plus important de cette analyse, donc il est isolé.

**Étape 1 de la vidéo = prendre l'image d'une personne réelle (une créatrice sur Pinterest,
souvent elle-même issue d'une vidéo tierce) et générer un personnage qui lui ressemble.**

Ce n'est pas une zone grise :

- **Droit à l'image** (France, art. 9 C. civ. ; UE) : le consentement est requis pour tout
  usage commercial.
- **RGPD** : un visage est une donnée personnelle ; sa dérivation pour créer un modèle
  d'apparence relève potentiellement de l'art. 9 (données biométriques).
- **États-Unis** : *right of publicity* (Californie AB 602, Tennessee ELVIS Act 2024,
  New York S7676B) — les répliques numériques non consenties sont explicitement visées.
- **EU AI Act art. 50** : obligation de divulgation des contenus synthétiques,
  applicable depuis 2026.
- **Politiques plateformes** : Meta et TikTok exigent le marquage des médias synthétiques
  réalistes et interdisent l'usurpation d'identité.

Un SaaS vendu à des entreprises ne peut pas construire sa fonctionnalité d'entrée sur cette
pratique. **Décision d'architecture, non négociable :**

1. **Bibliothèque de personnages propriétaires** — générés en interne à partir de prompts,
   sans référence photographique d'une personne réelle, validés puis figés. C'est notre
   catalogue. C'est aussi un actif défendable (voir le moat).
2. **Clonage sur consentement** — un utilisateur peut créer un avatar à partir de son propre
   visage ou de celui d'un modèle sous contrat, avec preuve de consentement horodatée
   (upload d'un formulaire signé + vidéo de consentement), stockée et auditable.
3. **Détection à l'ingestion** — tout upload d'image passe par un contrôle : visage détecté →
   demande d'attestation de droits ; correspondance avec une célébrité connue → blocage.
4. **Provenance C2PA** sur toute sortie + option de disclosure visible.

Coût : quelques semaines d'ingénierie. Bénéfice : le produit devient vendable à des
entreprises, à des agences et dans l'UE. Sans ça, il ne l'est pas.
