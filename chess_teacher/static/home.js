"use strict";

// A playable board for both sides. The server (/api/play) replays the move list,
// so it decides what's legal, and returns the position and the next legal moves.

const $ = (sel) => document.querySelector(sel);
const boardEl = $("#board");

const state = {
  moves: [], // UCI moves from the start position
  fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
  legal: [],
  sans: [],
  pgn: "",
  status: "",
  selected: null,
  flipped: false,
};
let drag = null; // { from, ghost, moved }

function saveMoves() {
  try {
    localStorage.setItem("homeMoves", JSON.stringify(state.moves));
  } catch (e) {
    // fine: the game just won't survive a reload
  }
}

function savedMoves() {
  try {
    const moves = JSON.parse(localStorage.getItem("homeMoves") || "[]");
    return Array.isArray(moves) ? moves : [];
  } catch (e) {
    return [];
  }
}

async function load(moves) {
  const res = await fetch("/api/play", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ moves }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Could not play that move.");
  Object.assign(state, { moves, fen: data.fen, legal: data.legal, sans: data.sans, pgn: data.pgn, status: data.status });
  state.selected = null;
  saveMoves();
  render();
}

function targetsFrom(square) {
  return [...new Set(state.legal.filter((u) => u.startsWith(square)).map((u) => u.slice(2, 4)))];
}

function render() {
  const last = state.moves[state.moves.length - 1];
  ChessBoard.render(boardEl, state.fen, {
    flipped: state.flipped,
    highlight: last ? [last.slice(0, 2), last.slice(2, 4)] : [],
    selected: state.selected,
    targets: state.selected ? targetsFrom(state.selected) : [],
  });
  $("#status").textContent = state.status;
  $("#undo").disabled = state.moves.length === 0;
  $("#to-analysis").disabled = state.moves.length === 0;
  $("#moves").textContent = state.sans
    .map((san, i) => (i % 2 === 0 ? `${i / 2 + 1}. ${san}` : san))
    .join(" ");
}

async function tryMove(from, to) {
  const candidates = state.legal.filter((u) => u.startsWith(from + to));
  if (!candidates.length) {
    state.selected = null;
    render();
    return;
  }
  const uci = candidates.length > 1 ? await choosePromotion(to, candidates) : candidates[0];
  if (!uci) return render();
  try {
    await load([...state.moves, uci]);
  } catch (err) {
    showError(err.message);
  }
}

function choosePromotion(to, candidates) {
  const white = state.fen.split(" ")[1] === "w";
  const box = $("#promotion");
  box.replaceChildren();
  return new Promise((resolve) => {
    const finish = (uci) => {
      box.hidden = true;
      document.removeEventListener("keydown", onKey);
      resolve(uci);
    };
    const onKey = (e) => e.key === "Escape" && finish(null);
    document.addEventListener("keydown", onKey);
    for (const p of ["q", "r", "b", "n"]) {
      const uci = candidates.find((u) => u.endsWith(p));
      if (!uci) continue;
      const button = document.createElement("button");
      button.title = { q: "Queen", r: "Rook", b: "Bishop", n: "Knight" }[p];
      button.append(ChessBoard.pieceImage(white ? p.toUpperCase() : p));
      button.addEventListener("click", () => finish(uci));
      box.append(button);
    }
    const cancel = document.createElement("button");
    cancel.textContent = "✕";
    cancel.title = "Cancel";
    cancel.addEventListener("click", () => finish(null));
    box.append(cancel);
    box.hidden = false;
  });
}

function showError(msg) {
  $("#error").textContent = msg;
  $("#error").hidden = !msg;
}

// ---------- Click and drag ----------

function squareAt(x, y) {
  const hit = document.elementFromPoint(x, y);
  const sq = hit && hit.closest(".sq");
  return sq && boardEl.contains(sq) ? sq.dataset.square : null;
}

boardEl.addEventListener("pointerdown", (e) => {
  const sq = e.target.closest(".sq");
  if (!sq || !$("#promotion").hidden) return;
  const square = sq.dataset.square;
  showError("");

  if (state.selected && targetsFrom(state.selected).includes(square)) {
    tryMove(state.selected, square);
    return;
  }
  if (!targetsFrom(square).length) {
    state.selected = null;
    render();
    return;
  }

  // Pick up a piece that can move.
  const wasSelected = state.selected === square;
  state.selected = square;
  render();
  const img = boardEl.querySelector(`[data-square="${square}"] .piece`);
  const size = img.getBoundingClientRect().width;
  const ghost = ChessBoard.pieceImage(ChessBoard.pieceAt(state.fen, square));
  ghost.classList.add("ghost");
  ghost.style.width = ghost.style.height = `${size}px`;
  document.body.append(ghost);
  img.classList.add("lifted");
  drag = { from: square, ghost, size, moved: false, wasSelected };
  moveGhost(e.clientX, e.clientY);
  boardEl.setPointerCapture(e.pointerId);
  e.preventDefault();
});

function moveGhost(x, y) {
  drag.ghost.style.left = `${x - drag.size / 2}px`;
  drag.ghost.style.top = `${y - drag.size / 2}px`;
}

boardEl.addEventListener("pointermove", (e) => {
  if (!drag) return;
  drag.moved = true;
  moveGhost(e.clientX, e.clientY);
});

function endDrag(e, cancelled) {
  if (!drag) return;
  const { from, ghost, moved, wasSelected } = drag;
  drag = null;
  ghost.remove();
  const to = cancelled ? null : squareAt(e.clientX, e.clientY);
  if (to && to !== from && targetsFrom(from).includes(to)) {
    tryMove(from, to);
  } else {
    if (!moved && wasSelected) state.selected = null; // second click on a piece puts it down
    render(); // otherwise stay selected so a click on a target square finishes the move
  }
}

boardEl.addEventListener("pointerup", (e) => endDrag(e, false));
boardEl.addEventListener("pointercancel", (e) => endDrag(e, true));

// ---------- Buttons ----------

$("#undo").addEventListener("click", () => load(state.moves.slice(0, -1)).catch((err) => showError(err.message)));
$("#reset").addEventListener("click", () => load([]).catch((err) => showError(err.message)));
$("#flip").addEventListener("click", () => {
  state.flipped = !state.flipped;
  render();
});
$("#to-analysis").addEventListener("click", () => {
  try {
    sessionStorage.setItem("pendingPgn", state.pgn);
  } catch (e) {
    // the analysis page will just start empty
  }
  location.href = "/analysis";
});

load(savedMoves()).catch(() => load([]).catch((err) => showError(err.message)));
