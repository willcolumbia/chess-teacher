import chess

from chess_teacher import safety
from chess_teacher.positions import replay


def test_hung_bishop_is_flagged():
    # 1. e4 e5 2. Nf3 Nc6 3. Bc4 Nf6 4. Ng5 Na5: the knight on a5 attacks the bishop on c4
    board = replay("e2e4 e7e5 g1f3 b8c6 f1c4 g8f6 f3g5 c6a5".split())
    check = safety.check(board)
    assert check["danger"] == ["c4"]


def test_pieces_you_can_win():
    # White to move; the black knight on e4 is undefended and attacked by the d3 pawn
    board = chess.Board("rnbqkb1r/pppp1ppp/8/4p3/4n3/3P1N2/PPP2PPP/RNBQKB1R w KQkq - 0 4")
    assert "e4" in safety.check(board)["chances"]


def test_moves_that_give_material_away():
    board = replay("e2e4 e7e5 g1f3 b8c6 f1c4 g8f6 f3g5".split())
    unsafe = safety.check(board)["unsafe"]
    assert "f8a3" in unsafe  # the bishop is taken by the b-pawn
    assert "d7d5" not in unsafe  # d5 is defended


def test_defended_trade_is_not_unsafe():
    # Bxc6 dxc6 is an even trade
    board = replay("e2e4 e7e5 g1f3 b8c6 f1b5 a7a6".split())
    assert "b5c6" not in safety.check(board)["unsafe"]


def test_pinned_attacker_does_not_count():
    # The black knight on c6 is pinned to the king by Bb5, so it can't take on d4
    board = chess.Board("r1b1k2r/ppp1qppp/2n2n2/1B6/3N4/8/PPPP1PPP/RNBQK2R b KQkq - 0 1")
    assert board.is_pinned(chess.BLACK, chess.C6)
    assert safety.can_take(board, chess.BLACK, chess.D4) == []
