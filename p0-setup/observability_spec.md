# M05 · Spécification d'observabilité (§19)

## Format : JSON Lines, une ligne par événement d'étape

```json
{
  "ts": "2026-09-06T12:34:56.789Z",
  "event": "stage.end",
  "experiment_id": "P0-E2-001",
  "run_id": "run_20260906_a3f1",
  "ad_id": "AD01",
  "scene_index": 2,
  "stage": "tts",
  "provider": "google",
  "model": "fr-FR-Chirp3-HD-Aoede",
  "status": "SUCCESS",
  "latency_ms": 812,
  "cost_usd": 0.000182,
  "attempt": 1,
  "retry_of": null,
  "repair_level": null,
  "input_ref": "sha256:...",
  "output_ref": "out/AD01/a2.m4a",
  "error": null,
  "failure_class": null
}
```

## Champs obligatoires par événement

`ts` · `event` (`stage.start` | `stage.end` | `repair` | `guardrail` | `abort`) ·
`experiment_id` · `run_id` · `stage` · `status` · `latency_ms` · `cost_usd` ·
`provider` · `model` · `attempt` · `error` · `failure_class`

## Interdits

- Aucun en-tête d'authentification, aucune clé, aucun jeton — **jamais**, même tronqué.
- Aucun contenu de script client dans les logs de production (autorisé en P0 : produit de test synthétique).
- Aucun `status: SUCCESS` sur une étape non exécutée. Une étape sautée est `SKIPPED`.

## Agrégats produits automatiquement en fin de run

`cost_ledger.csv` · `latency_trace.csv` (T0→T8) · `failure_log.csv` ·
coût par étage / fournisseur / cause (initial, réparation, premium, perdu) ·
médiane, p90, p95 pour TTFP, preview, final, publishable.
