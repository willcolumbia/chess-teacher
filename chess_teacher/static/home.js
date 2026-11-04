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
  premove: null, // { from, to }: one move queued while Stockfish is thinking
  // A game carried over from the Openings page ("Continue playing"): Stockfish's strength can be
  // changed until the first move after the hand-over, then it's locked for the rest of the game.
  continued: false,
  eloLocked: false,
  waiting: false, // Stockfish is to move but waits for "Start", so you can set its strength first
  ratings: [], // classification of each move ("best", "mistake", ...), filled in as Stockfish rates them
  opening: null, // { eco, name } of the most specific book opening reached, if any
};
let engineRequest = 0; // bumped to discard a reply that arrives after undo / new game

const STOCKFISH_MIN_ELO = 1320; // below this the engine's strength is our approximation
const ENGINE_THINK_MS = [900, 1600]; // Stockfish waits a random time in this range before moving
const GLIDE_MS = { engine: 330, click: 200, premove: 160 }; // how long a piece takes to slide over

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
}

const vsEngine = () => state.mode === "engine";
const enginesTurn = () => vsEngine() && !state.gameOver && state.turn !== state.myColor;
const canMove = () => !state.gameOver && !state.thinking && !enginesTurn();

function players() {
  if (!vsEngine()) return {};
  const engine = `Stockfish (${state.elo})`;
  return state.myColor === "white" ? { white: "You", black: engine } : { white: engine, black: "You" };
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
      render();
    }
  } catch (e) {
    // no icon for this move
  }
}

// glide: milliseconds to slide the new move's piece over (0 = jump straight there).
async function load(moves, { glide = 0 } = {}) {
  const res = await fetch("/api/play", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ moves, ...players() }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Could not play that move.");
  const added = moves.length === state.moves.length + 1 && moves.slice(0, -1).join() === state.moves.join();
  Object.assign(state, {
    moves,
    fen: data.fen,
    legal: data.legal,
    sans: data.sans,
    pgn: data.pgn,
    status: data.status,
    turn: data.turn,
    gameOver: data.game_over,
    opening: data.opening,
  });
  state.selected = null;
  drawn.clear(); // drawn arrows and marks go away once a move is played
  state.ratings = state.ratings.slice(0, moves.length);
  if (added && state.continued) state.eloLocked = true;
  if (state.waiting && !enginesTurn()) state.waiting = false;
  render();
  const landed = added && glide ? ChessBoard.glide(boardEl, moves[moves.length - 1], glide) : Promise.resolve();
  rateLastMove();
  if (enginesTurn() && !state.waiting) engineMove();
  else if (state.premove) {
    const premove = state.premove;
    landed.then(() => playPremove(premove));
  }
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
    const [min, max] = ENGINE_THINK_MS;
    const think = min + Math.random() * (max - min);
    await new Promise((r) => setTimeout(r, Math.max(0, think - (Date.now() - started)))); // don't reply instantly
    if (request !== engineRequest) return; // undo or new game happened meanwhile
    state.thinking = false;
    await load([...state.moves, data.uci], { glide: GLIDE_MS.engine });
  } catch (err) {
    if (request !== engineRequest) return;
    state.thinking = false;
    render();
    showError(err.message);
  }
}

function statusText() {
  if (!vsEngine() || state.gameOver) return state.status;
  if (state.waiting) return "Set Stockfish's strength, then press Start";
  if (state.thinking || enginesTurn()) return state.premove ? "Stockfish is thinking… (premove set)" : "Stockfish is thinking…";
  return state.status.includes("in check") ? "Your move — you're in check" : "Your move";
}

function targetsFrom(square) {
  return [...new Set(state.legal.filter((u) => u.startsWith(square)).map((u) => u.slice(2, 4)))];
}

// ---------- Premove ----------

// Squares the piece on `square` could reach on an empty board (plus castling), if it's yours.
// Whether the premove is really legal is only known once Stockfish has replied.
function premoveTargets(square) {
  const piece = ChessBoard.pieceAt(state.fen, square);
  if (!piece || (piece === piece.toUpperCase()) !== (state.myColor === "white")) return [];
  return ChessBoard.reach(square, piece);
}

