"""Compositing produit (M03 §08) + montage/rendu (§10). Entièrement déterministe."""
from __future__ import annotations
from pathlib import Path
from PIL import Image
from .models import Shot, ProductAsset, ScriptLine
from .providers.impl import ffmpeg, run

W, H = 1080, 1920


def composite_product(shot: Shot, product: ProductAsset, audio: Path,
                      out: Path, mode: str = "held") -> dict:
    """A: tenu · B: présenté face caméra · C: hero shot.

    Le packaging N'EST PAS redessiné : l'asset réel est masqué, mis à l'échelle
    et incrusté. C'est exactement la stratégie S1 du M02.
    """
    view = "front"
    src = product.views[view]
    if mode == "hero":
        pw = int(W * 0.62); box = ((W - pw) // 2, int(H * 0.30), pw, 0)
    else:
        if not shot.slot_box:
            raise ValueError(f"{shot.shot_id} n'a pas d'emplacement produit")
        box = shot.slot_box

    im = Image.open(src)
    scale = box[2] / im.width
    tw, th = int(im.width * scale), int(im.height * scale)
    x, y = box[0], box[1]

    if mode == "hero":
        # léger mouvement de caméra sur le produit — mise en valeur (§10)
        vf = (f"[1:v]scale={tw}:{th}[p];"
              f"[0:v][p]overlay=x={x}:y={y}+'sin(t*1.2)*8':shortest=1[v]")
    else:
        vf = (f"[1:v]scale={tw}:{th}[p];"
              f"[0:v][p]overlay=x={x}:y={y}:shortest=1[v]")

    # FIX F-001 : l'image produit est une entrée fixe ; sans `-loop 1` elle ne dure
    # qu'une frame et `-shortest` ramène toute la scène à 0,04 s.
    run([ffmpeg(), "-y", "-v", "error",
         "-i", shot.path, "-loop", "1", "-i", src, "-i", audio,
         "-filter_complex", vf, "-map", "[v]", "-map", "2:a:0",
         "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
         "-c:a", "aac", "-shortest", "-pix_fmt", "yuv420p", out])
    return {"placement": {"x": x, "y": y, "w": tw, "h": th}, "mode": mode, "view": view}


def _ass(lines: list[tuple[float, float, str]], cta: str, duration: float) -> str:
    """Sous-titres ASS + carte CTA finale. `drawtext` est absent du build ffmpeg
    disponible : tout le texte passe donc par ASS, ce qui est de toute façon
    préférable (styles, contours, safe zones)."""
    def ts(t):
        h = int(t // 3600); m = int(t % 3600 // 60); s = t % 60
        return f"{h}:{m:02d}:{s:05.2f}"
    head = f"""[Script Info]
ScriptType: v4.00+
PlayResX: {W}
PlayResY: {H}
WrapStyle: 0

[V4+ Styles]
Format: Name,Fontname,Fontsize,PrimaryColour,OutlineColour,BackColour,Bold,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding
Style: Sub,DejaVu Sans,68,&H00FFFFFF,&H00000000,&H80000000,-1,1,5,2,2,90,90,300,1
Style: CTA,DejaVu Sans,86,&H0043D6A5,&H00202020,&H00000000,-1,1,6,0,5,80,80,0,1

[Events]
Format: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text
"""
    ev = [f"Dialogue: 0,{ts(a)},{ts(b)},Sub,,0,0,0,,{t}" for a, b, t in lines]
    ev.append(f"Dialogue: 1,{ts(max(0,duration-2.2))},{ts(duration)},CTA,,0,0,0,,{cta}")
    return head + "\n".join(ev) + "\n"


def render_final(scenes: list[Path], sub_lines, cta_text: str, out: Path,
                 workdir: Path) -> dict:
    """Concat + sous-titres brûlés + normalisation audio + 9:16 1080x1920."""
    workdir.mkdir(parents=True, exist_ok=True)
    lst = workdir / "concat.txt"
    lst.write_text("".join(f"file '{Path(s).resolve()}'\n" for s in scenes))
    joined = workdir / "joined.mp4"
    run([ffmpeg(), "-y", "-v", "error", "-f", "concat", "-safe", "0", "-i", lst,
         "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
         "-c:a", "aac", "-pix_fmt", "yuv420p", joined])

    dur = probe_duration(joined)
    ass = workdir / "subs.ass"
    ass.write_text(_ass(sub_lines, cta_text, dur), encoding="utf8")

    run([ffmpeg(), "-y", "-v", "error", "-i", joined,
         "-vf", f"subtitles={ass.as_posix()}:fontsdir=/usr/share/fonts,scale={W}:{H}",
         "-af", "loudnorm=I=-14:TP=-1.5:LRA=11",
         "-c:v", "libx264", "-preset", "medium", "-crf", "21",
         "-c:a", "aac", "-b:a", "128k", "-pix_fmt", "yuv420p", "-r", "25", out])
    return {"duration_s": probe_duration(out), "subtitle_file": str(ass)}


def probe_duration(path) -> float:
    import subprocess, re
    err = subprocess.run([ffmpeg(), "-hide_banner", "-i", str(path)],
                         capture_output=True, text=True).stderr
    m = re.search(r"Duration:\s*(\d+):(\d+):([\d.]+)", err)
    if not m: return 0.0
    return int(m[1]) * 3600 + int(m[2]) * 60 + float(m[3])


def probe_streams(path) -> dict:
    import subprocess, re
    err = subprocess.run([ffmpeg(), "-hide_banner", "-i", str(path)],
                         capture_output=True, text=True).stderr
    v = re.search(r"Stream #\d+:\d+.*?Video:\s*(\w+).*?(\d{2,5})x(\d{2,5})", err, re.S)
    a = re.search(r"Stream #\d+:\d+.*?Audio:\s*(\w+)", err)
    fps = re.search(r"([\d.]+)\s+fps", err)
    return {"video_codec": v[1] if v else None,
            "width": int(v[2]) if v else None, "height": int(v[3]) if v else None,
            "audio_codec": a[1] if a else None,
            "fps": float(fps[1]) if fps else None,
            "duration_s": probe_duration(path)}


def extract_frame(video, t: float, out: Path):
    """Renvoie None si la frame ne peut pas être extraite (seek hors durée)."""
    Path(out).parent.mkdir(parents=True, exist_ok=True)
    d = probe_duration(video)
    t = max(0.0, min(t, max(0.0, d - 0.15)))
    try:
        run([ffmpeg(), "-y", "-v", "error", "-ss", f"{t:.3f}", "-i", str(video),
             "-frames:v", "1", out])
    except RuntimeError:
        return None
    return out if Path(out).exists() and Path(out).stat().st_size > 0 else None
