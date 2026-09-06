"""Adaptateurs providers. HTTP réel quand une clé existe ; substitut marqué
SYNTHETIC en --offline. Aucun résultat plausible n'est jamais fabriqué."""
from __future__ import annotations
import subprocess, json, shutil, os
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


# ── TTS LOCAL RÉEL (espeak-ng) ────────────────────────────────────────
class LocalEspeakTTS(Provider):
    """Moteur TTS RÉEL, local, à synthèse par formants.

    ⚠ CE N'EST PAS un TTS neuronal de qualité produit. Il produit de la vraie
    parole française, mesurable (durée, latence, intelligibilité mécanique),
    mais sa naturalité n'a rien à voir avec ElevenLabs/Cartesia. Il ne répond
    donc PAS à la question de qualité de E2 — il permet en revanche de faire
    tourner la chaîne avec de l'audio réel au lieu du silence.
    """
    name = "espeak-ng-local"
    env_var = ""
    unit_cost_usd = 0.0
    VOICE = "fr-fr"
    SPEED = 145          # mots/min
    PITCH = 42
    AMPLITUDE = 165

    def synth(self, text: str, out_path: Path, voice_id: str = "") -> dict:
        import shutil as _sh, time as _t
        exe = _sh.which("espeak-ng")
        if not exe:
            raise RuntimeError("espeak-ng absent")
        wav = Path(out_path).with_suffix(".wav")
        t0 = _t.perf_counter()
        p = subprocess.run([exe, "-v", self.VOICE, "-s", str(self.SPEED),
                            "-p", str(self.PITCH), "-a", str(self.AMPLITUDE),
                            "-w", str(wav), text], capture_output=True, text=True)
        if p.returncode != 0:
            raise RuntimeError(f"espeak-ng: {p.stderr[:300]}")
        synth_ms = int((_t.perf_counter() - t0) * 1000)
        run([ffmpeg(), "-y", "-v", "error", "-i", wav, "-ar", "44100", "-ac", "1",
             "-c:a", "aac", "-b:a", "128k", out_path])
        wav.unlink(missing_ok=True)
        return {"cost_usd": 0.0, "synthetic": False, "local_engine": True,
                "engine": "espeak-ng-1.51", "voice": self.VOICE,
                "synth_latency_ms": synth_ms}


# ══════════════════════════════════════════════════════════════════════
# ADAPTATEURS GOOGLE CLOUD — seuls providers joignables (voir M05)
# Écrits pour être exécutables dès qu'une clé existe. Sans clé :
# MissingCredentials. Jamais de simulation.
# ══════════════════════════════════════════════════════════════════════

class GoogleTTS(Provider):
    """Google Cloud Text-to-Speech · E2. Endpoint joignable depuis cet environnement."""
    name = "google-tts"
    env_var = "GOOGLE_API_KEY"
    ENDPOINT = "https://texttospeech.googleapis.com/v1/text:synthesize"
    # tarif catalogue NON VÉRIFIÉ — à remplacer par la valeur facturée réelle
    unit_cost_usd = 0.000016          # $/caractère (hypothèse 16 $/1M)

    def __init__(self, offline: bool = False,
                 voice: str = "fr-FR-Neural2-A", language_code: str = "fr-FR"):
        super().__init__(offline)
        self.voice = os.environ.get("TTS_VOICE", voice)
        self.language_code = language_code

    def synth(self, text: str, out_path: Path, voice_id: str = "") -> dict:
        self.require_key()
        import base64, httpx, time as _t
        body = {"input": {"text": text},
                "voice": {"languageCode": self.language_code,
                          "name": voice_id or self.voice},
                "audioConfig": {"audioEncoding": "MP3", "speakingRate": 1.0}}
        t0 = _t.perf_counter()
        r = httpx.post(self.ENDPOINT, params={"key": self.key}, json=body, timeout=90)
        lat = int((_t.perf_counter() - t0) * 1000)
        if r.status_code != 200:
            raise RuntimeError(f"google-tts HTTP {r.status_code}: {r.text[:200]}")
        mp3 = Path(out_path).with_suffix(".mp3")
        mp3.write_bytes(base64.b64decode(r.json()["audioContent"]))
        run([ffmpeg(), "-y", "-v", "error", "-i", mp3, "-ar", "44100", "-ac", "1",
             "-c:a", "aac", "-b:a", "128k", out_path])
        mp3.unlink(missing_ok=True)
        return {"cost_usd": round(len(text) * self.unit_cost_usd, 8),
                "cost_basis": "ESTIMATED_catalogue_non_verifie",
                "synthetic": False, "engine": "google-tts-v1",
                "voice": voice_id or self.voice, "synth_latency_ms": lat}