function setPremove(from, to) {
  state.premove = { from, to }; // replaces any earlier one: only one premove at a time
  state.selected = null;
  render();
}

function clearPremove() {
  state.premove = null;
  state.selected = null;
  render();
}

// Your turn again: play the queued premove if it's legal now (a promotion becomes a queen).
function playPremove(premove) {
  if (state.premove !== premove || !canMove()) return;
  state.premove = null;
  const prefix = premove.from + premove.to;
  const uci = state.legal.find((u) => u.startsWith(prefix) && (u.length === 4 || u.endsWith("q")));
  if (!uci) return render();
  load([...state.moves, uci], { glide: GLIDE_MS.premove }).catch((err) => showError(err.message));
}

// ---------- Drawing ----------

function renderElo() {
  const approximate = state.elo < STOCKFISH_MIN_ELO;
  $("#elo").value = state.elo;
  $("#elo-value").textContent = approximate ? `≈${state.elo}` : String(state.elo);
  $("#elo-note").classList.toggle("off", !approximate);
  $("#elo").disabled = state.eloLocked;
  $("#elo-locked").hidden = !state.eloLocked;
  $("#start-engine").hidden = !state.waiting;
  $("#opponent").textContent = vsEngine()
    ? `You (${state.myColor}) vs Stockfish ${state.elo}`
    : "Two players — move both sides";
}

