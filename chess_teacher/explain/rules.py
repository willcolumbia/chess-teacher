"""Rule-based explanations built from the engine's lines and simple board checks."""
from __future__ import annotations

from typing import List, Optional, Tuple

import chess
import chess.engine

from .base import Explainer, Explanation, MoveContext

PIECE_VALUES = {
    chess.PAWN: 1,
    chess.KNIGHT: 3,
    chess.BISHOP: 3,
    chess.ROOK: 5,
    chess.QUEEN: 9,
    chess.KING: 0,
}

LINE_PLIES = 6  # how much of an engine line to show in text


def material_balance(board: chess.Board, color: chess.Color) -> int:
    total = 0
    for piece in board.piece_map().values():
        value = PIECE_VALUES[piece.piece_type]
        total += value if piece.color == color else -value
    return total


def settle(
    board: chess.Board, line: List[chess.Move], color: chess.Color, min_plies: int = 4
) -> Tuple[int, int, List[chess.Piece]]:
    """Material change for `color` along `line`, measured once captures stop.

    Plays at least `min_plies` moves (if available), then keeps going until the
    next move is not a capture, so a half-finished exchange isn't counted.
    Returns (change, plies played, pieces of `color` captured on the way).
    """
    b = board.copy(stack=False)
    start = material_balance(b, color)
    change, plies, lost, settled_lost = 0, 0, [], []
    for i, move in enumerate(line):
        if not b.is_legal(move):
            break
        if b.turn != color and b.is_capture(move):
            lost.append(captured_piece(b, move))
        b.push(move)
        nxt = line[i + 1] if i + 1 < len(line) else None
        if nxt is None or not b.is_capture(nxt):
            change, plies, settled_lost = material_balance(b, color) - start, i + 1, list(lost)
            if plies >= min_plies:
                break
    return change, plies, settled_lost


def settled_material_change(
    board: chess.Board, line: List[chess.Move], color: chess.Color, min_plies: int = 4
) -> int:
    return settle(board, line, color, min_plies)[0]


def pieces_phrase(pieces: List[chess.Piece]) -> str:
    """e.g. "a rook and two pawns"."""
    counts: dict = {}
    for piece in sorted(pieces, key=lambda p: -PIECE_VALUES[p.piece_type]):
        counts[name(piece)] = counts.get(name(piece), 0) + 1
    words = []
    for piece_name, n in counts.items():
        if n == 1:
            article = "an" if piece_name[0] in "aeiou" else "a"
            words.append(f"{article} {piece_name}")
        else:
            words.append(f"{n} {piece_name}s")
    return words[0] if len(words) == 1 else ", ".join(words[:-1]) + " and " + words[-1]


def captured_piece(board: chess.Board, move: chess.Move) -> Optional[chess.Piece]:
    if board.is_en_passant(move):
        return chess.Piece(chess.PAWN, not board.turn)
    return board.piece_at(move.to_square)


def first_capture_of(
    board: chess.Board, line: List[chess.Move], victim: chess.Color
) -> Optional[Tuple[int, chess.Move, chess.Piece]]:
    """First move in `line` that captures a piece of color `victim`."""
    b = board.copy(stack=False)
    for i, move in enumerate(line):
        if not b.is_legal(move):
            break
        if b.turn != victim and b.is_capture(move):
            return i, move, captured_piece(b, move)
        b.push(move)
    return None


def line_san(board: chess.Board, line: List[chess.Move], plies: int = LINE_PLIES) -> str:
    moves = []
    b = board.copy(stack=False)
    for move in line[:plies]:
        if not b.is_legal(move):
            break
        moves.append(move)
        b.push(move)
    return board.variation_san(moves) if moves else ""


def name(piece: chess.Piece) -> str:
    return chess.piece_name(piece.piece_type)


def sq(square: chess.Square) -> str:
    return chess.square_name(square)


def points(n: int) -> str:
    return f"{n} point{'s' if n != 1 else ''}"


def is_winning_mate(score: chess.engine.Score) -> bool:
    return score.is_mate() and (score == chess.engine.MateGiven or score.mate() > 0)


def format_score(score: chess.engine.Score) -> str:
    """Score from the mover's point of view, in words a player would use."""
    if score.is_mate():
        n = score.mate()
        if score == chess.engine.MateGiven:
            return "checkmate"
        return f"mate in {n}" if n > 0 else f"getting mated in {-n}"
    return f"{score.score() / 100:+.1f}"


def describe_tactic(board: chess.Board, move: chess.Move) -> Optional[Tuple[str, str]]:
    """Look for a simple tactic created by `move`. Returns (phrase, theme)."""
    me = board.turn
    them = not me
    after = board.copy(stack=False)
    after.push(move)
    mover = after.piece_at(move.to_square)

    # Fork: the moved piece attacks two or more targets worth hitting.
    targets = []
    for target_sq in after.attacks(move.to_square):
        target = after.piece_at(target_sq)
        if target is None or target.color != them:
            continue
        undefended = not after.is_attacked_by(them, target_sq)
        if (
            target.piece_type == chess.KING
            or PIECE_VALUES[target.piece_type] > PIECE_VALUES[mover.piece_type]
            or undefended
        ):
            targets.append(target)
    if len(targets) >= 2:
        targets.sort(key=lambda p: (p.piece_type == chess.KING, PIECE_VALUES[p.piece_type]), reverse=True)
        named = " and ".join(name(p) for p in targets[:2])
        return f"forking the {named}", "fork"

    # Pin: an enemy piece that is newly pinned to its king.
    for target_sq, target in after.piece_map().items():
        if target.color != them or target.piece_type == chess.KING:
            continue
        if after.is_pinned(them, target_sq) and not board.is_pinned(them, target_sq):
            return f"pinning the {name(target)} on {sq(target_sq)} to the king", "pin"

    if board.is_capture(move):
        victim = captured_piece(board, move)
        if not board.is_attacked_by(them, move.to_square):
            return f"winning the undefended {name(victim)}", "free-piece"

    if after.is_check():
        return "with check", "check"
    return None


