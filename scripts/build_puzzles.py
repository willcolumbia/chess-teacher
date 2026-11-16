"""Pick the preset puzzles from the Lichess puzzle database and write chess_teacher/data/puzzles.json.

Usage:
    zstd -d lichess_db_puzzle.csv.zst      # from https://database.lichess.org/#puzzles (public domain)
    .venv/bin/python scripts/build_puzzles.py lichess_db_puzzle.csv

For each skill in chess_teacher/puzzles.py this takes well-liked, much-played puzzles with the
matching Lichess theme, keeps only the ones where the idea shows plainly on the board (the
`find_*` checks below), spreads them from easy to hard, and has Stockfish confirm every move of
the solution. Each puzzle also gets a sentence or two saying why the solution works.

`--report` prints every chosen puzzle with its line and explanation, for reading through.
"""
from __future__ import annotations

import argparse
import csv
import json
import math
import random
import sys
from pathlib import Path
from typing import Callable, Dict, List, Optional, Tuple

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import chess  # noqa: E402
import chess.engine  # noqa: E402

from chess_teacher.analysis import win_percent  # noqa: E402
from chess_teacher.engine import find_stockfish  # noqa: E402
from chess_teacher.explain.rules import PIECE_VALUES, captured_piece, name, pieces_phrase, sq, untraded  # noqa: E402
from chess_teacher.puzzles import DATA, SKILLS  # noqa: E402

PER_SKILL = 20
SEED = 7
# Quality bar for a database row.
MIN_POPULARITY = 90
MIN_PLAYS = 1000
MAX_DEVIATION = 90
PER_BAND = 500  # rows kept per theme and 100-point rating band while reading the file
# Stockfish must agree with every move of the solution, by at least this many points of winning chances.
MIN_GAP = 25

KING_VALUES = dict(PIECE_VALUES)
KING_VALUES[chess.KING] = 99
SLIDERS = (chess.BISHOP, chess.ROOK, chess.QUEEN)
LETTER = {chess.PAWN: "P", chess.KNIGHT: "N", chess.BISHOP: "B", chess.ROOK: "R", chess.QUEEN: "Q", chess.KING: "K"}
# Lichess themes that name a tactical idea. A puzzle chosen for one skill may not carry another
# skill's idea too, apart from the ones its rule allows.
IDEAS = {
    "fork", "pin", "skewer", "discoveredAttack", "discoveredCheck", "hangingPiece", "capturingDefender",
    "deflection", "attraction", "trappedPiece", "sacrifice", "intermezzo", "xRayAttack", "interference",
    "clearance", "zugzwang", "doubleCheck", "promotion", "advancedPawn", "quietMove", "defensiveMove",
}
NEVER = {"underPromotion", "enPassant", "veryLong", "castling"}

Motif = Tuple[str, str]  # (why the solution works, a key used to vary the puzzles in a set)


class Line:
    """A puzzle played out. moves[0] is the opponent's move; boards[i] is the position before moves[i]."""

    def __init__(self, row: Dict):
        self.id = row["PuzzleId"]
        self.fen = row["FEN"]
        self.rating = int(row["Rating"])
        self.themes = set(row["Themes"].split())
        self.ucis = row["Moves"].split()
        self.moves = [chess.Move.from_uci(u) for u in self.ucis]
        board = chess.Board(self.fen)
        self.boards = []
        for move in self.moves:
            if move not in board.legal_moves:
                raise ValueError(f"illegal move in {self.id}")
            self.boards.append(board.copy(stack=False))
            board.push(move)
        self.end = board.copy(stack=False)
        self.you = self.boards[1].turn
        self.count = len(self.moves) // 2  # your moves

    def after(self, i: int) -> chess.Board:
        """The position after moves[i]."""
        return self.boards[i + 1] if i + 1 < len(self.boards) else self.end

    def san(self, i: int) -> str:
        return self.boards[i].san(self.moves[i])

    def plain(self, i: int) -> str:
        return self.san(i).rstrip("+#")

    def well_formed(self) -> bool:
        if len(self.moves) % 2 or len(self.moves) < 2 or self.boards[1].is_check():
            return False
        for i, move in enumerate(self.moves):
            if i % 2 == 0 and move.promotion:
                return False  # the opponent queening mid-puzzle muddles what was won
            if i % 2 and (move.promotion not in (None, chess.QUEEN) or self.boards[i].is_en_passant(move)):
                return False
        return True


# ---------- Board checks ----------


def is_defended(board: chess.Board, square: chess.Square) -> bool:
    """Is the piece on `square` protected, directly or from behind the piece attacking it?"""
    piece = board.piece_at(square)
    if board.attackers(piece.color, square):
        return True
    for attacker in board.attackers(not piece.color, square):
        if board.piece_type_at(attacker) in SLIDERS:
            without = board.copy(stack=False)
            without.remove_piece_at(attacker)
            if without.attackers(piece.color, square):
                return True
    return False


