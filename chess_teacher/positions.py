"""Helpers for positions built from a list of UCI moves."""
from __future__ import annotations

from typing import List

import chess


def game_status(board: chess.Board) -> str:
    side = "White" if board.turn == chess.WHITE else "Black"
    if board.is_checkmate():
        return f"Checkmate — {'Black' if board.turn == chess.WHITE else 'White'} wins"
    if board.is_stalemate():
        return "Stalemate — draw"
    if board.is_insufficient_material():
        return "Draw — not enough material to checkmate"
    if board.can_claim_threefold_repetition() or board.is_fivefold_repetition():
        return "Draw by repetition"
    if board.can_claim_fifty_moves() or board.is_seventyfive_moves():
        return "Draw by the fifty-move rule"
    if board.is_check():
        return f"{side} to move — in check"
    return f"{side} to move"


def replay(moves) -> chess.Board:
    """Play UCI `moves` from the start position. Raises ValueError on a bad or illegal move."""
    board = chess.Board()
    for uci in moves or []:
        try:
            move = chess.Move.from_uci(uci)
        except ValueError:
            raise ValueError(f"Bad move {uci!r}.")
        if move not in board.legal_moves:
            raise ValueError(f"Illegal move {uci!r}.")
        board.push(move)
    return board


def sans_of(board: chess.Board) -> List[str]:
    """The SAN of every move played on `board`, from its starting position."""
    walk = board.root()
    sans = []
    for move in board.move_stack:
        sans.append(walk.san(move))
        walk.push(move)
    return sans
