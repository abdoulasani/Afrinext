# P0 · Failure log (M03 §19)

Journal des défauts rencontrés pendant la construction et l'exécution du harnais.
Format demandé : ID · étape · description · cause racine · sévérité · réparation ·
coût · latence · succès après réparation.

---

| ID | Étape | Description | Cause racine | Sév. | Réparation | Coût | Latence | Corrigé |
|---|---|---|---|---|---|---|---|---|
| **F-001** | compositing | Toute scène contenant le produit durait **0,04 s**. Publicité totale 9 s au lieu de 14,6 s. | L'image produit est une entrée fixe ; sans `-loop 1`, ffmpeg lui donne une durée d'une frame et `-shortest` ramène la scène à cette durée. | **P0** | ajout de `-loop 1` sur l'entrée image | 0 | ~10 min de dev | **oui** |
| **F-002** | script / TTS | 6 pubs sur 10 en échec `scene_duration`. Écart typique : 1,16 s réel contre 1,60 s planifié. | **Deux formules de durée** coexistaient : le planificateur (`max(1,6 ; mots/2,6)`) et le synthétiseur (`max(1,0 ; mots/2,6)`). | P2 | source de vérité unique + complément par silence (`apad`) | 0 | ~10 min | **oui** |
| **F-003** | QC produit | Après réincrustation, le QC continuait de mesurer l'**ancien** emplacement. | La liste des emplacements de référence était patchée à partir de la dernière scène au lieu d'être reconstruite. | P1 | reconstruction complète de la vérité QC après réparation | 0 | ~15 min | **oui** |
| **F-004** | QC produit | `logo_text_preservation` échouait à 18,5 dB sur les plans *hero* alors que l'incrustation était correcte. **Faux positif.** | Le plan hero applique un léger mouvement sinusoïdal à l'overlay ; le contrôle comparait une région **figée**. | P1 | recherche locale ±16 px (template matching) au lieu d'un crop fixe | 0 | ~20 min | **oui** |
| **F-005** | réparation | Les réparations s'exécutaient mais ne corrigeaient rien (`corrigé=[]` sur 6 tentatives). | Le niveau de réparation était choisi **par nom de contrôle**, pas par **cause racine**. Un audio tronqué déclenchait une réparation de montage (L0), incapable de le traiter. | **P1** | diagnostic de cause racine avant sélection du niveau : `scene_duration` → L1 si l'audio est court, L0 sinon | 0 | ~20 min | **oui** |
| **F-006** | montage | Sur la dernière scène, la carte CTA et le sous-titre se superposent (« WhatsApp » affiché deux fois). | Le sous-titre de la ligne CTA et la carte CTA occupent la même fenêtre temporelle. | P3 | cosmétique — supprimer le sous-titre sur la ligne portant déjà la carte | 0 | non corrigé | **non** |
| **F-007** | environnement | Aucun ASR disponible : `audio_transcription` ne peut pas s'exécuter. | Téléchargement du modèle Whisper **bloqué par le proxy sortant (403)**. | P1 | aucune — contrôle déclaré `SKIPPED` | — | — | **non** |
| **F-008** | environnement | `drawtext` absent du binaire ffmpeg disponible. | Build statique minimal (`imageio-ffmpeg`). | P3 | tout le texte passe par **ASS** — de toute façon préférable (styles, contours, safe zones) | 0 | ~10 min | **oui** |
| **F-009** | environnement | Chemins A/B (vidéo générative) non exécutables. | Aucune clé `VIDEO_API_KEY`. Le provider **lève une erreur explicite** plutôt que de simuler. | **P0 pour la mission** | aucune — la comparaison §16 est déclarée **non mesurée** | — | — | **non** |
| **F-010** | environnement | Lip-sync non exécutable. | Aucune clé `LIPSYNC_API_KEY`. | **P0 pour la mission** | aucune — H1 reste non tranchée | — | — | **non** |

---

## Classement

| | Défauts |
|---|---|
| **P0** | F-001 (corrigé) · F-009, F-010 (bloquants de mission, non corrigeables ici) |
| **P1** | F-003, F-004, F-005 (tous corrigés) · F-007 (contourné par `SKIPPED`) |
| **P2** | F-002 (corrigé) |
| **P3** | F-006 (ouvert, cosmétique) · F-008 (contourné) |

## Ce que ce journal démontre

Cinq défauts réels (F-001 à F-005) ont été trouvés **par le QC lui-même**, en
exécutant la chaîne de bout en bout — pas en la dessinant. Deux d'entre eux
(F-004, F-005) étaient des défauts **du QC**, pas de la production : un contrôle qui
mesure la mauvaise zone, et une politique de réparation qui répare la mauvaise
chose. Aucun n'aurait été visible sur un schéma d'architecture.

C'est l'argument central en faveur d'une tranche verticale avant la Phase 01.
