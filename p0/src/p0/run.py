"""Orchestrateur P0 : une publicité de bout en bout, mesurée.

    python3 -m p0.run --offline --all
"""
from __future__ import annotations
import argparse, json, os, time, resource, shutil
from dataclasses import asdict
from pathlib import Path
from datetime import datetime, timezone

from .models import AdScript, ScriptLine, AdManifest, sha
from .ledger import Ledger, Trace
from .assets import make_product, make_shot_bank
from .providers.impl import TTSProvider, LipSyncProvider, ffmpeg, run as ffrun
from . import compose, qc as QC, repair as RP

P0 = Path(__file__).resolve().parents[2]   # .../Afrinext/p0
FR_WPS = TTSProvider.FR_WORDS_PER_SEC


def load_scripts(path: Path):
    d = json.loads(Path(path).read_text(encoding="utf8"))
    out = []
    for a in d["ads"]:
        lines = []
        for i, l in enumerate(a["lines"]):
            dur = round(max(1.6, len(l["text"].split()) / FR_WPS), 2)
            lines.append(ScriptLine(i, l["role"], l["text"], dur, l["shot"],
                                    l["product"], l.get("ost")))
        out.append((AdScript(a["ad_id"], a["hook_type"], d["language"], d["market"],
                             lines, d["cta_channel"], list(d["facts"])), a))
    return d, out


def cpu_seconds() -> float:
    r = resource.getrusage(resource.RUSAGE_CHILDREN)
    return r.ru_utime + r.ru_stime


