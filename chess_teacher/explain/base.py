from __future__ import annotations

from dataclasses import dataclass, field
from typing import List

import chess
import chess.engine


@dataclass
class MoveContext:
    """Everything an explainer needs to know about one move.

    Scores are from the point of view of the player who made the move.
    """

    board: chess.Board  # position before the move
    move: chess.Move  # the move that was played
    best_move: chess.Move  # engine's choice in the same position
    best_line: List[chess.Move]  # engine's main line, starting with best_move
    reply_line: List[chess.Move]  # engine's main line after the played move
    score_before: chess.engine.Score  # eval if the best move is played
    score_after: chess.engine.Score  # eval after the played move
    classification: str

    @property
    def mover(self) -> chess.Color:
        return self.board.turn

    @property
    def board_after(self) -> chess.Board:
        after = self.board.copy(stack=False)
        after.push(self.move)
        return after


@dataclass
class Explanation:
    text: str  # the full explanation
    themes: List[str] = field(default_factory=list)
    summary: str = ""  # just what went wrong, without the better move or evaluation


class Explainer:
    """Turns a MoveContext into a human-readable explanation."""

    name = "base"

    def explain(self, ctx: MoveContext) -> Explanation:
        raise NotImplementedError
