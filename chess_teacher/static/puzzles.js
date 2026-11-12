"use strict";

// Puzzles from your own games: the position before one of your mistakes; find the better move.
// The engine's move is the answer, but any move Stockfish rates as best (or nearly as good)
// counts too: /api/rate judges a move that isn't the stored answer.

const $ = (sel) => document.querySelector(sel);
const boardEl = $("#board");
const GLIDE_MS = 300;
const LINE_STEP_MS = 900; // pause between the moves of the line after a solve
const CLOSE_ENOUGH = 3; // winning chances (points) a different move may lose and still count

const state = {
  queue: [], // ids still to do this session
  done: 0, // puzzles finished this session
  sessionSize: 0,
  puzzle: null,
  fen: null,
  legal: [],
  selected: null,
  flipped: false,
  phase: "idle", // "solve", "checking", "wrong", "solved", "revealed"
  wrongTries: 0,
  hinted: false,
  lastMove: null, // [from, to] highlighted
  arrows: [],
  feedback: null, // { kind, title, text }
  lineIndex: 0, // moves of the line shown after the answer
  lineTimer: 0,
};

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === "class") node.className = value;
    else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value);
  }
  for (const child of children) if (child != null && child !== false) node.append(child);
  return node;
}

function show(screen) {
  for (const s of document.querySelectorAll(".screen")) s.hidden = s.id !== `screen-${screen}`;
  window.scrollTo(0, 0);
}

