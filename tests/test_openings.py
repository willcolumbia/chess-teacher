import random

import chess
import pytest

from chess_teacher.engine import find_stockfish
from chess_teacher.opening_book import OPENINGS
from chess_teacher.openings import TREES, list_openings, parse_line, turn, walk

try:
    find_stockfish()
    HAVE_ENGINE = True
except FileNotFoundError:
    HAVE_ENGINE = False
needs_engine = pytest.mark.skipif(not HAVE_ENGINE, reason="Stockfish not installed")


def test_parse_line_attaches_ideas():
    assert parse_line("e4 {center} e5 Nf3 {attack e5}") == [("e4", "center"), ("e5", None), ("Nf3", "attack e5")]


def test_every_opening_builds_and_is_listed():
    assert set(TREES) == {o["id"] for o in OPENINGS}
    listed = list_openings()
    assert {o["color"] for o in listed} == {"white", "black"}
    assert all(o["first_moves"].startswith("1.") for o in listed)


def test_trainee_has_one_book_move_everywhere():
    for opening in OPENINGS:
        trainee_white = opening["color"] == "white"
        stack = [(TREES[opening["id"]], 0)]
        while stack:
            node, depth = stack.pop()
            if (depth % 2 == 0) == trainee_white:
                assert len(node.children) <= 1, opening["id"]
            stack.extend((child, depth + 1) for child in node.children.values())


@needs_engine
def test_black_drill_starts_with_white_book_move():
    result = turn("sicilian", [], random.Random(1))
    assert result["feedback"] is None
    assert result["reply"]["uci"] == "e2e4"
    assert result["expected"] == {**result["expected"], "san": "c5", "source": "book"}


@needs_engine
def test_book_move_is_correct_and_deviation_is_judged():
    good = turn("italian", ["e2e4"], random.Random(1))
    assert good["feedback"]["correct"]
    assert good["reply"]["san"] == "e5"

    # 2.Qh5 instead of the book 2.Nf3: allowed, but flagged with the book move.
    off = turn("italian", ["e2e4", "e7e5", "d1h5"], random.Random(1))
    assert not off["feedback"]["correct"]
    assert off["feedback"]["expected"]["san"] == "Nf3"
    assert not off["in_book"]
    assert off["expected"]["source"] == "engine"


@needs_engine
def test_drill_ends_after_the_opening_length():
    moves = []
    result = turn("london", moves, random.Random(2))
    while not result["done"]:
        moves = result["moves"] + [result["expected"]["uci"]]
        result = turn("london", moves, random.Random(2))
    assert result["trainee_moves"] == 10
    assert result["sans"][0] == "d4"
    assert walk(TREES["london"], result["moves"][:1]) is not None


@needs_engine
def test_recommended_move_is_judged_correct_when_played():
    # Out of book after 1...f6, so recommendations come from Stockfish.
    moves = []
    result = turn("sicilian", moves, random.Random(3))
    result = turn("sicilian", result["moves"] + ["f7f6"], random.Random(3))
    for _ in range(4):
        result = turn("sicilian", result["moves"] + [result["expected"]["uci"]], random.Random(3))
        assert result["feedback"]["correct"], result["feedback"]
