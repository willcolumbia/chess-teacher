from pathlib import Path

import pytest

from chess_teacher.analysis import analyze_pgn, read_game
from chess_teacher.engine import find_stockfish

SAMPLE = (Path(__file__).parent.parent / "samples" / "example.pgn").read_text()

try:
    find_stockfish()
    HAVE_ENGINE = True
except FileNotFoundError:
    HAVE_ENGINE = False


def test_rejects_bad_pgn():
    with pytest.raises(ValueError):
        read_game("not a game")
    with pytest.raises(ValueError):
        read_game('[Event "x"]\n\n*')


@pytest.mark.skipif(not HAVE_ENGINE, reason="Stockfish not installed")
def test_sample_game():
    result = analyze_pgn(SAMPLE, depth=12)
    by_san = {m["san"]: m for m in result["moves"]}
    assert len(result["moves"]) == 14
    assert by_san["Nxf7"]["classification"] in ("mistake", "blunder")
    assert by_san["Be2"]["classification"] == "blunder"
    assert "mate in 1" in by_san["Be2"]["explanation"]
    assert by_san["Nf3#"]["eval_after"]["text"] == "0-1"
    assert result["moves"][0]["clock"] == 598.0
