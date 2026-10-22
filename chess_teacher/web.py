"""Local web app.

/          a playable board, for two players or against Stockfish
           (moves are checked by /api/play; the engine answers via /api/engine-move)
/openings  opening trainer (/api/openings, /api/openings/turn)
/analysis  paste a PGN; analysis runs in a background thread and the page polls for it
"""
from __future__ import annotations

import threading
import uuid
from datetime import date
from pathlib import Path
from typing import Dict

import chess
import chess.pgn
from flask import Flask, jsonify, request, send_from_directory

from . import openings, opponent
from .positions import game_status, replay, sans_of
from .analysis import DEFAULT_DEPTH, analyze_pgn, rate_last_move, read_game

STATIC = Path(__file__).parent / "static"
MAX_JOBS = 50

app = Flask(__name__, static_folder=None)
jobs: Dict[str, Dict] = {}
jobs_lock = threading.Lock()


def run_job(job_id: str, pgn: str, depth: int) -> None:
    def progress(done: int, total: int) -> None:
        with jobs_lock:
            jobs[job_id]["progress"] = {"done": done, "total": total}

    try:
        result = analyze_pgn(pgn, depth=depth, progress=progress)
        update = {"status": "done", "result": result}
    except Exception as exc:  # report any failure to the page
        update = {"status": "error", "error": str(exc)}
    with jobs_lock:
        jobs[job_id].update(update)


@app.get("/")
def home():
    return send_from_directory(STATIC, "home.html")


@app.get("/openings")
def openings_page():
    return send_from_directory(STATIC, "openings.html")


@app.get("/analysis")
def analysis_page():
    return send_from_directory(STATIC, "analysis.html")


@app.get("/static/<path:name>")
def static_file(name):
    return send_from_directory(STATIC, name)


@app.post("/api/analyze")
def analyze():
    body = request.get_json(silent=True) or {}
    pgn = (body.get("pgn") or "").strip()
    try:
        depth = max(8, min(22, int(body.get("depth") or DEFAULT_DEPTH)))
        read_game(pgn)  # fail fast on bad PGN
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400

    job_id = uuid.uuid4().hex
    with jobs_lock:
        if len(jobs) >= MAX_JOBS:
            jobs.pop(next(iter(jobs)))
        jobs[job_id] = {"status": "running", "progress": {"done": 0, "total": 0}}
    threading.Thread(target=run_job, args=(job_id, pgn, depth), daemon=True).start()
    return jsonify({"job_id": job_id})


@app.get("/api/jobs/<job_id>")
def job_status(job_id):
    with jobs_lock:
        job = jobs.get(job_id)
        if job is None:
            return jsonify({"error": "Unknown job."}), 404
        return jsonify(dict(job))


@app.post("/api/play")
def play():
    """Replay `moves` (UCI) from the start position; return the position and its legal moves."""
    body = request.get_json(silent=True) or {}
    try:
        board = replay(body.get("moves"))
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    sans = sans_of(board)

    game = chess.pgn.Game.from_board(board)
    game.headers["Event"] = "Casual game"
    for side in ("White", "Black"):
        name = body.get(side.lower())
        if isinstance(name, str) and name.strip():
            game.headers[side] = name.strip()[:60]
    game.headers["Date"] = date.today().strftime("%Y.%m.%d")
    over = board.is_game_over(claim_draw=True)
    if over:
        game.headers["Result"] = board.result(claim_draw=True)
    return jsonify(
        {
            "fen": board.fen(),
            "turn": "white" if board.turn == chess.WHITE else "black",
            "legal": [] if over else [m.uci() for m in board.legal_moves],
            "sans": sans,
            "status": game_status(board),
            "game_over": over,
            "pgn": str(game),
        }
    )


@app.post("/api/engine-move")
def engine_move():
    """Stockfish's reply to `moves` (UCI), playing at roughly `elo`."""
    body = request.get_json(silent=True) or {}
    try:
        board = replay(body.get("moves"))
        elo = int(body.get("elo") or 1500)
        move = opponent.choose_move(board, elo)
    except (ValueError, TypeError) as exc:
        return jsonify({"error": str(exc)}), 400
    except FileNotFoundError as exc:
        return jsonify({"error": str(exc)}), 500
    return jsonify({"uci": move.uci(), "elo": max(opponent.MIN_ELO, min(opponent.MAX_ELO, elo))})


@app.get("/api/openings")
def openings_list():
    return jsonify(openings.list_openings())


@app.post("/api/openings/turn")
def openings_turn():
    body = request.get_json(silent=True) or {}
    try:
        return jsonify(openings.turn(str(body.get("opening")), body.get("moves") or []))
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    except FileNotFoundError as exc:
        return jsonify({"error": str(exc)}), 500


@app.post("/api/rate")
def rate():
    """Classify the last of `moves` (best, great, good, inaccuracy, mistake, blunder)."""
    body = request.get_json(silent=True) or {}
    try:
        board = replay(body.get("moves"))
        if not board.move_stack:
            raise ValueError("No moves to rate.")
        return jsonify(rate_last_move(board))
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    except FileNotFoundError as exc:
        return jsonify({"error": str(exc)}), 500
