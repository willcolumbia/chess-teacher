"""The Openings trainer: walk the book, judge the trainee's moves, pick the opponent's replies.

The book (opening_book.py) is turned into a tree per opening. While the game stays in
the tree, the trainee's recommended move is the book move and the opponent picks one of
the book replies at random (weighted). Once the line ends, or anyone leaves the book,
Stockfish recommends the trainee's moves and picks sound, varied replies.
"""
from __future__ import annotations

import random
import re
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Set

import chess
import chess.engine

from .analysis import classify, win_percent
from .engine import find_stockfish
from .explain import MoveContext, get_explainer
from .explain.describe import describe_move
from .opening_book import OPENINGS
from .positions import game_status, replay, sans_of

DEPTH = 14  # engine depth for recommendations and feedback
REPLY_SPREAD = 30  # centipawns: engine replies this close to the best are all fair game


@dataclass
class Node:
    san: str = ""
    idea: Optional[str] = None  # explanation of the move that led to this node
    weight: int = 0
    names: Set[str] = field(default_factory=set)  # book lines passing through
    children: Dict[str, "Node"] = field(default_factory=dict)  # uci -> node


def parse_line(text: str):
    """'e4 {idea} e5 Nf3' -> [('e4', 'idea'), ('e5', None), ('Nf3', None)]"""
    moves = []
    for token in re.findall(r"\{[^}]*\}|[^\s{}]+", text):
        if token.startswith("{"):
            san, _ = moves[-1]
            moves[-1] = (san, token[1:-1].strip())
        else:
            moves.append((token, None))
    return moves


def build_tree(opening: Dict) -> Node:
    trainee = chess.WHITE if opening["color"] == "white" else chess.BLACK
    root = Node()
    for line in opening["lines"]:
        board = chess.Board()
        node = root
        for san, idea in parse_line(line["moves"]):
            try:
                move = board.parse_san(san)
            except ValueError:
                raise ValueError(f"{opening['id']} / {line['name']}: illegal move {san} in {board.fen()}")
            if board.turn == trainee and node.children and move.uci() not in node.children:
                raise ValueError(f"{opening['id']} / {line['name']}: two different book moves for the trainee at {san}")
            child = node.children.setdefault(move.uci(), Node(san=san))
            child.weight += line.get("weight", 1)
            child.names.add(line["name"])
            if idea and not child.idea:
                child.idea = idea
            board.push(move)
            node = child
    return root


TREES = {opening["id"]: build_tree(opening) for opening in OPENINGS}
BY_ID = {opening["id"]: opening for opening in OPENINGS}


def list_openings() -> List[Dict]:
    out = []
    for opening in OPENINGS:
        main = max(opening["lines"], key=lambda line: line.get("weight", 1))
        first = [san for san, _ in parse_line(main["moves"])][:6]
        out.append(
            {
                "id": opening["id"],
                "name": opening["name"],
                "color": opening["color"],
                "summary": opening["summary"],
                "length": opening["length"],
                "first_moves": chess.Board().variation_san([m for m in _ucis(first)]),
                "variations": [line["name"] for line in opening["lines"]],
            }
        )
    return out


def _ucis(sans: List[str]) -> List[chess.Move]:
    board = chess.Board()
    moves = []
    for san in sans:
        move = board.parse_san(san)
        moves.append(move)
        board.push(move)
    return moves


def walk(tree: Node, moves: List[str]) -> Optional[Node]:
    """The book node reached by `moves`, or None once the game has left the book."""
    node = tree
    for uci in moves:
        node = node.children.get(uci)
        if node is None:
            return None
    return node


def variation_name(node: Optional[Node]) -> Optional[str]:
    return next(iter(node.names)) if node and len(node.names) == 1 else None


class Engine:
    """Opens Stockfish only if a turn needs it, and closes it when the turn is done."""

    def __init__(self):
        self._engine = None

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        if self._engine is not None:
            self._engine.quit()

    def get(self) -> chess.engine.SimpleEngine:
        if self._engine is None:
            self._engine = chess.engine.SimpleEngine.popen_uci(find_stockfish())
        return self._engine

    def analyse(self, board: chess.Board, multipv: int = 1):
        return self.get().analyse(board, chess.engine.Limit(depth=DEPTH), multipv=multipv)

    def best(self, board: chess.Board) -> chess.Move:
        # Clear the hash first: leftovers from earlier searches can change the pick,
        # and the move recommended now must match the one used to judge the reply.
        self.get().configure({"Clear Hash": None})
        return self.analyse(board)[0]["pv"][0]


def recommended(tree: Node, moves: List[str], board: chess.Board, engine: Engine) -> Dict:
    """The trainee's recommended move in this position: the book move, else Stockfish's."""
    node = walk(tree, moves)
    if node and node.children:
        uci, child = next(iter(node.children.items()))
        move = chess.Move.from_uci(uci)
        return {"uci": uci, "san": board.san(move), "idea": child.idea or describe_move(board, move), "source": "book"}
    move = engine.best(board)
    return {"uci": move.uci(), "san": board.san(move), "idea": describe_move(board, move), "source": "engine"}


