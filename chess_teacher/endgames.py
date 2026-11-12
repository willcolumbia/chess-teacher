"""Endgame drills: basic endings you play out against Stockfish's best defence (or attack).

Each drill has a few starting positions, a goal and some tips. /api/endgames/turn takes your
move, plays Stockfish's reply and says whether the drill is won, failed or still going, with
Stockfish's verdict from your side ("mate in 7", "draw", ...) so you can see if a move helped.
"""
from __future__ import annotations

from typing import Dict, List, Optional

import chess
import chess.engine

from .analysis import score_json
from .explain.describe import describe_move
from .engine import find_stockfish
from .positions import game_status, is_finished, replay, sans_of

DEPTH = 18
HOLD_MOVES = 12  # "hold the draw": survive this many moves with the position still a draw

DRILLS: List[Dict] = [
    {
        "id": "two-rooks",
        "name": "Ladder mate",
        "material": "King and two rooks vs king",
        "goal": "mate",
        "level": "Beginner",
        "summary": "The rooks take turns cutting the king off, one rank at a time, until it's on the edge.",
        "tips": [
            "One rook checks, the other guards the next rank so the king can't step back.",
            "If the king attacks a rook, move that rook far away along the same rank.",
            "Your own king isn't needed.",
        ],
        "fens": [
            "8/8/3k4/8/8/8/8/1R4RK w - - 0 1",
            "8/8/8/3k4/8/8/8/R5RK w - - 0 1",
            "8/8/8/4k3/8/8/8/R3K2R w - - 0 1",
        ],
    },
    {
        "id": "queen",
        "name": "Queen mate",
        "material": "King and queen vs king",
        "goal": "mate",
        "level": "Beginner",
        "summary": "Shrink the king's box with knight-move steps of the queen, then bring your king up to help.",
        "tips": [
            "Put the queen a knight's move away from the king: it shrinks the box without giving check.",
            "Once the king is stuck on the edge, stop moving the queen and walk your king over.",
            "Watch out for stalemate: always leave the king a square unless you're giving mate.",
        ],
        "fens": [
            "8/8/8/3k4/8/8/8/2Q1K3 w - - 0 1",
            "8/8/2k5/8/8/8/8/4K1Q1 w - - 0 1",
            "8/8/8/4k3/8/8/2Q5/6K1 w - - 0 1",
        ],
    },
    {
        "id": "square",
        "name": "Rule of the square",
        "material": "King vs king and pawn",
        "goal": "draw",
        "level": "Beginner",
        "summary": "Can your king catch a runaway pawn? Picture a square from the pawn to its queening rank and step into it.",
        "tips": [
            "Draw a square: from the pawn to the last rank, and the same distance sideways toward your king.",
            "If your king can step inside that square, it catches the pawn. If not, the pawn queens.",
            "Go diagonally: a king move along a diagonal counts as a step in both directions at once.",
        ],
        "fens": [
            "8/8/8/5k2/P7/8/8/7K b - - 0 1",
            "8/8/8/8/6P1/2k5/8/K7 b - - 0 1",
            "8/8/8/2k5/7P/8/8/K7 b - - 0 1",
        ],
    },
    {
        "id": "rook",
        "name": "Rook mate",
        "material": "King and rook vs king",
        "goal": "mate",
        "level": "Intermediate",
        "summary": "The rook cuts the king off; your king pushes it back with the opposition.",
        "tips": [
            "Use the rook to fence the king in on one side of a rank or file.",
            "Bring your king toward the enemy king. Check only when the kings face each other (the opposition).",
            "When there's nothing useful, make a waiting move with the rook along its line.",
        ],
        "fens": [
            "8/8/2k5/8/8/8/8/4K2R w - - 0 1",
            "8/8/8/4k3/8/8/8/1R4K1 w - - 0 1",
            "8/8/8/3k4/8/8/8/R3K3 w - - 0 1",
        ],
    },
    {
        "id": "pawn-win",
        "name": "Win with the pawn",
        "material": "King and pawn vs king",
        "goal": "promote",
        "level": "Intermediate",
        "summary": "Make a queen and keep it. The king leads the way; the pawn follows.",
        "tips": [
            "Get your king in front of the pawn, not behind or beside it.",
            "Take the opposition: kings facing each other with one square between, and the other side to move.",
            "Push the pawn only when your king already controls the squares in front of it.",
        ],
        "fens": [
            "4k3/8/4K3/4P3/8/8/8/8 w - - 0 1",
            "6k1/8/5K2/5P2/8/8/8/8 w - - 0 1",
            "8/8/3k4/8/8/3K4/3P4/8 w - - 0 1",
        ],
    },
    {
        "id": "pawn-draw",
        "name": "Stop the pawn",
        "material": "King vs king and pawn",
        "goal": "draw",
        "level": "Intermediate",
        "summary": "You only have a king. Get in front of the pawn and hold the opposition, and it's a draw.",
        "tips": [
            "Head for the square in front of the pawn.",
            "Face the enemy king with one square between you (the opposition), so it can't get past.",
            "When you're pushed back to your last rank, stay right in front of the pawn: then it's stalemate or a draw.",
        ],
        "fens": [
            "8/8/8/4k3/8/8/4P3/4K3 b - - 0 1",
            "8/8/4k3/8/8/4K3/4P3/8 b - - 0 1",
            "8/8/3k4/8/8/3K4/3P4/8 b - - 0 1",
        ],
    },
    {
        "id": "breakthrough",
        "name": "Pawn breakthrough",
        "material": "Three pawns vs three pawns",
        "goal": "promote",
        "level": "Intermediate",
        "summary": "The kings are too far away to help. One pawn sacrifice, then another, and one of your pawns runs through.",
        "tips": [
            "Push the middle pawn first, even though it can be taken.",
            "Whichever pawn takes it, push the pawn next to the one that took.",
            "Pushing an outside pawn first doesn't work: Black just blocks.",
        ],
        "fens": [
            "6k1/ppp5/8/PPP5/8/8/8/6K1 w - - 0 1",
            "1k6/5ppp/8/5PPP/8/8/8/1K6 w - - 0 1",
            "6k1/ppp5/8/PPP5/8/8/8/5K2 w - - 0 1",
        ],
    },
    {
        "id": "bishops",
        "name": "Two-bishop mate",
        "material": "King and two bishops vs king",
        "goal": "mate",
        "level": "Advanced",
        "summary": "Side by side, the two bishops make a wall the king can't cross. Push it to the edge, then into a corner.",
        "tips": [
            "Keep the bishops next to each other: together they cut off two diagonals.",
            "Your king has to help. Bring it close to the enemy king.",
            "The mate happens in a corner. Watch for stalemate when the king is nearly trapped.",
        ],
        "fens": [
            "8/8/8/3k4/8/8/8/2B1KB2 w - - 0 1",
            "4k3/8/8/8/8/8/8/2B1KB2 w - - 0 1",
            "8/8/5k2/8/8/8/8/2B1KB2 w - - 0 1",
        ],
        "win_cp": 200,  # Stockfish rates this win lower than it is
    },
    {
        "id": "lucena",
        "name": "Lucena position",
        "material": "Rook and pawn vs rook",
        "goal": "promote",
        "level": "Advanced",
        "summary": "Your pawn is one step from queening but your king is in the way. Build a bridge with the rook to escape the checks.",
        "tips": [
            "Move your rook up to the 4th rank first: that's the bridge.",
            "Then step your king out from in front of the pawn.",
            "When the checks come, walk the king toward your rook and block the last check with it.",
        ],
        "fens": [
            "1K6/1P6/4k3/8/8/8/r7/3R4 w - - 0 1",
            "1K6/1P2k3/8/8/8/8/r7/3R4 w - - 0 1",
            "2K5/2P5/5k2/8/8/8/1r6/4R3 w - - 0 1",
        ],
    },
    {
        "id": "philidor",
        "name": "Philidor position",
        "material": "Rook vs rook and pawn",
        "goal": "draw",
        "level": "Advanced",
        "summary": "The most important defence in chess: keep your rook on the third rank, then check from behind once the pawn moves up.",
        "tips": [
            "Keep your rook on your third rank so the enemy king can't come forward.",
            "Keep your king in front of the pawn.",
            "Once the pawn steps onto your third rank, drop the rook to the back and check from behind, from far away.",
        ],
        "fens": [
            "4k3/R7/7r/3KP3/8/8/8/8 b - - 0 1",
            "3k4/7R/6r1/2KP4/8/8/8/8 b - - 0 1",
            "5k2/1R6/r7/4KP2/8/8/8/8 b - - 0 1",
        ],
    },
    {
        "id": "bishop-knight",
        "name": "Bishop and knight mate",
        "material": "King, bishop and knight vs king",
        "goal": "mate",
        "level": "Advanced",
        "summary": "The hardest basic mate. Drive the king to a corner the color of your bishop, all within fifty moves.",
        "tips": [
            "Mate only works in a corner your bishop can reach (same color as the bishop).",
            "First push the king to the edge with your king, bishop and knight working together.",
            "If it runs to the wrong corner, chase it along the edge to the right one. The knight moves in a W pattern.",
        ],
        "fens": [
            "8/8/8/4k3/8/8/8/1N2KB2 w - - 0 1",
            "7k/8/8/8/8/8/8/1N2KB2 w - - 0 1",
            "8/8/3k4/8/8/8/8/4KBN1 w - - 0 1",
        ],
        "win_cp": 150,
    },
]
BY_ID = {d["id"]: d for d in DRILLS}


