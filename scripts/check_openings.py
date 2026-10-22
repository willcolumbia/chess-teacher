"""Check every trainee move in the opening book with Stockfish.

Usage: .venv/bin/python scripts/check_openings.py [depth]
Prints each book move that loses 5% or more winning chances, then a summary.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import chess  # noqa: E402
import chess.engine  # noqa: E402

from chess_teacher.analysis import win_percent  # noqa: E402
from chess_teacher.engine import find_stockfish  # noqa: E402
from chess_teacher.openings import BY_ID, TREES  # noqa: E402


def main(depth: int) -> int:
    flagged = checked = 0
    with chess.engine.SimpleEngine.popen_uci(find_stockfish()) as engine:
        limit = chess.engine.Limit(depth=depth)
        for opening_id, tree in TREES.items():
            trainee = chess.WHITE if BY_ID[opening_id]["color"] == "white" else chess.BLACK
            stack = [(tree, chess.Board())]
            while stack:
                node, board = stack.pop()
                for uci, child in node.children.items():
                    move = chess.Move.from_uci(uci)
                    after = board.copy()
                    after.push(move)
                    if board.turn == trainee:
                        checked += 1
                        info = engine.analyse(board, limit)
                        best = info["pv"][0]
                        before = win_percent(info["score"].pov(trainee))
                        now = win_percent(engine.analyse(after, limit)["score"].pov(trainee))
                        drop = before - now
                        if move != best and drop >= 5:
                            flagged += 1
                            line = board.root().variation_san(after.move_stack)
                            print(f"{opening_id}: {line}  -- drop {drop:.1f}%, engine prefers {board.san(best)}")
                    stack.append((child, after))
    print(f"checked {checked} book moves, flagged {flagged}")
    return 1 if flagged else 0


if __name__ == "__main__":
    sys.exit(main(int(sys.argv[1]) if len(sys.argv) > 1 else 18))
