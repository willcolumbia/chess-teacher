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

The site has these pages:

- **Home** (`/`): a board you can play on by clicking or dragging pieces. Only legal moves are allowed.
  - **Two players**: move both sides.
  - **Play vs Stockfish**: pick White, Black or Random and set the engine's strength from 400 to 3000 Elo.
    From 1320 up, Stockfish limits its own strength; below that (Stockfish's minimum) the app weakens it
    with a shallow search and some randomness, so those ratings are approximate.
  - Undo (takes back your move and Stockfish's reply), new game, flip, and **Analyze this game**,
    which sends the game to the Analysis page.
- **Openings** (`/openings`): learn 6 openings for White and 7 for Black. Pick a side and an opening,
  then play the moves yourself. The coach explains the idea behind each book move; your opponent varies
  between the book's main variations. If you play something else, the move stays and the coach shows
  the book move and Stockfish's verdict on yours. When the book line ends (or you leave it), Stockfish
  recommends the moves, for about 10 moves in total. Hint / Show the move buttons help when you're stuck.
  The book lives in `chess_teacher/opening_book.py`; `scripts/check_openings.py` checks every book move
  with Stockfish.
- **Puzzles** (`/puzzles`): 280 short tactics from real games, 20 for each of 14 skills (mate in one,
  free pieces, back-rank mate, forks, pins, skewers, discovered attacks, mate in two, removing the
  defender, deflection, trapped pieces, pawn promotion, sacrifices, mate in three). Each set runs from
  easy to hard. A puzzle opens with your opponent's last move; you play the solution and the replies
  come by themselves. Only the puzzle's move counts, except that any checkmate does. Hint rings the
  piece to move, Show the move draws it, and after the last move a note says why the answer works.
  Progress is kept in the browser.
  The puzzles come from the [Lichess puzzle database](https://database.lichess.org/#puzzles) (public
  domain). `scripts/build_puzzles.py` picked them and wrote `chess_teacher/data/puzzles.json`; run it
  on a fresh copy of the database to make a new set.
  - **From your games** (`/puzzles/mine`): every mistake in a game you analyzed becomes a puzzle (find
    the move you should have played), repeated at growing intervals until you know it.
- **Endgames** (`/endgames`): 11 basic endings to play out against Stockfish, from the two-rook mate to
  the Lucena and Philidor positions, in Learn mode (each move shown and explained) or Practice mode.
- **Analysis** (`/analysis`): a move-by-move review of a finished game:

1. On Chess.com, open the game → **Share** → **PGN** → copy.
2. Paste it in (optionally with your username) and click **Analyze my game**.
3. Pick which side you played, if it didn't recognise your username.
4. Walk through the game one move at a time. Every move — yours and your opponent's — gets:
   - **What the move does** (develops, captures, attacks, defends, forks, …)
   - **Verdict** with the evaluation before and after
   - **Why it's a problem** for inaccuracies, mistakes and blunders
   - **What you could have played**, shown on the board with arrows (red = played, green = engine best, yellow = last move)
   - **Show why it's better**: plays out the engine's line on the board (up to 5 moves each), explaining each move
   - **Show why it's a mistake** (or **how to punish it**, for your opponent's mistakes): plays your move and what the engine expects to follow
   - **What to watch for next** / **your best reply**
5. Finish on a summary: both players' Chess.com ratings, accuracy and mistake counts, who outplayed their rating, and the patterns in your mistakes.

Keys: ← → step · n next mistake · b toggle better move · w show why better · x show why a mistake · f flip board.
While showing why: ← → step · space play/pause · Esc close.

Every page marks moves with Chess.com-style icons, on the board and in move lists:
!! brilliant (the engine's best move that sacrifices at least a minor piece's worth, when the position
wasn't already won and stays good), ★ best, ! great (the best move when every alternative loses 15%+ winning chances; not for recaptures
or plain material grabs), ✓ good, ?! inaccuracy, ? mistake, ?? blunder, and a book icon in Openings.
On Home, each move is rated live by a quick Stockfish check (`/api/rate`).

Moves are labelled by how much they dropped your winning chances (Lichess model):
inaccuracy ≥ 5%, mistake ≥ 20%, blunder ≥ 30% (or walking into a forced mate).
Game accuracy uses the Lichess method (volatility-weighted mean averaged with the harmonic mean).

## How it works

```
chess_teacher/
  analysis.py        # runs Stockfish on every position, classifies each move
  explain/
    base.py          # MoveContext / Explainer interface
    rules.py         # rule-based explanations (hanging pieces, forks, pins, missed mates, ...)
  opponent.py        # Stockfish as an opponent at an adjustable Elo
  opening_book.py    # opening lines with the idea behind each move
  openings.py        # Openings trainer: book tree, move feedback, opponent replies
  positions.py       # helpers for positions built from UCI move lists
  puzzles.py         # Puzzles: the skills and their preset puzzles (data/puzzles.json)
  endgames.py        # Endgames: the drills, Stockfish's replies and verdicts
  web.py             # Flask pages, analysis jobs, /api/play (legal moves) and /api/engine-move
  static/
    home.html/.js    # playable board (Home)
    openings.html/.js  # opening trainer (Openings)
    puzzles.html/.js   # preset puzzles by skill (Puzzles)
    my-puzzles.html/.js  # puzzles from your own games (Puzzles → From your games)
    endgames.html/.js  # endgame drills (Endgames)
    analysis.html/.js  # move-by-move review (Analysis)
    board.js         # board and arrow drawing shared by every page
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
