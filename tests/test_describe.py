import chess

from chess_teacher.explain.describe import describe_move


def play(*sans):
    board = chess.Board()
    for san in sans:
        board.push_san(san)
    return board


def test_describes_opening_moves():
    board = play()
    assert describe_move(board, board.parse_san("e4")) == "Puts a pawn on e4, fighting for the center."
    board = play("e4", "e5")
    assert describe_move(board, board.parse_san("Nf3")).startswith("Develops the knight to f3.")


def test_capture_is_not_a_recapture_after_a_quiet_move():
    board = play("d4", "d5", "Bf4", "Nc6", "e3", "e6", "Nf3", "Nb4", "c3", "Nc6",
                 "Nbd2", "Nf6", "Bd3", "Bd6", "O-O", "e5")
    text = describe_move(board, board.parse_san("dxe5"))
    assert text.startswith("The pawn takes the pawn on e5.")
    assert "forking the bishop and knight" in text


def test_recapture_and_castling():
    board = play("e4", "d5", "exd5")
    assert describe_move(board, board.parse_san("Qxd5")).startswith("Recaptures the pawn on d5")
    board = play("e4", "e5", "Nf3", "Nc6", "Bc4", "Bc5")
    assert describe_move(board, board.parse_san("O-O")).startswith("Castles kingside")
