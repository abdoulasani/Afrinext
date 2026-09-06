# M05 · Checklist de sécurité (§23)

| # | Point | État | Détail |
|---|---|---|---|
| 1 | **Secrets hors du code** | ✅ | `.env.example` ne contient que des noms de variables. Aucun secret dans le dépôt, les prompts, les logs ou les rapports |
| 2 | `.env` gitignoré | ✅ | ajouté à `.gitignore` |
| 3 | **Secrets hors des logs** | ✅ | le journal structuré n'émet que `provider`, `model`, `endpoint` — jamais d'en-tête ni de clé |
| 4 | Contrôle d'accès | ⚠️ | P0 est mono-utilisateur, local. À revoir en Phase 01 |
| 5 | **Confidentialité des assets** | ✅ | P0 n'utilise qu'un **produit de test synthétique**. Aucun asset client réel n'est envoyé à un fournisseur |
| 6 | **Rétention fournisseur** | ⚠️ `UNKNOWN` | DPA Google non lus. À faire **avant** d'envoyer le moindre asset client réel |
| 7 | Fichiers temporaires | ✅ | tous sous `p0/out/`, purgeables ; aucun `/tmp` partagé |
| 8 | URLs publiques | ✅ | aucune. Les vidéos restent locales |
| 9 | URLs signées | n/a | pas de stockage cloud en P0 |
| 10 | **Suppression** | ⚠️ | procédure de purge à écrire avant E6 si les vidéos sont partagées à des évaluateurs externes |
| 11 | **Registre de consentement** | ✅ | `consent_register.csv`. Aucun visage réel utilisé, donc aucun consentement de tiers requis en l'état |
| 12 | Divulgation IA sur les sorties | ⚠️ | non implémentée en P0 ; obligatoire avant toute diffusion réelle (EU AI Act art. 50) |

## Règles absolues de P0

1. **Aucun visage de personne réelle**, sous aucune forme, sans consentement écrit horodaté.
2. **Aucun asset client réel** envoyé à un fournisseur avant lecture du DPA.
3. **Aucun secret** dans le dépôt, les prompts, les logs ou les rapports.
4. **Aucune vidéo partagée publiquement** — E6 se fait par transfert direct aux évaluateurs.
