#!/usr/bin/env python3
"""M05 §16 — smoke tests minimaux, providers RÉELS.

Objectif : prouver que le provider répond, PAS juger la qualité finale.
Chaque test est le plus petit appel valide et facturable possible.

    python3 run_smoke.py --all              # exécute ce qui est configuré
    python3 run_smoke.py --dry-run          # n'émet aucun appel facturable

Règles :
  · sans credential → SKIPPED (jamais PASS)
  · endpoint injoignable → BLOCKED avec classe de panne (§20)
  · aucun secret n'est journalisé
"""
from __future__ import annotations
import argparse, base64, json, os, sys, time, wave, struct
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
RESULTS = HERE / "results"


def classify(status: int | None, exc: Exception | None) -> str:
    if exc is not None:
        n = type(exc).__name__
        return "TIMEOUT" if "Timeout" in n else "NETWORK"
    if status in (401, 403):
        return "AUTH"
    if status == 429:
        return "RATE_LIMIT"
    if status == 402:
        return "BILLING"
    if status and status >= 500:
        return "PROVIDER"
    if status == 400:
        return "INPUT"
    return "NONE"


class Smoke:
    def __init__(self, dry_run: bool):
        self.dry = dry_run
        self.rows: list[dict] = []

    def record(self, test_id, category, provider, endpoint, status,
               latency_ms, result, detail="", cost_usd=0.0, artifact=None):
        self.rows.append({
            "test_id": test_id, "experiment_ref": category,
            "provider": provider, "endpoint": endpoint,
            "status_code": status, "latency_ms": latency_ms,
            "result": result, "failure_class": detail if result == "BLOCKED" else None,
            "detail": detail, "cost_usd": cost_usd,
            "artifact": str(artifact) if artifact else None,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        })
        print(f"  [{result:8}] {test_id:16} {provider:14} "
              f"{'HTTP ' + str(status) if status else '—':>9} "
              f"{latency_ms:>6}ms  {detail}")

    # ── E2 · TTS ─────────────────────────────────────────────────────
    def tts_google(self):
        key = os.environ.get("GOOGLE_API_KEY")
        if not key:
            return self.record("P0-E2-SMOKE", "E2", "google-tts", "texttospeech.googleapis.com",
                               None, 0, "SKIPPED", "GOOGLE_API_KEY absente")
        if self.dry:
            return self.record("P0-E2-SMOKE", "E2", "google-tts", "texttospeech.googleapis.com",
                               None, 0, "DRY_RUN", "aucun appel émis")
        import httpx
        payload = {
            "input": {"text": "Bonjour, ceci est un test de synthèse vocale."},
            "voice": {"languageCode": "fr-FR",
                      "name": os.environ.get("TTS_VOICE", "fr-FR-Neural2-A")},
            "audioConfig": {"audioEncoding": "MP3"},
        }
        t0 = time.perf_counter()
        try:
            r = httpx.post("https://texttospeech.googleapis.com/v1/text:synthesize",
                           params={"key": key}, json=payload, timeout=60)
            lat = int((time.perf_counter() - t0) * 1000)
            if r.status_code != 200:
                return self.record("P0-E2-SMOKE", "E2", "google-tts",
                                   "texttospeech.googleapis.com", r.status_code, lat,
                                   "BLOCKED", classify(r.status_code, None))
            RESULTS.mkdir(parents=True, exist_ok=True)
            out = RESULTS / "e2_tts_smoke.mp3"
            out.write_bytes(base64.b64decode(r.json()["audioContent"]))
            self.record("P0-E2-SMOKE", "E2", "google-tts", "texttospeech.googleapis.com",
                        200, lat, "PASS", f"{out.stat().st_size} octets",
                        cost_usd=0.0, artifact=out)
        except Exception as e:
            self.record("P0-E2-SMOKE", "E2", "google-tts", "texttospeech.googleapis.com",
                        None, int((time.perf_counter() - t0) * 1000), "BLOCKED",
                        classify(None, e))

    # ── E4 · ASR ─────────────────────────────────────────────────────
    def asr_google(self):
        key = os.environ.get("GOOGLE_API_KEY")
        audio = RESULTS / "e2_tts_smoke.mp3"
        if not key:
            return self.record("P0-E4-SMOKE", "E4", "google-stt", "speech.googleapis.com",
                               None, 0, "SKIPPED", "GOOGLE_API_KEY absente")
        if not audio.exists():
            return self.record("P0-E4-SMOKE", "E4", "google-stt", "speech.googleapis.com",
                               None, 0, "SKIPPED", "aucun audio de E2 à transcrire")
        if self.dry:
            return self.record("P0-E4-SMOKE", "E4", "google-stt", "speech.googleapis.com",
                               None, 0, "DRY_RUN", "aucun appel émis")
        import httpx
        body = {"config": {"languageCode": "fr-FR", "encoding": "MP3",
                           "sampleRateHertz": 24000, "enableWordTimeOffsets": True},
                "audio": {"content": base64.b64encode(audio.read_bytes()).decode()}}
        t0 = time.perf_counter()
        try:
            r = httpx.post("https://speech.googleapis.com/v1/speech:recognize",
                           params={"key": key}, json=body, timeout=90)
            lat = int((time.perf_counter() - t0) * 1000)
            if r.status_code != 200:
                return self.record("P0-E4-SMOKE", "E4", "google-stt", "speech.googleapis.com",
                                   r.status_code, lat, "BLOCKED", classify(r.status_code, None))
            res = r.json().get("results", [])
            txt = res[0]["alternatives"][0]["transcript"] if res else ""
            (RESULTS / "e4_asr_smoke.json").write_text(json.dumps(r.json(), indent=2,
                                                                 ensure_ascii=False))
            self.record("P0-E4-SMOKE", "E4", "google-stt", "speech.googleapis.com", 200, lat,
                        "PASS" if txt else "BLOCKED", f'transcription: "{txt[:60]}"')
        except Exception as e:
            self.record("P0-E4-SMOKE", "E4", "google-stt", "speech.googleapis.com", None,
                        int((time.perf_counter() - t0) * 1000), "BLOCKED", classify(None, e))

    # ── E5/E1 · vidéo générative ─────────────────────────────────────
    def video_google(self):
        key = os.environ.get("GOOGLE_API_KEY")
        if not key:
            return self.record("P0-E5-SMOKE", "E5", "google-veo",
                               "generativelanguage.googleapis.com", None, 0,
                               "SKIPPED", "GOOGLE_API_KEY absente")
        if self.dry:
            return self.record("P0-E5-SMOKE", "E5", "google-veo",
                               "generativelanguage.googleapis.com", None, 0,
                               "DRY_RUN", "génération vidéo NON émise (facturable)")
        import httpx
        t0 = time.perf_counter()
        try:  # appel le moins cher : lister les modèles, pas générer
            r = httpx.get("https://generativelanguage.googleapis.com/v1beta/models",
                          params={"key": key}, timeout=45)
            lat = int((time.perf_counter() - t0) * 1000)
            names = [m["name"] for m in r.json().get("models", [])] if r.status_code == 200 else []
            veo = [n for n in names if "veo" in n.lower()]
            self.record("P0-E5-SMOKE", "E5", "google-veo",
                        "generativelanguage.googleapis.com", r.status_code, lat,
                        "PASS" if r.status_code == 200 else "BLOCKED",
                        f"{len(names)} modèles · Veo: {veo or 'aucun visible'}")
        except Exception as e:
            self.record("P0-E5-SMOKE", "E5", "google-veo",
                        "generativelanguage.googleapis.com", None,
                        int((time.perf_counter() - t0) * 1000), "BLOCKED", classify(None, e))

    # ── E3 · lip-sync ────────────────────────────────────────────────
    def lipsync(self):
        prov = os.environ.get("LIPSYNC_PROVIDER")
        key = os.environ.get("LIPSYNC_API_KEY")
        if not prov or not key:
            return self.record("P0-E3-SMOKE", "E3", prov or "aucun", "—", None, 0,
                               "SKIPPED", "LIPSYNC_PROVIDER / LIPSYNC_API_KEY absents")
        self.record("P0-E3-SMOKE", "E3", prov, "—", None, 0, "BLOCKED",
                    "adaptateur à écrire une fois le fournisseur retenu — "
                    "P0 ne code pas d'appel spéculatif")

    # ── rendu local ──────────────────────────────────────────────────
    def render_local(self):
        import subprocess
        try:
            import imageio_ffmpeg
            ff = imageio_ffmpeg.get_ffmpeg_exe()
        except Exception as e:
            return self.record("P0-RENDER-SMOKE", "E1", "ffmpeg", "local", None, 0,
                               "BLOCKED", f"ffmpeg introuvable: {e}")
        RESULTS.mkdir(parents=True, exist_ok=True)
        out = RESULTS / "render_smoke.mp4"
        t0 = time.perf_counter()
        p = subprocess.run([ff, "-y", "-v", "error", "-f", "lavfi",
                            "-i", "color=c=black:s=1080x1920:d=1", "-f", "lavfi",
                            "-i", "anullsrc=r=44100:cl=mono", "-t", "1",
                            "-c:v", "libx264", "-c:a", "aac", "-pix_fmt", "yuv420p",
                            str(out)], capture_output=True, text=True)
        lat = int((time.perf_counter() - t0) * 1000)
        ok = p.returncode == 0 and out.exists() and out.stat().st_size > 1000
        self.record("P0-RENDER-SMOKE", "E1", "ffmpeg", "local", None, lat,
                    "PASS" if ok else "BLOCKED",
                    f"{out.stat().st_size} octets" if ok else p.stderr[-120:], artifact=out)

    def finish(self):
        RESULTS.mkdir(parents=True, exist_ok=True)
        summary = {
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "dry_run": self.dry,
            "counts": {k: sum(1 for r in self.rows if r["result"] == k)
                       for k in ("PASS", "SKIPPED", "BLOCKED", "DRY_RUN")},
            "total_cost_usd": round(sum(r["cost_usd"] for r in self.rows), 6),
            "results": self.rows,
        }
        (RESULTS / "smoke_results.json").write_text(json.dumps(summary, indent=2,
                                                              ensure_ascii=False))
        print(f"\n  {summary['counts']}  ·  coût facturé {summary['total_cost_usd']} USD")
        return summary


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--all", action="store_true")
    ap.add_argument("--dry-run", action="store_true",
                    default=os.environ.get("DRY_RUN", "").lower() == "true")
    a = ap.parse_args()
    print(f"M05 · smoke tests  (dry_run={a.dry_run})\n")
    s = Smoke(a.dry_run)
    s.render_local(); s.tts_google(); s.asr_google(); s.video_google(); s.lipsync()
    r = s.finish()
    sys.exit(0 if r["counts"]["BLOCKED"] == 0 else 1)


if __name__ == "__main__":
    main()
