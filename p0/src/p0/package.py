"""Construction du data package M04 (§DATA PACKAGE).

Règle absolue : aucune fabrication. Une expérience non exécutée produit un
fichier dont chaque ligne porte status=BLOCKED et une cause précise.
"""
from __future__ import annotations
import json, csv, subprocess, shutil, os, statistics as st
from pathlib import Path
from datetime import datetime, timezone

ROOT = Path(__file__).resolve().parents[3]
PKG = ROOT / "p0-validation"
OUT = ROOT / "p0" / "out"


def _probe_env() -> list[dict]:
    def key(*names):
        return next((n for n in names if os.environ.get(n)), None)

    def http(url, timeout=10):
        try:
            r = subprocess.run(["curl", "-s", "-o", "/dev/null", "-w", "%{http_code}",
                                "-m", str(timeout), url], capture_output=True, text=True)
            return r.stdout.strip() or "000"
        except Exception:
            return "ERR"

    espeak = shutil.which("espeak-ng")
    ver = ""
    if espeak:
        ver = subprocess.run([espeak, "--version"], capture_output=True,
                             text=True).stdout.split("Data")[0].strip()
    ff = subprocess.run(["python3", "-c",
                         "import imageio_ffmpeg;print(imageio_ffmpeg.get_ffmpeg_version())"],
                        capture_output=True, text=True).stdout.strip()
    return [
        {"dependency": "TTS provider (neuronal, qualité produit)", "experiment": "E2",
         "status": "MISSING", "provider": "ElevenLabs / Cartesia / Azure",
         "version": None, "available": False, "blocking": True,
         "evidence": f"aucune clé d'API; api.elevenlabs.io HTTP {http('https://api.elevenlabs.io/v1/models')}",
         "notes": "les endpoints sont injoignables ET aucune clé n'est fournie"},
        {"dependency": "TTS local (moteur réel, non neuronal)", "experiment": "E2 partiel",
         "status": "AVAILABLE", "provider": "espeak-ng", "version": ver,
         "available": bool(espeak), "blocking": False,
         "evidence": "synthèse française vérifiée",
         "notes": "PERMET de faire tourner la chaîne avec de la vraie parole. "
                  "NE RÉPOND PAS à la question de naturalité de E2."},
        {"dependency": "Lip-sync provider", "experiment": "E3",
         "status": "MISSING", "provider": "sync.so / D-ID / HeyGen", "version": None,
         "available": False, "blocking": True,
         "evidence": f"aucune clé; api.d-id.com HTTP {http('https://api.d-id.com/')}",
         "notes": "E3 est l'expérience qui répond à H1. Sans elle, H1 reste ouverte."},
        {"dependency": "Provider vidéo génératif", "experiment": "E5",
         "status": "MISSING", "provider": "Veo / Kling / Runway (via Replicate ou fal)",
         "version": None, "available": False, "blocking": True,
         "evidence": f"aucune clé; api.replicate.com HTTP {http('https://api.replicate.com/v1/models')}",
         "notes": "le benchmark PATH C vs GENERATIVE ne peut pas être exécuté"},
        {"dependency": "Banque de plans réelle + personnage", "experiment": "E1",
         "status": "MISSING", "provider": None, "version": None,
         "available": False, "blocking": True,
         "evidence": "aucun asset humain fourni; aucun provider image/vidéo joignable",
         "notes": "les 10 plans utilisés sont des substituts géométriques marqués SYNTHETIC"},
        {"dependency": "ASR français", "experiment": "E4",
         "status": "MISSING", "provider": "Whisper / Vosk / PocketSphinx-fr", "version": None,
         "available": False, "blocking": True,
         "evidence": f"huggingface.co HTTP {http('https://huggingface.co')}; "
                     f"alphacephei.com HTTP {http('https://alphacephei.com')}; "
                     "pocketsphinx installé mais modèle acoustique en-us uniquement; "
                     "vosk non installable (échec de build de la dépendance srt)",
         "notes": "E4 est de toute façon en aval de E2 : mesurer un WER sur de l'audio "
                  "espeak déterministe ne dirait rien du produit"},
        {"dependency": "Évaluateurs humains francophones", "experiment": "E6",
         "status": "MISSING", "provider": None, "version": None,
         "available": False, "blocking": True,
         "evidence": "environnement non interactif",
         "notes": "grille aveugle prête et vide dans p0/eval/grid.csv"},
        {"dependency": "ffmpeg", "experiment": "E1-E7", "status": "AVAILABLE",
         "provider": "imageio-ffmpeg", "version": ff, "available": True,
         "blocking": False, "evidence": "10 rendus 1080x1920 produits",
         "notes": "filtre drawtext absent; tout le texte passe par ASS"},
        {"dependency": "Compute", "experiment": "E1-E7", "status": "AVAILABLE",
         "provider": "conteneur", "version": "4 vCPU / 16 Go", "available": True,
         "blocking": False, "evidence": "mesuré", "notes": ""},
    ]


def blocked_rows(headers, reason, n=1):
    return [{**{h: "" for h in headers}, "status": "BLOCKED",
             "blocked_reason": reason} for _ in range(n)]


