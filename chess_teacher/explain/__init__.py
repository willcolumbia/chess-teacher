"""Explainers turn engine findings into coaching text.

Pick one with the CHESS_TEACHER_EXPLAINER environment variable ("rules" by default).
A Claude-powered explainer can be added later by subclassing Explainer and
registering it in EXPLAINERS.
"""
from __future__ import annotations

import os

from .base import Explainer, Explanation, MoveContext
from .rules import RuleExplainer

EXPLAINERS = {
    "rules": RuleExplainer,
}


def get_explainer(name: str = "") -> Explainer:
    name = name or os.environ.get("CHESS_TEACHER_EXPLAINER", "rules")
    try:
        return EXPLAINERS[name]()
    except KeyError:
        raise ValueError(f"Unknown explainer {name!r}. Available: {', '.join(EXPLAINERS)}")


__all__ = ["Explainer", "Explanation", "MoveContext", "get_explainer"]
