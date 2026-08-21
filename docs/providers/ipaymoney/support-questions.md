# Questions for iPayMoney support

**Status: NOT SENT.** This is the message to send, prepared and waiting.

Addressed to `support@i-pay.money`. Ordered by what each answer blocks — K1 and
K5 first, because they decide whether Afrinext can return money to a buyer at
all, and no amount of engineering changes that.

Every question below arises from a specific gap in
`Documentation-de-iPayMoney.docx`, cited by line number into
`documentation-extract.md` in this directory.

---

## The message

> Bonjour,
>
> Nous intégrons iPayMoney pour Afrinext, une plateforme de commerce et de
> formation opérée par AFRI NEXT TECHNOLOGIE (Entreprise Individuelle, Niger).
> Nous avons étudié votre documentation en détail et l'avons suivie fidèlement.
> Quelques points restent à confirmer avant que nous mettions de l'argent réel
> en jeu, et nous préférons demander plutôt que supposer.
>
> Les deux premières questions sont les plus importantes pour nous.

### K1 — Existe-t-il une API de remboursement client ? · **blocks everything below**

> Existe-t-il une API permettant de **rembourser un paiement client**, en
> totalité ou en partie ?
>
> Si oui, pourriez-vous nous communiquer : l'endpoint, la méthode HTTP, le corps
> de la requête, la réponse, et **quel identifiant** elle attend (votre
> `reference`, notre `transaction_id`, ou un autre) ?
>
> **Si non, pourriez-vous nous le confirmer explicitement ?** Nous préférons une
> réponse claire à une absence de réponse : notre système doit savoir de manière
> certaine s'il peut rembourser automatiquement ou non.

*Why: the documentation contains no customer-refund operation. Both endpoints
are on `/api/v1/payments`, and every occurrence of « remboursement » refers to
**reversement** — the merchant withdrawing their own balance (L97). We need this
confirmed rather than inferred from silence.*

### K5 — S'il n'y a pas d'API, quelle est la procédure officielle ? · **blocks refunding a buyer at all**

> S'il n'existe pas d'API de remboursement, **quelle est la procédure officielle
> pour qu'un marchand rende son argent à un client** ?
>
> - depuis le tableau de bord ?
> - par une demande au support ?
> - par un transfert mobile money ou bancaire effectué séparément ?
> - par un autre mécanisme ?
>
> Et surtout : **ce remboursement est-il ensuite visible dans l'API ou dans les
> rapports**, afin que nous puissions le rapprocher de la commande concernée ?
> Sans cette visibilité nous ne pouvons pas garantir qu'un client remboursé
> apparaisse comme tel dans nos comptes.

*Why: Afrinext already records the debt, queues it and refuses to lose it. What
it has no way to do is send the money. Reconciliation matters as much as the
mechanism: a refund we cannot see is a refund we cannot prove.*

---

## Si la réponse à K1 est « oui » — les quatre questions qui suivent

Ces quatre-là ne se posent que s'il existe réellement une API de remboursement
client. Elles sont ici pour qu'elles partent dans le même message, plutôt que
dans un aller-retour supplémentaire.

### K2 — Peut-on interroger le statut d'un remboursement ? · **resolving an unknown**

> Le statut d'un remboursement peut-il être **interrogé après coup**, et par
> quel identifiant : la référence du remboursement, la `reference` du paiement
> d'origine, notre `transaction_id`, ou une clé d'idempotence que nous
> fournissons ?

*Why: when a refund request times out or loses its connection, Afrinext records
it as `in_doubt` and never retries it. A status query is the only mechanical way
such a refund is ever resolved; without one, every ambiguity becomes a person
reading a statement.*

### K3 — Clé d'idempotence · **whether a lost response can be retried**

> L'API accepte-t-elle une **clé d'idempotence** de notre part, et une
> répétition de la même clé renvoie-t-elle le résultat d'origine plutôt que de
> créer un second remboursement ?

### K4 — Quels codes d'erreur signifient « aucun remboursement créé » ? · **classification**

