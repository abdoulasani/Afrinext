#!/usr/bin/env python3
"""M05 §14 §15 — rapport d'environnement + tests de connectivité providers.

Aucune valeur n'est inventée : ce qui n'est pas mesurable est UNKNOWN,
ce qui échoue est classé selon la taxonomie §20.
"""
from __future__ import annotations
import json, os, platform, shutil, subprocess, sys, time, socket
from datetime import datetime, timezone
from pathlib import Path

OUT = Path(__file__).resolve().parent


def sh(cmd, timeout=25):
    try:
        p = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=timeout)
        return (p.stdout or p.stderr).strip()
    except Exception as e:
        return f"ERR {e}"


def version_of(mod):
    try:
        m = __import__(mod)
        return getattr(m, "__version__", "présent")
    except Exception:
        return None


def environment_report() -> dict:
    ff = None
    try:
        import imageio_ffmpeg
        ff = imageio_ffmpeg.get_ffmpeg_version()
    except Exception:
        pass
    deps = []
    for name, ver, blocking in [
        ("python", platform.python_version(), True),
        ("node", sh("node --version"), False),
        ("ffmpeg", ff, True),
        ("espeak-ng", (sh("espeak-ng --version").split("Data")[0].strip()
                       if shutil.which("espeak-ng") else None), False),
        ("Pillow", version_of("PIL"), True),
        ("numpy", version_of("numpy"), True),
        ("httpx", version_of("httpx"), True),
        ("requests", version_of("requests"), False),
        ("pypdfium2", version_of("pypdfium2"), False),
        ("git", sh("git --version"), False),
    ]:
        deps.append({"dependency": name, "installed": bool(ver), "version": ver or "ABSENT",
                     "working": bool(ver), "blocking": blocking})
    return {
        "os": f'{platform.system()} {platform.release()}',
        "distro": sh("cat /etc/os-release | head -2 | tr '\\n' ' '"),
        "arch": platform.machine(),
        "cpu_count": os.cpu_count(),
        "cpu_model": sh("grep -m1 'model name' /proc/cpuinfo | cut -d: -f2").strip() or "UNKNOWN",
        "ram_mb": int(sh("free -m | awk 'NR==2{print $2}'") or 0),
        "disk_avail": sh("df -h / | awk 'NR==2{print $4}'"),
        "gpu": "AUCUN (pas de /dev/nvidia*)" if not Path("/dev/nvidia0").exists() else "présent",
        "package_managers": {"pip": sh("pip --version").split()[1] if sh("pip --version") else None,
                             "apt": sh("apt-get -v | head -1"),
                             "npm": sh("npm --version")},
        "outbound_proxy": bool(os.environ.get("HTTPS_PROXY") or os.environ.get("https_proxy")),
        "dependencies": deps,
    }


# ── §20 taxonomie de panne ───────────────────────────────────────────
def classify(code: str, err: str) -> str:
    if code in ("401", "403"):
        return "AUTH"
    if code == "429":
        return "RATE_LIMIT"
    if code in ("402",):
        return "BILLING"
    if code.startswith("5"):
        return "PROVIDER"
    if code == "400":
        return "INPUT"
    if code in ("000", "ERR", ""):
        return "NETWORK"
    if code in ("200", "201", "404", "405"):
        return "OK_REACHABLE"
    return "UNKNOWN"


PROVIDERS = [
    ("TTS", "ElevenLabs", "https://api.elevenlabs.io/v1/models", "ELEVENLABS_API_KEY"),
    ("TTS", "Cartesia", "https://api.cartesia.ai/voices", "CARTESIA_API_KEY"),
    ("TTS", "Azure Speech", "https://francecentral.tts.speech.microsoft.com/cognitiveservices/voices/list", "AZURE_SPEECH_KEY"),
    ("TTS", "OpenAI", "https://api.openai.com/v1/models", "OPENAI_API_KEY"),
    ("LIPSYNC", "sync.so", "https://api.sync.so/v2/generate", "SYNC_API_KEY"),
    ("LIPSYNC", "Hedra", "https://api.hedra.com/web-app/public/voices", "HEDRA_API_KEY"),
    ("LIPSYNC", "fal.ai", "https://fal.run/health", "FAL_KEY"),
    ("LIPSYNC", "Replicate", "https://api.replicate.com/v1/models", "REPLICATE_API_TOKEN"),
    ("ASR", "Deepgram", "https://api.deepgram.com/v1/projects", "DEEPGRAM_API_KEY"),
    ("ASR", "AssemblyAI", "https://api.assemblyai.com/v2/transcript", "ASSEMBLYAI_API_KEY"),
    ("VIDEO", "fal.ai", "https://fal.run/health", "FAL_KEY"),
    ("VIDEO", "Replicate", "https://api.replicate.com/v1/models", "REPLICATE_API_TOKEN"),
    ("VIDEO", "Google AI", "https://generativelanguage.googleapis.com/v1beta/models", "GEMINI_API_KEY"),
    ("STORAGE", "Cloudflare R2", "https://cloudflarestorage.com", "R2_ACCESS_KEY_ID"),
]


def connectivity() -> list[dict]:
    rows = []
    for cat, prov, url, env in PROVIDERS:
        host = url.split("/")[2]
        dns = "OK"
        try:
            socket.getaddrinfo(host, 443)
        except Exception as e:
            dns = f"FAIL ({type(e).__name__})"
        t0 = time.perf_counter()
        code = sh(f'curl -s -o /dev/null -w "%{{http_code}}" -m 12 "{url}"', timeout=20) or "ERR"
        lat = int((time.perf_counter() - t0) * 1000)
        has_key = bool(os.environ.get(env))
        cls = classify(code, "")
        rows.append({
            "experiment_ref": {"TTS": "P0-E2", "LIPSYNC": "P0-E3", "ASR": "P0-E4",
                               "VIDEO": "P0-E5", "STORAGE": "P0-E1"}[cat],
            "category": cat, "provider": prov, "endpoint": url, "dns": dns,
            "status_code": code, "latency_ms": lat,
            "credential_env": env, "credential_present": has_key,
            "failure_class": "NONE" if cls == "OK_REACHABLE" and has_key else cls,
            "reachable": cls == "OK_REACHABLE",
            "usable": cls == "OK_REACHABLE" and has_key,
            "cost_usd": 0.0,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        })
    return rows


if __name__ == "__main__":
    env = environment_report()
    conn = connectivity()
    (OUT / "environment_report.json").write_text(json.dumps(env, indent=2, ensure_ascii=False))
    (OUT / "connectivity_tests.json").write_text(json.dumps({
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "note": "Test le plus économique possible : requête GET non authentifiée. "
                "Aucun appel facturable n'a été émis.",
        "results": conn}, indent=2, ensure_ascii=False))
    ok = sum(1 for r in conn if r["reachable"]); usable = sum(1 for r in conn if r["usable"])
    print(f"ENVIRONNEMENT : {env['os']} · {env['cpu_count']} vCPU · {env['ram_mb']} Mo · GPU {env['gpu']}")
    print(f"  bloquants absents : {[d['dependency'] for d in env['dependencies'] if d['blocking'] and not d['working']] or 'aucun'}")
    print(f"\nCONNECTIVITÉ : {ok}/{len(conn)} endpoints joignables · {usable}/{len(conn)} utilisables")
    for r in conn:
        print(f"  {r['category']:8} {r['provider']:16} HTTP {r['status_code']:>4} "
              f"{r['latency_ms']:>6}ms  dns={r['dns'][:14]:14} clé={'oui' if r['credential_present'] else 'non'}  "
              f"→ {r['failure_class']}")
