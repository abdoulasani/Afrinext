"""M06 — Orchestrateur d'exécution P0 (E1 → E7).

Applique la séquence et les garde-fous de M05/M06 :
  pre-flight → E2+E4 → inspection → E1 → gate identité → E3 → E6/H1 → E5/E7

    python3 -m p0.execute --preflight            # vérifie seulement
    python3 -m p0.execute --stage E2 --dry-run   # estime, ne dépense rien
    python3 -m p0.execute --stage E2 --authorize # exécute réellement

RÈGLES DURES
  · DRY_RUN par défaut ; toute dépense exige --authorize
  · un coût estimé est calculé et journalisé AVANT tout appel payant
  · les plafonds de M05 sont vérifiés à chaque étape
  · aucune étape ne s'exécute si sa dépendance critique est absente
"""
from __future__ import annotations
import argparse, json, os, sys
from dataclasses import dataclass, asdict
from datetime import datetime, timezone
from pathlib import Path

from .providers.base import MissingCredentials
from .providers.impl import GoogleTTS, GoogleASR, GoogleVeo, LipSyncProvider

P0 = Path(__file__).resolve().parents[2]
LEDGER = P0 / "out" / "authorizations.jsonl"

GUARDRAILS = {
    "MAX_COST_PER_RUN_USD": float(os.environ.get("MAX_COST_PER_RUN_USD", 2.00)),
    "MAX_DAILY_COST_USD":   float(os.environ.get("MAX_DAILY_COST_USD", 25.00)),
    "MAX_CLIPS_PER_RUN":    int(os.environ.get("MAX_CLIPS_PER_RUN", 12)),
    "MAX_RETRIES_PER_STAGE": int(os.environ.get("MAX_RETRIES_PER_STAGE", 2)),
    "MAX_GENERATIONS_PER_DAY": int(os.environ.get("MAX_GENERATIONS_PER_DAY", 300)),
}
BUDGET = {"LOW": 92.0, "BASE": 205.0, "HIGH": 470.0}


@dataclass
class Dep:
    name: str; experiment: str; provider: str
    available: bool; tested: bool; blocker: str; action: str; critical: bool


def preflight() -> list[Dep]:
    """§1 — vérification réelle, aucune supposition."""
    g = bool(os.environ.get("GOOGLE_API_KEY"))
    lip = bool(os.environ.get("LIPSYNC_API_KEY") and os.environ.get("LIPSYNC_PROVIDER"))
    import shutil, subprocess
    try:
        import imageio_ffmpeg; ff = bool(imageio_ffmpeg.get_ffmpeg_exe())
    except Exception:
        ff = False
    prod = (P0 / "data" / "product" / "product_front.png").exists()
    shots = len(list((P0 / "data" / "shots").glob("*.mp4"))) >= 10
    real_shots = (P0 / "data" / "shots_real").exists()

    def net(url):
        try:
            return subprocess.run(["curl", "-s", "-o", "/dev/null", "-w", "%{http_code}",
                                   "-m", "10", url], capture_output=True,
                                  text=True).stdout.strip()
        except Exception:
            return "ERR"

    google_reachable = net("https://texttospeech.googleapis.com/v1/voices") in ("200", "403")
    lip_reachable = net("https://api.sync.so/v2/generate") not in ("000", "ERR", "")

    return [
        Dep("TTS", "E2", "google-tts", g and google_reachable, False,
            "" if g else "GOOGLE_API_KEY absente",
            "créer le projet GCP, activer Text-to-Speech, poser GOOGLE_API_KEY", True),
        Dep("ASR", "E4", "google-stt", g and google_reachable, False,
            "" if g else "GOOGLE_API_KEY absente", "même clé", True),
        Dep("VIDEO_GEN", "E5", "google-veo", g and google_reachable, False,
            "" if g else "GOOGLE_API_KEY absente", "même clé", True),
        Dep("CHARACTER", "E1", "google-veo", g and google_reachable, False,
            "" if g else "GOOGLE_API_KEY absente", "même clé, puis vérifier l'identité", True),
        Dep("LIPSYNC", "E3", os.environ.get("LIPSYNC_PROVIDER") or "aucun",
            lip and lip_reachable, False,
            "réseau: hôte refusé au CONNECT du proxy" if not lip_reachable
            else ("LIPSYNC_API_KEY absente" if not lip else ""),
            "autoriser l'hôte dans la politique réseau, ou exécuter sur une machine ouverte",
            True),
        Dep("SHOT_BANK", "E1", "interne", real_shots, shots,
            "" if real_shots else "seuls des substituts géométriques existent",
            "exécuter E1", True),
        Dep("PRODUCT_ASSET", "E1", "interne", prod, prod, "" if prod else "absent",
            "aucune" if prod else "générer via p0.assets", True),
        Dep("STORAGE", "-", "disque local", True, True, "", "aucune", False),
        Dep("RENDERING", "-", "ffmpeg", ff, ff, "" if ff else "ffmpeg absent",
            "aucune", True),
        Dep("EVALUATORS", "E6", "humains", False, False,
            "aucun évaluateur dans un environnement non interactif",
            "recruter 3 à 5 francophones du marché visé", True),
        Dep("BILLING_LIMITS", "-", "garde-fous", True, True, "",
            "DRY_RUN=true par défaut", False),
    ]