def in_bad_spot(board: chess.Board, square: chess.Square) -> bool:
    """Attacked, and either unprotected or attacked by something cheaper."""
    piece = board.piece_at(square)
    attackers = board.attackers(not piece.color, square)
    if not attackers:
        return False
    if not is_defended(board, square):
        return True
    return any(
        board.piece_type_at(a) != chess.KING and PIECE_VALUES[board.piece_type_at(a)] < PIECE_VALUES[piece.piece_type]
        for a in attackers
    )


def is_trapped(board: chess.Board, square: chess.Square) -> bool:
    """The piece on `square` (its side to move) is in a bad spot and every move it has lands in another."""
    piece = board.piece_at(square)
    if board.is_check() or board.is_pinned(board.turn, square) or piece.piece_type in (chess.PAWN, chess.KING):
        return False
    if not in_bad_spot(board, square):
        return False
    for move in board.legal_moves:
        if move.from_square != square:
            continue
        taken = board.piece_at(move.to_square)
        if taken and PIECE_VALUES[taken.piece_type] >= PIECE_VALUES[piece.piece_type]:
            return False
        board.push(move)
        safe = not in_bad_spot(board, move.to_square)
        board.pop()
        if safe:
            return False
    return True


def pinner(board: chess.Board, color: chess.Color, square: chess.Square) -> Optional[chess.Square]:
    """The enemy bishop, rook or queen pinning `color`'s piece on `square` to its king."""
    mask = board.pin(color, square)
    if mask == chess.BB_ALL:
        return None
    king = board.king(color)
    for attacker in board.attackers(not color, square):
        if attacker in mask and board.piece_type_at(attacker) in SLIDERS and square in chess.SquareSet.between(attacker, king):
            return attacker
    return None


def mate_reason(board: chess.Board, move: chess.Move) -> str:
    """Why the mating `move` (played on `board`) leaves the king no way out."""
    after = board.copy(stack=False)
    after.push(move)
    them = after.turn
    king = after.king(them)
    checkers = list(after.checkers())
    flights = list(chess.SquareSet(chess.BB_KING_ATTACKS[king]))
    if len(checkers) > 1:
        return "It is a double check, so the king has to move, and it has nowhere to go."
    checker_sq = checkers[0]
    checker = after.piece_at(checker_sq)
    if checker.piece_type == chess.KNIGHT and all(after.color_at(s) == them for s in flights):
        return "A smothered mate: the king is boxed in by its own pieces, and nothing can take the knight."
    home = 7 if them == chess.BLACK else 0
    forward = [s for s in flights if chess.square_rank(s) != home]
    if (
        chess.square_rank(king) == home
        and chess.square_rank(checker_sq) == home
        and checker.piece_type in (chess.ROOK, chess.QUEEN)
        and all(after.color_at(s) == them for s in forward)
    ):
        wall = "pawns" if all(after.piece_type_at(s) == chess.PAWN for s in forward) else "pieces"
        return f"The king is trapped on the back rank behind its own {wall}, and nothing can block the check or take the {name(checker)}."
    if checker_sq != move.to_square:
        mover = after.piece_at(move.to_square)
        return f"Moving the {name(mover)} uncovers a check from your {name(checker)}, and the king has no way out."
    if chess.square_distance(checker_sq, king) == 1:
        guards = sorted(after.attackers(not them, checker_sq), key=lambda s: KING_VALUES[after.piece_type_at(s)])
        if guards:
            guard = after.piece_at(guards[0])
            return (
                f"The king can't take the {name(checker)} because your {name(guard)} on {sq(guards[0])} protects it, "
                "and it has no safe square to run to."
            )
    if checker.piece_type in (chess.KNIGHT, chess.PAWN):
        return f"The king has no safe square, and nothing can take the {name(checker)}."
    return f"The king has no safe square, and nothing can block the check or take the {name(checker)}."


def is_back_rank(board: chess.Board) -> bool:
    """Checkmate by a rook or queen along the back rank, with the king shut in by its own pieces."""
    if not board.is_checkmate():
        return False
    them = board.turn
    king = board.king(them)
    home = 7 if them == chess.BLACK else 0
    if chess.square_rank(king) != home:
        return False
    forward = [s for s in chess.SquareSet(chess.BB_KING_ATTACKS[king]) if chess.square_rank(s) != home]
    if not all(board.color_at(s) == them for s in forward):
        return False
    if sum(board.piece_type_at(s) == chess.PAWN for s in forward) < 2:
        return False
    checkers = list(board.checkers())
    return len(checkers) == 1 and chess.square_rank(checkers[0]) == home and board.piece_type_at(checkers[0]) in (chess.ROOK, chess.QUEEN)


# ---------- One check per skill: is this a plain example, and why does it work? ----------


def find_mate_in_one(line: Line) -> Optional[Motif]:
    if not line.end.is_checkmate() or line.moves[1].promotion:
        return None
    piece = line.boards[1].piece_type_at(line.moves[1].from_square)
    return f"{line.plain(1)} is checkmate. {mate_reason(line.boards[1], line.moves[1])}", LETTER[piece]


