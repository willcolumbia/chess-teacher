"""Danger check: which pieces can be won, and which moves give material away.

A quick static count, not a search: a piece is at risk when the other side can take it and
come out ahead (it's undefended, or the attacker is worth less). Good enough to flag hung
pieces, which is how most games are lost at club level.
"""
from __future__ import annotations

from typing import Dict, List

import chess

from .explain.rules import PIECE_VALUES

RISK = 2  # points: flag a piece (or a move) once at least this much is at stake; a pawn alone isn't


def can_take(board: chess.Board, color: chess.Color, square: chess.Square) -> List[chess.Square]:
    """Pieces of `color` that can capture on `square` (pinned pieces only along their pin)."""
    out = []
    for attacker in board.attackers(color, square):
        if square not in board.pin(color, attacker):
            continue
        if board.piece_type_at(attacker) == chess.KING and board.is_attacked_by(not color, square):
            continue  # the king can't take a defended piece
        out.append(attacker)
    return out


def loss_at(board: chess.Board, square: chess.Square) -> int:
    """Points the owner of the piece on `square` stands to lose if the other side takes it."""
    piece = board.piece_at(square)
    if piece is None or piece.piece_type == chess.KING:
        return 0
    attackers = can_take(board, not piece.color, square)
    if not attackers:
        return 0
    value = PIECE_VALUES[piece.piece_type]
    if not board.is_attacked_by(piece.color, square):
        return value
    cheapest = min(PIECE_VALUES[board.piece_type_at(a)] for a in attackers)
    return max(0, value - cheapest)


def at_risk(board: chess.Board, color: chess.Color) -> List[str]:
    """Squares of `color`'s pieces that can be won (by at least RISK points)."""
    return [
        chess.square_name(square)
        for square, piece in board.piece_map().items()
        if piece.color == color and loss_at(board, square) >= RISK
    ]


def gained(board: chess.Board, move: chess.Move) -> int:
    """Material a move wins straight away: what it captures, plus a promotion."""
    gain = 0
    if board.is_en_passant(move):
        gain = 1
    elif board.is_capture(move):
        gain = PIECE_VALUES[board.piece_type_at(move.to_square)]
    if move.promotion:
        gain += PIECE_VALUES[move.promotion] - 1
    return gain


def unsafe_moves(board: chess.Board) -> List[str]:
    """Legal moves after which the opponent can win material (net RISK points or more)."""
    me = board.turn
    out = []
    for move in board.legal_moves:
        after = board.copy(stack=False)
        after.push(move)
        if after.is_checkmate():
            continue
        worst = max((loss_at(after, sq) for sq, p in after.piece_map().items() if p.color == me), default=0)
        if worst - gained(board, move) >= RISK:
            out.append(move.uci())
    return out


def check(board: chess.Board) -> Dict:
    """Danger check for the side to move: its pieces at risk, the opponent's pieces it can win,
    and the moves that would give material away."""
    if board.is_game_over():
        return {"danger": [], "chances": [], "unsafe": []}
    me = board.turn
    return {
        "danger": at_risk(board, me),
        "chances": at_risk(board, not me),
        "unsafe": unsafe_moves(board),
    }
