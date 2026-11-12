"""Local web app.

/          a playable board, for two players or against Stockfish
           (moves are checked by /api/play; the engine answers via /api/engine-move;
           /api/best is the "Best move" hint)
/openings  opening trainer (/api/openings, /api/openings/turn)
/analysis  paste a PGN; analysis runs in a background thread and the page polls for it
/puzzles   puzzles made from your own mistakes (kept in the browser; Analysis adds them)
/endgames  endgame drills against Stockfish (/api/endgames, /api/endgames/turn)
/settings  theme, accent color, board colors and animation
"""
from __future__ import annotations

import os
import threading
import time
import uuid
from collections import defaultdict, deque
from datetime import date
from pathlib import Path
from typing import Deque, Dict

import chess
import chess.pgn
from flask import Flask, jsonify, request, send_from_directory
from werkzeug.middleware.proxy_fix import ProxyFix

from . import book, chesscom, endgames, openings, opponent, safety
from .positions import game_status, is_finished, replay, sans_of
from .analysis import DEFAULT_DEPTH, analyze_pgn, best_move, rate_last_move, read_game

STATIC = Path(__file__).parent / "static"
MAX_JOBS = 50
# Analyses running at once; each one keeps a Stockfish process busy.
MAX_RUNNING = int(os.environ.get("CHESS_TEACHER_MAX_RUNNING", "2"))
# (requests, seconds) per client IP. /api/jobs is left out: the Analysis page polls it.
RATE_LIMITS = {
    "/api/analyze": (5, 600),
    "/api/": (120, 60),
}

app = Flask(__name__, static_folder=None)
# The opening book takes a few seconds to load; do it in the background at startup.
threading.Thread(target=book._load, daemon=True).start()
if os.environ.get("CHESS_TEACHER_BEHIND_PROXY"):
    # Take the client IP from X-Forwarded-For (set by Tailscale Funnel).
    app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1)
jobs: Dict[str, Dict] = {}
jobs_lock = threading.Lock()
hits: Dict[tuple, Deque[float]] = defaultdict(deque)
hits_lock = threading.Lock()


@app.before_request
def rate_limit():
    path = request.path
    if request.method != "POST" or path.startswith("/api/jobs/"):
        return None
    prefix = next((p for p in RATE_LIMITS if path.startswith(p)), None)
    if prefix is None:
        return None
    limit, window = RATE_LIMITS[prefix]
    now = time.monotonic()
    with hits_lock:
        recent = hits[(prefix, request.remote_addr)]
        while recent and recent[0] <= now - window:
            recent.popleft()
        if len(recent) >= limit:
            wait = int(recent[0] + window - now) + 1
            return jsonify({"error": f"Too many requests. Try again in {wait}s."}), 429
        recent.append(now)
    return None


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


@app.get("/puzzles")
def puzzles_page():
    return send_from_directory(STATIC, "puzzles.html")


@app.get("/endgames")
def endgames_page():
    return send_from_directory(STATIC, "endgames.html")


@app.get("/settings")
def settings_page():
    return send_from_directory(STATIC, "settings.html")


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
        if sum(j["status"] == "running" for j in jobs.values()) >= MAX_RUNNING:
            return jsonify({"error": "The server is busy with other analyses. Try again in a minute."}), 503
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


def start_fen(body) -> str | None:
    """The optional starting position in a request (the analysis board explores from any position)."""
    fen = body.get("fen")
    if fen is None or fen == "":
        return None
    if not isinstance(fen, str) or len(fen) > 100:
        raise ValueError("Bad position.")
    return fen


@app.post("/api/play")
def play():
    """Replay `moves` (UCI) from the start position (or `fen`); return the position and its legal moves."""
    body = request.get_json(silent=True) or {}
    try:
        board = replay(body.get("moves"), start_fen(body))
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
    over = is_finished(board)
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
            "opening": book.opening_name(board),
            "safety": safety.check(board),
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
        line = body.get("line")
        if line is not None and (not isinstance(line, list) or len(line) > 80 or not all(isinstance(u, str) for u in line)):
            raise ValueError("Bad line.")
        return jsonify(openings.turn(str(body.get("opening")), body.get("moves") or [], line=line))
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    except FileNotFoundError as exc:
        return jsonify({"error": str(exc)}), 500


@app.post("/api/rate")
def rate():
    """Classify the last of `moves` (best, great, good, inaccuracy, mistake, blunder), played from the start or `fen`."""
    body = request.get_json(silent=True) or {}
    try:
        board = replay(body.get("moves"), start_fen(body))
        if not board.move_stack:
            raise ValueError("No moves to rate.")
        return jsonify(rate_last_move(board))
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    except FileNotFoundError as exc:
        return jsonify({"error": str(exc)}), 500


@app.post("/api/best")
def best():
    """Stockfish's best move (full strength) after `moves`: the Play page's "Best move" hint."""
    body = request.get_json(silent=True) or {}
    try:
        board = replay(body.get("moves"), start_fen(body))
        if is_finished(board):
            raise ValueError("The game is over.")
        return jsonify(best_move(board))
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    except FileNotFoundError as exc:
        return jsonify({"error": str(exc)}), 500


@app.get("/api/endgames")
def endgames_list():
    return jsonify(endgames.list_drills())


@app.post("/api/endgames/turn")
def endgames_turn():
    """Your move in an endgame drill (the last of `moves`), Stockfish's reply and the verdict."""
    body = request.get_json(silent=True) or {}
    try:
        return jsonify(endgames.turn(str(body.get("drill")), body.get("start"), body.get("moves") or []))
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    except FileNotFoundError as exc:
        return jsonify({"error": str(exc)}), 500


@app.get("/api/chesscom/<username>")
def chesscom_games(username):
    """A player's recent Chess.com games (with PGNs), newest first."""
    try:
        return jsonify(chesscom.recent_games(username))
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
