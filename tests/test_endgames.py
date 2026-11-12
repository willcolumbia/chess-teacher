import chess

from chess_teacher import endgames


def test_every_start_position_is_legal_with_you_to_move():
    for drill in endgames.DRILLS:
        assert drill["goal"] in ("mate", "promote", "draw")
        for fen in drill["fens"]:
            board = chess.Board(fen)
            assert board.is_valid(), (drill["id"], fen)
            assert not board.is_game_over()


def test_list_has_no_positions():
    listed = endgames.list_drills()
    assert [d["id"] for d in listed] == [d["id"] for d in endgames.DRILLS]
    assert all("fens" not in d and d["positions"] == 3 for d in listed)


def test_start_gives_the_verdict_without_a_reply():
    data = endgames.turn("queen", 0, [])
    assert data["reply"] is None
    assert data["eval"]["winning"]
    assert data["result"] is None
    assert data["start_fen"] == endgames.DRILLS[1]["fens"][0]


def test_a_move_that_lets_the_pawn_win_slip_fails():
    data = endgames.turn("pawn-win", 0, ["e6f5"])  # Kf5? and Black takes the opposition
    assert data["reply"] is not None
    assert data["result"] == "failed"


def test_the_only_drawing_move_holds():
    assert endgames.turn("pawn-draw", 1, ["e6e7"])["result"] == "failed"
    held = endgames.turn("pawn-draw", 1, ["e6e5"])
    assert held["result"] is None and held["eval"]["text"] == "Draw"


def test_checkmate_wins_and_stalemate_fails():
    drill = endgames.BY_ID["queen"]
    mated = chess.Board("k7/8/1K6/8/8/8/8/7Q w - - 0 1")
    mated.push_san("Qh8#")
    assert endgames.verdict(drill, mated, chess.WHITE, None, 5)["result"] == "won"
    stale = chess.Board("k7/2Q5/1K6/8/8/8/8/8 b - - 0 1")
    assert endgames.verdict(drill, stale, chess.WHITE, None, 5)["result"] == "failed"


def test_bad_requests():
    import pytest

    with pytest.raises(ValueError):
        endgames.turn("nope", 0, [])
    with pytest.raises(ValueError):
        endgames.turn("queen", 7, [])


def test_turn_gives_the_move_and_why():
    data = endgames.turn("pawn-win", 0, [])
    assert data["expected"]["san"] == "Kf6"
    assert "in front of the pawn" in data["expected"]["idea"]


def test_idea_explains_the_box():
    board = chess.Board("8/8/3k4/8/8/8/8/1R4RK w - - 0 1")
    assert "box from 28 to 12" in endgames.idea(board, board.parse_san("Rg5"), "mate")


def test_square_and_bridge_ideas():
    board = chess.Board("8/8/8/5k2/P7/8/8/7K b - - 0 1")
    assert "pawn's square" in endgames.idea(board, board.parse_san("Ke5"), "draw")
    board = chess.Board("1K6/1P2k3/8/8/8/8/r7/3R4 w - - 0 1")
    assert "bridge" in endgames.idea(board, board.parse_san("Rd4"), "promote")


def test_every_drill_starts_cleanly():
    for drill in endgames.DRILLS:
        for fen in drill["fens"]:
            assert chess.Board(fen).is_valid(), (drill["id"], fen)
