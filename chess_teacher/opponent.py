"""Stockfish as a sparring partner at an adjustable strength."""
from __future__ import annotations

import math
import random
from typing import Optional

import chess
import chess.engine

from .engine import find_stockfish

MIN_ELO = 400
MAX_ELO = 3000
STOCKFISH_MIN_ELO = 1320  # lowest UCI_Elo Stockfish supports
MOVE_TIME = 0.4  # seconds per engine move


def choose_move(board: chess.Board, elo: int, rng: Optional[random.Random] = None) -> chess.Move:
    """Pick a move for the side to move, playing at roughly `elo`."""
    if board.is_game_over():
        raise ValueError("The game is over.")
    elo = max(MIN_ELO, min(MAX_ELO, elo))
    # A fresh engine per move: startup is quick, and a long-lived engine keeps
    # Python from exiting (its background thread outlives exit hooks).
    with chess.engine.SimpleEngine.popen_uci(find_stockfish()) as engine:
        if elo >= STOCKFISH_MIN_ELO:
            options = {"UCI_LimitStrength": True, "UCI_Elo": elo}
            return engine.play(board, chess.engine.Limit(time=MOVE_TIME), options=options).move
        return _weak_move(engine, board, elo, rng or random.Random())


def _weak_move(
    engine: chess.engine.SimpleEngine, board: chess.Board, elo: int, rng: random.Random
) -> chess.Move:
    """Below Stockfish's own limit: a shallow search, then a weighted random pick among the
    top moves. The lower the rating, the shallower the search, the more often a worse
    move gets picked, and the more often a random move is played. Approximate.
    """
    strength = (elo - MIN_ELO) / (STOCKFISH_MIN_ELO - MIN_ELO)  # 0 at 400, 1 at 1320
    legal = list(board.legal_moves)
    if rng.random() < 0.15 * (1 - strength):
        return rng.choice(legal)

    depth = 1 + round(strength * 5)
    infos = engine.analyse(
        board,
        chess.engine.Limit(depth=depth),
        multipv=min(8, len(legal)),
        options={"UCI_LimitStrength": False},
    )
    candidates = [
        (info["pv"][0], info["score"].relative.score(mate_score=10000)) for info in infos if info.get("pv")
    ]
    if not candidates:
        return rng.choice(legal)
    temperature = 300 - 260 * strength  # centipawns
    best = max(score for _, score in candidates)
    weights = [math.exp((score - best) / temperature) for _, score in candidates]
    return rng.choices([move for move, _ in candidates], weights=weights)[0]
