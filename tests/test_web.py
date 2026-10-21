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
