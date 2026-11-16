"""Preset puzzles, grouped by the skill they train.

The puzzles come from the Lichess puzzle database (public domain, database.lichess.org):
positions from real games with one clearly best line. `scripts/build_puzzles.py` picked a
clean set for each skill, ordered from easy to hard, and wrote them to data/puzzles.json.

A puzzle starts one move early: `fen` is the position before your opponent's move, and the
first of `moves` is that move. The rest is the solution, your moves and the replies in turn.
"""
from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Dict, List

import chess

DATA = Path(__file__).parent / "data" / "puzzles.json"
LEVELS = ["Beginner", "Intermediate", "Advanced"]

SKILLS: List[Dict] = [
    {
        "id": "mate-in-1",
        "name": "Mate in one",
        "level": "Beginner",
        "goal": "Checkmate in one move",
        "summary": "One move ends the game. Find the check the king can't escape.",
        "tips": [
            "Look at every check you can give, starting with the queen.",
            "For each check, ask three things: can the king move, can the check be blocked, can the checking piece be taken?",
            "A piece next to the king needs a protector, or the king just takes it.",
        ],
    },
    {
        "id": "free-piece",
        "name": "Free pieces",
        "level": "Beginner",
        "goal": "Win the piece that isn't protected",
        "summary": "Your opponent left a piece with no protection. Spot it and take it.",
        "tips": [
            "Check each enemy piece: is something of yours attacking it, and is anything guarding it?",
            "A piece with no guard is free. A guarded piece usually costs you the piece you take with.",
            "If more than one piece is free, take the most valuable one.",
        ],
    },
    {
        "id": "back-rank",
        "name": "Back-rank mate",
        "level": "Beginner",
        "goal": "Checkmate on the back rank",
        "summary": "A king stuck behind its own pawns can be mated by a rook or queen on the back rank.",
        "tips": [
            "Look for a king on its first rank with its own pawns right in front of it.",
            "A rook or queen that lands on that rank with check wins, unless something can block or take it.",
            "If one piece guards the back rank, see if you can trade it off or outnumber it.",
        ],
    },
    {
        "id": "fork",
        "name": "Forks",
        "level": "Intermediate",
        "goal": "Find the fork",
        "summary": "One piece attacks two things at once. Your opponent can only save one.",
        "tips": [
            "Knights are the best forkers. Look for a knight jump that gives check and hits something else.",
            "Queens and pawns fork too. A pawn that attacks two pieces wins one of them.",
            "A fork is strongest when one target is the king, because the check has to be answered first.",
        ],
    },
    {
        "id": "pin",
        "name": "Pins",
        "level": "Intermediate",
        "goal": "Use the pin",
        "summary": "A pinned piece can't move without exposing the king behind it. Win it, or ignore it as a defender.",
        "tips": [
            "A piece pinned to its king can't leave the line, so it is stuck where it stands.",
            "Attack a pinned piece again, best of all with a pawn, and you usually win it.",
            "A pinned piece only pretends to guard things. A square it seems to protect may be safe for you.",
        ],
    },
    {
        "id": "skewer",
        "name": "Skewers",
        "level": "Intermediate",
        "goal": "Find the skewer",
        "summary": "Attack a valuable piece along a line. When it moves away, you take what was behind it.",
        "tips": [
            "A skewer is a pin turned around: the more valuable piece is in front.",
            "Look for the king and another piece on the same rank, file or diagonal.",
            "A check along that line forces the king to step off, and the piece behind it is yours.",
        ],
    },
    {
        "id": "discovered",
        "name": "Discovered attacks",
        "level": "Intermediate",
        "goal": "Find the discovered attack",
        "summary": "Move one piece out of the way and the piece behind it attacks. Two threats in one move.",
        "tips": [
            "Look for your bishop, rook or queen aimed at a target with one of your own pieces in the way.",
            "Move the piece in front to a square where it makes a threat of its own.",
            "If the uncovered attack is a check, the piece you moved can take almost anything.",
        ],
    },
    {
        "id": "mate-in-2",
        "name": "Mate in two",
        "level": "Intermediate",
        "goal": "Checkmate in two moves",
        "summary": "Force checkmate in two moves. Your first move leaves the king no way out.",
        "tips": [
            "Start with checks. A check limits the replies you have to think about.",
            "For every reply your opponent has, make sure you have a mate ready.",
            "Giving up a piece is fine if the king ends up with no escape.",
        ],
    },
    {
        "id": "defender",
        "name": "Remove the defender",
        "level": "Advanced",
        "goal": "Remove the defender",
        "summary": "A piece is only safe while its guard is there. Take the guard, then take the piece.",
        "tips": [
            "Find an enemy piece that only one thing protects.",
            "Take or trade off that protector, even if it costs you something at first.",
            "Count what you have at the end of the line, not after the first capture.",
        ],
    },
    {
        "id": "deflection",
        "name": "Deflection",
        "level": "Advanced",
        "goal": "Lure the defender away",
        "summary": "Force a defender to leave its post, then take what it was guarding.",
        "tips": [
            "Find a piece that is doing an important job, like guarding a piece or a key square.",
            "Give a check or offer a piece that the defender has to answer.",
            "Once it has moved, the thing it was guarding is yours.",
        ],
    },
    {
        "id": "trapped",
        "name": "Trapped pieces",
        "level": "Advanced",
        "goal": "Trap the piece",
        "summary": "A piece with no safe squares is lost as soon as you attack it.",
        "tips": [
            "Look for an enemy piece deep in your side of the board or stuck on the edge.",
            "Check every square it could move to. If all of them are covered, it is trapped.",
            "Attack it with something cheaper than it is.",
        ],
    },
    {
        "id": "promotion",
        "name": "Pawn promotion",
        "level": "Advanced",
        "goal": "Get a new queen",
        "summary": "A pawn that reaches the last rank becomes a queen. Find the way to get it there.",
        "tips": [
            "A pawn one or two squares from the end is worth a look before anything else.",
            "Ask what is stopping it: a blocker, or a piece guarding the promotion square.",
            "Remove or distract that piece, even at a cost. A new queen pays for it.",
        ],
    },
    {
        "id": "sacrifice",
        "name": "Sacrifices",
        "level": "Advanced",
        "goal": "Find the sacrifice",
        "summary": "Give up material on purpose because what you get back is worth more.",
        "tips": [
            "The winning move is often a capture or a check that looks like it loses a piece.",
            "Work out what happens after your piece is taken. You need a forced follow-up, not a hope.",
            "Typical payoffs: checkmate, winning the queen, or a pawn that can't be stopped.",
        ],
    },
    {
        "id": "mate-in-3",
        "name": "Mate in three",
        "level": "Advanced",
        "goal": "Checkmate in three moves",
        "summary": "Three forcing moves and the king is mated. Keep checking until it has no way out.",
        "tips": [
            "Look at checks first, then captures, then threats.",
            "Work out the whole line before you play the first move.",
            "Each of your moves should leave your opponent only one or two replies.",
        ],
    },
]
BY_ID = {s["id"]: s for s in SKILLS}