def find_free_piece(line: Line) -> Optional[Motif]:
    board, move = line.boards[1], line.moves[1]
    taken = board.piece_at(move.to_square)
    if taken is None or taken.piece_type == chess.PAWN or is_defended(board, move.to_square):
        return None
    if not line.boards[3].is_capture(line.moves[3]):
        return None  # keep the follow-up simple: your second move takes something back
    mover = board.piece_at(move.from_square)
    text = f"The {name(taken)} on {sq(move.to_square)} had no protection, so your {name(mover)} takes it for free."
    return text, LETTER[taken.piece_type]


def find_back_rank(line: Line) -> Optional[Motif]:
    if not is_back_rank(line.end):
        return None
    last = len(line.moves) - 1
    wall = "The king is trapped on the back rank behind its own pawns."
    if line.count == 1:
        return f"{line.plain(1)} is checkmate. {wall}", "1"
    return f"After {line.san(1)} {line.san(2)}, {line.plain(last)} is checkmate. {wall}", "2"


def fork_targets(board: chess.Board, square: chess.Square) -> List[chess.Square]:
    """Enemy pieces attacked from `square` that are worth forking: the king, anything worth more
    than the forking piece, and anything unprotected."""
    forker = board.piece_at(square)
    targets = []
    for target_sq in board.attacks(square):
        target = board.piece_at(target_sq)
        if target is None or target.color == forker.color:
            continue
        if (
            target.piece_type == chess.KING
            or PIECE_VALUES[target.piece_type] > PIECE_VALUES[forker.piece_type]
            or (target.piece_type != chess.PAWN and not is_defended(board, target_sq))
        ):
            targets.append(target_sq)
    return targets


def find_fork(line: Line) -> Optional[Motif]:
    move, after = line.moves[1], line.after(1)
    square = move.to_square
    forker = after.piece_at(square)
    if forker.piece_type == chess.KING:
        return None
    if forker.piece_type != chess.PAWN and after.attackers(not line.you, square):
        return None  # plainest when the forking piece can't simply be taken
    targets = fork_targets(after, square)
    follow = line.moves[3]
    if len(targets) < 2 or follow.from_square != square or follow.to_square not in targets:
        return None
    if line.moves[2].from_square == follow.to_square or line.moves[2].to_square == follow.to_square:
        return None  # the piece taken at the end is not the one that was forked
    won = after.piece_at(follow.to_square)
    others = sorted((t for t in targets if t != follow.to_square), key=lambda t: -KING_VALUES[after.piece_type_at(t)])
    other = after.piece_at(others[0])
    where = f"The {name(forker)} on {sq(square)}"
    if other.piece_type == chess.KING:
        text = (
            f"{where} checks the king and attacks the {name(won)} on {sq(follow.to_square)} at the same time. "
            "The check has to be dealt with first."
        )
    else:
        text = (
            f"{where} attacks the {name(other)} on {sq(others[0])} and the {name(won)} on {sq(follow.to_square)} "
            "at the same time. Only one of them can be saved."
        )
    return text, LETTER[forker.piece_type] + ("+" if other.piece_type == chess.KING else "")


def find_pin(line: Line) -> Optional[Motif]:
    them = not line.you
    for i in range(1, len(line.moves), 2):
        before, after, move = line.boards[i], line.after(i), line.moves[i]
        for square, piece in after.piece_map().items():
            if piece.color != them or piece.piece_type == chess.KING:
                continue
            sniper = pinner(after, them, square)
            if sniper is None:
                continue
            by = name(after.piece_at(sniper))
            is_new = pinner(before, them, square) is None
            # The pinned piece is taken later in the line, without ever having moved.
            for j in range(i + 2, len(line.moves), 2):
                if any(line.moves[k].from_square == square for k in range(i + 1, j)):
                    break
                if line.moves[j].to_square == square:
                    if is_new and sniper == move.to_square:
                        return f"Your {by} pins the {name(piece)} on {sq(square)} to its king, so it can't move out of the way.", "new"
                    return f"The {name(piece)} on {sq(square)} is pinned to its king by your {by}, so it can't move away.", "old"
            # The move lands on a square the pinned piece seems to guard (taking back doesn't count:
            # there the pin is beside the point).
            target = move.to_square
            if (
                target in after.attacks(square)
                and target not in after.pin(them, square)
                and set(after.attackers(them, target)) == {square}
                and line.moves[i - 1].to_square != target
            ):
                mover = after.piece_at(target)
                text = (
                    f"The {name(piece)} on {sq(square)} looks like it guards {sq(target)}, but it is pinned to its king "
                    f"by your {by}, so it can't take your {name(mover)}."
                )
                return text, "guard"
    return None


