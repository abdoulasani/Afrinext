#!/usr/bin/env python3
"""M07 §08.H — agrégation de l'évaluation aveugle E6.

    python3 aggregate.py responses.csv key.csv

Calcule Publishability Rate, Blind Mean Score, médianes, moyennes, écarts-types
et accord inter-juges. Applique les seuils H1 FIXÉS AVANT L'EXPÉRIENCE.

Ne fabrique jamais de données : un fichier vide produit un rapport vide.
"""
from __future__ import annotations
import csv, json, statistics as st, sys
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

CRITERIA = ["hook", "clarity", "naturalness", "product_fidelity", "visual_quality",
            "audio_quality", "lip_sync", "brand_fit", "cta", "publishability"]

# ── Seuils fixés en M05, AVANT toute donnée. Ne jamais les modifier après coup.
H1 = {"publishability_rate_pass": 0.60, "blind_mean_pass": 3.5,
      "criterion_median_floor": 3.0,
      "publishability_rate_fail": 0.35, "product_fidelity_median_fail": 3.0,
      "agreement_sd_max": 1.2}


def load(path: Path) -> list[dict]:
    if not path.exists():
        return []
    with path.open(encoding="utf8") as f:
        return [r for r in csv.DictReader(f)
                if any((r.get(c) or "").strip() for c in CRITERIA)]


def main():
    resp = load(Path(sys.argv[1] if len(sys.argv) > 1 else "responses.csv"))
    keyp = Path(sys.argv[2]) if len(sys.argv) > 2 else Path("key.csv")
    key = {r["anon_video_id"]: r["ad_id"] for r in load_key(keyp)} if keyp.exists() else {}

    if not resp:
        print("Aucune réponse. E6 = BLOCKED — aucun évaluateur n'a soumis de grille.")
        print("Ce script ne fabrique pas de données.")
        Path("aggregate_report.json").write_text(json.dumps(
            {"status": "BLOCKED", "reason": "aucune réponse",
             "responses": 0}, indent=2, ensure_ascii=False))
        sys.exit(2)

    evaluators = sorted({r["evaluator_id"] for r in resp})
    videos = sorted({r["anon_video_id"] for r in resp})

    def nums(rows, c):
        return [float(r[c]) for r in rows if (r.get(c) or "").strip()]

    per_criterion = {}
    for c in CRITERIA:
        v = nums(resp, c)
        per_criterion[c] = {
            "n": len(v), "min": min(v) if v else None, "max": max(v) if v else None,
            "mean": round(st.mean(v), 3) if v else None,
            "median": round(st.median(v), 3) if v else None,
            "sd": round(st.pstdev(v), 3) if len(v) > 1 else None}

    would = [(r.get("would_publish") or "").strip().upper().replace(" ", "_")
             for r in resp]
    yes = sum(1 for w in would if w == "YES")
    minor = sum(1 for w in would if w in ("YES_WITH_MINOR_EDIT", "YESWITHMINOREDIT"))
    no = sum(1 for w in would if w == "NO")
    total = yes + minor + no
    pub_rate = round((yes + minor) / total, 4) if total else None

    all_scores = [float(r[c]) for r in resp for c in CRITERIA if (r.get(c) or "").strip()]
    blind_mean = round(st.mean(all_scores), 3) if all_scores else None

    # accord inter-juges : écart-type des scores par vidéo, moyenné
    by_video = defaultdict(list)
    for r in resp:
        s = [float(r[c]) for c in CRITERIA if (r.get(c) or "").strip()]
        if s:
            by_video[r["anon_video_id"]].append(st.mean(s))
    sds = [st.pstdev(v) for v in by_video.values() if len(v) > 1]
    agreement_sd = round(st.mean(sds), 3) if sds else None

    # ── verdict H1, seuils inchangés
    medians = [per_criterion[c]["median"] for c in CRITERIA
               if per_criterion[c]["median"] is not None]
    pf_med = per_criterion["product_fidelity"]["median"]
    verdict, why = "INCONCLUSIVE", []
    if (pub_rate is not None and pub_rate >= H1["publishability_rate_pass"]
            and blind_mean is not None and blind_mean >= H1["blind_mean_pass"]
            and medians and min(medians) >= H1["criterion_median_floor"]):
        verdict = "PASS"; why.append("les trois conditions de PASS sont réunies")
    elif ((pub_rate is not None and pub_rate < H1["publishability_rate_fail"])
          or (pf_med is not None and pf_med < H1["product_fidelity_median_fail"])):
        verdict = "FAIL"; why.append("condition de FAIL atteinte")
    else:
        why.append("entre les deux seuils")
    if agreement_sd is not None and agreement_sd > H1["agreement_sd_max"]:
        verdict = "INCONCLUSIVE"
        why.append(f"accord inter-juges insuffisant (écart-type {agreement_sd} > "
                   f"{H1['agreement_sd_max']})")
    if len(evaluators) < 3:
        verdict = "INCONCLUSIVE"
        why.append(f"{len(evaluators)} évaluateur(s) — minimum 3")

    out = {"generated_at": datetime.now(timezone.utc).isoformat(),
           "evaluators": len(evaluators), "videos": len(videos),
           "judgements": total, "thresholds_fixed_in": "M05, avant toute donnée",
           "thresholds": H1,
           "publishability": {"yes": yes, "yes_with_minor_edit": minor, "no": no,
                              "rate": pub_rate},
           "blind_mean_score": blind_mean, "inter_rater_sd": agreement_sd,
           "per_criterion": per_criterion,
           "h1_verdict": verdict, "h1_reasons": why,
           "unblinding_available": bool(key)}
    Path("aggregate_report.json").write_text(json.dumps(out, indent=2, ensure_ascii=False))

    print(f"évaluateurs {len(evaluators)} · vidéos {len(videos)} · jugements {total}")
    print(f"Publishability Rate  {pub_rate}  (YES {yes} · MINOR {minor} · NO {no})")
    print(f"Blind Mean Score     {blind_mean}")
    print(f"Accord inter-juges   écart-type {agreement_sd}")
    print("\ncritère                 méd.  moy.   sd")
    for c in CRITERIA:
        p = per_criterion[c]
        print(f"  {c:<21} {str(p['median']):>5} {str(p['mean']):>5} {str(p['sd']):>5}")
    print(f"\nH1 = {verdict} — {'; '.join(why)}")


def load_key(path: Path) -> list[dict]:
    with path.open(encoding="utf8") as f:
        return list(csv.DictReader(f))


if __name__ == "__main__":
    main()