def list_drills() -> List[Dict]:
    keys = ("id", "name", "material", "goal", "level", "summary", "tips")
    return [dict({key: d[key] for key in keys}, positions=len(d["fens"]), fen=d["fens"][0]) for d in DRILLS]


def drill_board(drill_id: str, start: int, moves: List[str]) -> chess.Board:
    drill = BY_ID.get(drill_id)
    if drill is None:
        raise ValueError(f"Unknown drill {drill_id!r}.")
    if not isinstance(start, int) or not 0 <= start < len(drill["fens"]):
        raise ValueError("Unknown starting position.")
    return replay(moves, drill["fens"][start])


def has_queen(board: chess.Board, color: chess.Color) -> bool:
    return bool(board.pieces(chess.QUEEN, color))


def user_eval(score: chess.engine.PovScore, user: chess.Color, win_cp: int = 300) -> Dict:
    """Stockfish's verdict from your side, in words."""
    s = score.pov(user)
    data = score_json(score)
    if s.is_mate():
        n = s.mate()
        words = "Checkmate" if n == 0 else f"You mate in {n}" if n > 0 else f"You get mated in {-n}"
        return {"mate": n, "cp": None, "text": words, "winning": n > 0 or s == chess.engine.MateGiven, "board": data["text"]}
    cp = s.score()
    if abs(cp) < 80:
        words = "Draw"
    elif cp > 0:
        words = f"You're winning (+{cp / 100:.1f})"
    else:
        words = f"You're losing ({cp / 100:.1f})"
    return {"mate": None, "cp": cp, "text": words, "winning": cp >= win_cp, "board": data["text"]}