def find_skewer(line: Line) -> Optional[Motif]:
    for j in range(3, len(line.moves), 2):
        take, reply, attack = line.moves[j], line.moves[j - 1], line.moves[j - 2]
        board = line.boards[j]
        slider = board.piece_at(take.from_square)
        back = board.piece_at(take.to_square)
        if back is None or slider.piece_type not in SLIDERS or attack.to_square != take.from_square:
            continue
        front_sq = reply.from_square
        position = line.boards[j - 1]  # after the attacking move, before the front piece steps away
        front = position.piece_at(front_sq)
        if front_sq not in chess.SquareSet.between(take.from_square, take.to_square) or front_sq not in position.attacks(take.from_square):
            continue
        if position.piece_at(take.to_square) != back or KING_VALUES[front.piece_type] <= KING_VALUES[back.piece_type]:
            continue
        where = f"the enemy {name(back)} on {sq(take.to_square)}"
        if front.piece_type == chess.KING:
            text = (
                f"Your {name(slider)} checks the king, and {where} stands behind the king on the same line. "
                "The king has to step aside."
            )
            return text, LETTER[slider.piece_type]
        text = (
            f"Your {name(slider)} attacks the {name(front)}, and {where} stands behind it on the same line. "
            f"When the {name(front)} moves away, the {name(back)} is left behind."
        )
        return text, "piece"
    return None


def find_discovered(line: Line) -> Optional[Motif]:
    move, before, after = line.moves[1], line.boards[1], line.after(1)
    if before.is_castling(move):
        return None
    them = not line.you
    left, moved_sq = move.from_square, move.to_square
    moved = after.piece_at(moved_sq)
    follow = line.moves[3]
    for back_sq, back in after.piece_map().items():
        if back.color != line.you or back.piece_type not in SLIDERS or back_sq == moved_sq:
            continue
        for target_sq in after.attacks(back_sq):
            target = after.piece_at(target_sq)
            if target is None or target.color != them or left not in chess.SquareSet.between(back_sq, target_sq):
                continue
            taken = line.boards[3].piece_at(follow.to_square)
            if target.piece_type == chess.KING:
                if follow.from_square == moved_sq and taken:
                    enemy = "enemy " if taken.piece_type == moved.piece_type else ""
                    text = (
                        f"Moving your {name(moved)} uncovers a check from your {name(back)}. "
                        f"The check has to be answered first, so your {name(moved)} is free to take the {enemy}{name(taken)}."
                    )
                    return text, "check"
                continue
            if PIECE_VALUES[target.piece_type] <= PIECE_VALUES[back.piece_type] and is_defended(after, target_sq):
                continue
            own_threat = after.is_check() or before.is_capture(move)
            enemy = "enemy " if target.piece_type == back.piece_type else ""
            if follow.from_square == back_sq and follow.to_square == target_sq and line.moves[2].from_square != target_sq:
                text = f"Moving your {name(moved)} uncovers your {name(back)}'s attack on the {enemy}{name(target)} on {sq(target_sq)}."
                if after.is_check():
                    text += f" The {name(moved)} gives check at the same time, so there is no time to save the {name(target)}."
                elif before.is_capture(move):
                    text += f" The {name(moved)} takes something on the way, so there is no time to save the {name(target)}."
                elif fork_targets(after, moved_sq):
                    text += f" The {name(moved)} makes a threat of its own, and both can't be met."
                return text, "attack" if own_threat else "quiet"
            if follow.from_square == moved_sq and taken and line.moves[2].from_square == target_sq:
                text = (
                    f"Moving your {name(moved)} uncovers your {name(back)}'s attack on the {enemy}{name(target)}. "
                    f"While the {name(target)} gets out of the way, your {name(moved)} takes the {name(taken)}."
                )
                return text, "attack"
    return None


def mate_line(line: Line) -> str:
    last = len(line.moves) - 1
    pairs = [f"{line.san(i)} {line.san(i + 1)}" for i in range(1, last, 2)]
    return f"After {', '.join(pairs)}, {line.plain(last)} is checkmate."


def mate_kind(line: Line) -> str:
    """Varies a set of mates: a quiet first move, a back-rank finish, or the piece that mates."""
    last = len(line.moves) - 1
    if not line.after(1).is_check():
        return "quiet"
    if "backRankMate" in line.themes or is_back_rank(line.end):
        return "back"
    return LETTER[line.end.piece_type_at(line.moves[last].to_square)]


def find_mate_in_two(line: Line) -> Optional[Motif]:
    if not line.end.is_checkmate() or is_back_rank(line.end):
        return None
    last = len(line.moves) - 1
    return f"{mate_line(line)} {mate_reason(line.boards[last], line.moves[last])}", mate_kind(line)


def find_mate_in_three(line: Line) -> Optional[Motif]:
    if not line.end.is_checkmate():
        return None
    last = len(line.moves) - 1
    return f"{mate_line(line)} {mate_reason(line.boards[last], line.moves[last])}", mate_kind(line)