> Quels codes d'erreur signifient, **dans vos termes**, qu'aucun remboursement
> n'a été créé ?
>
> Nous ne considérons jamais un échec que nous ne pouvons pas prouver comme un
> échec définitif, et nous ne rejouons jamais une opération dont l'issue est
> inconnue. Une liste explicite de vos codes « rien ne s'est produit » est donc
> précieuse.

### K6 — Moyens de paiement et délai · **whether an old debt is refundable**

> Les remboursements sont-ils possibles **à la fois** sur mobile money et sur
> carte Visa/Mastercard ? Existe-t-il un **délai maximum** après le paiement
> d'origine au-delà duquel un remboursement n'est plus possible ?

---

### K7 — Authentification des webhooks · **security**

> Votre documentation décrit l'authentification des webhooks de deux manières
> différentes :
>
> - le texte mentionne un en-tête `x-iPayMoney-secret` contenant « une
>   signature » ;
> - l'exemple montre un en-tête `secret-hash` dont la valeur ressemble à la clé
>   secrète elle-même (`sk_...`) ;
> - et la configuration indique de coller notre clé API secrète dans le champ
>   « Secret Hash ».
>
> Pourriez-vous préciser :
>
> 1. **le nom exact de l'en-tête** envoyé ;
> 2. s'agit-il de **la clé secrète transmise telle quelle**, ou d'une
>    **signature calculée sur le corps de la requête** (par exemple HMAC-SHA256) ?
> 3. si c'est la clé transmise telle quelle : **une signature du corps est-elle
>    disponible** ?
>
> Notre système vérifie la signature sur les octets bruts avant toute lecture du
> contenu. Un en-tête constant n'authentifie pas le corps du message : toute
> personne obtenant le secret pourrait fabriquer un événement. C'est le point
> qui nous empêche aujourd'hui d'accepter vos webhooks pour confirmer un
> paiement.

*Why: extract L332 vs L338. Our webhook boundary is built on a signature over the
raw bytes, and that property is why a forged amount cannot confirm a payment.*

### K8 — Le montant est-il disponible ? · **verification**

> Ni la réponse de `GET /api/v1/payments/{reference}` ni le corps du webhook ne
> contiennent le **montant** de la transaction.
>
> Le montant est-il disponible quelque part — un champ non documenté, un autre
> endpoint, un rapport ? Sans lui nous ne pouvons pas vérifier que le montant
> encaissé correspond au montant demandé.

### K9 — Identifiant d'événement webhook · **replay protection**

> Vos webhooks contiennent-ils un **identifiant unique d'événement** ?
>
> Votre documentation indique 5 tentatives d'envoi en cas de non-réception, donc
> nous recevrons des doublons. Sans identifiant nous devons en dériver un
> nous-mêmes, et nous préférons utiliser le vôtre s'il existe.

### K10 — Recherche par notre `transaction_id` · **recovering a lost response**

> `GET /api/v1/payments/{reference}` attend **votre** référence.
>
> Si notre requête `POST` aboutit chez vous mais que la réponse se perd (réseau,
> timeout), nous n'avons pas cette référence. **Peut-on retrouver un paiement à
> partir de notre `transaction_id` ?** Sinon, comment savoir ce qu'est devenu un
> paiement dont nous n'avons pas reçu la réponse ?

### K11 — Les frais de 3 % en cas de remboursement · **cost**

> Les frais d'encaissement de 3 % sont-ils **restitués** lorsqu'un paiement est
> remboursé ou annulé ? Ou restent-ils acquis ?

### K12 — Énumération complète des statuts · **reconciliation**

> Quelle est la **liste complète des valeurs possibles du champ `status`** d'un
> paiement ?
>
> Nous avons vu `succeeded` et `failed`. Le bac à sable propose des scénarios
> (`error`, `insufficient_fund`, `declined`, `pending`) mais un scénario n'est
> pas un statut : nous ne savons pas quelle valeur `status` porte un paiement
> refusé.

### K13 — Unité du montant · **a 100× error if wrong**

