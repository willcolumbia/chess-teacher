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


def make_ctx(fen, played, best_line, reply_line, before=200, after=-100):
    board = chess.Board(fen)
    move = board.parse_san(played)
    after_board = board.copy()
    after_board.push(move)
    best = moves(board, *best_line)
    return MoveContext(
        board=board,
        move=move,
        best_move=best[0],
        best_line=best,
        reply_line=moves(after_board, *reply_line),
        score_before=chess.engine.Cp(before),
        score_after=chess.engine.Cp(after),
        classification="blunder",
    )


def test_trades_are_not_listed_as_losses():
    # White loses a bishop and a pawn but the queens are traded on the way.
    board = chess.Board("4k3/8/8/8/8/8/8/4K3 w - - 0 1")
    lost = [chess.Piece(chess.QUEEN, True), chess.Piece(chess.BISHOP, True), chess.Piece(chess.PAWN, True)]
    from chess_teacher.explain.rules import untraded
    left = untraded(lost, [chess.Piece(chess.QUEEN, False)])
    assert pieces_phrase(left) == "a bishop and a pawn"


def test_stalemate_explained():
    ctx = make_ctx("k7/2K5/8/8/8/8/8/1Q6 w - - 0 1", "Qb6", ["Qb7#"], [], before=10000, after=0)
    result = RuleExplainer().explain(ctx)
    assert result.themes[0] == "stalemate"
    assert "draw" in result.text


def test_moving_piece_off_a_line_is_explained():
    # The knight on e4 shields the rook on e1 from the queen on e5.
    ctx = make_ctx("4k3/8/8/4q3/4N3/8/8/4R1K1 w - - 0 1", "Nc3", ["Kg2"], ["Qxe1+"])
    result = RuleExplainer().explain(ctx)
    assert result.themes[0] == "discovered-attack"
    assert "rook on e1" in result.text


def test_walking_into_a_fork_is_explained():
    # Black's rook goes to d8 where Nxf7+ forks king and rook.
    ctx = make_ctx("2r5/5p2/3k4/6N1/8/8/8/5K2 b - - 0 1", "Rd8", ["Ke7"], ["Nxf7", "Kd7", "Nxd8"])
    result = RuleExplainer().explain(ctx)
    assert result.themes[0] == "fork"
    assert "king and rook" in result.text