def find_defender(line: Line) -> Optional[Motif]:
    board, first, reply, second = line.boards[1], line.moves[1], line.moves[2], line.moves[3]
    them = not line.you
    guard_sq, target_sq = first.to_square, second.to_square
    guard, target = board.piece_at(guard_sq), board.piece_at(target_sq)
    if guard is None or target is None or target.color != them or target.piece_type == chess.PAWN:
        return None
    if set(board.attackers(them, target_sq)) != {guard_sq} or guard.piece_type == chess.KING:
        return None
    if reply.from_square == target_sq or reply.to_square == target_sq or is_defended(line.boards[3], target_sq):
        return None
    text = (
        f"The {name(guard)} on {sq(guard_sq)} was the only thing guarding the {name(target)} on {sq(target_sq)}. "
        f"Once the guard is gone, the {name(target)} has no protection."
    )
    return text, LETTER[guard.piece_type]


def find_deflection(line: Line) -> Optional[Motif]:
    them = not line.you
    board, reply, second = line.boards[2], line.moves[2], line.moves[3]  # after your first move
    guard_sq, target_sq = reply.from_square, second.to_square
    guard, target = board.piece_at(guard_sq), board.piece_at(target_sq)
    if target is None or target.color != them or target.piece_type == chess.PAWN or target_sq == reply.to_square:
        return None
    if set(board.attackers(them, target_sq)) != {guard_sq}:
        return None
    later = line.boards[3]
    if later.attackers(them, target_sq) or KING_VALUES[target.piece_type] < 3:
        return None
    if line.boards[1].piece_at(line.moves[1].to_square) == target:
        return None
    first = line.plain(1)
    if guard.piece_type == chess.KING:
        text = f"The king was the only thing guarding the {name(target)} on {sq(target_sq)}. {first} forces the king away from it."
    else:
        text = (
            f"The {name(guard)} on {sq(guard_sq)} was the only thing guarding the {name(target)} on {sq(target_sq)}. "
            f"{first} drags the {name(guard)} away from it."
        )
    return text, LETTER[guard.piece_type]


def find_trapped(line: Line) -> Optional[Motif]:
    board, reply, second = line.boards[2], line.moves[2], line.moves[3]
    square = reply.from_square if reply.to_square == second.to_square else second.to_square
    piece = board.piece_at(square)
    if piece is None or piece.color == line.you or line.boards[3].piece_at(second.to_square) is None:
        return None
    if not is_trapped(board.copy(stack=False), square):
        return None
    text = f"After {line.plain(1)} the {name(piece)} on {sq(square)} is under attack and has no safe square to go to."
    return text, LETTER[piece.piece_type]


def find_promotion(line: Line) -> Optional[Motif]:
    for i in range(len(line.moves) - 1, 0, -2):  # the last pawn to queen is the one that stays
        if line.moves[i].promotion != chess.QUEEN:
            continue
        # Where that pawn stood when the puzzle began.
        square = line.moves[i].from_square
        for k in range(i - 2, 0, -2):
            if line.moves[k].to_square == square:
                square = line.moves[k].from_square
        return f"Your pawn on {sq(square)} gets to the last rank and becomes a queen.", str(line.count)
    return None


def find_sacrifice(line: Line) -> Optional[Motif]:
    for i in range(1, len(line.moves) - 1, 2):
        board, move, reply = line.boards[i], line.moves[i], line.moves[i + 1]
        piece = board.piece_at(move.from_square)
        taken = captured_piece(board, move) if board.is_capture(move) else None
        cost = PIECE_VALUES[piece.piece_type] - (PIECE_VALUES[taken.piece_type] if taken else 0)
        if reply.to_square != move.to_square or cost < 2 or piece.piece_type == chess.KING:
            continue
        if line.end.is_checkmate():
            kind = "back" if "backRankMate" in line.themes or is_back_rank(line.end) else "mate"
            return f"You give up the {name(piece)} on {sq(move.to_square)}, and in return the king can't escape checkmate.", kind
        return f"You give up the {name(piece)} on {sq(move.to_square)} for a moment and get more back.", "win"
    return None


def plain_win(line: Line, result: Outcome) -> bool:
    """You end up at least two points ahead, so the win is easy to see."""
    return result.queened or (result.net >= 2 and bool(result.gained))


def wins_that_piece(line: Line, result: Outcome) -> bool:
    """The puzzle wins exactly the piece taken on the first move, and gives nothing back."""
    taken = line.boards[1].piece_at(line.moves[1].to_square)
    return not result.given and not result.queened and [p.piece_type for p in result.gained] == [taken.piece_type]


