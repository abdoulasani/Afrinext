"""Génération des actifs de test P0 : produit de marque synthétique (§04) et
banque de plans de substitution (§05).

TOUT ce qui est produit ici est marqué synthetic=True. Ces actifs permettent de
mesurer les étapes DÉTERMINISTES (compositing, montage, rendu, QC). Ils ne
permettent PAS de juger H1 (qualité perçue) — le rapport le dit explicitement.
"""
from __future__ import annotations
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
from .models import ProductAsset, Shot
from .providers.impl import ffmpeg, run

W, H = 1080, 1920
BRAND = "KARITÉ D'OR"
SUBTITLE_TXT = "BEURRE DE KARITÉ PUR"
NET = "200 g"


def _font(size: int):
    for p in ["/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
              "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"]:
        if Path(p).exists():
            return ImageFont.truetype(p, size)
    return ImageFont.load_default()


def make_product(outdir: Path) -> ProductAsset:
    """Pot de crème avec logo, nom de marque et texte de packaging — c'est
    volontairement un produit AVEC branding (§04 interdit de tricher)."""
    outdir.mkdir(parents=True, exist_ok=True)
    views = {}
    for view, w, h in [("front", 520, 700), ("side", 420, 700), ("back", 520, 700)]:
        img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
        d = ImageDraw.Draw(img)
        # corps du pot
        d.rounded_rectangle([20, 90, w - 20, h - 20], radius=42, fill=(238, 231, 216, 255),
                            outline=(120, 104, 78, 255), width=5)
        # couvercle
        d.rounded_rectangle([8, 20, w - 8, 120], radius=28, fill=(58, 84, 66, 255))
        # bandeau étiquette
        d.rectangle([40, 250, w - 40, 520], fill=(58, 84, 66, 255))
        if view != "side":
            f1, f2, f3 = _font(46), _font(26), _font(22)
            # logo : losange
            cx = w // 2
            d.polygon([(cx, 285), (cx + 34, 322), (cx, 359), (cx - 34, 322)],
                      fill=(213, 178, 92, 255))
            t = BRAND if view == "front" else "INGRÉDIENTS"
            tw = d.textlength(t, font=f1); d.text((cx - tw / 2, 375), t, font=f1, fill=(255, 255, 255))
            t2 = SUBTITLE_TXT if view == "front" else "100% KARITÉ · SANS PARFUM"
            tw = d.textlength(t2, font=f2); d.text((cx - tw / 2, 435), t2, font=f2, fill=(213, 178, 92))
            tw = d.textlength(NET, font=f3); d.text((cx - tw / 2, 478), NET, font=f3, fill=(255, 255, 255))
        p = outdir / f"product_{view}.png"; img.save(p); views[view] = str(p)

    masks = {}
    for k, v in views.items():
        im = Image.open(v); a = im.split()[-1]
        mp = outdir / f"mask_{k}.png"; a.save(mp); masks[k] = str(mp)

    return ProductAsset(
        product_id="prd_test_karite", name="Beurre de karité pur 200 g", brand=BRAND,
        views=views, masks=masks,
        packaging_text=[BRAND, SUBTITLE_TXT, NET],
        logo_box=(226, 285, 68, 74), synthetic=True)


def make_shot_bank(outdir: Path, seconds: float = 4.0, fps: int = 25) -> list[Shot]:
    """Banque de 10 plans (§05). Substituts géométriques : figure stylisée, cadrage
    correct, EMPLACEMENT PRODUIT défini. Aucune prétention de réalisme humain."""
    outdir.mkdir(parents=True, exist_ok=True)
    specs = [
        ("s01_talking_medium",  "talking_medium",  None,          None),
        ("s02_talking_close",   "talking_close",   None,          None),
        ("s03_holding_product", "holding_product", "hand_right",  (620, 980, 300, 400)),
        ("s04_showing_product", "showing_product", "front_center", (330, 820, 420, 560)),
        ("s05_looking_product", "looking_product", "hand_right",  (640, 900, 280, 380)),
        ("s06_pointing",        "pointing",        "hand_right",  (660, 940, 260, 350)),
        ("s07_reaction",        "reaction",        None,          None),
        ("s08_smiling",         "smiling",         None,          None),
        ("s09_listening",       "listening",       None,          None),
        ("s10_cta",             "cta",             None,          None),
    ]
    shots = []
    for sid, kind, slot, box in specs:
        img = Image.new("RGB", (W, H), (232, 226, 216))
        d = ImageDraw.Draw(img)
        d.rectangle([0, 0, W, 620], fill=(206, 214, 205))          # mur
        d.ellipse([300, 380, 780, 900], fill=(196, 152, 116))       # tête
        d.rounded_rectangle([250, 860, 830, 1700], radius=90, fill=(70, 96, 120))  # buste
        close = kind == "talking_close"
        mouth = (470, 730, 140, 46) if not close else (430, 700, 220, 70)
        d.rounded_rectangle([mouth[0], mouth[1], mouth[0] + mouth[2], mouth[1] + mouth[3]],
                            radius=18, fill=(140, 78, 78))
        if box:
            d.rectangle([box[0], box[1], box[0] + box[2], box[1] + box[3]],
                        outline=(0, 140, 90), width=6)
        f = _font(30)
        d.text((40, 40), f"SYNTHETIC SHOT · {kind}", font=f, fill=(150, 40, 40))
        d.text((40, 84), "substitut géométrique — ne juge pas H1", font=_font(24), fill=(150, 40, 40))
        still = outdir / f"{sid}.png"; img.save(still)
        mp4 = outdir / f"{sid}.mp4"
        run([ffmpeg(), "-y", "-v", "error", "-loop", "1", "-i", still, "-t", f"{seconds}",
             "-vf", f"scale={W}:{H},fps={fps},format=yuv420p", "-c:v", "libx264",
             "-preset", "veryfast", "-crf", "20", mp4])
        shots.append(Shot(shot_id=sid, kind=kind, path=str(mp4), duration_s=seconds,
                          fps=fps, width=W, height=H, product_slot=slot, slot_box=box,
                          mouth_box=mouth, synthetic=True, source="p0.assets.make_shot_bank"))
    return shots
