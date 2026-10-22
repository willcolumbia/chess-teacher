"use strict";

// A playable board: two players on one screen, or you against Stockfish.
// The server (/api/play) replays the move list, so it decides what's legal, and
// returns the position and the next legal moves. /api/engine-move picks Stockfish's reply.

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
  turn: "white",
  gameOver: false,
  // Opponent settings
  mode: "human", // "human" (two players) or "engine"
  elo: 1200,
  colorChoice: "white", // "white", "black" or "random"
  myColor: "white", // the side you actually play this game
  thinking: false,
  ratings: [], // classification of each move ("best", "mistake", ...), filled in as Stockfish rates them
};
let engineRequest = 0; // bumped to discard a reply that arrives after undo / new game

const STOCKFISH_MIN_ELO = 1320; // below this the engine's strength is our approximation

function saveSettings() {
  try {
    const { mode, elo, colorChoice, myColor } = state;
    localStorage.setItem("homeSettings", JSON.stringify({ mode, elo, colorChoice, myColor }));
  } catch (e) {
    // settings just won't be remembered
  }
}

function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem("homeSettings") || "{}");
    if (saved.mode === "human" || saved.mode === "engine") state.mode = saved.mode;
    if (Number.isFinite(saved.elo)) state.elo = Math.max(400, Math.min(3000, saved.elo));
    if (["white", "black", "random"].includes(saved.colorChoice)) state.colorChoice = saved.colorChoice;
    if (["white", "black"].includes(saved.myColor)) state.myColor = saved.myColor;
  } catch (e) {
    // use the defaults
  }
  state.flipped = state.mode === "engine" && state.myColor === "black";
}

const vsEngine = () => state.mode === "engine";
const enginesTurn = () => vsEngine() && !state.gameOver && state.turn !== state.myColor;
const canMove = () => !state.gameOver && !state.thinking && !enginesTurn();

function players() {
  if (!vsEngine()) return {};
  const engine = `Stockfish (${state.elo})`;
  return state.myColor === "white" ? { white: "You", black: engine } : { white: engine, black: "You" };
}

function saveMoves() {
  try {
    localStorage.setItem("homeMoves", JSON.stringify(state.moves));
    localStorage.setItem("homeRatings", JSON.stringify(state.ratings));
  } catch (e) {
    // fine: the game just won't survive a reload
  }
}

function savedRatings() {
  try {
    const ratings = JSON.parse(localStorage.getItem("homeRatings") || "[]");
    return Array.isArray(ratings) ? ratings : [];
  } catch (e) {
    return [];
  }
}

