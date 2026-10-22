"""Run Stockfish over every position in a game and build a move-by-move report."""
from __future__ import annotations

import io
import math
import statistics
from typing import Callable, Dict, List, Optional, Tuple

import chess
import chess.engine
import chess.pgn

from .engine import find_stockfish
from .explain import Explainer, MoveContext, get_explainer
from .explain.describe import describe_move
from .explain.rules import describe_tactic, line_san

DEFAULT_DEPTH = 16

# Drop in the mover's winning chances (percentage points) for each label.
# Inaccuracy starts lower than Lichess's 10 so smaller slips get flagged too.
THRESHOLDS = [(30, "blunder"), (20, "mistake"), (5, "inaccuracy")]
EXPLAINED = {"inaccuracy", "mistake", "blunder"}
CLASSIFICATIONS = ["great", "best", "good", "inaccuracy", "mistake", "blunder"]
# "Great": the best move when every alternative loses at least this much winning chance.
GREAT_GAP = 15

ProgressFn = Callable[[int, int], None]
# (score, principal variation, score of the second-best move or None)
Evaluation = Tuple[chess.engine.PovScore, List[chess.Move], Optional[chess.engine.PovScore]]


def win_percent(score: chess.engine.Score) -> float:
    """Winning chances (0-100) for the side the score belongs to (Lichess model)."""
    return score.wdl(model="lichess").expectation() * 100


def move_accuracy(drop: float) -> float:
    """Lichess per-move accuracy from the drop in winning chances (including its +1 uncertainty bonus)."""
    if drop <= 0:
        return 100.0
    return max(0.0, min(100.0, 103.1668 * math.exp(-0.04354 * drop) - 3.1669 + 1))