async function post(url, body) {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Something went wrong.");
  return data;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function whenText(p, now = Date.now()) {
  if (p.due <= now) return "Due now";
  const days = Math.round((p.due - now) / PuzzleStore.DAY);
  return days <= 1 ? "Back tomorrow" : `Back in ${days} days`;
}

function gameText(p) {
  return [p.opponent ? `vs ${p.opponent}` : null, p.date ? p.date.replace(/\./g, "-") : null].filter(Boolean).join(" · ");
}

// ---------- Overview ----------

function renderList() {
  const all = PuzzleStore.all();
  const due = PuzzleStore.due();
  const mastered = all.filter((p) => p.box >= PuzzleStore.MASTERED).length;
  $("#puzzle-stats").replaceChildren(
    ...[["Due now", due.length], ["Puzzles", all.length], ["Learned", mastered]].map(([label, n]) =>
      el("div", { class: "stat" }, el("span", {}, label), el("strong", {}, String(n))))
  );
  const start = $("#start");
  start.hidden = !all.length;
  start.textContent = due.length ? `Start · ${due.length} due` : "Practice anyway";

  const list = $("#puzzle-list");
  if (!all.length) {
    list.replaceChildren(el("div", { class: "empty" },
      el("p", {}, "No puzzles yet."),
      el("p", { class: "muted" }, "Analyze one of your games on the Analysis page. Each mistake, miss or blunder you made becomes a puzzle here."),
      el("a", { class: "button-link primary", href: "/analysis" }, "Analyze a game")));
    return;
  }
  const sorted = all.slice().sort((a, b) => a.due - b.due);
  list.replaceChildren(...sorted.map((p) =>
    el("div", { class: "puzzle-row" },
      el("span", { class: "puzzle-icon" }, ChessBoard.icon(p.classification)),
      el("button", { class: "puzzle-open", onclick: () => startSession([p.id]) },
        el("strong", {}, `${p.moveLabel}`),
        el("span", { class: "muted small" }, [p.color === "white" ? "as White" : "as Black", gameText(p)].filter(Boolean).join(" · "))),
      el("span", { class: `puzzle-when ${p.due <= Date.now() ? "due" : ""}` }, whenText(p)),
      el("span", { class: "boxes", title: `Solved ${p.solved} of ${p.tries} tries` },
        ...[1, 2, 3, 4, 5].map((b) => el("i", { class: b <= p.box ? "on" : "" }))),
      el("button", {
        class: "puzzle-remove", title: "Remove this puzzle", "aria-label": "Remove this puzzle",
        onclick: () => {
          if (confirm("Remove this puzzle?")) {
            PuzzleStore.remove(p.id);
            renderList();
          }
        },
      }, "✕"))));
}

$("#start").addEventListener("click", () => {
  const due = PuzzleStore.due();
  // Nothing due: a handful of the puzzles you know least well.
  const ids = due.length
    ? due.map((p) => p.id)
    : PuzzleStore.all().sort((a, b) => a.box - b.box || a.due - b.due).slice(0, 10).map((p) => p.id);
  startSession(ids);
});

$("#back-to-list").addEventListener("click", () => {
  stopLine();
  state.puzzle = null;
  renderList();
  show("list");
});

// ---------- Solving ----------

function startSession(ids) {
  state.queue = ids.slice();
  state.done = 0;
  state.sessionSize = ids.length;
  show("solve");
  nextPuzzle();
}

async function nextPuzzle() {
  stopLine();
  const id = state.queue.shift();
  const puzzle = id && PuzzleStore.all().find((p) => p.id === id);
  if (!puzzle) return finishSession();
  Object.assign(state, {
    puzzle,
    fen: puzzle.fen,
    legal: [],
    selected: null,
    flipped: puzzle.color === "black",
    phase: "solve",
    wrongTries: 0,
    hinted: false,
    lastMove: null,
    arrows: [],
    feedback: null,
    lineIndex: 0,
  });
  render();
  try {
    state.legal = (await post("/api/play", { fen: puzzle.fen, moves: [] })).legal;
  } catch (err) {
    state.feedback = { kind: "wrong", title: "Couldn't load this puzzle", text: err.message };
  }
  render();
}

function finishSession() {
  state.puzzle = null;
  show("list");
  renderList();
  const done = state.done;
  if (done) {
    const note = el("p", { class: "session-note" }, `Done: ${done} puzzle${done === 1 ? "" : "s"} this session.`);
    $("#puzzle-stats").after(note);
    setTimeout(() => note.remove(), 6000);
  }
}

const sideToMove = () => (state.fen.split(" ")[1] === "w" ? "White" : "Black");
const canMove = () => state.phase === "solve" && state.legal.length > 0;

function targetsFrom(square) {
  return [...new Set(state.legal.filter((u) => u.startsWith(square)).map((u) => u.slice(2, 4)))];
}

async function onMove(from, to) {
  const candidates = state.legal.filter((u) => u.startsWith(from + to));
  if (!candidates.length) return;
  const uci = candidates.find((u) => u.length === 4 || u.endsWith("q")) || candidates[0];
  const p = state.puzzle;
  state.selected = null;
  state.lastMove = [from, to];
  const before = state.fen;
  state.fen = (await post("/api/play", { fen: before, moves: [uci] }).catch(() => ({ fen: before }))).fen;

  if (uci.slice(0, 4) === p.best.slice(0, 4)) return solved(uci, "That's the move.");
  state.phase = "checking";
  state.feedback = { kind: "checking", title: "Checking your move…", text: "" };
  render();
  let rating = null;
  try {
    rating = await post("/api/rate", { fen: before, moves: [uci] });
  } catch (err) {
    rating = null;
  }
  if (state.puzzle !== p) return;
  const good = rating && (["best", "great", "brilliant"].includes(rating.classification) || rating.win_drop <= CLOSE_ENOUGH);
  if (good) return solved(uci, `${rating.san} works too: Stockfish rates it ${(ChessBoard.LABELS[rating.classification] || rating.classification).toLowerCase()}.`);

  // Wrong: say why, then put the piece back.
  state.wrongTries += 1;
  state.phase = "wrong";
  state.feedback = {
    kind: "wrong",
    title: rating ? `${rating.san} isn't it` : "Not that one",
    text: rating && rating.problem ? rating.problem : "That move doesn't fix the problem. Look again.",
  };
  render();
  await sleep(1200);
  if (state.puzzle !== p) return;
  state.fen = before;
  state.lastMove = null;
  state.phase = "solve";
  render();
}

function solved(uci, title) {
  const p = state.puzzle;
  const firstTry = state.wrongTries === 0 && !state.hinted;
  PuzzleStore.record(p.id, firstTry);
  state.done += 1;
  state.phase = "solved";
  state.feedback = {
    kind: "right",
    title: firstTry ? `Correct! ${title}` : `Solved. ${title}`,
    text: p.bestIdea || "",
  };
  state.lineIndex = 1; // the answer is the line's first move
  render();
  if (uci.slice(0, 4) !== p.best.slice(0, 4)) return; // their own good move: the stored line doesn't follow it
  if (p.line.length > 1) state.feedback.more = true;
  render();
}

function reveal() {
  const p = state.puzzle;
  PuzzleStore.record(p.id, false);
  state.done += 1;
  state.phase = "revealed";
  state.arrows = [[p.best, "best"]];
  state.feedback = { kind: "reveal", title: `The move was ${p.bestSan}`, text: p.bestIdea || "" };
  state.queue.push(p.id); // try it again at the end of this session
  render();
}

function hint() {
  state.hinted = true;
  render();
}

// After a solve: play the rest of the engine's line on the board, one move at a time.
async function playLine() {
  const p = state.puzzle;
  stopLine();
  let fen = state.fen;
  const moves = p.line.length ? p.line.map((m) => m.uci) : [p.best];
  for (let i = state.lineIndex; i < moves.length; i++) {
    const data = await post("/api/play", { fen: p.fen, moves: moves.slice(0, i + 1) }).catch(() => null);
    if (!data || state.puzzle !== p) return;
    fen = data.fen;
    state.fen = fen;
    state.lastMove = [moves[i].slice(0, 2), moves[i].slice(2, 4)];
    state.lineIndex = i + 1;
    render();
    ChessBoard.glide(boardEl, moves[i], GLIDE_MS);
    await new Promise((r) => { state.lineTimer = setTimeout(r, LINE_STEP_MS); });
    if (state.puzzle !== p) return;
  }
}

function stopLine() {
  clearTimeout(state.lineTimer);
}

// ---------- Drawing ----------

function render() {
  const p = state.puzzle;
  if (!p) return;
  const hintSquare = state.hinted && state.phase === "solve" ? [p.best.slice(0, 2)] : [];
  ChessBoard.render(boardEl, state.fen, {
    flipped: state.flipped,
    highlight: state.lastMove || [],
    selected: state.selected,
    targets: state.selected ? targetsFrom(state.selected) : [],
    marked: [],
    chances: hintSquare,
  });
  ChessBoard.drawArrows($("#arrow-layer"), state.arrows, state.flipped);
  renderPlayers();

  const position = state.sessionSize > 1 ? `Puzzle ${Math.min(state.done + 1, state.sessionSize)} of ${state.sessionSize}` : "Puzzle";
  $("#puzzle-count").textContent = position;
  $("#puzzle-title").textContent = `${p.color === "white" ? "White" : "Black"} to move: find a better move`;
  $("#puzzle-context").textContent =
    `From your game${p.opponent ? ` vs ${p.opponent}` : ""}${p.date ? ` (${p.date.replace(/\./g, "-")})` : ""}. ` +
    `You played ${p.moveLabel} here, a ${p.classification}.`;

  const fb = state.feedback;
  const box = $("#puzzle-feedback");
  const parts = [];
  if (state.hinted && state.phase === "solve") parts.push(el("div", { class: "box" }, el("p", {}, `Hint: move the piece on ${p.best.slice(0, 2)} (blue ring).`)));
  if (fb) {
    parts.push(el("div", { class: `box ${fb.kind === "right" ? "better" : fb.kind === "wrong" ? "wrong" : ""}` },
      el("h3", {}, fb.title),
      fb.text ? el("p", {}, fb.text) : null,
      state.phase === "solved" || state.phase === "revealed"
        ? el("p", { class: "muted small" }, `In the game: ${p.problem || `${p.played} was a ${p.classification}.`}`)
        : null));
  }
  box.replaceChildren(...parts);

  const buttons = [];
  if (state.phase === "solve" || state.phase === "wrong" || state.phase === "checking") {
    const busy = state.phase !== "solve";
    if (!state.hinted) buttons.push(el("button", { onclick: hint, ...(busy ? { disabled: "" } : {}) }, "Hint"));
    buttons.push(el("button", { onclick: reveal, ...(busy ? { disabled: "" } : {}) }, "Show the answer"));
    buttons.push(el("button", { onclick: () => { state.queue.push(state.puzzle.id); nextPuzzle(); } }, "Skip"));
  } else {
    if (state.puzzle.line.length > state.lineIndex && (state.phase === "solved" ? fb && fb.more : false)) {
      buttons.push(el("button", { onclick: playLine }, "Play the line"));
    }
    if (state.phase === "revealed") buttons.push(el("button", { onclick: () => playAnswer() }, "Play it on the board"));
    buttons.push(el("button", { class: "primary", onclick: nextPuzzle }, state.queue.length ? "Next puzzle" : "Finish"));
  }
  $("#puzzle-buttons").replaceChildren(...buttons);
}

// After "Show the answer": play the answer and the line that follows.
async function playAnswer() {
  state.arrows = [];
  state.lineIndex = 0;
  state.phase = "solved";
  state.feedback = Object.assign({}, state.feedback, { more: false });
  await playLine();
}

function renderPlayers() {
  const p = state.puzzle;
  const bottom = state.flipped ? "black" : "white";
  for (const [id, color] of [["#top-player", bottom === "white" ? "black" : "white"], ["#bottom-player", bottom]]) {
    const mine = color === p.color;
    const name = mine ? `You · ${color}` : p.opponent ? `${p.opponent} · ${color}` : `Opponent · ${color}`;
    const avatar = el("span", { class: `avatar ${color}`, "aria-hidden": "true" }, mine ? "Y" : (p.opponent || "O")[0].toUpperCase());
    const info = el("div", { class: "pinfo" }, el("span", { class: "pname" }, name), ChessBoard.capturedRow(state.fen, color));
    $(id).replaceChildren(avatar, info);
  }
}

ChessBoard.attachInput(boardEl, {
  canMove,
  targetsFrom,
  fen: () => state.fen,
  selected: () => state.selected,
  select: (square) => {
    state.selected = square;
    render();
  },
  move: onMove,
});

renderList();
// /puzzles#start jumps straight into the due puzzles (the Analysis page links here).
if (location.hash === "#start" && PuzzleStore.due().length) $("#start").click();
