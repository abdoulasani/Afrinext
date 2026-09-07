#!/usr/bin/env python3
"""M07 §11 — scan de secrets sur les fichiers suivis et l'historique git.

Cherche : clés d'API, clés privées de compte de service, jetons, en-têtes
d'autorisation, URLs signées. N'IMPRIME JAMAIS de secret : seulement le fichier,
la ligne et le motif déclenché.
"""
from __future__ import annotations
import json, re, subprocess, sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

PATTERNS = [
    ("google_api_key",      re.compile(r"AIza[0-9A-Za-z_\-]{35}")),
    ("gcp_sa_private_key",  re.compile(r'"private_key"\s*:\s*"-----BEGIN')),
    ("pem_private_key",     re.compile(r"-----BEGIN (RSA |EC |OPENSSH |)PRIVATE KEY-----")),
    ("aws_access_key",      re.compile(r"AKIA[0-9A-Z]{16}")),
    ("openai_key",          re.compile(r"sk-[A-Za-z0-9]{20,}")),
    ("anthropic_key",       re.compile(r"sk-ant-[A-Za-z0-9\-_]{20,}")),
    ("elevenlabs_key",      re.compile(r"\bsk_[0-9a-f]{40,}\b")),
    ("github_token",        re.compile(r"gh[pousr]_[A-Za-z0-9]{30,}")),
    ("slack_token",         re.compile(r"xox[baprs]-[A-Za-z0-9-]{10,}")),
    ("bearer_header",       re.compile(r"[Aa]uthorization\s*[:=]\s*['\"]?Bearer\s+[A-Za-z0-9._\-]{20,}")),
    ("xi_api_key_header",   re.compile(r"xi-api-key\s*[:=]\s*['\"][A-Za-z0-9]{20,}")),
    ("signed_url",          re.compile(r"[?&](X-Goog-Signature|X-Amz-Signature|Signature)=[A-Za-z0-9%._\-]{20,}")),
    ("generic_assignment",  re.compile(r"(?i)\b(api[_-]?key|secret|token|password|passwd)\b\s*[:=]\s*['\"][^'\"\s]{16,}['\"]")),
]

# Un fichier d'exemple ne contient que des noms de variables : les lignes vides
# après '=' ne sont pas des secrets.
ALLOW_EMPTY_ASSIGN = re.compile(r"^\s*[A-Z0-9_]+=\s*$")
SKIP_DIRS = {".git", "node_modules", "__pycache__", "out", "data"}
SKIP_EXT = {".mp4", ".m4a", ".mp3", ".png", ".jpg", ".jpeg", ".pdf", ".wav", ".zip"}


def scan_text(path: Path, text: str) -> list[dict]:
    hits = []
    for i, line in enumerate(text.splitlines(), 1):
        if ALLOW_EMPTY_ASSIGN.match(line):
            continue
        for name, rx in PATTERNS:
            if rx.search(line):
                hits.append({"file": str(path.relative_to(ROOT)), "line": i,
                             "pattern": name, "redacted_context":
                                 re.sub(r"[A-Za-z0-9_\-]{12,}", "<REDACTED>", line)[:120]})
    return hits


def main():
    findings, scanned = [], 0
    for p in ROOT.rglob("*"):
        if not p.is_file() or p.suffix.lower() in SKIP_EXT:
            continue
        if any(part in SKIP_DIRS for part in p.parts):
            continue
        try:
            text = p.read_text(encoding="utf8", errors="ignore")
        except Exception:
            continue
        scanned += 1
        findings += scan_text(p, text)

    # historique git : contenu de tous les blobs des commits de cette branche
    git_findings = []
    try:
        log = subprocess.run(["git", "-C", str(ROOT), "log", "--all", "-p",
                              "--no-color", "-U0"], capture_output=True,
                             text=True, timeout=180).stdout
        for i, line in enumerate(log.splitlines(), 1):
            if not line.startswith("+"):
                continue
            if ALLOW_EMPTY_ASSIGN.match(line[1:]):
                continue
            for name, rx in PATTERNS:
                if rx.search(line):
                    git_findings.append({"source": "git-history", "line": i,
                                         "pattern": name,
                                         "redacted_context":
                                             re.sub(r"[A-Za-z0-9_\-]{12,}", "<REDACTED>",
                                                    line)[:120]})
    except Exception as e:
        git_findings.append({"source": "git-history", "error": str(e)})

    out = {"generated_at": datetime.now(timezone.utc).isoformat(),
           "files_scanned": scanned,
           "patterns_checked": [n for n, _ in PATTERNS],
           "working_tree_findings": findings,
           "git_history_findings": git_findings,
           "verdict": "PASS" if not findings and not git_findings else "FAIL"}
    (Path(__file__).parent / "secret_scan.json").write_text(
        json.dumps(out, indent=2, ensure_ascii=False))
    print(f"fichiers scannés      : {scanned}")
    print(f"motifs vérifiés       : {len(PATTERNS)}")
    print(f"trouvailles (travail) : {len(findings)}")
    print(f"trouvailles (git)     : {len(git_findings)}")
    for f in (findings + git_findings)[:10]:
        print("  ", f)
    print(f"\nVERDICT : {out['verdict']}")
    sys.exit(0 if out["verdict"] == "PASS" else 1)


if __name__ == "__main__":
    main()