@lru_cache(maxsize=1)
def _data() -> Dict[str, List[Dict]]:
    """{skill id: its puzzles, easiest first}."""
    with open(DATA, encoding="utf-8") as f:
        return json.load(f)["skills"]


def difficulty(rating: int) -> str:
    return "Easy" if rating < 900 else "Medium" if rating < 1200 else "Hard"


def solver_position(puzzle: Dict) -> chess.Board:
    """The position you solve from: after your opponent's first move."""
    board = chess.Board(puzzle["fen"])
    board.push_uci(puzzle["moves"].split()[0])
    return board


def expand(puzzle: Dict) -> Dict:
    """A puzzle with everything the page needs to run it without asking the server again.

    `steps` are the solution moves in order (yours first, then the reply, and so on), each with
    the position after it. Your steps also list the legal moves, and `mates`: other moves that
    give checkmate on the spot, which count as solving the puzzle.
    """
    board = chess.Board(puzzle["fen"])
    setup, *solution = [chess.Move.from_uci(u) for u in puzzle["moves"].split()]
    first = {"uci": setup.uci(), "san": board.san(setup)}
    board.push(setup)
    first["fen"] = board.fen()
    you = board.turn
    steps = []
    for move in solution:
        step = {"uci": move.uci(), "san": board.san(move)}
        if board.turn == you:
            step["legal"] = [m.uci() for m in board.legal_moves]
            mates = {}
            for other in board.legal_moves:
                if other == move:
                    continue
                san = board.san(other)
                board.push(other)
                if board.is_checkmate():
                    mates[other.uci()] = {"san": san, "fen": board.fen()}
                board.pop()
            step["mates"] = mates
        board.push(move)
        step["fen"] = board.fen()
        steps.append(step)
    return {
        "id": puzzle["id"],
        "rating": puzzle["rating"],
        "difficulty": difficulty(puzzle["rating"]),
        "color": "white" if you == chess.WHITE else "black",
        "start_fen": puzzle["fen"],
        "setup": first,
        "steps": steps,
        "idea": puzzle.get("idea", ""),
    }


def list_skills() -> List[Dict]:
    """Every skill with its puzzle ids (for progress) and a position for its thumbnail."""
    out = []
    for skill in SKILLS:
        puzzles = _data().get(skill["id"], [])
        info = {k: skill[k] for k in ("id", "name", "level", "goal", "summary")}
        info["puzzles"] = [p["id"] for p in puzzles]
        info["fen"] = solver_position(puzzles[0]).fen() if puzzles else None
        out.append(info)
    return out


@lru_cache(maxsize=None)
def get_skill(skill_id: str) -> Dict:
    """One skill with all of its puzzles, ready to play."""
    skill = BY_ID.get(skill_id)
    if skill is None:
        raise ValueError("Unknown skill.")
    info = dict(skill)
    info["puzzles"] = [expand(p) for p in _data().get(skill_id, [])]
    return info
