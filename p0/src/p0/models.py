"""Contrats typés du harnais P0. Jetable — voir p0/README.md.

Règle: aucune sortie de provider n'est jamais inventée. Tout artefact produit
sans provider réel porte `synthetic=True` et se propage jusqu'au manifeste.
"""
from __future__ import annotations
from dataclasses import dataclass, field, asdict
from typing import Literal, Optional
import json, hashlib

Stage = Literal["strategy", "script", "tts", "lipsync", "composite", "edit", "render", "qc"]
RepairLevel = Literal[0, 1, 2, 3, 4, 5]


@dataclass
class Fact:
    """Fait fourni par l'entreprise. Seuls ces éléments peuvent devenir des
    affirmations dans le script (M03 §07: séparer FACTS de CREATIVE)."""
    key: str
    value: str
    source: str            # 'business' | 'product_page' | 'user_input'


@dataclass
class ProductAsset:
    product_id: str
    name: str
    brand: str
    views: dict            # {'front': path, 'side': path, 'back': path}
    masks: dict = field(default_factory=dict)
    packaging_text: list[str] = field(default_factory=list)   # vérité terrain pour le QC
    logo_box: Optional[tuple] = None
    synthetic: bool = False


@dataclass
class Shot:
    shot_id: str
    kind: str              # talking_medium | talking_close | holding_product | ...
    path: str
    duration_s: float
    fps: int
    width: int
    height: int
    product_slot: Optional[str] = None      # 'hand_right' | 'front_center' | None
    slot_box: Optional[tuple] = None        # (x, y, w, h) en px, où incruster
    mouth_box: Optional[tuple] = None       # zone bouche, pour le lip-sync
    synthetic: bool = False
    source: str = "unknown"


@dataclass
class ScriptLine:
    index: int
    role: str              # hook | problem | product | proof | cta
    text: str
    duration_s: float
    shot_kind: str
    product_presence: str  # none | held | shown | hero
    on_screen_text: Optional[str] = None

    @property
    def word_count(self) -> int:
        return len(self.text.split())


@dataclass
class AdScript:
    ad_id: str
    hook_type: str
    language: str
    market: str
    lines: list[ScriptLine]
    cta_channel: str
    facts_used: list[str] = field(default_factory=list)

    @property
    def total_duration_s(self) -> float:
        return sum(l.duration_s for l in self.lines)


@dataclass
class LedgerEntry:
    ad_id: str
    stage: Stage
    provider: str
    operation: str
    input_ref: str
    output_ref: str
    duration_ms: int
    cost_usd: float
    attempt: int = 1
    error: Optional[str] = None
    repair_level: Optional[int] = None
    synthetic: bool = False


@dataclass
class QCResult:
    check: str
    kind: Literal["rule", "model"]
    passed: bool
    value: object = None
    threshold: object = None
    severity: Literal["P0", "P1", "P2", "P3"] = "P2"
    repair: Optional[int] = None       # niveau de réparation suggéré
    detail: str = ""


@dataclass
class AdManifest:
    ad_id: str
    produced_at: str
    script_hash: str
    product_id: str
    character_id: str
    shots_used: list[str]
    providers: dict
    synthetic_stages: list[str]        # ← la garantie anti-fabrication
    outputs: dict
    total_cost_usd: float
    qc: list[dict]
    timings_ms: dict

    def to_json(self) -> str:
        return json.dumps(asdict(self), indent=2, ensure_ascii=False)


def sha(obj) -> str:
    return hashlib.sha256(json.dumps(obj, sort_keys=True, default=str).encode()).hexdigest()[:16]