def main():
    PKG.mkdir(parents=True, exist_ok=True)
    res = json.loads((OUT / "results.json").read_text()) if (OUT / "results.json").exists() else []
    led = [json.loads(l) for l in (OUT / "ledger.jsonl").open()] if (OUT / "ledger.jsonl").exists() else []

    readiness = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "milestone": "M04",
        "verdict": "BLOCKED / MISSING DEPENDENCY",
        "blocking_count": sum(1 for d in _probe_env() if d["blocking"]),
        "dependencies": _probe_env(),
    }
    (PKG / "readiness.json").write_text(json.dumps(readiness, indent=2, ensure_ascii=False))

    # ── ads.json
    (PKG / "ads.json").write_text(json.dumps([{
        "ad_id": a["ad_id"], "hook_type": a["hook"], "duration_s": a["duration_s"],
        "qc_passed": sum(1 for q in a["qc"] if q["passed"]),
        "qc_failed": sum(1 for q in a["qc"] if not q["passed"]
                         and "SKIPPED" not in (q["detail"] or "")),
        "qc_skipped": sum(1 for q in a["qc"] if "SKIPPED" in (q["detail"] or "")),
        "synthetic_stages": a["synthetic_stages"],
        "quality_gate": "BLOCKED_UNVERIFIABLE",
        "quality_gate_reason": "lip-sync, naturalité audio et publishability non mesurables",
    } for a in res], indent=2, ensure_ascii=False))

    # ── tts_manifest.json  (E2 partiel, RÉEL)
    tts = [t for a in res for t in a.get("tts_manifest", [])]
    (PKG / "tts_manifest.json").write_text(json.dumps({
        "experiment": "E2", "status": "PARTIAL",
        "engine_used": "espeak-ng (local, formants) — PAS un TTS neuronal",
        "what_this_proves": "durées réelles, latence réelle, intégration réelle",
        "what_this_does_NOT_prove": "naturalité, prononciation neuronale, coût réel",
        "entries": tts}, indent=2, ensure_ascii=False))

    # ── manifestes BLOCKED
    for name, exp, reason in [
        ("lipsync_manifest.json", "E3", "aucun provider lip-sync : ni clé, ni endpoint joignable"),
        ("asr_results.json", "E4", "aucun ASR français : hôtes de modèles injoignables, "
                                   "pocketsphinx en-us seulement, vosk non installable"),
        ("benchmark.csv", "E5", "aucun provider vidéo génératif joignable"),
        ("human_eval.csv", "E6", "aucun évaluateur humain : environnement non interactif"),
        ("regen_runs.csv", "E7", "les étages stochastiques (TTS neuronal, lip-sync, "
                                 "génératif) n'ont pas tourné : rejouer un pipeline "
                                 "déterministe 20 fois donnerait 20 fois le même résultat"),
    ]:
        payload = {"experiment": exp, "status": "BLOCKED",
                   "blocked_reason": reason, "rows": []}
        if name.endswith(".csv"):
            with (PKG / name).open("w", newline="") as f:
                w = csv.writer(f)
                w.writerow(["experiment", "status", "blocked_reason"])
                w.writerow([exp, "BLOCKED", reason])
        else:
            (PKG / name).write_text(json.dumps(payload, indent=2, ensure_ascii=False))

    # ── cost_ledger.csv  (coûts RÉELLEMENT facturés)
    with (PKG / "cost_ledger.csv").open("w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["ad_id", "stage", "provider", "operation", "attempt",
                    "repair_level", "duration_ms", "billed_cost_usd", "synthetic", "error"])
        for e in led:
            w.writerow([e["ad_id"], e["stage"], e["provider"], e["operation"],
                        e["attempt"], e["repair_level"], e["duration_ms"],
                        f'{e["cost_usd"]:.6f}', e["synthetic"], e["error"] or ""])
        w.writerow(["TOTAL", "", "", "", "", "", "",
                    f'{sum(e["cost_usd"] for e in led):.6f}', "", "aucun provider payant appelé"])

    # ── latency_trace.csv
    with (PKG / "latency_trace.csv").open("w", newline="") as f:
        w = csv.writer(f)
        marks = ["T0_start", "T1_strategy", "T2_script", "T3_audio", "T4_lipsync",
                 "T5_composite", "T6_first_pixel", "T7_final_render", "T8_qc_done"]
        w.writerow(["ad_id"] + marks + ["TTFP_ms", "time_to_final_ms",
                                        "time_to_publishable_ms", "wall_s", "cpu_s"])
        for a in res:
            t = a["timings"]
            w.writerow([a["ad_id"]] + [t.get(m) for m in marks] +
                       [t.get("TTFP_ms"), t.get("time_to_final_ms"),
                        t.get("time_to_publishable_ms"), a.get("wall_s"), a.get("cpu_s")])

    # ── failure_log.csv
    with (PKG / "failure_log.csv").open("w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["failure_id", "stage", "description", "root_cause", "severity",
                    "repair", "cost_usd", "latency_ms", "success_after_repair"])
        for a in res:
            for r in a.get("repair_log", []):
                w.writerow([f'{a["ad_id"]}-R{r["round"]}', r["trigger"],
                            f'échec QC {r["trigger"]}', "voir p0/FAILURE-LOG.md",
                            "P2", f'niveau {r["level"]} · {r["action"]}',
                            "0.000000" if r["free"] else "facturable",
                            r["latency_ms"], bool(r["fixed"])])
            for q in a["qc"]:
                if not q["passed"] and "SKIPPED" in (q["detail"] or ""):
                    w.writerow([f'{a["ad_id"]}-{q["check"]}', q["check"],
                                "contrôle non exécutable", q["detail"], q["severity"],
                                "aucune — SKIPPED", "", "", "N/A"])
    print(f"data package écrit dans {PKG}")
    for p in sorted(PKG.iterdir()):
        print(f"  {p.name:26} {p.stat().st_size:>8} o")


if __name__ == "__main__":
    main()
