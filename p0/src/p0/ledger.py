"""Cost ledger + latency trace (M03 §17, §18). Append-only, sérialisé en JSONL."""
from __future__ import annotations
import json, time, contextlib
from pathlib import Path
from dataclasses import asdict
from .models import LedgerEntry


class Ledger:
    def __init__(self, path: Path):
        self.path = Path(path); self.path.parent.mkdir(parents=True, exist_ok=True)
        self.entries: list[LedgerEntry] = []

    def add(self, e: LedgerEntry):
        self.entries.append(e)
        with self.path.open("a") as f:
            f.write(json.dumps(asdict(e), ensure_ascii=False) + "\n")

    @contextlib.contextmanager
    def op(self, ad_id, stage, provider, operation, input_ref="", cost_usd=0.0,
           attempt=1, synthetic=False, repair_level=None):
        t0 = time.perf_counter(); err = None; out = ""
        box = {}
        try:
            yield box
            out = str(box.get("output_ref", ""))
            cost_usd = float(box.get("cost_usd", cost_usd))
        except Exception as ex:
            err = f"{type(ex).__name__}: {ex}"; raise
        finally:
            self.add(LedgerEntry(
                ad_id=ad_id, stage=stage, provider=provider, operation=operation,
                input_ref=str(input_ref), output_ref=out,
                duration_ms=int((time.perf_counter() - t0) * 1000),
                cost_usd=cost_usd, attempt=attempt, error=err,
                repair_level=repair_level, synthetic=synthetic))

    # ── agrégats demandés par M03 §17 ────────────────────────────────
    def total(self) -> float:
        return round(sum(e.cost_usd for e in self.entries), 6)

    def by_stage(self) -> dict:
        d = {}
        for e in self.entries:
            d[e.stage] = round(d.get(e.stage, 0) + e.cost_usd, 6)
        return d

    def by_provider(self) -> dict:
        d = {}
        for e in self.entries:
            d[e.provider] = round(d.get(e.provider, 0) + e.cost_usd, 6)
        return d

    def repair_cost(self) -> float:
        return round(sum(e.cost_usd for e in self.entries if e.repair_level is not None), 6)

    def attempts(self) -> int:
        """Nombre total de tentatives de génération (dénominateur du facteur de régé.)."""
        return sum(1 for e in self.entries if e.stage in ("tts", "lipsync", "composite"))


class Trace:
    """T0..T8 (M03 §18)."""
    MARKS = ["T0_start", "T1_strategy", "T2_script", "T3_audio", "T4_lipsync",
             "T5_composite", "T6_first_pixel", "T7_final_render", "T8_qc_done"]

    def __init__(self):
        self.t: dict[str, float] = {}
        self.mark("T0_start")

    def mark(self, name: str):
        self.t[name] = time.perf_counter()

    def ms(self, a: str, b: str):
        if a in self.t and b in self.t:
            return int((self.t[b] - self.t[a]) * 1000)
        return None

    def summary(self) -> dict:
        s = {m: (int((self.t[m] - self.t["T0_start"]) * 1000) if m in self.t else None)
             for m in self.MARKS}
        s["TTFP_ms"] = self.ms("T0_start", "T6_first_pixel")
        s["time_to_final_ms"] = self.ms("T0_start", "T7_final_render")
        s["time_to_publishable_ms"] = self.ms("T0_start", "T8_qc_done")
        return s
