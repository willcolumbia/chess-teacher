"""Recent games from Chess.com's public API (https://www.chess.com/news/view/published-data-api)."""
from __future__ import annotations

import json
import re
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Dict, List, Tuple

API = "https://api.chess.com/pub/player/{user}/games/archives"
HEADERS = {"User-Agent": "chess-teacher (local app)"}  # Chess.com asks API users to identify themselves
CACHE_SECONDS = 30
TIMEOUT = 10

_cache: Dict[str, Tuple[float, List[Dict]]] = {}
_lock = threading.Lock()


def _get(url: str) -> Dict:
    request = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(request, timeout=TIMEOUT) as response:
        return json.load(response)


def recent_games(username: str, limit: int = 20) -> List[Dict]:
    """The player's most recent finished standard games, newest first."""
    username = username.strip().lower()
    if not re.fullmatch(r"[a-z0-9_-]{3,25}", username):
        raise ValueError("That doesn't look like a Chess.com username.")
    with _lock:
        cached = _cache.get(username)
        if cached and time.time() - cached[0] < CACHE_SECONDS:
            return cached[1][:limit]

    try:
        archives = _get(API.format(user=urllib.parse.quote(username)))["archives"]
    except urllib.error.HTTPError as exc:
        if exc.code == 404:
            raise ValueError(f"No Chess.com player called {username!r}.")
        raise ValueError(f"Chess.com said: {exc.code} {exc.reason}")
    except (urllib.error.URLError, OSError) as exc:
        raise ValueError(f"Couldn't reach Chess.com ({exc}).")

    games: List[Dict] = []
    for archive in reversed(archives[-2:]):  # this month and last month
        try:
            games.extend(reversed(_get(archive)["games"]))
        except (urllib.error.URLError, OSError, KeyError):
            continue
        if len(games) >= limit:
            break

    out = []
    for game in games:
        if game.get("rules") != "chess" or not game.get("pgn"):
            continue
        mine = "white" if game["white"]["username"].lower() == username else "black"
        them = "black" if mine == "white" else "white"
        result = game[mine].get("result", "")
        out.append(
            {
                "url": game.get("url"),
                "pgn": game["pgn"],
                "end_time": game.get("end_time"),
                "time_class": game.get("time_class"),
                "color": mine,
                "opponent": game[them]["username"],
                "opponent_rating": game[them].get("rating"),
                "rating": game[mine].get("rating"),
                "outcome": "win" if result == "win" else "draw" if result in DRAWS else "loss",
            }
        )
    with _lock:
        _cache[username] = (time.time(), out)
    return out[:limit]


DRAWS = {"agreed", "repetition", "stalemate", "insufficient", "50move", "timevsinsufficient"}