def produce(ad: AdScript, raw: dict, facts: dict, product, shots, outdir: Path,
            ledger: Ledger, offline: bool, inject: str | None = None) -> dict:
    tr = Trace()
    wd = outdir / ad.ad_id; wd.mkdir(parents=True, exist_ok=True)
    by_kind = {s.kind: s for s in shots}
    tts, lip = TTSProvider(offline=offline), LipSyncProvider(offline=offline)
    cpu0 = cpu_seconds()
    synthetic_stages, scenes, sub_lines, slots_for_qc = set(), [], [], []
    tts_chars = lip_clips = 0
    t_cursor = 0.0
    tr.mark("T1_strategy")

    fact_qc = QC.qc_script_factuality([l.text for l in ad.lines], facts)
    tr.mark("T2_script")

    first_pixel_marked = False
    for line in ad.lines:
        shot = by_kind.get(line.shot_kind) or by_kind["talking_medium"]

        # ── 1. TTS ────────────────────────────────────────────────
        audio = wd / f"a{line.index}.m4a"
        with ledger.op(ad.ad_id, "tts", tts.name, "synthesize", line.text[:40]) as box:
            res = tts.synth(line.text, audio)
            # FIX F-002 : le planificateur et le synthétiseur utilisaient deux
            # formules de durée. On aligne en complétant par du silence — c'est
            # une réparation de niveau 0, gratuite, et c'est le comportement
            # correct en production (le silence de fin est absorbé au montage).
            if compose.probe_duration(audio) < line.duration_s - 0.05:
                ffrun([ffmpeg(), "-y", "-v", "error", "-i", audio,
                       "-af", f"apad=whole_dur={line.duration_s:.3f}",
                       "-c:a", "aac", wd / "pad.m4a"])
                shutil.move(wd / "pad.m4a", audio)
            if inject == "short_audio" and line.index == 1:
                ffrun([ffmpeg(), "-y", "-v", "error", "-i", audio, "-t",
                       f"{line.duration_s*0.5:.2f}", "-c", "copy", wd / "tmp.m4a"])
                shutil.move(wd / "tmp.m4a", audio)
            tts_chars += len(line.text)
            box["output_ref"] = audio.name
            box["cost_usd"] = res["cost_usd"]
            box["synthetic"] = res.get("synthetic", False)
        if res.get("synthetic"): synthetic_stages.add("tts")

        # ── 2. LIP-SYNC ───────────────────────────────────────────
        synced = wd / f"s{line.index}_sync.mp4"
        with ledger.op(ad.ad_id, "lipsync", lip.name, "sync", shot.shot_id) as box:
            r2 = lip.sync(Path(shot.path), audio, synced)
            lip_clips += 1
            box["output_ref"] = synced.name; box["cost_usd"] = r2["cost_usd"]
        if r2.get("synthetic"): synthetic_stages.add("lipsync")
        if line.index == 0: tr.mark("T3_audio"); tr.mark("T4_lipsync")

        # ── 3. COMPOSITING PRODUIT ────────────────────────────────
        scene = wd / f"scene{line.index}.mp4"
        if line.product_presence != "none" and shot.slot_box:
            box_used = shot.slot_box
            if inject == "bad_slot" and line.index == 2:
                box_used = (60, 120, 120, 160)          # emplacement volontairement faux
            s2 = compose.Shot(**{**asdict(shot), "slot_box": box_used})
            with ledger.op(ad.ad_id, "composite", "ffmpeg", "overlay_product",
                           shot.shot_id) as bx:
                meta = compose.composite_product(
                    s2, product, audio, scene,
                    mode="hero" if line.product_presence == "shown" else "held")
                bx["output_ref"] = scene.name
            slots_for_qc.append((t_cursor + line.duration_s / 2,
                                 (meta["placement"]["x"], meta["placement"]["y"],
                                  meta["placement"]["w"], meta["placement"]["h"])))
        else:
            with ledger.op(ad.ad_id, "composite", "ffmpeg", "mux_scene", shot.shot_id) as bx:
                ffrun([ffmpeg(), "-y", "-v", "error", "-i", shot.path, "-i", audio,
                       "-map", "0:v:0", "-map", "1:a:0", "-c:v", "libx264",
                       "-preset", "veryfast", "-crf", "20", "-c:a", "aac",
                       "-shortest", "-pix_fmt", "yuv420p", scene])
                bx["output_ref"] = scene.name

        if not first_pixel_marked:
            tr.mark("T5_composite"); tr.mark("T6_first_pixel"); first_pixel_marked = True

        actual = compose.probe_duration(scene)
        scenes.append((scene, line, actual))
        if line.on_screen_text:
            sub_lines.append((t_cursor, t_cursor + actual, line.on_screen_text))
        t_cursor += actual

    # ── 4. MONTAGE + RENDU ───────────────────────────────────────
    final = wd / f"{ad.ad_id}.mp4"
    cta_text = "WhatsApp  ›  " + facts.get("contact", "WhatsApp")
    with ledger.op(ad.ad_id, "render", "ffmpeg", "final_render") as bx:
        rmeta = compose.render_final([s for s, _, _ in scenes], sub_lines,
                                     cta_text, final, wd / "work")
        bx["output_ref"] = final.name
    tr.mark("T7_final_render")

    # ── 5. QC ────────────────────────────────────────────────────
    dur = rmeta["duration_s"]
    results = [
        fact_qc,
        QC.qc_render_validity(final),
        QC.qc_aspect_ratio(final),
        QC.qc_duration(final, ad.total_duration_s),
        QC.qc_scene_durations([(l.role, a, l.duration_s) for _, l, a in scenes]),
        QC.qc_black_frames(final),
        QC.qc_subtitles(Path(rmeta["subtitle_file"]), dur),
        QC.qc_cta_present(Path(rmeta["subtitle_file"]), "WhatsApp"),
        QC.qc_audio_transcription(None, None),
        QC.qc_lip_sync(final),
        QC.qc_visual_quality(final),
    ]
    if slots_for_qc:
        results.append(QC.qc_product_presence(final, Path(product.views["front"]),
                                              slots_for_qc, wd / "qcframes"))
        t, b = slots_for_qc[0]
        results.append(QC.qc_logo_preservation(final, Path(product.views["front"]),
                                               t, b, product.logo_box, wd / "qcframes"))
    tr.mark("T8_qc_done")

    # ── 6. RÉPARATION CIBLÉE (§12) — du niveau le moins cher au plus cher
    repair_log = []
    rounds = 0
    while rounds < 2:
        todo = RP.plan_repairs(results)
        todo = [(lv, ck) for lv, ck in todo if ck not in ("script_factuality",)]
        # FIX F-005 : diagnostic de cause racine avant de choisir le niveau.
        sd = next((r for r in results if r.check == "scene_duration" and not r.passed), None)
        if sd and any(a_ < p_ - 0.3 for _, a_, p_ in (sd.value or [])):
            todo = [(1, "scene_duration")] + [t for t in todo if t[1] != "scene_duration"]
            todo.sort(key=lambda t: (t[1] != "scene_duration", t[0]))
        if not todo:
            break
        rounds += 1
        level, check = todo[0]
        t_rep = time.perf_counter()
        applied = None
        if level == 3 and slots_for_qc:
            # réincrustation avec l'emplacement nominal du plan (annule bad_slot)
            new_slots = []   # FIX F-003 : on reconstruit la vérité QC, on ne la patche pas
            for idx, (ln, sc) in enumerate([(l, s_) for s_, l, _ in scenes]):
                if ln.product_presence != "none":
                    sh = by_kind.get(ln.shot_kind)
                    if not (sh and sh.slot_box):
                        continue
                    with ledger.op(ad.ad_id, "composite", "ffmpeg", "repair_recomposite",
                                   sh.shot_id, repair_level=3) as bx:
                        meta = compose.composite_product(
                            sh, product, wd / f"a{ln.index}.m4a", sc,
                            mode="hero" if ln.product_presence == "shown" else "held")
                        bx["output_ref"] = Path(sc).name
                    new_slots.append((meta["placement"]["x"], meta["placement"]["y"],
                                      meta["placement"]["w"], meta["placement"]["h"]))
            if new_slots:
                cur_t, rebuilt = 0.0, []
                for s_, l_, a_ in scenes:
                    if l_.product_presence != "none" and by_kind.get(l_.shot_kind) \
                            and by_kind[l_.shot_kind].slot_box:
                        rebuilt.append((cur_t + a_ / 2, new_slots[len(rebuilt)]
                                        if len(rebuilt) < len(new_slots) else new_slots[-1]))
                    cur_t += a_
                slots_for_qc = rebuilt or slots_for_qc
            applied = "recomposite"
        elif level == 1:
            bad = {n for n, a_, p_ in
                   [(l.role, a_, l.duration_s) for _, l, a_ in scenes]
                   if abs(a_ - p_) > max(0.35, p_ * 0.25)}
            for s_, ln, _ in scenes:
                if ln.role not in bad:
                    continue
                au = wd / f"a{ln.index}.m4a"
                with ledger.op(ad.ad_id, "tts", tts.name, "repair_resynth",
                               ln.text[:30], repair_level=1) as bx:
                    rr = tts.synth(ln.text, au)
                    ffrun([ffmpeg(), "-y", "-v", "error", "-i", au, "-af",
                           f"apad=whole_dur={ln.duration_s:.3f}", "-c:a", "aac",
                           wd / "pad2.m4a"])
                    shutil.move(wd / "pad2.m4a", au)
                    bx["output_ref"] = au.name; bx["cost_usd"] = rr["cost_usd"]
                sh = by_kind.get(ln.shot_kind) or by_kind["talking_medium"]
                if ln.product_presence != "none" and sh.slot_box:
                    compose.composite_product(
                        sh, product, au, s_,
                        mode="hero" if ln.product_presence == "shown" else "held")
                else:
                    ffrun([ffmpeg(), "-y", "-v", "error", "-i", sh.path, "-i", au,
                           "-map", "0:v:0", "-map", "1:a:0", "-c:v", "libx264",
                           "-preset", "veryfast", "-crf", "20", "-c:a", "aac",
                           "-shortest", "-pix_fmt", "yuv420p", s_])
            applied = "resynth_audio"
        elif level == 0:
            applied = "re_edit"
        else:
            break

        # re-montage (niveau 0, toujours gratuit) puis re-QC
        with ledger.op(ad.ad_id, "render", "ffmpeg", "repair_render",
                       repair_level=0) as bx:
            scenes = [(s_, l, compose.probe_duration(s_)) for s_, l, _ in scenes]
            sub_lines, cur = [], 0.0
            for s_, l, a_ in scenes:
                if l.on_screen_text:
                    sub_lines.append((cur, cur + a_, l.on_screen_text))
                cur += a_
            rmeta = compose.render_final([s_ for s_, _, _ in scenes], sub_lines,
                                         cta_text, final, wd / "work")
            bx["output_ref"] = final.name
        dur = rmeta["duration_s"]
        prev = [(r.check, r.passed) for r in results]
        results = [
            fact_qc,
            QC.qc_render_validity(final), QC.qc_aspect_ratio(final),
            QC.qc_duration(final, ad.total_duration_s),
            QC.qc_scene_durations([(l.role, a_, l.duration_s) for _, l, a_ in scenes]),
            QC.qc_black_frames(final),
            QC.qc_subtitles(Path(rmeta["subtitle_file"]), dur),
            QC.qc_cta_present(Path(rmeta["subtitle_file"]), "WhatsApp"),
            QC.qc_audio_transcription(None, None), QC.qc_lip_sync(final),
            QC.qc_visual_quality(final),
        ]
        if slots_for_qc:
            results.append(QC.qc_product_presence(final, Path(product.views["front"]),
                                                  slots_for_qc, wd / "qcframes"))
            t, b = slots_for_qc[0]
            results.append(QC.qc_logo_preservation(final, Path(product.views["front"]),
                                                   t, b, product.logo_box, wd / "qcframes"))
        repair_log.append({"round": rounds, "level": level, "trigger": check,
                           "action": applied, "free": RP.is_free(level),
                           "latency_ms": int((time.perf_counter() - t_rep) * 1000),
                           "fixed": [c for c, p in prev
                                     if not p and any(r.check == c and r.passed for r in results)]})

    cpu_used = round(cpu_seconds() - cpu0, 2)
    man = AdManifest(
        ad_id=ad.ad_id, produced_at=datetime.now(timezone.utc).isoformat(),
        script_hash=sha([asdict(l) for l in ad.lines]),
        product_id=product.product_id, character_id="char_p0_synthetic",
        shots_used=[by_kind.get(l.shot_kind, by_kind["talking_medium"]).shot_id
                    for l in ad.lines],
        providers={"tts": tts.name, "lipsync": lip.name, "render": "ffmpeg"},
        synthetic_stages=sorted(synthetic_stages | {"shot_bank", "product"}),
        outputs={"final": str(final), "duration_s": dur},
        total_cost_usd=0.0,
        qc=[asdict(r) for r in results],
        timings_ms=tr.summary())
    (wd / "manifest.json").write_text(man.to_json(), encoding="utf8")

    return {"ad_id": ad.ad_id, "hook": ad.hook_type, "final": str(final),
            "duration_s": dur, "qc": results, "timings": tr.summary(),
            "cpu_s": cpu_used, "tts_chars": tts_chars, "lip_clips": lip_clips,
            "video_seconds": round(sum(a for _, _, a in scenes), 2),
            "synthetic_stages": man.synthetic_stages,
            "repairs_remaining": RP.plan_repairs(results),
            "repair_log": repair_log, "injected": inject}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--offline", action="store_true")
    ap.add_argument("--all", action="store_true")
    ap.add_argument("--ad", default=None)
    ap.add_argument("--out", default=str(P0 / "out"))
    args = ap.parse_args()

    out = Path(args.out); out.mkdir(parents=True, exist_ok=True)
    ledger = Ledger(out / "ledger.jsonl")
    doc, ads = load_scripts(P0 / "data" / "scripts" / "ads.json")
    product = make_product(P0 / "data" / "product")
    shots = make_shot_bank(P0 / "data" / "shots")

    # injections de faute contrôlées, pour MESURER la réparation ciblée (§12)
    inject_map = {"AD03": "bad_slot", "AD07": "short_audio"}

    results = []
    for ad, raw in ads:
        if args.ad and ad.ad_id != args.ad: continue
        t0 = time.perf_counter()
        r = produce(ad, raw, doc["facts"], product, shots, out, ledger,
                    args.offline, inject_map.get(ad.ad_id))
        r["wall_s"] = round(time.perf_counter() - t0, 2)
        results.append(r)
        passed = sum(1 for x in r["qc"] if x.passed)
        skipped = sum(1 for x in r["qc"] if "SKIPPED" in (x.detail or ""))
        print(f"{r['ad_id']}  {r['duration_s']:5.1f}s  "
              f"QC {passed}/{len(r['qc'])-skipped} (skip {skipped})  "
              f"{r['wall_s']:5.1f}s wall  {r['cpu_s']:5.1f}s cpu"
              + (f"  [faute injectée: {r['injected']}]" if r["injected"] else ""))

    (out / "results.json").write_text(json.dumps(
        [{**r, "qc": [asdict(x) for x in r["qc"]]} for r in results],
        indent=2, ensure_ascii=False), encoding="utf8")
    print(f"\n{len(results)} publicités · ledger {len(ledger.entries)} opérations "
          f"· coût facturé réel {ledger.total()} USD (mode offline = rien payé)")


if __name__ == "__main__":
    main()