# skill id: Lichess theme, rating range, how many moves you make, the check, other ideas the
# puzzle may also be tagged with, whether it may end in mate, and limits on each kind (`key`).
RULES: Dict[str, Dict] = {
    "mate-in-1": dict(theme="mateIn1", lo=480, hi=1100, moves=(1,), find=find_mate_in_one, mate=True,
                      also={"discoveredCheck", "doubleCheck", "pin", "hangingPiece"}, ban={"backRankMate"},
                      limits={"Q": 8, "R": 5, "N": 4, "B": 3, "P": 2}),
    "free-piece": dict(theme="hangingPiece", lo=480, hi=1100, moves=(2,), find=find_free_piece, mate=False,
                       also=set(), limits={"Q": 6, "R": 6, "B": 6, "N": 6}, wins=wins_that_piece, silent=True),
    "back-rank": dict(theme="backRankMate", lo=500, hi=1150, moves=(1, 2), find=find_back_rank, mate=True,
                      also={"sacrifice", "deflection", "attraction", "pin", "hangingPiece", "xRayAttack"},
                      limits={"1": 9, "2": 12}),
    "fork": dict(theme="fork", lo=620, hi=1300, moves=(2,), find=find_fork, mate=False,
                 also=set(), limits={"N+": 6, "N": 3, "Q+": 3, "Q": 2, "P": 3, "P+": 0, "B+": 2, "B": 1, "R+": 2, "R": 1}),
    "pin": dict(theme="pin", lo=700, hi=1350, moves=(1, 2, 3), find=find_pin, mate=False,
                also=set(), limits={"new": 10, "old": 8, "guard": 8}),
    "skewer": dict(theme="skewer", lo=620, hi=1300, moves=(2,), find=find_skewer, mate=False,
                   also=set(), limits={"Q": 7, "R": 7, "B": 6, "piece": 5}),
    "discovered": dict(theme="discoveredAttack", lo=700, hi=1350, moves=(2,), find=find_discovered, mate=False,
                       also={"discoveredCheck", "doubleCheck"}, limits={"check": 9, "attack": 14, "quiet": 4}),
    "mate-in-2": dict(theme="mateIn2", lo=650, hi=1300, moves=(2,), find=find_mate_in_two, mate=True,
                      also=IDEAS - {"promotion", "advancedPawn"}, ban={"backRankMate"}, limits={"quiet": 3, "Q": 9, "R": 7}),
    "defender": dict(theme="capturingDefender", lo=850, hi=1500, moves=(2,), find=find_defender, mate=False,
                     also={"sacrifice"}, limits={"Q": 7}),
    "deflection": dict(theme="deflection", lo=850, hi=1500, moves=(2,), find=find_deflection, mate=False,
                       also={"sacrifice", "attraction"}, limits={"K": 5, "R": 6, "Q": 5}),
    "trapped": dict(theme="trappedPiece", lo=900, hi=1500, moves=(2,), find=find_trapped, mate=False,
                    also=set(), limits={"Q": 8, "R": 6, "B": 7, "N": 6}),
    "promotion": dict(theme="promotion", lo=800, hi=1500, moves=(1, 2, 3), find=find_promotion, mate=False,
                      also={"advancedPawn", "sacrifice", "deflection", "attraction", "clearance", "quietMove", "interference"},
                      limits={"1": 5, "2": 12, "3": 8}, silent=True, wins=lambda line, result: result.queened),
    "sacrifice": dict(theme="sacrifice", lo=900, hi=1500, moves=(2, 3), find=find_sacrifice, mate=True,
                      also=IDEAS - {"promotion", "advancedPawn"}, limits={"mate": 8, "back": 3, "win": 10}, ahead=True),
    "mate-in-3": dict(theme="mateIn3", lo=900, hi=1500, moves=(3,), find=find_mate_in_three, mate=True,
                      also=IDEAS - {"promotion", "advancedPawn"}, limits={"quiet": 2, "back": 5, "Q": 8, "R": 8}),
}


def fits(line: Line, rule: Dict) -> bool:
    """Right length, no other skill's idea mixed in, nothing awkward to play on the board."""
    themes = line.themes
    if line.count not in rule["moves"] or themes & NEVER or not line.well_formed():
        return False
    if (themes & IDEAS) - {rule["theme"]} - rule["also"] or themes & rule.get("ban", set()):
        return False
    if not rule["mate"] and "mate" in themes:
        return False
    return True


# ---------- Reading the database ----------