> Le champ `amount` est une chaîne de caractères. Pour le XOF, faut-il envoyer
> le montant **en francs entiers** ? Par exemple, pour 15 000 FCFA, envoie-t-on
> `"15000"` ?
>
> Le XOF n'ayant pas de décimales, c'est notre lecture — mais une erreur ici
> serait un facteur 100 sur de l'argent réel, donc nous préférons le confirmer.

### K14 — Signification d'une erreur 5xx · **classification**

> Que signifie une réponse **5xx** de votre API pour la transaction ?
>
> - que le paiement n'a pas été créé ?
> - ou que son sort est indéterminé ?
>
> Nous ne considérons jamais un délai d'attente ou une erreur serveur comme une
> preuve que rien ne s'est passé, donc nous traitons ce cas comme « inconnu ».
> Si vous garantissez qu'un 5xx signifie qu'aucun paiement n'a été créé, nous
> pouvons le traiter comme un échec définitif.

### K15 — Limites de débit · **integration**

> Existe-t-il des **limites de débit** (rate limits) sur `POST /api/v1/payments`
> et `GET /api/v1/payments/{reference}` ?

### K16 — Délai de règlement (T+N) · **accounting**

> Au bout de **combien de temps** un paiement encaissé devient-il disponible sur
> le solde du marchand et éligible au reversement ?
>
> Nous avons noté la règle des 3 jours et le seuil de 50 000 FCFA pour le
> reversement ; nous cherchons ici le délai entre l'encaissement et la
> disponibilité.

### K17 — Quel pays pour le champ `country` ? · **every charge we send**

> Le champ `country` est documenté comme « le code du pays de la transaction ».
>
> S'agit-il du pays **du client qui paie**, ou du pays **du marchand** ? Nos
> vendeurs et nos acheteurs peuvent être dans des pays différents, donc nous ne
> voulons pas le deviner.

### K18 — Activation Live pour une Entreprise Individuelle · **go-live**

> AFRI NEXT TECHNOLOGIE est une **Entreprise Individuelle** au Niger.
>
> Pour l'activation du mode Live, quels documents s'appliquent dans ce cas, et
> **de qui** la pièce d'identité est-elle demandée ? Y a-t-il un délai indicatif
> d'examen de la demande ?

> Merci beaucoup pour votre aide.
>
> Cordialement,
> AFRI NEXT TECHNOLOGIE

---

## Tracking

| # | Question | Blocks | Answer |
|---|---|---|---|
| K1 | Refund API exists? | Everything below it | *awaiting* |
| K5 | Official refund procedure if not | **Refunding a buyer at all** | *awaiting* |
| K2 | Refund status query (if K1 = yes) | Resolving an `in_doubt` refund mechanically | *awaiting* |
| K3 | Refund idempotency key (if K1 = yes) | Retrying safely after a lost response | *awaiting* |
| K4 | Which errors mean no refund was created (if K1 = yes) | Failure classification | *awaiting* |
| K6 | Card and mobile money, and any time limit (if K1 = yes) | Whether an old `refund_due` is refundable | *awaiting* |
| K7 | Webhook authentication scheme | Trusting a webhook with money | *awaiting* |
| K8 | Amount availability | The amount cross-check | *awaiting* |
| K9 | Webhook event id | Replay protection | *awaiting* |
| K10 | Lookup by our `transaction_id` | Recovering a lost charge | *awaiting* |
| K11 | 3 % fee on refund | Whether a refund costs us 3 % | *awaiting* |
| K12 | Complete status enumeration | Reconciliation, status mapping | *awaiting* |
| K13 | Amount units | Every amount we send | *awaiting* |
| K14 | 5xx semantics | Failure classification | *awaiting* |
| K15 | Rate limits | Integration | *awaiting* |
| K16 | Settlement T+N | **Settlement** | *awaiting* |
| K17 | Which country | Every charge | *awaiting* |
| K18 | Live activation for an EI | Go-live | *awaiting* |

K17 and K18 were added during the sandbox-integration milestone: K17 because
`createCharge` cannot be written without knowing whose country to send, and K18
because it was folded in from the gate report's K16.