NAMES = {chess.QUEEN: "queen", chess.ROOK: "rook", chess.KING: "king", chess.PAWN: "pawn"}


def box_size(board: chess.Board, user: chess.Color) -> int:
    """How many squares the enemy king can still reach without stepping into your attacks."""
    them = not user
    king = board.king(them)
    open_board = board.copy(stack=False)
    open_board.remove_piece_at(king)  # squares behind the king on a rook's line count as attacked
    seen, todo = {king}, [king]
    while todo:
        for nxt in chess.SquareSet(chess.BB_KING_ATTACKS[todo.pop()]):
            if nxt not in seen and open_board.piece_at(nxt) is None and not open_board.is_attacked_by(user, nxt):
                seen.add(nxt)
                todo.append(nxt)
    return len(seen)


def in_square(king: chess.Square, pawn: chess.Square, color: chess.Color) -> bool:
    """Can `king` catch `color`'s pawn with the pawn to move (the rule of the square)?"""
    rank = chess.square_rank(pawn) if color == chess.WHITE else 7 - chess.square_rank(pawn)
    steps = 7 - rank - (1 if rank == 1 else 0)  # a pawn on its first rank can jump two squares
    queen_square = chess.square(chess.square_file(pawn), 7 if color == chess.WHITE else 0)
    return chess.square_distance(king, queen_square) <= steps


