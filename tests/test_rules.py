import chess
import chess.engine

from chess_teacher.explain.base import MoveContext
from chess_teacher.explain.rules import RuleExplainer, describe_tactic, pieces_phrase, settle


def moves(board, *sans):
    b = board.copy()
    out = []
    for san in sans:
        move = b.parse_san(san)
        out.append(move)
        b.push(move)
    return out


def test_settle_waits_for_exchange_to_finish():
    # White knight takes a defended pawn; black recaptures.
    board = chess.Board("4k3/8/2p5/3p4/8/4N3/8/4K3 w - - 0 1")
    line = moves(board, "Nxd5", "cxd5")
    change, plies, lost = settle(board, line, chess.WHITE)
    assert change == -2
    assert plies == 2
    assert [p.piece_type for p in lost] == [chess.KNIGHT]


def test_detects_knight_fork():
    board = chess.Board("r3k3/8/8/3N4/8/8/8/4K3 w - - 0 1")
    phrase, theme = describe_tactic(board, board.parse_san("Nc7+"))
    assert theme == "fork"
    assert "king and rook" in phrase


def test_pieces_phrase():
    pieces = [chess.Piece(chess.PAWN, True), chess.Piece(chess.ROOK, True), chess.Piece(chess.PAWN, True)]
    assert pieces_phrase(pieces) == "a rook and 2 pawns"


def test_hanging_piece_explanation():
    # White puts a knight where a pawn can take it.
    board = chess.Board("4k3/8/4p3/8/8/2N5/8/4K3 w - - 0 1")
    move = board.parse_san("Nd5")
    after = board.copy()
    after.push(move)
    ctx = MoveContext(
        board=board,
        move=move,
        best_move=board.parse_san("Kd2"),
        best_line=moves(board, "Kd2"),
        reply_line=moves(after, "exd5"),
        score_before=chess.engine.Cp(200),
        score_after=chess.engine.Cp(-100),
        classification="blunder",
    )
    result = RuleExplainer().explain(ctx)
    assert "hanging-piece" in result.themes
    assert "knight on d5" in result.text
    assert "Better was Kd2" in result.text
