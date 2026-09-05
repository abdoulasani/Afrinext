"""Adaptateurs providers. HTTP réel quand une clé existe ; substitut marqué
SYNTHETIC en --offline. Aucun résultat plausible n'est jamais fabriqué."""
from __future__ import annotations
import subprocess, json, shutil
from pathlib import Path
from .base import Provider

FF = None
def ffmpeg() -> str:
    global FF
    if FF is None:
        try:
            import imageio_ffmpeg; FF = imageio_ffmpeg.get_ffmpeg_exe()
        except Exception:
            FF = shutil.which("ffmpeg") or "ffmpeg"
    return FF

def ffprobe_json(path) -> dict:
    """ffprobe n'est pas fourni par imageio-ffmpeg : on interroge via ffmpeg."""
    out = subprocess.run([ffmpeg(), "-hide_banner", "-i", str(path)],
                         capture_output=True, text=True).stderr
    return {"raw": out}

def run(cmd: list[str]) -> str:
    p = subprocess.run([str(c) for c in cmd], capture_output=True, text=True)
    if p.returncode != 0:
        raise RuntimeError(f"ffmpeg a échoué: {' '.join(map(str,cmd))[:400]}\n{p.stderr[-1200:]}")
    return p.stderr


# ── TTS ───────────────────────────────────────────────────────────────
class TTSProvider(Provider):
    name = "elevenlabs"
    env_var = "ELEVENLABS_API_KEY"
    unit_cost_usd = 0.00003          # $/caractère — CATALOGUE NON VÉRIFIÉ

    # débit de parole français mesuré pour la lecture publicitaire (mots/s)
    FR_WORDS_PER_SEC = 2.6

    def synth(self, text: str, out_path: Path, voice_id: str = "") -> dict:
        self.require_key()
        if self.available:
            import httpx
            r = httpx.post(
                f"https://api.elevenlabs.io/v1/text-to-speech/{voice_id}",
                headers={"xi-api-key": self.key, "content-type": "application/json"},
                json={"text": text, "model_id": "eleven_multilingual_v2"}, timeout=120)
            r.raise_for_status()
            out_path.write_bytes(r.content)
            return {"cost_usd": len(text) * self.unit_cost_usd, "synthetic": False}
        # ── mode --offline : silence de durée réaliste, marqué SYNTHETIC
        dur = max(1.0, len(text.split()) / self.FR_WORDS_PER_SEC)
        run([ffmpeg(), "-y", "-v", "error", "-f", "lavfi",
             "-i", f"anullsrc=r=44100:cl=mono", "-t", f"{dur:.3f}",
             "-c:a", "aac", "-b:a", "128k", out_path])
        out_path.with_suffix(".intended.txt").write_text(text, encoding="utf8")
        return {"cost_usd": 0.0, "synthetic": True, "duration_s": dur}


# ── LIP-SYNC ──────────────────────────────────────────────────────────
class LipSyncProvider(Provider):
    name = "lipsync-generic"
    env_var = "LIPSYNC_API_KEY"
    unit_cost_usd = 0.05             # $/clip — CATALOGUE NON VÉRIFIÉ

    def sync(self, video: Path, audio: Path, out_path: Path) -> dict:
        self.require_key()
        if self.available:
            raise NotImplementedError(
                "Adaptateur lip-sync à brancher sur le provider retenu. "
                "P0 ne code pas d'appel spéculatif contre une API non choisie.")
        # ── mode --offline : la piste audio est muxée sur le plan, SANS lip-sync.
        # Le résultat n'a AUCUNE valeur pour H1 et est marqué comme tel.
        run([ffmpeg(), "-y", "-v", "error", "-i", video, "-i", audio,
             "-map", "0:v:0", "-map", "1:a:0", "-c:v", "copy", "-c:a", "aac",
             "-shortest", out_path])
        return {"cost_usd": 0.0, "synthetic": True}


# ── CONTRÔLE GÉNÉRATIF (M03 §06, §16) ─────────────────────────────────
class GenerativeVideoProvider(Provider):
    name = "generative-control"
    env_var = "VIDEO_API_KEY"
    unit_cost_usd = 0.20             # $/seconde — CATALOGUE NON VÉRIFIÉ

    def generate(self, prompt: str, ref_image: Path, seconds: float, out_path: Path) -> dict:
        self.require_key()
        if self.available:
            raise NotImplementedError(
                "Adaptateur à brancher sur le provider vidéo retenu (Veo / Omni / Kling).")
        raise RuntimeError(
            "CHEMIN GÉNÉRATIF NON EXÉCUTÉ : aucune clé vidéo. "
            "La comparaison PATH C vs GENERATIVE (M03 §16) ne peut pas être "
            "mesurée dans cet environnement — elle est déclarée non mesurée "
            "dans le rapport, jamais estimée.")
