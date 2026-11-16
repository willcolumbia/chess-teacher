import chess

from chess_teacher import puzzles


def test_every_skill_has_a_full_set_from_easy_to_hard():
    data = puzzles._data()
    assert list(data) == [s["id"] for s in puzzles.SKILLS]
    ids = [p["id"] for group in data.values() for p in group]
    assert len(ids) == len(set(ids)) == 280
    for skill in puzzles.SKILLS:
        group = data[skill["id"]]
        assert len(group) == 20, skill["id"]
        assert [p["rating"] for p in group] == sorted(p["rating"] for p in group)
        assert all(p["idea"].endswith(".") for p in group)
        assert skill["level"] in puzzles.LEVELS and len(skill["tips"]) == 3


def test_every_solution_is_legal_and_ends_on_your_move():
    for group in puzzles._data().values():
        for p in group:
            board = chess.Board(p["fen"])
            assert board.is_valid(), p["id"]
            moves = p["moves"].split()
            assert len(moves) % 2 == 0 and len(moves) >= 2, p["id"]
            for i, uci in enumerate(moves):
                move = chess.Move.from_uci(uci)
                assert move in board.legal_moves, (p["id"], uci)
                if i % 2:  # your move: the page always promotes to a queen
                    assert move.promotion in (None, chess.QUEEN), p["id"]
                board.push(move)


def test_mate_sets_end_in_checkmate():
    for skill_id, yours in (("mate-in-1", 1), ("mate-in-2", 2), ("mate-in-3", 3), ("back-rank", None)):
        for p in puzzles._data()[skill_id]:
            board = chess.Board(p["fen"])
            moves = p["moves"].split()
            for uci in moves:
                board.push_uci(uci)
            assert board.is_checkmate(), p["id"]
            assert yours is None or len(moves) == 2 * yours, p["id"]


def test_list_has_ids_and_a_thumbnail_but_no_solutions():
    listed = puzzles.list_skills()
    assert [s["id"] for s in listed] == [s["id"] for s in puzzles.SKILLS]
    for s in listed:
        assert len(s["puzzles"]) == 20 and all(isinstance(i, str) for i in s["puzzles"])
        assert chess.Board(s["fen"]).is_valid()
        assert "tips" not in s


def test_a_skill_is_ready_to_play():
    skill = puzzles.get_skill("fork")
    assert skill["goal"] == "Find the fork" and len(skill["tips"]) == 3
    for p in skill["puzzles"]:
        board = chess.Board(p["start_fen"])
        board.push_uci(p["setup"]["uci"])
        assert board.fen() == p["setup"]["fen"]
        assert p["color"] == ("white" if board.turn == chess.WHITE else "black")
        assert p["difficulty"] in ("Easy", "Medium", "Hard")
        assert len(p["steps"]) % 2 == 1  # you move last
        for i, step in enumerate(p["steps"]):
            if i % 2 == 0:
                assert sorted(step["legal"]) == sorted(m.uci() for m in board.legal_moves)
                assert step["uci"] in step["legal"]
            else:
                assert "legal" not in step and "mates" not in step
            assert step["san"] == board.san(chess.Move.from_uci(step["uci"]))
            board.push_uci(step["uci"])
            assert board.fen() == step["fen"]


def test_any_other_checkmate_counts_too():
    # After ...c4, Ra8 is the answer, but the queen mates on b8 and h7 as well.
    p = {"id": "x", "fen": "7k/8/7K/2p5/8/8/8/RQ6 b - - 0 1", "moves": "c5c4 a1a8", "rating": 500}
    step = puzzles.expand(p)["steps"][0]
    assert set(step["mates"]) == {"b1b8", "b1h7"}
    assert step["mates"]["b1h7"]["san"] == "Qh7#"
    assert chess.Board(step["mates"]["b1b8"]["fen"]).is_checkmate()


def test_unknown_skill():
    try:
        puzzles.get_skill("nope")
    except ValueError:
        return
    raise AssertionError("expected a ValueError")