function render() {
  const last = state.moves[state.moves.length - 1];
  const rating = state.ratings[state.moves.length - 1];
  const targets = enginesTurn() ? premoveTargets : targetsFrom;
  ChessBoard.render(boardEl, state.fen, {
    flipped: state.flipped,
    highlight: last ? [last.slice(0, 2), last.slice(2, 4)] : [],
    selected: state.selected,
    targets: state.selected ? targets(state.selected) : [],
    icon: last && rating ? { square: last.slice(2, 4), classification: rating } : null,
    premove: state.premove ? [state.premove.from, state.premove.to] : [],
    marked: drawn.marks,
  });
  drawUserArrows();
  $("#status").textContent = statusText();
  $("#undo").disabled = state.moves.length === 0;
  for (const b of document.querySelectorAll("[data-mode]")) b.classList.toggle("active", b.dataset.mode === state.mode);
  $("#engine-settings").hidden = !vsEngine();
  renderElo();
  for (const b of document.querySelectorAll("[data-color]")) b.classList.toggle("active", b.dataset.color === state.colorChoice);
  renderPlayers();
  $("#opening").replaceChildren(...(state.opening
    ? [ChessBoard.icon("book"), state.opening.name, Object.assign(document.createElement("span"), { className: "eco", textContent: state.opening.eco })]
    : [state.moves.length ? "Out of the opening book" : "Make the first move"]));
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

// Name strips above and below the board, with the pieces each side has captured.
function renderPlayers() {
  const names = players();
  const bottom = state.flipped ? "black" : "white";
  const top = bottom === "white" ? "black" : "white";
  for (const [id, color] of [["#top-player", top], ["#bottom-player", bottom]]) {
    const name = names[color] || (color === "white" ? "White" : "Black");
    const avatar = document.createElement("span");
    avatar.className = `avatar ${color}`;
    avatar.setAttribute("aria-hidden", "true");
    avatar.textContent = name.startsWith("Stockfish") ? "SF" : name[0];
    const info = document.createElement("div");
    info.className = "pinfo";
    const label = document.createElement("span");
    label.className = "pname";
    label.textContent = name === "You" ? `You · ${color}` : name;
    info.append(label, ChessBoard.capturedRow(state.fen, color));
    $(id).replaceChildren(avatar, info);
  }
}

async function tryMove(from, to, { dragged = false } = {}) {
  const candidates = state.legal.filter((u) => u.startsWith(from + to));
  if (!candidates.length) {
    state.selected = null;
    render();
    return;
  }
  state.premove = null;
  const uci = candidates.length > 1 ? await choosePromotion(to, candidates) : candidates[0];
  if (!uci) return render();
  try {
    await load([...state.moves, uci], { glide: dragged ? 0 : GLIDE_MS.click }); // a dragged piece is already there
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

// While Stockfish is thinking, the same clicks and drags queue a premove instead.
ChessBoard.attachInput(boardEl, {
  canMove: () => $("#promotion").hidden && !state.waiting && (canMove() || enginesTurn()),
  targetsFrom: (square) => (enginesTurn() ? premoveTargets(square) : targetsFrom(square)),
  fen: () => state.fen,
  selected: () => state.selected,
  select: (square) => {
    if (square === null && enginesTurn()) state.premove = null; // clicking elsewhere cancels the premove
    state.selected = square;
    render();
  },
  move: (from, to, how) => (enginesTurn() ? setPremove(from, to) : tryMove(from, to, how)),
  touched: () => showError(""),
});

// ---------- Your own arrows: right-click and drag ----------

const drawn = ChessBoard.attachDrawing(boardEl, {
  fen: () => state.fen,
  changed: ({ cleared }) => (cleared ? drawUserArrows() : render()),
  plainRightClick: () => {
    if (!state.premove) return false;
    clearPremove(); // a plain right-click cancels the premove first
    return true;
  },
});

function drawUserArrows() {
  ChessBoard.drawArrows($("#arrow-layer"), drawn.arrows.map((a) => [a, "user"]), state.flipped);
}

// ---------- Buttons ----------

function undo() {
  let back = 1;
  state.premove = null;
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
  state.premove = null;
  state.ratings = [];
  Object.assign(state, { continued: false, eloLocked: false, waiting: false });
  if (vsEngine()) {
    state.myColor = state.colorChoice === "random" ? (Math.random() < 0.5 ? "white" : "black") : state.colorChoice;
    state.flipped = state.myColor === "black";
  } else {
    state.flipped = false;
  }
  saveSettings();
  showError("");
  load([]).catch((err) => showError(err.message));
}

// Pick up a game from the Openings page: you against Stockfish from that position.
function continueGame({ moves, color }) {
  engineRequest++;
  Object.assign(state, {
    mode: "engine",
    myColor: color,
    colorChoice: color,
    flipped: color === "black",
    thinking: false,
    premove: null,
    ratings: [],
    continued: true,
    eloLocked: false,
    waiting: true, // cleared by load() if it's your move
  });
  saveSettings();
  showError("");
  load(moves).catch((err) => {
    showError(err.message);
    newGame();
  });
}

// The game carried over from the Openings page, if there is one (read once).
function takeContinuedGame() {
  try {
    const raw = sessionStorage.getItem("continueGame");
    sessionStorage.removeItem("continueGame");
    const game = JSON.parse(raw || "null");
    if (game && Array.isArray(game.moves) && ["white", "black"].includes(game.color)) return game;
  } catch (e) {
    // no game to continue
  }
  return null;
}

function confirmRestart() {
  return state.moves.length === 0 || state.gameOver || confirm("Start a new game? The current game will be lost.");
}

$("#undo").addEventListener("click", undo);
$("#start-engine").addEventListener("click", () => {
  state.waiting = false;
  state.eloLocked = true;
  render();
  engineMove();
});
$("#reset").addEventListener("click", newGame);

document.querySelectorAll("[data-mode]").forEach((b) =>
  b.addEventListener("click", () => {
    if (b.dataset.mode === state.mode || !confirmRestart()) return;
    state.mode = b.dataset.mode;
    newGame();
  })
);
document.querySelectorAll("[data-color]").forEach((b) =>
  b.addEventListener("click", () => {
    if (b.dataset.color === state.colorChoice || !confirmRestart()) return;
    state.colorChoice = b.dataset.color;
    newGame();
  })
);
$("#elo").addEventListener("input", (e) => {
  state.elo = Number(e.target.value);
  saveSettings();
  renderElo(); // only the labels change: no need to redraw the board while sliding
  renderPlayers();
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

// Every visit starts a fresh game (your opponent settings are remembered),
// unless you came from the Openings page to continue a game.
loadSettings();
const continued = takeContinuedGame();
if (continued) continueGame(continued);
else newGame();
