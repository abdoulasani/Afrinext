# AI UGC Advertising SaaS — Architecture & Product Blueprint

**Phase 1 uniquement : conception. Aucun code n'est écrit à ce stade,** conformément aux
sections 28 et 31 du master prompt.

Ce blueprint répond à la demande « transformer un workflow manuel de création de publicités
UGC avec avatars IA en un SaaS premium, automatisé, scalable et extrêmement simple ». Il
s'appuie sur trois sources analysées en profondeur :

| Source | Ce qu'elle apporte |
|---|---|
| **La vidéo** (*How To Create Ultra Real AI Avatar*, 15 min 28 s) | Le workflow réel en 6 étapes, ses outils, ses prompts, ses limites — décomposé image par image |
| **`avatar-6c-prompt-engine`** | La méthode 6C de prompt d'avatar et le vocabulaire « iPhone realism » |
| **`ugc-ad-engine`** (8 fichiers, ~1 290 lignes) | Le pipeline angles → script → prompts vidéo, et surtout `ads-method.md`, la base de connaissance créative |

---

## Plan du document

| Fichier | Contenu | Sections du master prompt |
|---|---|---|
| **[00 · Analyse des sources](00-analyse-sources.md)** | Décomposition de la vidéo, analyse critique des deux skills, risque juridique à éliminer | 25, 26 |
| **[01 · Produit](01-produit.md)** | Executive Summary · Vision · Utilisateurs · Parcours · Architecture fonctionnelle | A → E |
| **[02 · Moteur IA](02-moteur-ia.md)** | Architecture IA · Orchestrateur créatif · Génération vidéo · Système de personnages · Éditeur IA · Creative Intelligence | F → K |
| **[03 · Plateforme](03-plateforme.md)** | Backend · Frontend · Schéma de données · API · Jobs · Abstraction providers · Storage · Sécurité · Coûts · Facturation · Multi-tenant · Analytics · Observabilité · Déploiement · Arborescence | L → Z |
| **[04 · Diagrammes](04-diagrammes.md)** | Les 8 diagrammes ASCII demandés | 29 |
| **[05 · Roadmap & décision finale](05-roadmap-et-decision-finale.md)** | MVP · V1 · V2 · Moat · Différenciation · THE RECOMMENDED ARCHITECTURE · BUILD ORDER · Risques | 15, 23, 30 |
| **[06 · M02 — Stress test](06-m02-stress-test.md)** | 16 findings, vérification du marché, one-click, gate humain, WOW moment | M02 · 01→07 |
| **[07 · M02 — Systèmes créatifs](07-m02-systemes-createurs.md)** | Score créatif, Creative DNA, Brand Memory, Character DNA, Product Consistency, SceneSpecification, régénération ciblée, routage, budget planner | M02 · 08→16 |
| **[08 · M02 — Produit et marché](08-m02-produit-marche.md)** | MVP A/B/C, test URL→pub, vertical playbooks, Market Context Engine, agences, UX premium, magic vs control, moat map, business model | M02 · 17→25 |
| **[09 · M02 — Exploitation et décision](09-m02-exploitation-et-decision.md)** | 42 failure modes, escalade humaine, execution trace, versioning, flywheel, sécurité, simplification, **MVP final, GO/NO-GO, autorisation de phase** | M02 · 26→38 |

---

## Résumé en dix lignes

1. Le produit n'est pas un générateur de vidéos : c'est un **système publicitaire** qui part
   de la stratégie et finit au fichier `.mp4`.
2. **80 % du résultat d'une publicité tient à l'angle.** C'est là que se joue la
   différenciation, pas dans le modèle vidéo — que tout le monde loue au même prix.
3. Le workflow analysé n'a **qu'une seule décision humaine** : le choix de l'angle. On la
   garde, on supprime les 45 minutes de travail mécanique autour.
4. Le pipeline est un **DAG explicite**, pas un agent. Déterministe, inspectable, chiffrable.
5. **Toute sortie IA est un objet typé et validé**, jamais du markdown re-parsé.
6. Les providers sont routés **par capabilities déclarées en base** : ajouter un modèle =
   un adaptateur + une ligne SQL.
7. Le personnage est une **`CharacterSheet` structurée**, propriétaire ou consentie —
   jamais le sosie d'une personne réelle non consentante.
8. Le COGS réel est de **10 à 30 $ par publicité**. Aucun forfait illimité n'est viable ;
   l'argent est estimé, réservé, attribué et plafonné avant d'être dépensé.
9. Le moat est dans la **mémoire de marque** et la **boucle de performance**, pas dans les
   modèles.
10. On construit la **stratégie (Phase 03) avant la vidéo (Phase 05)** — parce que c'est la
    seule partie qui ne sera pas commoditisée.

---

> **⚠ Le M02 amende ce blueprint sur 20 points.** Les fichiers 00 à 05 restent la baseline,
> mais l'architecture vidéo, le produit en scène, le gate humain, l'entonnoir, la
> facturation et le build order sont révisés. **Lire les fichiers 06 à 09 avant de
> construire quoi que ce soit** — la décision finale et l'autorisation de phase sont en
> [09 §33-38](09-m02-exploitation-et-decision.md).
>
> **État : GO WITH CHANGES · PHASE 01 BLOCKED · PHASE 00 AUTHORIZED.**

## Conventions de ce blueprint

- Chaque décision d'architecture suit le format demandé en section 27 : **décision →
  alternatives → trade-offs → recommandation → pourquoi.**
- Les chiffres de coût sont des **ordres de grandeur à re-benchmarker** avant tout engagement
  tarifaire. Ils sont signalés comme tels.
- Ce qui est mauvais ou risqué est dit tel quel, y compris dans les sources fournies
  (voir §00.2 et §00.3).
