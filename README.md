# Chess Teacher

Paste a PGN from a finished game and get a move-by-move review: where you went wrong, what you should have played, and why.

Runs locally: a small Python web app using [Stockfish](https://stockfishchess.org/) for analysis and rule-based coaching explanations.

## Setup

Requires Python 3.8+ on Linux x86-64.

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
scripts/install_stockfish.sh        # downloads Stockfish into ./bin
```

To use a Stockfish you already have, set `STOCKFISH_PATH=/path/to/stockfish`.

## Use

```bash
.venv/bin/python -m chess_teacher   # then open http://127.0.0.1:5000
```

1. On Chess.com, open the game → **Share** → **PGN** → copy.
2. Paste it in, enter your username (so it knows which side you were), and click **Analyze game**.
3. Step through the game with the arrow keys. Press **n** to jump to your next mistake.
   - Red arrow: the move you played. Green arrow: the engine's best move.

Moves are labelled by how much they dropped your winning chances (Lichess model):
inaccuracy ≥ 10%, mistake ≥ 20%, blunder ≥ 30% (or walking into a forced mate).

## How it works

```
chess_teacher/
  analysis.py        # runs Stockfish on every position, classifies each move
  explain/
    base.py          # MoveContext / Explainer interface
    rules.py         # rule-based explanations (hanging pieces, forks, pins, missed mates, ...)
  web.py             # Flask API + background analysis jobs
  static/            # the web page (no external dependencies)
```

### Swapping in Claude for explanations (later)

Explanations come from an `Explainer` chosen with `CHESS_TEACHER_EXPLAINER` (default `rules`).
To add a Claude-powered one, subclass `Explainer` in `chess_teacher/explain/`, register it in
`EXPLAINERS`, and set `CHESS_TEACHER_EXPLAINER=claude`.

## Tests

```bash
.venv/bin/pip install -r requirements-dev.txt
.venv/bin/python -m pytest
```
