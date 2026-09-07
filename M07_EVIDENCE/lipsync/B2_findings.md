# B2 · Lip-sync — constat et décision (§05, §06)

## Constat : ce blocage n'est pas levable depuis cette session

La documentation du proxy de sortie est explicite :

> *« The destination host is not allowed by your organization's egress policy for this
> session. **Do not retry or route around it** — report the blocked host. »*

Le proxy a enregistré **13 refus de `CONNECT`** (`gateway answered 403 to CONNECT · policy
denial`) — preuve dans `p0-setup/proxy_status_evidence.json`. Les hôtes concernés incluent
`api.sync.so`, `api.hedra.com`, `fal.run`, `api.replicate.com`.

Conformément à §05 (« ne pas réessayer la même route bloquée ») et à la consigne du proxy,
**je n'ai pas retenté ni cherché à contourner.**

## Caractérisation du besoin

| | |
|---|---|
| **PRIMARY** | sync.so — API accessible dès le palier gratuit, ce qui permet un smoke test sans engagement |
| **FALLBACK** | Hedra · LatentSync auto-hébergé (exige un GPU) |
| **NETWORK** | HTTPS sortant vers l'hôte du fournisseur — **c'est l'unique contrainte** |
| **AUTH** | clé d'API en en-tête |
| **COMMERCIAL USE** | oui sur les paliers payants — à confirmer aux CGU du fournisseur retenu |
| **PRICING** | facturation à la seconde de vidéo générée (source secondaire, à vérifier) |
| **INPUT** | vidéo MP4 H.264 avec visage et bouche visibles + audio (WAV ou MP3) |
| **OUTPUT** | MP4 synchronisé, durée = durée de l'audio |

## Trois options, et celle qui est retenue

| | Option | Changement d'architecture | Faisable ? |
|---|---|---|---|
| **A** | Autoriser l'endpoint dans la politique d'egress | **nul** | ⚠️ **hors de mon contrôle** — décision d'administration de l'organisation |
| **B** | **Exécuter le harnais existant sur une machine à HTTPS sortant ouvert** | **nul — le harnais est déjà portable** | ✅ **RETENUE** |
| C | Trouver un fournisseur déjà joignable | moyen — aucun candidat : Google n'a pas d'offre lip-sync | ❌ |

> **Décision : option B.** C'est le moindre changement architectural — **aucun**. Le harnais
> tourne à l'identique ailleurs. L'option A reste préférable si votre administrateur peut
> autoriser l'hôte : elle éviterait tout déplacement.

## Paquet de lancement (§06)

`M07_EVIDENCE/lipsync/launch_elsewhere.md` et `bootstrap.sh` contiennent :
runtime, dépendances, variables d'environnement, accès réseau requis, commande exacte,
entrée de test, artefact attendu, signal de succès, signal d'échec.

**Le pipeline n'est pas reconstruit.** Le paquet ne fait que transporter et lancer
l'existant.