def feedback(tree: Node, moves: List[str], engine: Engine) -> Dict:
    """Judge the trainee's last move (moves[-1])."""
    before = replay(moves[:-1])
    move = chess.Move.from_uci(moves[-1])
    expected = recommended(tree, moves[:-1], before, engine)
    played = {"uci": move.uci(), "san": before.san(move), "description": describe_move(before, move)}
    if move.uci() == expected["uci"]:
        icon = "book" if expected["source"] == "book" else "best"
        return {"correct": True, "played": played, "expected": expected, "classification": icon}

    # A different move: let Stockfish judge it.
    after = replay(moves)
    info_before = engine.analyse(before)[0]
    best_line = info_before.get("pv") or [move]
    score_before = info_before["score"].pov(before.turn)
    if after.is_game_over():
        score_after = chess.engine.PovScore(
            chess.engine.MateGiven if after.is_checkmate() else chess.engine.Cp(0), before.turn
        ).pov(before.turn)
        reply_line = []
    else:
        info_after = engine.analyse(after)[0]
        score_after = info_after["score"].pov(before.turn)
        reply_line = info_after.get("pv") or []
    drop = max(0.0, win_percent(score_before) - win_percent(score_after))
    label = classify(move, best_line[0], drop, score_before, score_after)
    result = {
        "correct": False,
        "played": played,
        "expected": expected,
        "classification": label,
        "win_drop": round(drop, 1),
        "explanation": None,
    }
    if label not in ("best", "good"):
        result["explanation"] = get_explainer().explain(
            MoveContext(
                board=before.copy(stack=False),
                move=move,
                best_move=best_line[0],
                best_line=best_line,
                reply_line=reply_line,
                score_before=score_before,
                score_after=score_after,
                classification=label,
            )
        ).text
    return result


def opponent_reply(tree: Node, moves: List[str], board: chess.Board, engine: Engine, rng: random.Random) -> Dict:
    node = walk(tree, moves)
    if node and node.children:
        ucis = list(node.children)
        uci = rng.choices(ucis, weights=[node.children[u].weight for u in ucis])[0]
        child = node.children[uci]
        move = chess.Move.from_uci(uci)
        return {
            "uci": uci,
            "san": board.san(move),
            "note": child.idea or describe_move(board, move),
            "source": "book",
            "variation": variation_name(child),
        }
    infos = engine.analyse(board, multipv=3)
    scored = [(info["pv"][0], info["score"].relative.score(mate_score=10000)) for info in infos if info.get("pv")]
    top = max(score for _, score in scored)
    move = rng.choice([m for m, score in scored if score >= top - REPLY_SPREAD])
    return {"uci": move.uci(), "san": board.san(move), "note": describe_move(board, move), "source": "engine", "variation": None}


def turn(opening_id: str, moves: List[str], rng: Optional[random.Random] = None) -> Dict:
    """One trainer step. `moves` ends with the trainee's move (or is empty at the start).

    Returns feedback on that move, the opponent's reply (already played), and the
    trainee's next recommended move, unless the drill is over.
    """
    if opening_id not in BY_ID:
        raise ValueError(f"Unknown opening {opening_id!r}.")
    opening, tree = BY_ID[opening_id], TREES[opening_id]
    trainee = chess.WHITE if opening["color"] == "white" else chess.BLACK
    rng = rng or random.Random()
    board = replay(moves)
    moves = list(moves)

    with Engine() as engine:
        result = {"feedback": None, "reply": None, "expected": None}
        last_by_trainee = bool(moves) and (len(moves) % 2 == 1) == (trainee == chess.WHITE)
        if last_by_trainee:
            result["feedback"] = feedback(tree, moves, engine)

        trainee_moves = (len(moves) + (1 if trainee == chess.WHITE else 0)) // 2
        done = trainee_moves >= opening["length"] or board.is_game_over()
        result["fen_before_reply"] = board.fen()
        if not done and board.turn != trainee:
            reply = opponent_reply(tree, moves, board, engine, rng)
            result["reply"] = reply
            moves.append(reply["uci"])
            board.push(chess.Move.from_uci(reply["uci"]))
            done = board.is_game_over()
        if not done:
            result["expected"] = recommended(tree, moves, board, engine)

    node = walk(tree, moves)
    result.update(
        {
            "moves": moves,
            "fen": board.fen(),
            "legal": [] if done else [m.uci() for m in board.legal_moves],
            "sans": sans_of(board),
            "status": game_status(board),
            "in_book": node is not None,
            "variation": variation_name(node),
            "trainee_moves": (len(moves) + (1 if trainee == chess.WHITE else 0)) // 2,
            "length": opening["length"],
            "done": done,
        }
    )
    return result
