"""Modèle de coût P0 (M03 §17, §23).

IMPORTANT : en mode --offline aucun provider payant n'a été appelé. Le ledger
enregistre donc 0 $ RÉELLEMENT FACTURÉ. Ce module applique des prix catalogue
NON VÉRIFIÉS aux VOLUMES RÉELLEMENT MESURÉS. Le résultat est un coût *modélisé*,
jamais présenté comme un coût observé.
"""
from __future__ import annotations
import json, statistics as st
from pathlib import Path

P0 = Path(__file__).resolve().parents[2]

# ── Prix catalogue — À REVÉRIFIER (bas / base / haut), en USD ─────────
PRICES = {
    "tts_per_1k_chars":   (0.015, 0.030, 0.090),
    "lipsync_per_clip":   (0.020, 0.050, 0.150),
    "generative_per_sec": (0.080, 0.200, 0.500),
    "vcpu_hour":          (0.020, 0.040, 0.060),
    "storage_gb_month":   (0.010, 0.015, 0.023),
    "llm_per_ad":         (0.010, 0.030, 0.080),   # stratégie + script + QC texte
}
IDX = {"low": 0, "base": 1, "high": 2}


def path_c_cost(v: dict, tier: str) -> dict:
    i = IDX[tier]
    tts = v["tts_chars"] / 1000 * PRICES["tts_per_1k_chars"][i]
    lip = v["lip_clips"] * PRICES["lipsync_per_clip"][i]
    cpu = v["cpu_s"] / 3600 * PRICES["vcpu_hour"][i]
    sto = v["mb_per_ad"] / 1024 * PRICES["storage_gb_month"][i]
    llm = PRICES["llm_per_ad"][i]
    return {"tts": tts, "lipsync": lip, "cpu": cpu, "storage": sto, "llm": llm,
            "total": round(tts + lip + cpu + sto + llm, 4)}


def generative_cost(v: dict, tier: str) -> dict:
    """NON MESURÉ — modélisé à partir des secondes vidéo réellement produites."""
    i = IDX[tier]
    gen = v["video_seconds"] * PRICES["generative_per_sec"][i]
    llm = PRICES["llm_per_ad"][i]
    cpu = v["cpu_s"] / 3600 * PRICES["vcpu_hour"][i]
    return {"generative": gen, "llm": llm, "cpu": cpu,
            "total": round(gen + llm + cpu, 4)}


def breakeven_lipsync(v: dict, target=1.00) -> float:
    """Prix maximal du lip-sync par clip pour rester sous `target` $/pub (base)."""
    i = IDX["base"]
    fixed = (v["tts_chars"] / 1000 * PRICES["tts_per_1k_chars"][i]
             + v["cpu_s"] / 3600 * PRICES["vcpu_hour"][i]
             + PRICES["llm_per_ad"][i])
    return round((target - fixed) / max(v["lip_clips"], 1), 4)


def infra_monthly(v: dict, ads_per_month: int, tier="base") -> dict:
    i = IDX[tier]
    variable = path_c_cost(v, tier)["total"] * ads_per_month
    cpu_hours = v["cpu_s"] * ads_per_month / 3600
    storage_gb = v["mb_per_ad"] * ads_per_month / 1024
    baseline = {100: 60, 1000: 180, 10000: 900}[ads_per_month]   # api+db+redis+workers
    return {"ads": ads_per_month, "variable_usd": round(variable, 2),
            "cpu_hours": round(cpu_hours, 1),
            "storage_gb_new": round(storage_gb, 1),
            "baseline_infra_usd": baseline,
            "total_usd": round(variable + baseline, 2)}


def main():
    res = json.loads((P0 / "out" / "results.json").read_text())
    finals = [Path(a["final"]) for a in res if Path(a["final"]).exists()]
    mb = st.median([f.stat().st_size / 1e6 for f in finals]) if finals else 3.0
    v = {
        "tts_chars":      st.median([a["tts_chars"] for a in res]),
        "lip_clips":      st.median([a["lip_clips"] for a in res]),
        "video_seconds":  st.median([a["video_seconds"] for a in res]),
        "cpu_s":          st.median([a["cpu_s"] for a in res]),
        "duration_s":     st.median([a["duration_s"] for a in res]),
        "mb_per_ad":      round(mb * 3, 2),      # final + scènes intermédiaires
    }
    out = {"measured_volumes": v, "prices_unverified": PRICES, "path_c": {}, "generative": {}}
    print("VOLUMES MESURÉS (médiane sur 10 pubs)")
    for k, x in v.items(): print(f"  {k:16} {x}")

    print("\nCOÛT MODÉLISÉ · CHEMIN C ($/pub)")
    for t in ("low", "base", "high"):
        c = path_c_cost(v, t); out["path_c"][t] = c
        print(f"  {t:5} total={c['total']:.4f}   tts={c['tts']:.4f} "
              f"lipsync={c['lipsync']:.4f} llm={c['llm']:.4f} "
              f"cpu={c['cpu']:.5f} storage={c['storage']:.5f}")

    print("\nCOÛT MODÉLISÉ · CONTRÔLE GÉNÉRATIF ($/pub) — NON MESURÉ")
    for t in ("low", "base", "high"):
        c = generative_cost(v, t); out["generative"][t] = c
        print(f"  {t:5} total={c['total']:.4f}   generative={c['generative']:.4f}")

    be = breakeven_lipsync(v)
    out["breakeven_lipsync_per_clip"] = be
    print(f"\nSEUIL DE RUPTURE : prix max du lip-sync pour tenir sous 1,00 $/pub "
          f"= {be:.4f} $/clip  (soit {be/PRICES['lipsync_per_clip'][1]:.1f}x le prix base)")

    print("\nINFRA MENSUELLE ESTIMÉE (base)")
    out["infra"] = {}
    for n in (100, 1000, 10000):
        m = infra_monthly(v, n); out["infra"][str(n)] = m
        print(f"  {n:>6} pubs/mois : variable {m['variable_usd']:>8.2f} $ "
              f"+ socle {m['baseline_infra_usd']:>4} $ = {m['total_usd']:>8.2f} $ "
              f"({m['cpu_hours']} h CPU, +{m['storage_gb_new']} Go)")

    # ── B5 : budget banque de plans, à partir du besoin mesuré ────────
    shots_per_char = 10
    per_shot = {"low": 0.60, "base": 1.60, "high": 4.00}     # 8 s génératif premium
    print("\nB5 · BANQUE DE PLANS (4 personnages × 10 plans × 1 marché)")
    out["b5"] = {}
    for t, p in per_shot.items():
        capex = 4 * shots_per_char * p
        retries = capex * 2.5          # sélection : ~2-3 générations retenues sur 1
        out["b5"][t] = {"capex_1_marche": round(retries, 2),
                        "capex_3_marches": round(retries * 3, 2),
                        "maintenance_annuelle": round(retries * 0.4, 2)}
        print(f"  {t:5} 1 marché={retries:8.2f} $ · 3 marchés={retries*3:8.2f} $ "
              f"· maintenance/an={retries*0.4:7.2f} $")

    (P0 / "out" / "costmodel.json").write_text(json.dumps(out, indent=2), encoding="utf8")


if __name__ == "__main__":
    main()