def game_accuracy(moves: List[Dict], color: str) -> Optional[float]:
    """Lichess game accuracy for one side.

    The average of (a) move accuracies weighted by how volatile the position was
    around each move, and (b) their harmonic mean. Quiet moves in decided positions
    count for little, and a few bad moves pull the score down hard.
    """
    wins = [m["eval_before"]["white_win"] for m in moves] + [moves[-1]["eval_after"]["white_win"]]
    size = min(len(wins), max(2, min(8, len(moves) // 10)))
    windows = [wins[:size]] * (size - 2) + [wins[i:i + size] for i in range(len(wins) - size + 1)]
    weights = [max(0.5, min(12.0, statistics.pstdev(w))) for w in windows]
    mine = [(m["accuracy"], weights[i]) for i, m in enumerate(moves) if m["color"] == color]
    if not mine:
        return None
    weighted = sum(a * w for a, w in mine) / sum(w for _, w in mine)
    harmonic = len(mine) / sum(1 / max(a, 1) for a, _ in mine)  # floor of 1 avoids dividing by zero
    return (weighted + harmonic) / 2


def is_mated_soon(score: chess.engine.Score) -> bool:
    return score.is_mate() and score != chess.engine.MateGiven and score.mate() < 0


VALUES = {chess.PAWN: 1, chess.KNIGHT: 3, chess.BISHOP: 3, chess.ROOK: 5, chess.QUEEN: 9, chess.KING: 0}


def is_obvious(board: chess.Board, move: chess.Move) -> bool:
    """A recapture, or taking a piece worth more than the capturer: not 'great', however forced."""
    if not board.is_capture(move) or board.is_en_passant(move):
        return False
    captured = board.piece_type_at(move.to_square)
    if VALUES[captured] > VALUES[board.piece_type_at(move.from_square)]:
        return True
    return is_recapture(board, move)


def is_recapture(board: chess.Board, move: chess.Move) -> bool:
    if not board.move_stack or not board.is_capture(move):
        return False
    previous = board.pop()
    try:
        return previous.to_square == move.to_square and board.is_capture(previous)
    finally:
        board.push(previous)


def classify(
    move: chess.Move,
    best_move: chess.Move,
    drop: float,
    before: chess.engine.Score,
    after: chess.engine.Score,
    second: Optional[chess.engine.Score] = None,
    board: Optional[chess.Board] = None,
) -> str:
    """`before`/`after`/`second` are from the mover's point of view; `board` is the
    position before the move (with its move stack), used to spot recaptures."""
    if move == best_move:
        only_move = second is not None and win_percent(before) - win_percent(second) >= GREAT_GAP
        if only_move and not (board is not None and is_obvious(board, move)):
            return "great"
        return "best"
    # Walking into a forced mate is serious even in a bad position (Lichess rule),
    # but less so when the position was already hopeless.
    if is_mated_soon(after) and not is_mated_soon(before):
        cp = before.score()
        if cp is not None and cp < -999:
            return "inaccuracy"
        if cp is not None and cp < -700:
            return "mistake"
        return "blunder"
    for threshold, label in THRESHOLDS:
        if drop >= threshold:
            return label
    return "good"


def score_json(score: chess.engine.PovScore) -> Dict:
    """Score from White's point of view, plus a display string and bar position."""
    white = score.white()
    if white.is_mate():
        n = white.mate()
        if n == 0:
            text = "1-0" if white > chess.engine.Cp(0) else "0-1"
        else:
            text = f"#{n}" if n > 0 else f"#-{-n}"
        cp = None
    else:
        n = None
        cp = white.score()
        text = f"{cp / 100:+.2f}"
    return {"cp": cp, "mate": n, "text": text, "white_win": round(win_percent(white), 1)}


IDEA_PLIES = 10  # how much of the better line to play out on the board (5 moves each)


def line_details(board: chess.Board, line: List[chess.Move], plies: int = IDEA_PLIES) -> List[Dict]:
    """Each move of an engine line with its position and a plain-language description."""
    b = board.copy()
    out = []
    for move in line[:plies]:
        if not b.is_legal(move):
            break
        san = b.san(move)
        number = f"{b.fullmove_number}." if b.turn == chess.WHITE else f"{b.fullmove_number}..."
        detail = {
            "san": san,
            "label": f"{number} {san}",
            "uci": move.uci(),
            "color": "white" if b.turn == chess.WHITE else "black",
            "description": describe_move(b, move),
        }
        b.push(move)
        detail["fen"] = b.fen()
        out.append(detail)
    return out


def evaluate(engine: chess.engine.SimpleEngine, board: chess.Board, limit) -> Evaluation:
    if board.is_checkmate():
        return chess.engine.PovScore(chess.engine.MateGiven, not board.turn), [], None
    if board.is_game_over():
        return chess.engine.PovScore(chess.engine.Cp(0), board.turn), [], None
    infos = engine.analyse(board, limit, multipv=2)
    second = infos[1]["score"] if len(infos) > 1 else None
    return infos[0]["score"], infos[0].get("pv", []), second


def rate_last_move(board: chess.Board, depth: int = 12) -> Dict:
    """Classify the last move played on `board` (which must have a move stack)."""
    after = board.copy()
    before = board.copy()
    move = before.pop()
    mover = before.turn
    limit = chess.engine.Limit(depth=depth)
    with chess.engine.SimpleEngine.popen_uci(find_stockfish()) as engine:
        score_before, best_line, second = evaluate(engine, before, limit)
        score_after, _, _ = evaluate(engine, after, limit)
    rel_before, rel_after = score_before.pov(mover), score_after.pov(mover)
    drop = max(0.0, win_percent(rel_before) - win_percent(rel_after))
    best_move = best_line[0] if best_line else move
    second_rel = second.pov(mover) if second else None
    label = classify(move, best_move, drop, rel_before, rel_after, second_rel, before)
    return {"uci": move.uci(), "classification": label, "win_drop": round(drop, 1), "best_uci": best_move.uci()}


def read_game(pgn_text: str) -> chess.pgn.Game:
    game = chess.pgn.read_game(io.StringIO(pgn_text))
    if game is None:
        raise ValueError("No game found in the PGN.")
    if game.errors:
        raise ValueError(f"Could not parse the PGN: {game.errors[0]}")
    if game.next() is None:
        raise ValueError("The PGN has no moves.")
    return game


def analyze_pgn(
    pgn_text: str,
    depth: int = DEFAULT_DEPTH,
    explainer: Optional[Explainer] = None,
    progress: Optional[ProgressFn] = None,
) -> Dict:
    game = read_game(pgn_text)
    explainer = explainer or get_explainer()
    nodes = list(game.mainline())
    start = game.board()
    limit = chess.engine.Limit(depth=depth)
    total = len(nodes) + 1

    # Evaluate every position once: evals[i] is the position before move i.
    evals: List[Evaluation] = []
    with chess.engine.SimpleEngine.popen_uci(find_stockfish()) as engine:
        board = start.copy()
        evals.append(evaluate(engine, board, limit))
        if progress:
            progress(1, total)
        for i, node in enumerate(nodes):
            board.push(node.move)
            evals.append(evaluate(engine, board, limit))
            if progress:
                progress(i + 2, total)

    moves = []
    board = start.copy()
    for i, node in enumerate(nodes):
        move = node.move
        mover = board.turn
        score_before, best_line, second = evals[i]
        score_after, reply_line, _ = evals[i + 1]
        best_move = best_line[0] if best_line else move
        rel_before, rel_after = score_before.pov(mover), score_after.pov(mover)
        drop = max(0.0, win_percent(rel_before) - win_percent(rel_after))
        second_rel = second.pov(mover) if second else None
        label = classify(move, best_move, drop, rel_before, rel_after, second_rel, board)

        explanation, themes = None, []
        if label in EXPLAINED:
            result = explainer.explain(
                MoveContext(
                    board=board.copy(stack=False),
                    move=move,
                    best_move=best_move,
                    best_line=best_line,
                    reply_line=reply_line,
                    score_before=rel_before,
                    score_after=rel_after,
                    classification=label,
                )
            )
            explanation, themes = result.text, result.themes

        after = board.copy(stack=False)
        after.push(move)
        reply = reply_line[0] if reply_line else None
        reply_tactic = describe_tactic(after, reply) if reply else None

        moves.append(
            {
                "ply": i + 1,
                "move_number": board.fullmove_number,
                "color": "white" if mover == chess.WHITE else "black",
                "san": board.san(move),
                "uci": move.uci(),
                "fen_before": board.fen(),
                "fen_after": after.fen(),
                "description": describe_move(board, move),
                "best_san": board.san(best_move),
                "best_uci": best_move.uci(),
                "best_line": line_san(board, best_line, plies=10),
                "best_description": describe_move(board, best_move) if best_move != move else None,
                "best_line_moves": line_details(board, best_line) if best_move != move else [],
                # The played move followed by the engine's best play from there.
                "punish_line_moves": (
                    line_details(board, [move] + reply_line, plies=IDEA_PLIES + 1) if label in EXPLAINED else []
                ),
                "reply_san": after.san(reply) if reply else None,
                "reply_note": reply_tactic[0] if reply_tactic else None,
                "reply_line": line_san(after, reply_line, plies=6),
                "classification": label,
                "win_drop": round(drop, 1),
                "accuracy": round(move_accuracy(drop), 1),
                "eval_before": score_json(score_before),
                "eval_after": score_json(score_after),
                "clock": node.clock(),
                "explanation": explanation,
                "themes": themes,
            }
        )
        board.push(move)

    return {
        "headers": dict(game.headers),
        "start_fen": start.fen(),
        "final_fen": board.fen(),
        "depth": depth,
        "explainer": explainer.name,
        "moves": moves,
        "summary": {color: summarize(moves, color) for color in ("white", "black")},
    }


def summarize(moves: List[Dict], color: str) -> Dict:
    mine = [m for m in moves if m["color"] == color]
    counts = {label: 0 for label in CLASSIFICATIONS}
    for m in mine:
        counts[m["classification"]] += 1
    accuracy = game_accuracy(moves, color)
    return {"accuracy": round(accuracy, 1) if accuracy is not None else None, "counts": counts}