def has_opposition(board: chess.Board) -> bool:
    """Kings facing each other with one square between, and the side to move has to give way."""
    a, b = board.king(chess.WHITE), board.king(chess.BLACK)
    files, ranks = abs(chess.square_file(a) - chess.square_file(b)), abs(chess.square_rank(a) - chess.square_rank(b))
    return (files, ranks) in ((0, 2), (2, 0))


def idea(board: chess.Board, move: chess.Move, goal: str) -> str:
    """Why `move` is the right one in a drill, in a sentence or two."""
    user = board.turn
    them = not user
    after = board.copy(stack=False)
    after.push(move)
    if after.is_checkmate():
        return "Checkmate!"
    piece = board.piece_at(move.from_square)
    name = NAMES.get(piece.piece_type, "piece")
    parts = []
    if move.promotion:
        parts.append("Makes a new queen.")
    elif piece.piece_type != chess.KING and board.attackers(them, move.from_square) and not board.attackers(user, move.from_square):
        parts.append(f"Gets the {name} out of the king's reach: it was attacked and nothing defended it.")
    if goal == "mate":
        before_box, after_box = box_size(board, user), box_size(after, user)
        if after_box < before_box:
            parts.append(f"It shrinks the king's box from {before_box} to {after_box} squares.")
    if piece.piece_type == chess.KING:
        enemy = board.king(them)
        if has_opposition(after):
            parts.append("Takes the opposition: the kings face each other and the other king has to give way.")
        elif chess.square_distance(move.to_square, enemy) < chess.square_distance(move.from_square, enemy):
            parts.append("Brings your king closer to the other king.")
        if goal == "promote":
            ahead = 1 if user == chess.WHITE else -1
            seventh = 6 if user == chess.WHITE else 1
            if any(p + 8 * ahead == move.from_square and chess.square_rank(p) == seventh for p in board.pieces(chess.PAWN, user)):
                parts.insert(0, "Steps out from in front of the pawn so it can move up.")
            for pawn in after.pieces(chess.PAWN, user):
                files = abs(chess.square_file(pawn) - chess.square_file(move.to_square))
                ranks = (chess.square_rank(move.to_square) - chess.square_rank(pawn)) * ahead
                if files <= 1 and ranks >= 1:
                    parts.append("Your king leads the way in front of the pawn, clearing its path to the last rank.")
                    break
        if goal == "draw":
            pawns = after.pieces(chess.PAWN, them)
            if any(chess.square_file(p) == chess.square_file(move.to_square) for p in pawns):
                parts.append("Your king stands in the pawn's path.")
            elif any(in_square(move.to_square, p, them) for p in pawns):
                parts.insert(0, "Steps into the pawn's square: now your king can catch it.")
    elif piece.piece_type == chess.PAWN and not move.promotion:
        if after.attackers(them, move.to_square) & after.pawns:
            parts.append("A pawn sacrifice: whichever pawn takes it, another of yours gets a free run.")
        else:
            parts.append("Pushes the pawn one step closer to queening.")
    elif piece.piece_type == chess.ROOK:
        rank = chess.square_rank(move.to_square) if user == chess.WHITE else 7 - chess.square_rank(move.to_square)
        if goal == "promote" and rank == 3 and any(chess.square_rank(p) in (1, 6) for p in after.pieces(chess.PAWN, user)):
            parts.append("Builds a bridge: from the 4th rank the rook can block the checks once your king steps out.")
        if goal == "draw":
            if rank == 2:
                parts.append("Keeps your rook on your third rank, so the enemy king can't come forward.")
            elif after.is_check() and chess.square_distance(move.to_square, after.king(them)) >= 3:
                parts.append("Checks from far away, where the king can't chase the rook.")
                return " ".join(parts[:2])
    if after.is_check() and len(parts) < 2:
        parts.append("It's check, so the king has to move.")
    if not parts:
        if goal == "mate" and piece.piece_type != chess.KING:
            return f"A waiting move: the {name} keeps its fence and the king has to move."
        return describe_move(board, move)
    return " ".join(parts[:2])


