"""Plain-language description of what any move does, good or bad."""
from __future__ import annotations

from typing import List

import chess

from .rules import PIECE_VALUES, captured_piece, describe_tactic, name, sq


def in_danger(board: chess.Board, square: chess.Square) -> bool:
    """Is the piece on `square` attacked and either undefended or attacked by something cheaper?"""
    piece = board.piece_at(square)
    them = not piece.color
    attackers = board.attackers(them, square)
    if not attackers:
        return False
    if not board.is_attacked_by(piece.color, square):
        return True
    cheapest = min(PIECE_VALUES[board.piece_type_at(a)] or 100 for a in attackers)
    return cheapest < PIECE_VALUES[piece.piece_type]


def join(items: List[str]) -> str:
    return items[0] if len(items) == 1 else ", ".join(items[:-1]) + " and " + items[-1]


def describe_move(board: chess.Board, move: chess.Move) -> str:
    """`board` is the position before `move` (its move stack is used to spot recaptures)."""
    me, them = board.turn, not board.turn
    piece = board.piece_at(move.from_square)
    after = board.copy(stack=False)
    after.push(move)
    to = sq(move.to_square)
    home_rank = 0 if me == chess.WHITE else 7
    sentences: List[str] = []

    victim = captured_piece(board, move) if board.is_capture(move) else None
    recapture = False
    if board.move_stack:
        previous = board.move_stack[-1]
        before_previous = board.copy()
        before_previous.pop()
        recapture = previous.to_square == move.to_square and before_previous.is_capture(previous)

    if board.is_castling(move):
        side = "kingside" if board.is_kingside_castling(move) else "queenside"
        sentences.append(f"Castles {side}, tucking the king away and bringing the rook toward the center.")
    elif victim:
        if recapture:
            sentences.append(f"Recaptures the {name(victim)} on {to} with the {name(piece)}.")
        else:
            sentences.append(f"The {name(piece)} takes the {name(victim)} on {to}.")
        if not after.is_attacked_by(them, move.to_square):
            sentences.append("It can't be taken back.")
    elif move.promotion:
        sentences.append(f"Promotes the pawn to a {chess.piece_name(move.promotion)} on {to}.")
    elif board.is_check():
        if piece.piece_type == chess.KING:
            sentences.append(f"Gets out of check by moving the king to {to}.")
        else:
            sentences.append(f"Blocks the check with the {name(piece)} on {to}.")
    elif (
        piece.piece_type in (chess.KNIGHT, chess.BISHOP)
        and chess.square_rank(move.from_square) == home_rank
        and board.fullmove_number <= 15
    ):
        sentences.append(f"Develops the {name(piece)} to {to}.")
    elif piece.piece_type == chess.PAWN and to in ("d4", "e4", "d5", "e5") and board.fullmove_number <= 10:
        sentences.append(f"Puts a pawn on {to}, fighting for the center.")
    elif piece.piece_type == chess.PAWN:
        sentences.append(f"Pushes the pawn to {to}.")
    else:
        sentences.append(f"Moves the {name(piece)} to {to}.")

    if after.is_checkmate():
        sentences.append("Checkmate!")
        return " ".join(sentences)
    if after.is_stalemate():
        sentences.append("Stalemate: the opponent has no legal moves, so the game is a draw.")
        return " ".join(sentences)

    if not board.is_check() and in_danger(board, move.from_square) and not in_danger(after, move.to_square):
        sentences.append(f"It gets the {name(piece)} out of danger.")

    tactic = describe_tactic(board, move)
    if tactic and tactic[1] in ("fork", "pin", "discovered-check"):
        sentences.append(f"It's a tactic: {tactic[0]}.")
    else:
        if after.is_check():
            sentences.append("It gives check.")
        attacked = []
        for target_sq in after.attacks(move.to_square):
            target = after.piece_at(target_sq)
            if (
                target
                and target.color == them
                and target.piece_type != chess.KING
                and target_sq not in board.attacks(move.from_square)
                and in_danger(after, target_sq)
            ):
                attacked.append(f"the {name(target)} on {sq(target_sq)}")
        if attacked:
            sentences.append(f"It attacks {join(attacked[:2])}.")

    defended = []
    for friend_sq in after.attacks(move.to_square):
        friend = after.piece_at(friend_sq)
        if (
            friend
            and friend.color == me
            and friend.piece_type != chess.KING
            and friend_sq not in board.attacks(move.from_square)
            and in_danger(board, friend_sq)
            and not in_danger(after, friend_sq)
        ):
            defended.append(f"the {name(friend)} on {sq(friend_sq)}")
    if defended:
        sentences.append(f"It protects {join(defended[:2])}.")

    return " ".join(sentences)
