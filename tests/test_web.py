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