class RuleExplainer(Explainer):
    name = "rules"

    def explain(self, ctx: MoveContext) -> Explanation:
        board, after = ctx.board, ctx.board_after
        me = ctx.mover
        played = board.san(ctx.move)
        best = board.san(ctx.best_move)
        parts: List[str] = []
        themes: List[str] = []

        problem = (
            self._allowed_mate(ctx, after, played)
            or self._missed_mate(ctx)
            or self._lost_material(ctx, after, played)
            or self._positional(ctx, played)
        )
        parts.append(problem[0])
        themes.append(problem[1])

        # What should have been played, and why.
        tactic = describe_tactic(board, ctx.best_move)
        gain = settled_material_change(board, ctx.best_line, me)
        played_change = settled_material_change(board, [ctx.move] + ctx.reply_line, me)
        sentence = f"Better was {best}"
        if tactic:
            sentence += f", {tactic[0]}"
            themes.append(tactic[1])
        if gain - played_change >= 2 and gain > 0 and "missed-mate" not in themes:
            sentence += f" — it wins {points(gain)} of material"
            themes.append("missed-material")
        line = line_san(board, ctx.best_line)
        if line:
            sentence += f". Engine line: {line}"
        parts.append(sentence + ".")

        parts.append(
            f"Evaluation for you: {format_score(ctx.score_before)} with {best}, "
            f"{format_score(ctx.score_after)} after {played}."
        )
        return Explanation(text=" ".join(parts), themes=themes)

    # Each rule returns (sentence, theme) or None.

    def _allowed_mate(self, ctx, after, played):
        sa = ctx.score_after
        if sa.is_mate() and sa != chess.engine.MateGiven and sa.mate() < 0:
            line = line_san(after, ctx.reply_line, plies=2 * -sa.mate())
            return f"{played} allows a forced mate in {-sa.mate()}: {line}.", "allows-mate"
        return None

    def _missed_mate(self, ctx):
        if is_winning_mate(ctx.score_before) and not is_winning_mate(ctx.score_after):
            return f"You had a forced mate in {ctx.score_before.mate()} and missed it.", "missed-mate"
        return None

    def _lost_material(self, ctx, after, played):
        me = ctx.mover
        change, plies, lost = settle(after, ctx.reply_line, me)
        if change > -1:
            return None
        hit = first_capture_of(after, ctx.reply_line, victim=me)
        lost_text = f"{pieces_phrase(lost)}, " if lost else ""
        net = f" Net result: you lose {lost_text}{points(-change)} of material."
        if hit is None:
            line = line_san(after, ctx.reply_line, plies=max(plies, 2))
            return f"After {played}, the opponent wins material: {line}.{net}", "loses-material"

        index, capture, piece = hit
        where = capture.to_square
        line = line_san(after, ctx.reply_line, plies=max(plies, index + 1, 2))
        if index == 0 and where == ctx.move.to_square:
            if not after.is_attacked_by(me, where):
                return (
                    f"{played} leaves your {name(piece)} on {sq(where)} undefended — "
                    f"the opponent simply takes it ({line}).{net}",
                    "hanging-piece",
                )
            attacker = after.piece_at(capture.from_square)
            return (
                f"{played} puts your {name(piece)} on {sq(where)} where the "
                f"{name(attacker)} can take it ({line}).{net}",
                "hanging-piece",
            )
        if index == 0 and ctx.board.piece_at(where) == piece and ctx.board.is_attacked_by(not me, where):
            return (
                f"You overlooked the threat to your {name(piece)} on {sq(where)}. "
                f"After {played}, the opponent wins it: {line}.{net}",
                "ignored-threat",
            )
        reply_tactic = describe_tactic(after, ctx.reply_line[0]) if ctx.reply_line else None
        how = f" by {reply_tactic[0]}" if reply_tactic else ""
        return (
            f"After {played}, the opponent wins your {name(piece)}{how}: {line}.{net}",
            reply_tactic[1] if reply_tactic else "loses-material",
        )

    def _positional(self, ctx, played):
        board, move = ctx.board, ctx.move
        piece = board.piece_at(move.from_square)
        if (
            piece.piece_type == chess.KING
            and not board.is_castling(move)
            and board.has_castling_rights(ctx.mover)
        ):
            return (
                f"{played} gives up the right to castle and leaves your king exposed.",
                "king-safety",
            )
        if piece.piece_type == chess.QUEEN and board.fullmove_number <= 8:
            return (
                f"{played} brings the queen out early; the opponent can gain time by "
                "developing pieces with tempo against it.",
                "development",
            )
        if ctx.reply_line:
            after = ctx.board_after
            reply = after.san(ctx.reply_line[0])
            tactic = describe_tactic(after, ctx.reply_line[0])
            if tactic:
                return f"{played} lets the opponent play {reply}, {tactic[0]}.", tactic[1]
            return (
                f"{played} doesn't lose material right away, but it hands the opponent "
                f"the better position — their best reply is {reply}.",
                "positional",
            )
        return f"{played} worsens your position.", "positional"
