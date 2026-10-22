"use strict";

// Openings trainer. The server (/api/openings/turn) judges each of your moves, plays the
// opponent's reply from the book (or Stockfish once out of book) and returns your next
// recommended move. This page keeps the conversation log and the board.

const $ = (sel) => document.querySelector(sel);
const boardEl = $("#board");
const REPLY_DELAY_MS = 600;

const state = {
  openings: [],
  side: "white",
  opening: null,
  moves: [],
  sans: [],
  fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
  legal: [],
  expected: null, // { uci, san, idea, source }
  lastMove: null,
  mark: null, // { square, classification }: icon on your last move
  selected: null,
  flipped: false,
  busy: false,
  done: false,
  inBook: true,
  variation: null,
  hint: 0, // 0 nothing shown, 1 idea shown, 2 move shown
  preview: null, // { fen, arrows, caption } while comparing a past move on the board
  log: [],
  score: { firstTry: 0, total: 0, misses: [] },
  traineeMoves: 0,
  length: 10,
};

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === "class") node.className = value;
    else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value);
  }
  for (const child of children) {
    if (child != null && child !== false) node.append(child);
  }
  return node;
}

function store(key, value) {
  try {
    if (value === undefined) return localStorage.getItem(key);
    localStorage.setItem(key, value);
  } catch (e) {
    return null;
  }
}

function show(screen) {
  for (const s of document.querySelectorAll(".screen")) s.hidden = s.id !== `screen-${screen}`;
  window.scrollTo(0, 0);
}

