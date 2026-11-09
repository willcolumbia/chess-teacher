from chess_teacher.web import app

client = app.test_client()


def play(*moves):
    return client.post("/api/play", json={"moves": list(moves)})


def test_start_position():
    data = play().get_json()
    assert data["turn"] == "white"
    assert len(data["legal"]) == 20
    assert data["status"] == "White to move"


def test_legal_and_illegal_moves():
    data = play("e2e4", "e7e5").get_json()
    assert data["sans"] == ["e4", "e5"]
    assert "g1f3" in data["legal"]
    assert play("e2e5").status_code == 400


def test_checkmate_ends_the_game():
    data = play("f2f3", "e7e5", "g2g4", "d8h4").get_json()
    assert data["game_over"]
    assert data["legal"] == []
    assert data["status"] == "Checkmate — Black wins"
    assert "0-1" in data["pgn"]


def test_pages_are_served():
    assert client.get("/").status_code == 200
    assert client.get("/analysis").status_code == 200


def test_engine_moves_are_legal_at_every_strength():
    import chess

    from chess_teacher.web import replay

    for elo in (400, 900, 1500, 2800):
        data = client.post("/api/engine-move", json={"moves": ["e2e4"], "elo": elo}).get_json()
        assert chess.Move.from_uci(data["uci"]) in replay(["e2e4"]).legal_moves, elo


def test_engine_refuses_finished_games():
    res = client.post("/api/engine-move", json={"moves": ["f2f3", "e7e5", "g2g4", "d8h4"], "elo": 1500})
    assert res.status_code == 400


def test_a_possible_repetition_does_not_end_the_game():
    # The start position has occurred twice; Black *could* repeat it, but hasn't.
    shuffle = ["g1f3", "g8f6", "f3g1", "f6g8", "g1f3", "g8f6", "f3g1"]
    data = play(*shuffle).get_json()
    assert not data["game_over"]
    assert data["status"] == "Black to move"
    assert data["legal"]
    # Once it actually happens a third time, it's a draw.
    data = play(*shuffle, "f6g8").get_json()
    assert data["game_over"]
    assert data["status"] == "Draw by repetition"
    assert "1/2-1/2" in data["pgn"]


def test_play_from_a_position():
    fen = "rn2kb1r/pp2pppp/1q6/3p4/8/2N4P/PPPP1P1P/R1BQK2R w KQkq - 0 8"
    data = client.post("/api/play", json={"fen": fen, "moves": ["c3d5"]}).get_json()
    assert data["sans"] == ["Nxd5"]
    assert data["turn"] == "black"
    assert "b6b2" in data["legal"]
    assert client.post("/api/play", json={"fen": "not a position", "moves": []}).status_code == 400
    assert client.post("/api/play", json={"fen": 42, "moves": []}).status_code == 400


def test_best_move():
    # Black can mate at once: 1. f3 e5 2. g4 ... Qh4#
    data = client.post("/api/best", json={"moves": ["f2f3", "e7e5", "g2g4"]}).get_json()
    assert data["uci"] == "d8h4"
    assert data["san"] == "Qh4#"
    assert client.post("/api/best", json={"moves": ["f2f3", "e7e5", "g2g4", "d8h4"]}).status_code == 400
