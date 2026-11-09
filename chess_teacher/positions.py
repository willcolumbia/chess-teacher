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
    if board.is_repetition(3):
        return "Draw by repetition"
    if board.halfmove_clock >= 100:
        return "Draw by the fifty-move rule"
    if board.is_check():
        return f"{side} to move — in check"
    return f"{side} to move"


def replay(moves, fen=None) -> chess.Board:
    """Play UCI `moves` from the start position, or from `fen` if given.

    Raises ValueError on a bad position or a bad or illegal move.
    """
    board = chess.Board()
    if fen:
        try:
            board = chess.Board(fen)
        except ValueError:
            raise ValueError("Bad position.")
        if not board.is_valid():
            raise ValueError("Bad position.")
    for uci in moves or []:
        try:
            move = chess.Move.from_uci(uci)
        except ValueError:
            raise ValueError(f"Bad move {uci!r}.")
        if move not in board.legal_moves:
            raise ValueError(f"Illegal move {uci!r}.")
        board.push(move)
    return board


def is_finished(board: chess.Board) -> bool:
    """Is the game over, the way an online site ends it automatically?

    Checkmate, stalemate, not enough material, the same position three times, or fifty
    moves each without a capture or pawn move. Only a repetition that has actually
    happened counts, not one that a move *could* make.
    """
    return board.is_game_over() or board.is_repetition(3) or board.halfmove_clock >= 100


def sans_of(board: chess.Board) -> List[str]:
    """The SAN of every move played on `board`, from its starting position."""
    walk = board.root()
    sans = []
    for move in board.move_stack:
        sans.append(walk.san(move))
        walk.push(move)
    return sans