def read_rows(path: str) -> Dict[str, List[Dict]]:
    """{theme: good rows}, a random sample of each 100-point rating band."""
    wanted = {rule["theme"] for rule in RULES.values()}
    rng = random.Random(SEED)
    bands: Dict[Tuple[str, int], List[Dict]] = {}
    seen: Dict[Tuple[str, int], int] = {}
    with open(path, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            if (
                int(row["Popularity"]) < MIN_POPULARITY
                or int(row["NbPlays"]) < MIN_PLAYS
                or int(row["RatingDeviation"]) > MAX_DEVIATION
            ):
                continue
            rating = int(row["Rating"])
            for theme in sorted(wanted & set(row["Themes"].split())):  # sorted: the same pick on every run
                key = (theme, rating // 100)
                seen[key] = seen.get(key, 0) + 1
                rows = bands.setdefault(key, [])
                if len(rows) < PER_BAND:
                    rows.append(row)
                else:
                    j = rng.randrange(seen[key])
                    if j < PER_BAND:
                        rows[j] = row
    out: Dict[str, List[Dict]] = {}
    for (theme, _), rows in sorted(bands.items()):
        out.setdefault(theme, []).extend(rows)
    return out


# ---------- Stockfish ----------


def confirm(engine: chess.engine.SimpleEngine, line: Line, depth: int) -> bool:
    """Stockfish plays every one of your moves in the solution, and nothing else comes close."""
    last = len(line.moves) - 1
    for i in range(1, len(line.moves), 2):
        board, move = line.boards[i], line.moves[i]
        if i == last and line.end.is_checkmate():
            continue  # any mate in one is accepted on the page
        infos = engine.analyse(board, chess.engine.Limit(depth=depth), multipv=2)
        if infos[0]["pv"][0] != move:
            return False
        if len(infos) > 1:
            best = win_percent(infos[0]["score"].pov(line.you))
            second = win_percent(infos[1]["score"].pov(line.you))
            if best - second < MIN_GAP:
                return False
    return True


class Outcome:
    """What the solution wins, once any trade on the last square is finished."""

    def __init__(self, mate: bool, gained: List[chess.Piece], given: List[chess.Piece], queened: bool, sound: bool):
        self.mate, self.gained, self.given, self.queened, self.sound = mate, gained, given, queened, sound
        self.net = sum(PIECE_VALUES[p.piece_type] for p in gained) - sum(PIECE_VALUES[p.piece_type] for p in given)

    def text(self, ahead: bool = False) -> Optional[str]:
        if self.mate:
            return None
        if self.queened:
            if self.gained and not self.given:
                return f"You get a new queen and win {phrase(self.gained)} as well."
            return "You get a new queen."
        if self.net <= 0 or not self.gained:
            return None
        if self.given:
            return f"You win {phrase(self.gained)} for {phrase(self.given)}."
        if ahead:
            return f"You come out {phrase(self.gained)} ahead."
        return f"You win {phrase(self.gained)}."


def phrase(pieces: List[chess.Piece]) -> str:
    """"a rook and two pawns"."""
    words = {"2": "two", "3": "three", "4": "four"}
    return " ".join(words.get(word, word) for word in pieces_phrase(pieces).split())


def trade_on(board: chess.Board, square: chess.Square) -> List[chess.Move]:
    """The captures on `square` both sides would make from here, cheapest piece first.
    Each side stops as soon as taking again would lose material."""

    def best(b: chess.Board) -> Tuple[int, List[chess.Move]]:
        takers = [m for m in b.legal_moves if m.to_square == square and b.is_capture(m) and not b.is_en_passant(m)]
        if not takers:
            return 0, []
        move = min(takers, key=lambda m: KING_VALUES[b.piece_type_at(m.from_square)])
        victim = b.piece_at(square)
        b.push(move)
        reply_gain, reply = best(b)
        b.pop()
        gain = PIECE_VALUES[victim.piece_type] - reply_gain
        return (gain, [move] + reply) if gain > 0 else (0, [])

    return best(board.copy(stack=False))[1]


def balance(board: chess.Board, color: chess.Color) -> int:
    return sum(PIECE_VALUES[p.piece_type] * (1 if p.color == color else -1) for p in board.piece_map().values())


def outcome(engine: chess.engine.SimpleEngine, line: Line, depth: int) -> Outcome:
    """Count what the line wins, including any taking back on the last square. `sound` is False
    when Stockfish thinks you stand worse than that count says, so something else is going on."""
    if line.end.is_checkmate():
        return Outcome(True, [], [], False, True)
    board = line.boards[1].copy(stack=False)
    queens = len(board.pieces(chess.QUEEN, line.you))
    won: List[chess.Piece] = []
    lost: List[chess.Piece] = []
    for move in line.moves[1:] + trade_on(line.end, line.moves[-1].to_square):
        if board.is_capture(move):
            (won if board.turn == line.you else lost).append(captured_piece(board, move))
        board.push(move)
    queened = len(board.pieces(chess.QUEEN, line.you)) > queens
    score = engine.analyse(line.end, chess.engine.Limit(depth=depth))["score"].pov(line.you)
    if score.is_mate():
        sound = score.mate() > 0
    else:
        sound = score.score() >= 100 * balance(board, line.you) - 200
    return Outcome(False, untraded(won, lost), untraded(lost, won), queened, sound)


# ---------- Choosing ----------


def choose(skill_id: str, rows: List[Dict], engine, depth: int, used: set, log: Callable[[str], None]) -> List[Dict]:
    rule = RULES[skill_id]
    found = []
    for row in rows:
        if row["PuzzleId"] in used or not rule["lo"] - 80 <= int(row["Rating"]) <= rule["hi"] + 80:
            continue
        try:
            line = Line(row)
        except ValueError:
            continue
        if not fits(line, rule):
            continue
        motif = rule["find"](line)
        if motif:
            found.append((line, motif))
    counts: Dict[str, int] = {}
    for _, (_, key) in found:
        counts[key] = counts.get(key, 0) + 1
    log(f"{skill_id}: {len(found)} plain examples out of {len(rows)} rows, kinds {counts}")
    rng = random.Random(SEED)
    rng.shuffle(found)
    targets = [rule["lo"] + (rule["hi"] - rule["lo"]) * i / (PER_SKILL - 1) for i in range(PER_SKILL)]
    chosen: List[Dict] = []
    kinds: Dict[str, int] = {}
    firsts: Dict[str, int] = {}  # e.g. "Qxf7": no more than two puzzles in a set open with the same move
    colors = {chess.WHITE: 0, chess.BLACK: 0}
    taken = set()
    for i, target in enumerate(targets):
        # Limits grow with the set, so each kind and each colour is spread from easy to hard.
        share = (i + 1) / PER_SKILL

        def room(key: str) -> bool:
            limit = rule["limits"].get(key, PER_SKILL)
            return kinds.get(key, 0) < min(limit, math.ceil(limit * share) + 1)

        pool = sorted(
            (
                x for x in found
                if x[0].id not in taken and room(x[1][1]) and colors[x[0].you] < (i + 1) // 2 + 2
                and firsts.get(x[0].plain(1), 0) < 2
            ),
            key=lambda x: abs(x[0].rating - target),
        )
        for line, (text, key) in pool[:60]:
            taken.add(line.id)
            if not confirm(engine, line, depth):
                continue
            result = outcome(engine, line, depth)
            if not result.mate and not (result.sound and rule.get("wins", plain_win)(line, result)):
                continue  # nothing clear to show for it
            said = None if rule.get("silent") else result.text(ahead=rule.get("ahead", False))
            idea = f"{text} {said}" if said else text
            chosen.append({"id": line.id, "fen": line.fen, "moves": " ".join(line.ucis), "rating": line.rating, "idea": idea,
                           "_key": key, "_line": line})
            kinds[key] = kinds.get(key, 0) + 1
            firsts[line.plain(1)] = firsts.get(line.plain(1), 0) + 1
            colors[line.you] += 1
            used.add(line.id)
            break
    chosen.sort(key=lambda p: p["rating"])
    log(f"{skill_id}: chose {len(chosen)}, kinds {kinds}, ratings {chosen[0]['rating']}-{chosen[-1]['rating']}" if chosen else f"{skill_id}: none")
    return chosen


def report(skill_id: str, puzzles: List[Dict]) -> None:
    print(f"\n=== {skill_id} ===")
    for p in puzzles:
        line: Line = p["_line"]
        sans = line.boards[1].variation_san(line.moves[1:])
        side = "White" if line.you == chess.WHITE else "Black"
        print(f"{p['id']} {p['rating']:5d} {side} [{p['_key']}] after {line.san(0)}: {sans}")
        print(f"      {line.boards[1].fen()}")
        print(f"      {p['idea']}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("csv", help="lichess_db_puzzle.csv (decompressed)")
    parser.add_argument("--depth", type=int, default=16)
    parser.add_argument("--out", default=str(DATA))
    parser.add_argument("--only", help="just this skill (nothing is written)")
    parser.add_argument("--report", action="store_true", help="print every chosen puzzle")
    args = parser.parse_args()

    rows = read_rows(args.csv)
    log = lambda text: print(text, file=sys.stderr, flush=True)  # noqa: E731
    used: set = set()
    skills: Dict[str, List[Dict]] = {}
    with chess.engine.SimpleEngine.popen_uci(find_stockfish()) as engine:
        engine.configure({"Threads": 1, "Hash": 128})  # one thread, so the search is the same on every run
        for skill in SKILLS:
            if args.only and skill["id"] != args.only:
                continue
            puzzles = choose(skill["id"], rows.get(RULES[skill["id"]]["theme"], []), engine, args.depth, used, log)
            if args.report:
                report(skill["id"], puzzles)
            skills[skill["id"]] = [{k: v for k, v in p.items() if not k.startswith("_")} for p in puzzles]
    short = [s for s, puzzles in skills.items() if len(puzzles) < PER_SKILL]
    if short:
        log(f"Not enough puzzles for: {', '.join(short)}")
    if args.only:
        return 0
    body = ",\n".join(
        f'  {json.dumps(skill_id)}: [\n' + ",\n".join("    " + json.dumps(p) for p in puzzles) + "\n  ]"
        for skill_id, puzzles in skills.items()
    )
    text = (
        '{\n "source": "Lichess puzzle database, https://database.lichess.org/#puzzles (public domain)",\n'
        ' "skills": {\n' + body + "\n }\n}\n"
    )
    Path(args.out).write_text(text, encoding="utf-8")
    log(f"Wrote {sum(len(p) for p in skills.values())} puzzles to {args.out}")
    return 1 if short else 0


if __name__ == "__main__":
    sys.exit(main())
