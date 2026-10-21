"""Local web app: paste a PGN, analysis runs in a background thread, page polls for it."""
from __future__ import annotations

import threading
import uuid
from pathlib import Path
from typing import Dict

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
def index():
    return send_from_directory(STATIC, "index.html")


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
