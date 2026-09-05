"""QC P0 (M03 §11). Sépare strictement RULE-BASED (déterministe, bloquant) et
MODEL-BASED (consultatif). Un contrôle qui ne peut pas être exécuté est déclaré
SKIPPED — jamais passé par défaut."""
from __future__ import annotations
import re, subprocess, unicodedata
from pathlib import Path
import numpy as np
from PIL import Image
from .models import QCResult
from .compose import probe_streams, extract_frame
from .providers.impl import ffmpeg

TARGET_W, TARGET_H = 1080, 1920


def _norm(s: str) -> str:
    s = unicodedata.normalize("NFKD", s.lower())
    return "".join(c for c in s if not unicodedata.combining(c))


# ══ RULE-BASED ════════════════════════════════════════════════════════
def qc_render_validity(video: Path) -> QCResult:
    info = probe_streams(video)
    ok = bool(info["video_codec"]) and info["duration_s"] > 0.5 and Path(video).stat().st_size > 10_000
    return QCResult("render_validity", "rule", ok, info, None, "P0", 5,
                    "" if ok else "fichier illisible, vide ou sans piste vidéo")


def qc_aspect_ratio(video: Path) -> QCResult:
    i = probe_streams(video)
    ok = (i["width"], i["height"]) == (TARGET_W, TARGET_H)
    return QCResult("aspect_ratio", "rule", ok, f'{i["width"]}x{i["height"]}',
                    f"{TARGET_W}x{TARGET_H}", "P1", 0)


def qc_duration(video: Path, target_s: float, tol=0.15) -> QCResult:
    d = probe_streams(video)["duration_s"]
    ok = abs(d - target_s) <= target_s * tol
    return QCResult("total_duration", "rule", ok, round(d, 2),
                    f"{target_s}s ±{int(tol*100)}%", "P2", 0)


def qc_scene_durations(scenes: list[tuple[str, float, float]], tol=0.25) -> QCResult:
    bad = [(n, a, p) for n, a, p in scenes if abs(a - p) > max(0.35, p * tol)]
    return QCResult("scene_duration", "rule", not bad, bad, f"±{int(tol*100)}%", "P2", 0,
                    "" if not bad else f"{len(bad)} scène(s) hors tolérance")


def qc_black_frames(video: Path) -> QCResult:
    err = subprocess.run([ffmpeg(), "-hide_banner", "-i", str(video),
                          "-vf", "blackdetect=d=0.25:pix_th=0.10", "-f", "null", "-"],
                         capture_output=True, text=True).stderr
    hits = re.findall(r"black_start:([\d.]+) black_end:([\d.]+)", err)
    return QCResult("black_frames", "rule", not hits, hits, "aucune", "P1", 5,
                    "" if not hits else f"{len(hits)} segment(s) noir(s)")


def qc_subtitles(ass_path: Path, duration: float, max_chars=42) -> QCResult:
    txt = Path(ass_path).read_text(encoding="utf8")
    ev = re.findall(r"Dialogue:\s*\d+,([\d:.]+),([\d:.]+),(\w+),.*?,,(.*)", txt)
    def sec(t):
        h, m, s = t.split(":"); return int(h) * 3600 + int(m) * 60 + float(s)
    problems = []
    for st, en, style, body in ev:
        a, b = sec(st), sec(en)
        if b <= a: problems.append(("timing_inverse", body[:30]))
        if b > duration + 0.35: problems.append(("hors_duree", body[:30]))
        if style == "Sub" and len(body) > max_chars * 2:
            problems.append(("trop_long", body[:30]))
    ok = bool(ev) and not problems
    return QCResult("subtitle_validity", "rule", ok,
                    {"events": len(ev), "problems": problems}, f"≤{max_chars*2} car.", "P2", 0)


def qc_cta_present(ass_path: Path, cta_text: str) -> QCResult:
    txt = _norm(Path(ass_path).read_text(encoding="utf8"))
    ok = _norm(cta_text)[:18] in txt
    return QCResult("cta_presence", "rule", ok, cta_text, "présent", "P1", 0)


def qc_script_factuality(script_lines: list[str], facts: dict) -> QCResult:
    """M03 §07 : aucune affirmation chiffrée ou superlative qui ne soit un fait fourni."""
    allowed = _norm(" ".join(str(v) for v in facts.values()))
    banned_claims = ["meilleur", "n°1", "numero 1", "garanti", "miracle", "prouve scientifiquement",
                     "100% efficace", "guerit", "elimine definitivement"]
    violations = []
    for ln in script_lines:
        n = _norm(ln)
        for b in banned_claims:
            if b in n: violations.append(("claim_interdit", b, ln[:48]))
        for num in re.findall(r"\b\d+[\d,.]*\s*(?:%|jours?|semaines?|g|ml|fcfa|f\b)?", n):
            if num.strip() and num.strip() not in allowed:
                violations.append(("chiffre_non_source", num.strip(), ln[:48]))
    return QCResult("script_factuality", "rule", not violations, violations, "0 violation",
                    "P0", 0, "" if not violations else f"{len(violations)} violation(s)")


