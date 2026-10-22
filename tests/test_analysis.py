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


def test_only_move_is_great_but_obvious_captures_are_not():
    import chess
    import chess.engine

    from chess_teacher.analysis import classify

    cp = chess.engine.Cp
    board = chess.Board("4k3/8/8/8/8/8/4q3/R3K3 w - - 0 1")
    # Kxe2 would be "only move" by the scores, but it takes a queen with the king: obvious.
    take = board.parse_san("Kxe2")
    assert classify(take, take, 0, cp(500), cp(500), cp(-900), board) == "best"
    quiet = chess.Board("4k3/8/8/8/8/8/8/R3K3 w - - 0 1")
    move = quiet.parse_san("Ra8+")
    assert classify(move, move, 0, cp(300), cp(300), cp(-300), quiet) == "great"
    assert classify(move, move, 0, cp(300), cp(300), cp(250), quiet) == "best"


def test_sound_sacrifice_is_brilliant_but_a_trade_is_not():
    import chess
    import chess.engine

    from chess_teacher.analysis import classify

    cp = chess.engine.Cp
    # A knight hop to e6 puts it where the d7 pawn can take it.
    board = chess.Board("4k3/3p4/8/6N1/8/8/8/4K3 w - - 0 1")
    sac = board.parse_san("Ne6")  # the d7 pawn can take it
    assert classify(sac, sac, 0, cp(80), cp(90), None, board) == "brilliant"
    # Same move in a position that was already completely winning: just best.
    assert classify(sac, sac, 0, cp(900), cp(900), None, board) == "best"
    # Rook takes a defended rook: material goes back and forth, no sacrifice.
    trade = chess.Board("3rk3/2p5/8/8/8/8/8/3RK3 w - - 0 1")
    rxd8 = trade.parse_san("Rxd8+")
    assert classify(rxd8, rxd8, 0, cp(0), cp(0), None, trade) == "best"


def test_castling_and_en_passant_can_be_rated():
    import chess
    import chess.engine

    from chess_teacher.analysis import classify

    cp = chess.engine.Cp
    board = chess.Board("r3k2r/pppppppp/8/8/8/8/PPPPPPPP/R3K2R w KQkq - 0 1")
    for san in ("O-O", "O-O-O"):
        move = board.parse_san(san)
        assert classify(move, move, 0, cp(20), cp(20), None, board) == "best"
    ep = chess.Board("4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1")
    move = ep.parse_san("exd6")
    assert classify(move, move, 0, cp(20), cp(20), None, ep) == "best"