// Ask Stockfish how good the last move was; show its icon when the answer arrives.
async function rateLastMove() {
  const moves = state.moves.slice();
  const index = moves.length - 1;
  if (index < 0 || state.ratings[index]) return;
  try {
    const res = await fetch("/api/rate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ moves }),
    });
    const data = await res.json();
    if (!res.ok) return;
    // Still the same game (no undo / new game since)?
    if (state.moves.length > index && state.moves[index] === moves[index] && state.moves.slice(0, index).join() === moves.slice(0, index).join()) {
      state.ratings[index] = data.classification;
      saveMoves();
      render();
    }
  } catch (e) {
    // no icon for this move
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
    body: JSON.stringify({ moves, ...players() }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Could not play that move.");
  Object.assign(state, {
    moves,
    fen: data.fen,
    legal: data.legal,
    sans: data.sans,
    pgn: data.pgn,
    status: data.status,
    turn: data.turn,
    gameOver: data.game_over,
  });
  state.selected = null;
  state.ratings = state.ratings.slice(0, moves.length);
  saveMoves();
  render();
  rateLastMove();
  if (enginesTurn()) engineMove();
}

async function engineMove() {
  const request = ++engineRequest;
  state.thinking = true;
  render();
  try {
    const started = Date.now();
    const res = await fetch("/api/engine-move", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ moves: state.moves, elo: state.elo }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Stockfish couldn't move.");
    await new Promise((r) => setTimeout(r, Math.max(0, 350 - (Date.now() - started)))); // don't reply instantly
    if (request !== engineRequest) return; // undo or new game happened meanwhile
    state.thinking = false;
    await load([...state.moves, data.uci]);
  } catch (err) {
    if (request !== engineRequest) return;
    state.thinking = false;
    render();
    showError(err.message);
  }
}

function statusText() {
  if (!vsEngine() || state.gameOver) return state.status;
  if (state.thinking || enginesTurn()) return "Stockfish is thinking…";
  return state.status.includes("in check") ? "Your move — you're in check" : "Your move";
}

function targetsFrom(square) {
  return [...new Set(state.legal.filter((u) => u.startsWith(square)).map((u) => u.slice(2, 4)))];
}

function render() {
  const last = state.moves[state.moves.length - 1];
  const rating = state.ratings[state.moves.length - 1];
  ChessBoard.render(boardEl, state.fen, {
    flipped: state.flipped,
    highlight: last ? [last.slice(0, 2), last.slice(2, 4)] : [],
    selected: state.selected,
    targets: state.selected ? targetsFrom(state.selected) : [],
    icon: last && rating ? { square: last.slice(2, 4), classification: rating } : null,
  });
  ChessBoard.drawArrows($("#arrow-layer"), last ? [[last, "last"]] : [], state.flipped);
  $("#status").textContent = statusText();
  $("#undo").disabled = state.moves.length === 0;
  for (const b of document.querySelectorAll("[data-mode]")) b.classList.toggle("active", b.dataset.mode === state.mode);
  $("#engine-settings").hidden = !vsEngine();
  $("#elo").value = state.elo;
  $("#elo-value").textContent = state.elo < STOCKFISH_MIN_ELO ? `≈${state.elo} (approximate)` : String(state.elo);
  $("#color").value = state.colorChoice;
  $("#opponent").textContent = vsEngine()
    ? `You (${state.myColor}) vs Stockfish ${state.elo}`
    : "Two players — move both sides";
  $("#to-analysis").disabled = state.moves.length === 0;
  $("#moves").replaceChildren(
    ...state.sans.map((san, i) => {
      const item = document.createElement("span");
      item.className = "move-item";
      item.append(i % 2 === 0 ? `${i / 2 + 1}. ${san}` : san);
      const badge = ChessBoard.icon(state.ratings[i]);
      if (badge) item.append(badge);
      return item;
    })
  );
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

ChessBoard.attachInput(boardEl, {
  canMove: () => $("#promotion").hidden && canMove(),
  targetsFrom,
  fen: () => state.fen,
  selected: () => state.selected,
  select: (square) => {
    state.selected = square;
    render();
  },
  move: tryMove,
  touched: () => showError(""),
});

// ---------- Buttons ----------

function undo() {
  let back = 1;
  if (vsEngine()) {
    if (state.thinking) {
      engineRequest++; // drop the pending reply
      state.thinking = false;
    } else if (state.turn === state.myColor && state.moves.length >= 2) {
      back = 2; // take back Stockfish's reply and your move
    }
  }
  load(state.moves.slice(0, -back)).catch((err) => showError(err.message));
}

function newGame() {
  engineRequest++;
  state.thinking = false;
  if (vsEngine()) {
    state.myColor = state.colorChoice === "random" ? (Math.random() < 0.5 ? "white" : "black") : state.colorChoice;
    state.flipped = state.myColor === "black";
  }
  saveSettings();
  showError("");
  load([]).catch((err) => showError(err.message));
}

function confirmRestart() {
  return state.moves.length === 0 || state.gameOver || confirm("Start a new game? The current game will be lost.");
}

$("#undo").addEventListener("click", undo);
$("#reset").addEventListener("click", newGame);

document.querySelectorAll("[data-mode]").forEach((b) =>
  b.addEventListener("click", () => {
    if (b.dataset.mode === state.mode || !confirmRestart()) return;
    state.mode = b.dataset.mode;
    newGame();
  })
);
$("#color").addEventListener("change", (e) => {
  if (!confirmRestart()) return render();
  state.colorChoice = e.target.value;
  newGame();
});
$("#elo").addEventListener("input", (e) => {
  state.elo = Number(e.target.value);
  saveSettings();
  render();
});
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

loadSettings();
state.ratings = savedRatings();
load(savedMoves()).catch(() => load([]).catch((err) => showError(err.message)));
