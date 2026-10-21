"""Local web app.

/          a playable board (moves are checked by the /api/play endpoint)
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

from .analysis import DEFAULT_DEPTH, analyze_pgn, read_game

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


def game_status(board: chess.Board) -> str:
    side = "White" if board.turn == chess.WHITE else "Black"
    if board.is_checkmate():
        return f"Checkmate — {'Black' if board.turn == chess.WHITE else 'White'} wins"
    if board.is_stalemate():
        return "Stalemate — draw"
    if board.is_insufficient_material():
        return "Draw — not enough material to checkmate"
    if board.can_claim_threefold_repetition() or board.is_fivefold_repetition():
        return "Draw by repetition"
    if board.can_claim_fifty_moves() or board.is_seventyfive_moves():
        return "Draw by the fifty-move rule"
    if board.is_check():
        return f"{side} to move — in check"
    return f"{side} to move"


@app.post("/api/play")
def play():
    """Replay `moves` (UCI) from the start position; return the position and its legal moves."""
    body = request.get_json(silent=True) or {}
    board = chess.Board()
    sans = []
    for uci in body.get("moves") or []:
        try:
            move = chess.Move.from_uci(uci)
        except ValueError:
            return jsonify({"error": f"Bad move {uci!r}."}), 400
        if move not in board.legal_moves:
            return jsonify({"error": f"Illegal move {uci!r}."}), 400
        sans.append(board.san(move))
        board.push(move)

    game = chess.pgn.Game.from_board(board)
    game.headers["Event"] = "Casual game"
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