def print_preflight(deps: list[Dep]) -> bool:
    print(f"{'DEPENDENCY':<16}{'STATUS':<14}{'PROVIDER':<14}{'TESTED':<8}BLOCKER")
    print("─" * 100)
    for d in deps:
        st = "READY" if d.available else ("BLOCKED" if d.critical else "OPTIONAL")
        print(f"{d.name:<16}{st:<14}{d.provider:<14}{'oui' if d.tested else 'non':<8}"
              f"{d.blocker[:52]}")
    missing = [d for d in deps if d.critical and not d.available]
    print("─" * 100)
    print(f"{len(deps) - len(missing)}/{len(deps)} prêtes · "
          f"{len(missing)} dépendance(s) critique(s) manquante(s)")
    return not missing


def authorize(stage: str, expected_cost: float, items: int, dry_run: bool) -> bool:
    """§2 — coût estimé, budget restant, trace d'autorisation, AVANT tout appel."""
    LEDGER.parent.mkdir(parents=True, exist_ok=True)
    spent = 0.0
    if LEDGER.exists():
        today = datetime.now(timezone.utc).date().isoformat()
        for line in LEDGER.read_text().splitlines():
            r = json.loads(line)
            if r.get("executed") and r.get("ts", "").startswith(today):
                spent += r.get("expected_cost_usd", 0.0)
    rec = {"ts": datetime.now(timezone.utc).isoformat(), "stage": stage,
           "items": items, "expected_cost_usd": round(expected_cost, 4),
           "cost_basis": "ESTIMATED_catalogue_non_verifie",
           "spent_today_usd": round(spent, 4), "guardrails": GUARDRAILS,
           "dry_run": dry_run, "executed": False, "refused_reason": None}
    ok = True
    if expected_cost > GUARDRAILS["MAX_COST_PER_RUN_USD"]:
        rec["refused_reason"] = (f"coût estimé {expected_cost:.2f} $ > "
                                 f"MAX_COST_PER_RUN_USD {GUARDRAILS['MAX_COST_PER_RUN_USD']}")
        ok = False
    elif spent + expected_cost > GUARDRAILS["MAX_DAILY_COST_USD"]:
        rec["refused_reason"] = (f"cumul {spent + expected_cost:.2f} $ > "
                                 f"MAX_DAILY_COST_USD {GUARDRAILS['MAX_DAILY_COST_USD']}")
        ok = False
    elif items > GUARDRAILS["MAX_CLIPS_PER_RUN"]:
        rec["refused_reason"] = f"{items} éléments > MAX_CLIPS_PER_RUN"
        ok = False
    elif dry_run:
        rec["refused_reason"] = "DRY_RUN — aucun appel émis"
        ok = False
    rec["executed"] = ok
    with LEDGER.open("a") as f:
        f.write(json.dumps(rec, ensure_ascii=False) + "\n")
    print(f"  autorisation {stage}: coût estimé {expected_cost:.4f} $ · "
          f"dépensé aujourd'hui {spent:.2f} $ · "
          f"{'ACCORDÉE' if ok else 'REFUSÉE — ' + str(rec['refused_reason'])}")
    return ok


def stage_cost_estimate(stage: str) -> tuple[float, int]:
    """Estimations issues des volumes RÉELLEMENT mesurés en M03/M04."""
    return {
        "E1": (25 * 4 * GoogleVeo.unit_cost_usd, 25),      # 25 générations de 4 s
        "E2": (9100 * GoogleTTS.unit_cost_usd, 50),        # ~9 100 caractères
        "E3": (50 * 0.05, 50),                              # 50 clips
        "E4": (10 * 0.006, 10),                             # ~140 s d'audio
        "E5": (140 * GoogleVeo.unit_cost_usd, 10),          # 140 s de vidéo
    }.get(stage, (0.0, 0))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--preflight", action="store_true")
    ap.add_argument("--stage", choices=["E1", "E2", "E3", "E4", "E5", "E6", "E7"])
    ap.add_argument("--dry-run", action="store_true",
                    default=os.environ.get("DRY_RUN", "true").lower() != "false")
    ap.add_argument("--authorize", action="store_true",
                    help="désactive DRY_RUN et autorise la dépense réelle")
    a = ap.parse_args()
    dry = a.dry_run and not a.authorize

    print(f"\nM06 · exécution P0  ·  {datetime.now(timezone.utc).isoformat()}")
    print(f"garde-fous : {GUARDRAILS}")
    print(f"mode : {'DRY_RUN (aucune dépense)' if dry else 'AUTORISÉ (dépense réelle)'}\n")

    deps = preflight()
    ready = print_preflight(deps)
    if a.preflight or not a.stage:
        sys.exit(0 if ready else 2)

    need = {"E1": ["CHARACTER"], "E2": ["TTS"], "E3": ["LIPSYNC"], "E4": ["ASR"],
            "E5": ["VIDEO_GEN"], "E6": ["EVALUATORS"], "E7": ["LIPSYNC", "TTS"]}[a.stage]
    missing = [d for d in deps if d.name in need and not d.available]
    if missing:
        print(f"\n  STOP — {a.stage} ne peut pas démarrer.")
        for d in missing:
            print(f"    BLOCKER : {d.name} — {d.blocker}")
            print(f"    IMPACT  : {d.experiment} non exécutable")
            print(f"    ACTION  : {d.action}")
            print(f"    RETEST  : relancer `python3 -m p0.execute --preflight`")
        sys.exit(2)

    cost, items = stage_cost_estimate(a.stage)
    if not authorize(a.stage, cost, items, dry):
        sys.exit(1)
    print(f"\n  {a.stage} autorisé — l'exécution démarrerait ici.")
    sys.exit(0)


if __name__ == "__main__":
    main()
