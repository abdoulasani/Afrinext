# Live activation checklist — PREPARED, NOT SUBMITTED

**Nothing has been submitted, and nothing here activates anything.** This is a
checklist assembled from the documented requirements (extract L45–L61) so the
work can start when somebody decides to start it.

Until a submission is approved, **the iPayMoney account is sandbox only** (L45).

## Why this exists now

Live activation is a **queue with an unknown wait**, not a task. The
documentation says the answer arrives by email after examination and gives no
service level (L61). Beginning it early costs nothing; discovering it late costs
whatever the review takes.

## The route

1. Enable Live in the dashboard — the **Live** control above the Tableau de bord
   menu.
2. Go to **Paramètres → Information Légale**, click **modifier**.
3. Fill in the information below, upload the documents below.
4. Save, then submit.
5. Wait for the email.

## Information to enter

| # | Field | Afrinext's value | Ready? |
|---|---|---|---|
| 1 | Nom de l'entreprise | AFRI NEXT TECHNOLOGIE | ☐ |
| 2 | Numéro de téléphone | — | ☐ |
| 3 | Adresse du siège social | — | ☐ |
| 4 | Secteur d'activité | Commerce et formation en ligne | ☐ |
| 5 | Site web / Application | — | ☐ |
| 6 | Numéro : ID card / passeport | — | ☐ |
| 7 | N° du registre de commerce | — | ☐ |
| 8 | Numéro IFU/NIF (numéro fiscal) | — | ☐ |

## Documents to upload

| # | Document | Ready? |
|---|---|---|
| 1 | RCCM | ☐ |
| 2 | IFU/NIF (numéro fiscal) | ☐ |
| 3 | Pièce d'identité | ☐ |

## Two things worth settling before submitting

**Field 5 — "Site web / Application" means iPayMoney will look at Afrinext.**
The submission is reviewed by a person, and that person will open whatever URL
is given. Whether the platform is presentable at that moment is a scheduling
decision rather than a paperwork one.

**AFRI NEXT TECHNOLOGIE is an Entreprise Individuelle.** The documented list
reads as though written for a company: it asks for both a *registre de commerce*
and a *pièce d'identité*, which for an EI are the same person's paperwork. Which
documents actually apply, and whose identity document is wanted, is **question
K18** in `support-questions.md` — worth answering before a submission is
rejected rather than after.

## What this checklist deliberately does not do

- It does not submit anything.
- It does not put any of these values into the repository. Fields 2, 3, 5, 6, 7
  and 8 are business and personal identifiers; they belong in the dashboard, not
  in source control, and the table above is a checklist rather than a store.
- It does not enable Live mode anywhere in the code. `IPAYMONEY_ENVIRONMENT` has
  **no default** precisely so that reaching Live requires somebody to say
  `live` out loud.
