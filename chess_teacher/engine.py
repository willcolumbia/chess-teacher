from __future__ import annotations

import os
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def find_stockfish() -> str:
    """Locate a Stockfish binary: $STOCKFISH_PATH, then ./bin/stockfish, then $PATH."""
    candidates = [
        os.environ.get("STOCKFISH_PATH"),
        str(ROOT / "bin" / "stockfish"),
        shutil.which("stockfish"),
    ]
    for path in candidates:
        if path and os.path.isfile(path) and os.access(path, os.X_OK):
            return path
    raise FileNotFoundError(
        "Stockfish not found. Run scripts/install_stockfish.sh or set STOCKFISH_PATH."
    )
