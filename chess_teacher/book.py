"""Opening theory from the Lichess chess-openings dataset: book positions and opening names."""
from __future__ import annotations

import csv
import re
from functools import lru_cache
from pathlib import Path
from typing import Dict, Optional, Set, Tuple

import chess

DATA = Path(__file__).parent / "data" / "openings"


@lru_cache(maxsize=1)
def _load() -> Tuple[Set[str], Dict[str, Tuple[str, str]]]:
    """(every position reached by a book line, {position: (eco, name)} for named lines' ends)."""
    positions: Set[str] = set()
    names: Dict[str, Tuple[str, str]] = {}
    for path in sorted(DATA.glob("*.tsv")):
        with open(path, newline="", encoding="utf-8") as f:
            for row in csv.DictReader(f, delimiter="\t"):
                board = chess.Board()
                for san in re.sub(r"\d+\.", " ", row["pgn"]).split():
                    board.push_san(san)
                    positions.add(board.epd())
                names[board.epd()] = (row["eco"], row["name"])
    return positions, names


def is_book(board: chess.Board) -> bool:
    """Is the current position part of opening theory?"""
    return board.epd() in _load()[0]


def opening_name(board: chess.Board) -> Optional[Dict[str, str]]:
    """Name of the most specific opening this game passed through, if any."""
    _, names = _load()
    found = None
    walk = board.root()
    for move in board.move_stack:
        walk.push(move)
        if walk.epd() in names:
            eco, name = names[walk.epd()]
            found = {"eco": eco, "name": name}
    return found
