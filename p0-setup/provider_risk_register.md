# M05 · Registre des risques fournisseurs (§24)

| Risque | Prob. | Impact | Mitigation | Repli | Lock-in | Volatilité prix | Rate limit | Variance qualité | Chgt d'API | Dispo. régionale |
|---|---|---|---|---|---|---|---|---|---|---|
| **Lip-sync indisponible** — aucun fournisseur joignable, aucun équivalent Google | **certaine** *(constatée)* | **critique** — bloque H1 **et** ~87 % du coût variable | ajouter l'hôte à la liste d'autorisation, **ou** exécuter E3 hors de cet environnement | LatentSync auto-hébergé (exige un GPU) | fort — peu d'acteurs matures | UNKNOWN | UNKNOWN | élevée selon comparatifs | UNKNOWN | UNKNOWN |
| **Dépendance mono-fournisseur Google** pour TTS + ASR + vidéo + personnage | élevée | élevé — une panne ou un blocage de compte arrête E1, E2, E4, E5 | garder les adaptateurs derrière l'interface `Provider` du harnais ; ne rien coder de spécifique à Google dans le cœur | ElevenLabs / Deepgram / fal **dès que le réseau le permet** | **fort dans cet environnement**, faible dans le code | moyenne | quotas projet à surveiller | UNKNOWN | fréquente sur les API génératives | bonne |
| **Prix non vérifiés** — tout vient de comparatifs secondaires | **certaine** | moyen — fausse le budget | relever les prix officiels ; mesurer sur une **première facture réelle** | — | — | **élevée** — le marché bouge par trimestre | — | — | — | — |
| **Blocage de politique de contenu** sur les prompts vidéo (personnage, marque) | moyenne | moyen — E1 ou E5 partiellement infaisables | pré-contrôle de politique déjà spécifié en M02 §F ; reformulation automatique | prompts neutralisés | — | — | — | — | — | — |
| **Cohérence du personnage entre plans générés** | moyenne | élevé — invalide l'hypothèse « banque de plans » du M02 | image de référence identique + ancrages verbatim + QC d'embedding facial (déjà implémenté) | tournage réel avec un acteur consentant | — | — | — | **c'est le risque qualité n°1 de E1** | — | — |
| **Facturation surprise** sur la vidéo générative | moyenne | élevé | garde-fous §12 : plafonds par run, par jour, nombre max de clips ; Veo **Lite** et non Standard | — | — | — | — | — | — | — |
| **Quota / rate limit Google** en rafale sur 50+ générations | moyenne | moyen — allonge E1 et E5 | exécution séquentielle bornée, backoff, `MAX_CLIPS` | étaler sur plusieurs jours | — | — | — | — | — | — |
| **Rétention des données par le fournisseur** (scripts, voix, produit) | UNKNOWN | moyen | lire les DPA avant tout envoi de données client réelles ; P0 n'utilise qu'un **produit de test synthétique** | — | — | — | — | — | — | — |

## La dépendance la plus dangereuse

> ### Le lip-sync.
>
> Elle est **unique** (aucune redondance disponible), **bloquante pour H1** (sans elle, P0 ne
> peut pas conclure), et **dominante économiquement** (~87 % du coût variable mesuré en M03).
> Toute la planification de P0 doit être organisée autour de sa levée.