class GoogleASR(Provider):
    """Google Cloud Speech-to-Text · E4. Fournit les horodatages mot à mot."""
    name = "google-stt"
    env_var = "GOOGLE_API_KEY"
    ENDPOINT = "https://speech.googleapis.com/v1/speech:recognize"
    unit_cost_usd = 0.006             # $/15 s — NON VÉRIFIÉ

    def transcribe(self, audio_path: Path, language_code: str = "fr-FR") -> dict:
        self.require_key()
        import base64, httpx, time as _t
        wav = Path(audio_path).with_suffix(".asr.wav")
        run([ffmpeg(), "-y", "-v", "error", "-i", audio_path,
             "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", wav])
        body = {"config": {"languageCode": language_code, "encoding": "LINEAR16",
                           "sampleRateHertz": 16000, "enableWordTimeOffsets": True,
                           "model": "latest_long"},
                "audio": {"content": base64.b64encode(wav.read_bytes()).decode()}}
        t0 = _t.perf_counter()
        r = httpx.post(self.ENDPOINT, params={"key": self.key}, json=body, timeout=180)
        lat = int((_t.perf_counter() - t0) * 1000)
        wav.unlink(missing_ok=True)
        if r.status_code != 200:
            raise RuntimeError(f"google-stt HTTP {r.status_code}: {r.text[:200]}")
        data = r.json()
        results = data.get("results", [])
        text = " ".join(a["alternatives"][0]["transcript"].strip()
                        for a in results if a.get("alternatives"))
        words = [{"word": w["word"],
                  "start_s": float(str(w.get("startTime", "0s")).rstrip("s")),
                  "end_s": float(str(w.get("endTime", "0s")).rstrip("s"))}
                 for a in results for w in a["alternatives"][0].get("words", [])]
        conf = [a["alternatives"][0].get("confidence") for a in results
                if a.get("alternatives")]
        return {"text": text, "words": words,
                "confidence": (sum(c for c in conf if c) / len(conf)) if conf else None,
                "latency_ms": lat, "cost_usd": 0.0,
                "cost_basis": "ESTIMATED_catalogue_non_verifie", "raw": data}


class GoogleVeo(Provider):
    """Veo via l'API Gemini · E1 (banque de plans) et E5 (contrôle génératif).

    L'API est asynchrone : soumission puis interrogation d'une opération longue.
    Le nom exact du modèle et la forme de la réponse DOIVENT être confirmés sur
    la documentation officielle au moment de l'exécution — ils changent souvent.
    """
    name = "google-veo"
    env_var = "GOOGLE_API_KEY"
    BASE = "https://generativelanguage.googleapis.com/v1beta"
    unit_cost_usd = 0.05              # $/seconde en Lite — NON VÉRIFIÉ

    def __init__(self, offline: bool = False, model: str = "veo-3.1-lite"):
        super().__init__(offline)
        self.model = os.environ.get("VIDEO_MODEL", model)

    def list_models(self) -> list[str]:
        self.require_key()
        import httpx
        r = httpx.get(f"{self.BASE}/models", params={"key": self.key}, timeout=60)
        r.raise_for_status()
        return [m["name"] for m in r.json().get("models", [])]

    def generate(self, prompt: str, out_path: Path, seconds: float = 4.0,
                 reference_image: Path | None = None,
                 aspect_ratio: str = "9:16", poll_s: int = 10,
                 timeout_s: int = 900) -> dict:
        self.require_key()
        import base64, httpx, time as _t
        inst: dict = {"prompt": prompt}
        if reference_image and Path(reference_image).exists():
            inst["image"] = {"bytesBase64Encoded":
                             base64.b64encode(Path(reference_image).read_bytes()).decode(),
                             "mimeType": "image/png"}
        body = {"instances": [inst],
                "parameters": {"aspectRatio": aspect_ratio,
                               "durationSeconds": int(seconds), "sampleCount": 1}}
        t0 = _t.perf_counter()
        r = httpx.post(f"{self.BASE}/models/{self.model}:predictLongRunning",
                       params={"key": self.key}, json=body, timeout=120)
        if r.status_code != 200:
            raise RuntimeError(f"google-veo submit HTTP {r.status_code}: {r.text[:300]}")
        op = r.json().get("name")
        if not op:
            raise RuntimeError(f"google-veo: aucune opération retournée: {r.text[:200]}")
        while _t.perf_counter() - t0 < timeout_s:
            _t.sleep(poll_s)
            p = httpx.get(f"{self.BASE}/{op}", params={"key": self.key}, timeout=60)
            if p.status_code != 200:
                raise RuntimeError(f"google-veo poll HTTP {p.status_code}: {p.text[:200]}")
            d = p.json()
            if d.get("error"):
                raise RuntimeError(f"google-veo erreur: {str(d['error'])[:300]}")
            if d.get("done"):
                vids = (d.get("response", {}).get("generatedSamples")
                        or d.get("response", {}).get("videos") or [])
                if not vids:
                    raise RuntimeError(f"google-veo: réponse sans vidéo: {str(d)[:300]}")
                v = vids[0]
                if "bytesBase64Encoded" in str(v):
                    b64 = v.get("bytesBase64Encoded") or v.get("video", {}).get("bytesBase64Encoded")
                    Path(out_path).write_bytes(base64.b64decode(b64))
                else:
                    uri = v.get("uri") or v.get("video", {}).get("uri")
                    if not uri:
                        raise RuntimeError(f"google-veo: ni bytes ni uri: {str(v)[:200]}")
                    dl = httpx.get(uri, params={"key": self.key}, timeout=300)
                    dl.raise_for_status()
                    Path(out_path).write_bytes(dl.content)
                return {"cost_usd": round(seconds * self.unit_cost_usd, 6),
                        "cost_basis": "ESTIMATED_catalogue_non_verifie",
                        "latency_ms": int((_t.perf_counter() - t0) * 1000),
                        "model": self.model, "operation": op, "synthetic": False}
        raise TimeoutError(f"google-veo: opération {op} non terminée en {timeout_s}s")
