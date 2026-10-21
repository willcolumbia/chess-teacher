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
.venv/bin/python -m chess_teacher   # then open http://localhost:5000
```

1. On Chess.com, open the game → **Share** → **PGN** → copy.
2. Paste it in (optionally with your username) and click **Analyze my game**.
3. Pick which side you played, if it didn't recognise your username.
4. Walk through the game one move at a time. Every move — yours and your opponent's — gets:
   - **What the move does** (develops, captures, attacks, defends, forks, …)
   - **Verdict** with the evaluation before and after
   - **Why it's a problem** for inaccuracies, mistakes and blunders
   - **What you could have played**, shown on the board with arrows (red = played, green = better)
   - **Show why it's better**: plays out the engine's line on the board (up to 5 moves each), explaining each move
   - **What to watch for next** / **your best reply**
5. Finish on a summary of your accuracy and the patterns in your mistakes.

Keys: ← → step · n next mistake · b toggle better move · w show why · f flip board.
While showing why: ← → step · space play/pause · Esc close.

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