async function post(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Something went wrong.");
  return data;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// "Nf3" at ply index i -> "2. Nf3" / "2... Nc6"
function label(sans, i) {
  return `${Math.floor(i / 2) + 1}.${i % 2 ? ".." : ""} ${sans[i]}`;
}

// ---------- Pick screen ----------

function renderPick() {
  for (const b of document.querySelectorAll("[data-side]")) b.classList.toggle("active", b.dataset.side === state.side);
  const list = $("#opening-list");
  list.replaceChildren(
    ...state.openings
      .filter((o) => o.color === state.side)
      .map((o) =>
        el("button", { class: "opening-card", onclick: () => start(o) },
          el("strong", {}, o.name),
          el("span", { class: "line" }, o.first_moves),
          el("span", { class: "summary" }, o.summary),
          el("span", { class: "muted small" }, `${o.variations.length} variations · about ${o.length} moves`)))
  );
}

document.querySelectorAll("[data-side]").forEach((b) =>
  b.addEventListener("click", () => {
    state.side = b.dataset.side;
    store("openingSide", state.side);
    renderPick();
  })
);

async function loadOpenings() {
  try {
    const res = await fetch("/api/openings");
    state.openings = await res.json();
    const saved = store("openingSide");
    if (saved === "white" || saved === "black") state.side = saved;
    renderPick();
  } catch (err) {
    $("#pick-error").textContent = "Couldn't load the openings.";
    $("#pick-error").hidden = false;
  }
}

// ---------- Drill ----------

async function start(opening) {
  Object.assign(state, {
    opening,
    moves: [],
    sans: [],
    fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
    legal: [],
    expected: null,
    lastMove: null,
    mark: null,
    selected: null,
    flipped: opening.color === "black",
    busy: true,
    done: false,
    inBook: true,
    variation: null,
    hint: 0,
    preview: null,
    log: [],
    score: { firstTry: 0, total: 0, misses: [] },
    traineeMoves: 0,
    length: opening.length,
  });
  $("#drill-title").textContent = `${opening.name} · you play ${opening.color === "white" ? "White" : "Black"}`;
  addLog({ kind: "info", text: opening.summary });
  show("drill");
  render();
  try {
    const data = await post("/api/openings/turn", { opening: opening.id, moves: [] });
    await apply(data, null);
  } catch (err) {
    showError(err.message);
  } finally {
    state.busy = false;
    render();
  }
}

function addLog(entry) {
  state.log.push(entry);
}

// Take a /turn response: log the feedback and the reply, then wait for the trainee.
async function apply(data, fenBefore) {
  const fb = data.feedback;
  if (fb) {
    state.score.total += 1;
    const playedIndex = data.sans.length - (data.reply ? 2 : 1);
    if (fb.correct && state.hint < 2) state.score.firstTry += 1;
    if (!fb.correct) state.score.misses.push({ played: label(data.sans, playedIndex), expected: fb.expected.san });
    addLog(feedbackEntry(fb, label(data.sans, playedIndex), fenBefore));
    state.mark = { square: fb.played.uci.slice(2, 4), classification: fb.classification };
  }
  const wasBook = state.expected ? state.expected.source === "book" : true;

  if (data.reply) {
    // Show the trainee's move for a moment before the reply lands.
    state.fen = data.fen_before_reply;
    state.lastMove = data.moves[data.moves.length - 2] || null;
    render();
    await sleep(fb ? REPLY_DELAY_MS : 250);
    const replyLabel = label(data.sans, data.sans.length - 1);
    addLog({
      kind: "them",
      title: replyLabel,
      text: data.reply.note,
      variation: data.reply.variation,
      book: data.reply.source === "book",
    });
    // The reply may land on the square your icon was on.
    if (state.mark && data.reply.uci.slice(2, 4) === state.mark.square) state.mark = null;
    if (data.reply.variation && data.reply.variation !== state.variation) state.variation = data.reply.variation;
  }

  Object.assign(state, {
    moves: data.moves,
    sans: data.sans,
    fen: data.fen,
    legal: data.legal,
    expected: data.expected,
    lastMove: data.moves[data.moves.length - 1] || null,
    done: data.done,
    inBook: data.in_book,
    traineeMoves: data.trainee_moves,
    length: data.length,
    hint: 0,
    selected: null,
  });
  if (data.variation) state.variation = data.variation;

  if (state.expected && wasBook && state.expected.source === "engine") {
    addLog({
      kind: "info",
      text: fb && !fb.correct
        ? "You've left the book, so Stockfish takes over: it recommends your moves and picks your opponent's replies."
        : "That's the end of the book line. From here Stockfish recommends your moves and picks your opponent's replies.",
    });
  }
  if (state.done) addLog({ kind: "recap" });
}

function feedbackEntry(fb, playedLabel, fenBefore) {
  const exp = fb.expected;
  const source = exp.source === "book" ? "book" : "Stockfish's";
  if (fb.correct) {
    return {
      kind: "you",
      ok: true,
      title: playedLabel,
      badge: exp.source === "book" ? "Book move" : "Stockfish's choice",
      classification: fb.classification,
      text: exp.idea,
    };
  }
  const playable = fb.classification === "best" || fb.classification === "good";
  return {
    kind: "you",
    ok: false,
    title: playedLabel,
    badge: playable ? "Playable" : ChessBoard.LABELS[fb.classification],
    classification: fb.classification,
    text: playable
      ? `Not the ${source} move, but Stockfish thinks it's fine (you lost ${fb.win_drop}% winning chances). ${fb.played.description}`
      : fb.explanation,
    expected: `The ${source} move was ${exp.san}: ${exp.idea}`,
    preview: fenBefore
      ? {
          fen: fenBefore,
          arrows: [[fb.played.uci, "played"], [exp.uci, "best"]],
          caption: `Red: what you played (${fb.played.san}). Blue: the ${source} move (${exp.san}).`,
        }
      : null,
  };
}

// ---------- Rendering ----------

function targetsFrom(square) {
  return [...new Set(state.legal.filter((u) => u.startsWith(square)).map((u) => u.slice(2, 4)))];
}

const traineeToMove = () => state.fen.split(" ")[1] === (state.opening && state.opening.color === "white" ? "w" : "b");
const canMove = () => !state.busy && !state.done && !state.preview && traineeToMove();

function render() {
  if (!state.opening) return;
  const view = state.preview;
  const arrows = view ? view.arrows : [];
  if (!view && state.lastMove) arrows.push([state.lastMove, "last"]);
  if (!view && state.hint >= 2 && state.expected) arrows.push([state.expected.uci, "best"]);
  ChessBoard.render(boardEl, view ? view.fen : state.fen, {
    flipped: state.flipped,
    highlight: !view && state.lastMove ? [state.lastMove.slice(0, 2), state.lastMove.slice(2, 4)] : [],
    selected: view ? null : state.selected,
    targets: !view && state.selected ? targetsFrom(state.selected) : [],
    icon: view ? null : state.mark,
  });
  ChessBoard.drawArrows($("#arrow-layer"), arrows, state.flipped);
  $("#caption").textContent = view ? view.caption : state.hint >= 2 && state.expected ? `Blue: ${state.expected.san}` : "";

  $("#drill-variation").hidden = !state.variation;
  $("#drill-variation").textContent = state.variation || "";
  $("#drill-book").textContent = state.inBook ? "In the book" : "Out of book · Stockfish";
  $("#drill-book").classList.toggle("you", state.inBook);
  $("#drill-progress").style.width = `${Math.min(100, (state.traineeMoves / state.length) * 100)}%`;

  renderLog();
  renderPrompt();
}

// Icon plus label, e.g. [book] Book move
function classBadge(classification, text) {
  return el("span", { class: `with-icon class-label t-${classification}` },
    ChessBoard.icon(classification), text || ChessBoard.LABELS[classification]);
}

function renderLog() {
  const box = $("#log");
  box.replaceChildren(...state.log.map(renderEntry));
  box.scrollTop = box.scrollHeight;
}

function renderEntry(entry) {
  switch (entry.kind) {
    case "info":
      return el("div", { class: "entry info" }, entry.text);
    case "them":
      return el("div", { class: "entry them" },
        el("div", { class: "entry-head" }, el("strong", {}, entry.title), el("span", { class: "muted" }, "Opponent"),
          entry.book ? classBadge("book") : null,
          entry.variation ? el("span", { class: "chip" }, entry.variation) : null),
        el("div", {}, entry.text));
    case "you":
      return el("div", { class: `entry you ${entry.ok ? "ok" : "miss"}` },
        el("div", { class: "entry-head" }, el("strong", {}, entry.title),
          classBadge(entry.classification, entry.badge)),
        el("div", {}, entry.text),
        entry.expected ? el("div", { class: "expected" }, entry.expected) : null,
        entry.preview
          ? el("button", {
              class: "small-button",
              onclick: () => {
                state.preview = state.preview === entry.preview ? null : entry.preview;
                render();
              },
            }, state.preview === entry.preview ? "Back to the game" : "Compare on the board")
          : null);
    case "recap":
      return recapEntry();
    default:
      return el("div");
  }
}

function recapEntry() {
  const { firstTry, total, misses } = state.score;
  return el("div", { class: "entry recap" },
    el("h2", {}, "Opening complete"),
    el("p", {}, el("strong", {}, `${firstTry} of ${total}`), " moves right on the first try."),
    el("p", { class: "line" }, state.sans.map((s, i) => (i % 2 === 0 ? `${i / 2 + 1}. ${s}` : s)).join(" ")),
    misses.length ? el("h3", {}, "To review") : null,
    ...misses.map((m) => el("p", {}, `${m.played} — the recommended move was ${m.expected}.`)),
    el("div", { class: "row" },
      el("button", { class: "primary", onclick: () => start(state.opening) }, "Practice again"),
      el("button", { onclick: () => show("pick") }, "Another opening"),
      el("button", { onclick: analyze }, "Analyze this game")));
}

function renderPrompt() {
  const box = $("#prompt");
  if (state.done || !state.opening) return box.replaceChildren();
  if (state.busy || !state.expected) return box.replaceChildren(el("p", { class: "muted" }, "…"));
  const nodes = [el("p", {}, el("strong", {}, "Your move."), state.expected.source === "book" ? " Play the book move." : " Play Stockfish's recommended move.")];
  if (state.hint >= 1) nodes.push(el("p", { class: "hint" }, `Hint: ${state.expected.idea}`));
  if (state.hint >= 2) nodes.push(el("p", { class: "hint" }, `The move is ${state.expected.san} (blue arrow).`));
  nodes.push(el("div", { class: "row" },
    state.hint < 1 ? el("button", { onclick: () => setHint(1) }, "Hint") : null,
    state.hint < 2 ? el("button", { onclick: () => setHint(2) }, "Show the move") : null));
  box.replaceChildren(...nodes);
}

function setHint(level) {
  state.hint = level;
  render();
}

function showError(msg) {
  $("#drill-error").textContent = msg;
  $("#drill-error").hidden = !msg;
}

// ---------- Moves ----------

async function onMove(from, to) {
  const candidates = state.legal.filter((u) => u.startsWith(from + to));
  if (!candidates.length) return;
  const uci = candidates.find((u) => u.length === 4 || u.endsWith("q")) || candidates[0];
  const fenBefore = state.fen;
  const hintLevel = state.hint;
  state.busy = true;
  state.selected = null;
  state.mark = null; // the previous move's icon; the new one arrives with the feedback
  showError("");
  try {
    // Show your move right away, then the coach's verdict and the reply.
    const quick = await post("/api/play", { moves: [...state.moves, uci] });
    state.fen = quick.fen;
    state.lastMove = uci;
    render();
    const data = await post("/api/openings/turn", { opening: state.opening.id, moves: [...state.moves, uci] });
    state.hint = hintLevel;
    await apply(data, fenBefore);
  } catch (err) {
    showError(err.message);
  } finally {
    state.busy = false;
    render();
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

async function analyze() {
  try {
    const white = state.opening.color === "white" ? "You" : "Opponent";
    const black = state.opening.color === "white" ? "Opponent" : "You";
    const data = await post("/api/play", { moves: state.moves, white, black });
    sessionStorage.setItem("pendingPgn", data.pgn);
  } catch (e) {
    // the analysis page will just start empty
  }
  location.href = "/analysis";
}

$("#restart").addEventListener("click", () => state.opening && start(state.opening));
$("#choose").addEventListener("click", () => show("pick"));
$("#flip").addEventListener("click", () => {
  state.flipped = !state.flipped;
  render();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && state.preview) {
    state.preview = null;
    render();
  }
});

loadOpenings();
