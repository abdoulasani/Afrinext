# M05 · Schémas de données (§18)

Tout artefact porte au minimum : `id`, `parent_id`, `version`, `provider`, `created_at`,
`status`.

```ts
type Base = { id: string; parent_id: string | null; version: number;
              provider: string | null; created_at: string;
              status: 'PENDING'|'RUNNING'|'OK'|'FAILED'|'SKIPPED'|'BLOCKED' };

type Experiment = Base & {
  experiment_id: string;        // P0-E1-001 … P0-E7-001
  run_id: string; hypothesis: 'H1'|'H2'|'H3'|'H4';
  started_at: string; ended_at: string | null;
  guardrails: { max_cost_usd: number; max_clips: number; max_retries: number };
  total_cost_usd: number; outcome: 'PASS'|'FAIL'|'INCONCLUSIVE'|'BLOCKED';
};

type ProviderRecord = Base & {
  category: 'TTS'|'LIPSYNC'|'ASR'|'VIDEO'|'STORAGE';
  product: string; model: string; model_version: string;
  endpoint: string; reachable: boolean; authenticated: boolean;
  pricing_model: string; unit_cost_usd: number | 'UNKNOWN';
  commercial_use: boolean | 'UNKNOWN'; data_policy: string | 'UNKNOWN';
};

type Asset = Base & {
  kind: 'shot'|'product_view'|'mask'|'audio'|'video'|'render'|'consent_doc';
  path: string; checksum: string; bytes: number;
  width?: number; height?: number; duration_s?: number;
  synthetic: boolean; rights: { owner: string; license: string;
                                commercial_use: boolean; consent_status: string };
};

type Script = Base & {
  ad_id: string; hook_type: string; language: string; market_code: string;
  lines: { index: number; role: string; text: string; word_count: number;
           shot_kind: string; product_presence: string;
           on_screen_text: string | null }[];
  facts_used: string[]; cta_channel: string;
};

type AudioArtifact = Base & {
  ad_id: string; scene_index: number; script_version: string;
  voice: string; language_code: string; chars: number;
  actual_duration_s: number;          // ← SOURCE DE VÉRITÉ des durées
  synth_latency_ms: number; cost_usd: number;
};

type VideoArtifact = Base & { ad_id: string; scene_index: number; shot_id: string;
  duration_s: number; width: number; height: number; fps: number };

type LipSyncArtifact = Base & { input_video: string; input_audio: string;
  model: string; duration_s: number; latency_ms: number; cost_usd: number;
  score: number | null; failure: string | null; retry_of: string | null };

type ASRResult = Base & { audio_ref: string; expected_text: string;
  actual_text: string; wer: number | null; confidence: number | null;
  words: { word: string; start_s: number; end_s: number }[] | null;
  missing_words: string[]; added_words: string[] };

type QCRecord = Base & { ad_id: string; check: string; kind: 'rule'|'model';
  passed: boolean; value: unknown; threshold: unknown;
  severity: 'P0'|'P1'|'P2'|'P3'; repair_level: number | null; detail: string };

type CostEntry = Base & { experiment_id: string; ad_id: string; stage: string;
  operation: string; attempt: number; repair_level: number | null;
  duration_ms: number; billed_cost_usd: number; estimated: boolean };

type LatencyTrace = Base & { ad_id: string;
  T0_start: number; T1_strategy: number; T2_script: number; T3_tts: number;
  T4_lipsync: number; T5_composite: number; T6_preview: number;
  T7_final: number; T8_qc: number;
  ttfp_ms: number; time_to_final_ms: number; time_to_publishable_ms: number };

type FailureRecord = Base & { failure_id: string; stage: string;
  description: string; root_cause: string; failure_class: string;
  severity: 'P0'|'P1'|'P2'|'P3'; repair_level: number | null;
  cost_usd: number; latency_ms: number; success_after_repair: boolean };

type HumanEval = Base & { evaluator_id: string; anon_video_id: string;
  hook: 1|2|3|4|5; clarity: 1|2|3|4|5; naturalness: 1|2|3|4|5;
  product_fidelity: 1|2|3|4|5; visual_quality: 1|2|3|4|5;
  audio_quality: 1|2|3|4|5; lip_sync: 1|2|3|4|5; brand_fit: 1|2|3|4|5;
  cta: 1|2|3|4|5; publishability: 1|2|3|4|5;
  would_publish: 'YES'|'YES_WITH_MINOR_EDIT'|'NO'; comment: string };
```

**Identifiants stables (§13)** : `P0-E{n}-{seq}` pour l'expérience,
`run_{YYYYMMDD}_{hash}` pour l'exécution, `AD01`…`AD10` pour la publicité. Tout artefact
référence `experiment_id`, `run_id`, `ad_id`, `provider`, `model`, `asset_version`,
`script_version`, `timestamp`.