def verdict(drill: Dict, board: chess.Board, user: chess.Color, ev: Optional[Dict], user_moves: int) -> Dict:
    """Is the drill won, failed or still going?"""
    goal = drill["goal"]
    if board.is_checkmate():
        if board.turn != user:
            return {"result": "won", "message": f"Checkmate in {user_moves} moves. Well done!"}
        return {"result": "failed", "message": "You got checkmated."}
    if board.is_stalemate():
        if goal == "draw":
            return {"result": "won", "message": "Stalemate: that's a draw. You held it!"}
        return {"result": "failed", "message": "Stalemate! The king had no legal moves but wasn't in check, so it's a draw. Always leave it a square."}
    if is_finished(board):  # not enough material, repetition, fifty moves
        if goal == "draw":
            return {"result": "won", "message": f"{game_status(board)}. You held the draw!"}
        why = "you lost the material you needed" if board.is_insufficient_material() else game_status(board).lower()
        return {"result": "failed", "message": f"It's a draw: {why}."}
    if goal == "promote" and board.turn == user and (ev is None or ev["winning"]):
        if has_queen(board, user):
            return {"result": "won", "message": f"You made a queen in {user_moves} moves, and it's safe. From here it's a queen mate."}
        lone_king = board.occupied_co[not user] == board.kings & board.occupied_co[not user]
        if lone_king and board.pieces(chess.ROOK, user):
            return {"result": "won", "message": f"Your opponent had to give up their rook to stop the pawn. With your rook left it's a rook mate: you won it in {user_moves} moves."}
    if ev is not None:
        if goal == "draw":
            if ev["mate"] is not None and ev["mate"] < 0 or (ev["cp"] is not None and ev["cp"] <= -300):
                return {"result": "failed", "message": "Stockfish can now force a win: your king lost the opposition or got out of the pawn's way."}
            if user_moves >= HOLD_MOVES and ev["text"] == "Draw":
                return {"result": "won", "message": f"You've held for {user_moves} moves and Stockfish can't make progress. Draw!"}
        elif not ev["winning"]:
            return {"result": "failed", "message": "That let the win slip: Stockfish now says it's a draw."}
    return {"result": None, "message": None}


def turn(drill_id: str, start: int, moves: List[str]) -> Dict:
    """Your move is the last of `moves` (or none at the start). Plays Stockfish's reply and
    judges the position."""
    drill = BY_ID.get(drill_id)
    board = drill_board(drill_id, start, moves)
    user = chess.Board(drill["fens"][start]).turn
    user_moves = (len(moves) + 1) // 2
    reply = None
    ev = None
    expected = None
    if not is_finished(board):
        with chess.engine.SimpleEngine.popen_uci(find_stockfish()) as engine:
            if board.turn != user:
                info = engine.analyse(board, chess.engine.Limit(depth=DEPTH))
                move = info["pv"][0]
                reply = {"uci": move.uci(), "san": board.san(move)}
                board.push(move)
            if not is_finished(board):
                info = engine.analyse(board, chess.engine.Limit(depth=DEPTH))
                ev = user_eval(info["score"], user, drill.get("win_cp", 300))
                if info.get("pv"):
                    best = info["pv"][0]
                    expected = {"uci": best.uci(), "san": board.san(best), "idea": idea(board, best, drill["goal"])}
    state = verdict(drill, board, user, ev, user_moves)
    over = state["result"] is not None or is_finished(board)
    return {
        "start_fen": drill["fens"][start],
        "moves": moves + ([reply["uci"]] if reply else []),
        "reply": reply,
        "fen": board.fen(),
        "legal": [] if over else [m.uci() for m in board.legal_moves],
        "sans": sans_of(board),
        "status": game_status(board),
        "eval": ev,
        "expected": None if over else expected,  # your best move now, with why
        "user_moves": user_moves,
        **state,
    }
