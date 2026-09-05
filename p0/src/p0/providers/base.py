"""Interfaces provider.

RÈGLE ANTI-FABRICATION (M03 §27) : un provider sans clé d'API ne fabrique JAMAIS
un résultat plausible. Soit il lève `MissingCredentials`, soit — en mode --offline
explicite — il renvoie un artefact de substitution marqué `synthetic=True`, qui
est propagé jusqu'au manifeste et jusqu'au rapport.
"""
from __future__ import annotations
import os


class MissingCredentials(RuntimeError):
    def __init__(self, provider: str, env_var: str):
        super().__init__(
            f"{provider}: clé absente (${env_var}). "
            f"P0 ne simule pas ce provider. Fournir la clé, ou lancer en --offline "
            f"(les sorties seront marquées SYNTHETIC et ne prouvent PAS H1).")
        self.provider, self.env_var = provider, env_var


class Provider:
    name = "abstract"
    env_var = ""
    unit_cost_usd = 0.0          # prix catalogue — NON VÉRIFIÉ, voir config/providers.yaml

    def __init__(self, offline: bool = False):
        self.offline = offline
        self.key = os.environ.get(self.env_var) if self.env_var else None

    def require_key(self):
        if not self.key and not self.offline:
            raise MissingCredentials(self.name, self.env_var)

    @property
    def available(self) -> bool:
        return bool(self.key)