def qc_product_presence(video: Path, product_png: Path, slots: list[tuple[float, tuple]],
                        workdir: Path, min_frames=2) -> QCResult:
    """Le produit est-il réellement visible, et à quelle fidélité ?
    On compare la région incrustée à l'asset source (corrélation normalisée)."""
    workdir.mkdir(parents=True, exist_ok=True)
    src = Image.open(product_png).convert("RGB")
    sims, seen = [], 0
    for i, (t, box) in enumerate(slots):
        f = extract_frame(video, t, workdir / f"chk_{i}.png")
        if f is None: continue
        im = Image.open(f).convert("RGB")
        x, y, w, h = box
        if x + w > im.width or y + h > im.height: continue
        ref = np.asarray(src.resize((160, 220)), dtype=np.float32)
        b = ref - ref.mean(); nb = np.sqrt((b ** 2).sum()) or 1.0
        best = -1.0
        # FIX F-004 : recherche locale ±16 px — un overlay animé (hero shot) se
        # déplace ; un crop figé mesurait la mauvaise région.
        for dy in range(-16, 17, 4):
            yy = max(0, min(y + dy, im.height - h))
            crop = np.asarray(im.crop((x, yy, x + w, yy + h)).resize((160, 220)),
                              dtype=np.float32)
            a = crop - crop.mean(); na = np.sqrt((a ** 2).sum()) or 1.0
            best = max(best, float((a * b).sum() / (na * nb)))
        sims.append(best); seen += 1
    score = round(float(np.mean(sims)), 4) if sims else 0.0
    ok = seen >= min_frames and score >= 0.60
    return QCResult("product_presence", "rule", ok,
                    {"frames_checked": seen, "similarity": score}, "≥0.60 sur ≥2 frames",
                    "P0", 3)


def qc_logo_preservation(video: Path, product_png: Path, t: float, box: tuple,
                         logo_box: tuple, workdir: Path) -> QCResult:
    """Le logo/texte du packaging est-il conservé pixel pour pixel ?
    Avec la stratégie S1 (compositing), la réponse doit être ~1.0 par construction —
    c'est précisément la thèse à démontrer."""
    f = extract_frame(video, t, workdir / "logo_chk.png")
    if f is None:
        return QCResult("logo_text_preservation", "rule", False, None, "≥22 dB", "P0", 3,
                        "frame non extractible")
    im = Image.open(f).convert("RGB")
    src = Image.open(product_png).convert("RGB")
    x, y, w, h = box
    sx = w / src.width; sy = h / src.height
    lx, ly, lw, lh = logo_box
    r2 = src.crop((lx, ly, lx + lw, ly + lh)).resize((96, 96))
    b = np.asarray(r2, np.float32)
    best_psnr = -1.0
    for dy in range(-16, 17, 2):      # FIX F-004, même raison
        yy = y + dy
        r1 = im.crop((int(x + lx * sx), int(yy + ly * sy),
                      int(x + (lx + lw) * sx), int(yy + (ly + lh) * sy))).resize((96, 96))
        a = np.asarray(r1, np.float32)
        mse = float(((a - b) ** 2).mean())
        best_psnr = max(best_psnr, 99.0 if mse < 1e-6
                        else float(10 * np.log10((255.0 ** 2) / mse)))
    psnr = best_psnr
    ok = psnr >= 22.0
    return QCResult("logo_text_preservation", "rule", ok,
                    {"psnr_db": round(psnr, 2)}, "≥22 dB", "P0", 3)


# ══ CONTRÔLES NON EXÉCUTABLES ICI ═════════════════════════════════════
def qc_audio_transcription(_audio, _expected) -> QCResult:
    return QCResult("audio_transcription", "rule", False, None, "ASR",
                    "P1", 1, "SKIPPED — aucun moteur ASR disponible "
                             "(téléchargement de modèle bloqué par le proxy)")


def qc_lip_sync(_video) -> QCResult:
    return QCResult("lip_sync", "model", False, None, None, "P1", 2,
                    "SKIPPED — aucun provider lip-sync branché")


def qc_visual_quality(_video) -> QCResult:
    return QCResult("visual_quality", "model", False, None, None, "P2", 4,
                    "SKIPPED — évaluation model-based non exécutée")


SKIPPED = {"audio_transcription", "lip_sync", "visual_quality"}
