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
    assert by_san["Be2"]["classification"] in ("mistake", "blunder")  # already lost, so not always a blunder
    assert "mate in 1" in by_san["Be2"]["explanation"]
    assert by_san["Nf3#"]["eval_after"]["text"] == "0-1"
    assert result["moves"][0]["clock"] == 598.0


def fake_move(color, accuracy, white_win_before, white_win_after):
    return {
        "color": color,
        "accuracy": accuracy,
        "eval_before": {"white_win": white_win_before},
        "eval_after": {"white_win": white_win_after},
    }


def test_game_accuracy_punishes_a_blunder_more_than_a_plain_average():
    from chess_teacher.analysis import game_accuracy

    moves = []
    for i in range(20):
        moves.append(fake_move("white", 100, 55, 55))
        moves.append(fake_move("black", 100, 55, 55))
    moves[10] = fake_move("white", 5, 55, 10)  # one white blunder
    for m in moves[11:]:
        m["eval_before"]["white_win"] = m["eval_after"]["white_win"] = 10
    plain = sum(m["accuracy"] for m in moves if m["color"] == "white") / 20
    assert game_accuracy(moves, "white") < plain - 10
    assert game_accuracy(moves, "black") > 99
