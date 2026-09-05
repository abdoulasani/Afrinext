"""Politique de régénération ciblée (M03 §12).
NEVER REGENERATE WHAT DOES NOT NEED TO BE REGENERATED."""
from __future__ import annotations

LEVELS = {
    0: ("edit",      "montage / timing / texte / sous-titres / normalisation"),
    1: ("tts",       "resynthèse audio d'une seule ligne"),
    2: ("lipsync",   "resynchronisation labiale d'une seule scène"),
    3: ("composite", "réincrustation du produit sur une seule scène"),
    4: ("shot",      "remplacement du plan par un autre de la banque"),
    5: ("full",      "régénération complète de la scène"),
}

# Coût marginal attendu par niveau, en unités provider (0 = aucune dépense)
BILLABLE = {0: False, 1: True, 2: True, 3: False, 4: False, 5: True}


def plan_repairs(qc_results) -> list[tuple[int, str]]:
    """Retourne les réparations à tenter, du niveau le moins cher au plus cher."""
    todo = []
    for r in qc_results:
        if r.passed or r.repair is None:
            continue
        if "SKIPPED" in (r.detail or ""):
            continue
        todo.append((r.repair, r.check))
    return sorted(set(todo))


def is_free(level: int) -> bool:
    return not BILLABLE.get(level, True)
