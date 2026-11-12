"use strict";

// Endgame drills. /api/endgames/turn takes your move, plays Stockfish's reply and says how it
// stands ("You mate in 7", "Draw", ...) and whether the drill is won or failed. Your record
// for each drill (best result) is kept in this browser.
//
// Learn mode shows Stockfish's move and why before you play it (like the Openings page);
// Practice mode makes you find it, with a hint and then the move if you ask. Only Practice
// tries go into your record.

const $ = (sel) => document.querySelector(sel);
const boardEl = $("#board");
const GLIDE_MS = { reply: 330, click: 200 };
const REPLY_DELAY_MS = 350; // a beat between your move and Stockfish's
const GOALS = {
  mate: "Checkmate the king.",
  promote: "Make a queen and keep it.",
  draw: "Hold the draw: don't let the pawn promote.",
};

const state = {
  drills: [],
  drill: null,
  start: 0,
  startFen: null,
  moves: [],
  sans: [],
  fen: null,
  legal: [],
  selected: null,
  flipped: false,
  busy: false,
  lastMove: null,
  eval: null,
  prevEval: null,
  result: null, // { result: "won" | "failed", message }
  expected: null, // your best move now: { uci, san, idea }
  hint: 0, // 0 nothing shown, 1 idea shown, 2 move shown
  mode: "learn", // "learn": the move is shown and explained first; "practice": find it yourself
  counted: true, // whether this try goes into your record (Practice only)
};

function store(key, value) {
  try {
    if (value === undefined) return localStorage.getItem(key);
    localStorage.setItem(key, value);
  } catch (e) {
    return null;
  }
}

const learning = () => state.mode === "learn";
const startHint = () => (learning() ? 2 : 0);

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

// ---------- Your record (localStorage) ----------

function records() {
  try {
    return JSON.parse(localStorage.getItem("endgameRecords") || "{}") || {};
  } catch (e) {
    return {};
  }
}

function saveRecord(drillId, won, moves) {
  const all = records();
  const r = all[drillId] || { tries: 0, wins: 0, best: null };
  r.tries += 1;
  if (won) {
    r.wins += 1;
    if (r.best === null || moves < r.best) r.best = moves;
  }
  all[drillId] = r;
  try {
    localStorage.setItem("endgameRecords", JSON.stringify(all));
  } catch (e) {
    // just not remembered
  }
}

function recordText(id) {
  const r = records()[id];
  if (!r || !r.tries) return "Not tried yet";
  const best = r.best !== null ? ` · best ${r.best} moves` : "";
  return `${r.wins} of ${r.tries} won${best}`;
}

// ---------- Pick a drill ----------

const GOAL_WORDS = { mate: "checkmate", promote: "make a queen", draw: "hold the draw" };

function renderList() {
  for (const b of document.querySelectorAll("[data-mode]")) b.classList.toggle("active", b.dataset.mode === state.mode);
  const all = records();
  const tried = state.drills.filter((d) => all[d.id] && all[d.id].tries);
  const tries = tried.reduce((n, d) => n + all[d.id].tries, 0);
  const wins = tried.reduce((n, d) => n + all[d.id].wins, 0);
  const wonOnce = state.drills.filter((d) => all[d.id] && all[d.id].wins).length;
  $("#drill-stats").replaceChildren(...(tries
    ? [el("div", { class: "drill-stat" }, el("strong", {}, `${wonOnce} of ${state.drills.length}`), el("span", {}, "drills won at least once")),
       el("div", { class: "drill-stat" }, el("strong", {}, `${wins} of ${tries}`), el("span", {}, "tries won"))]
    : []));
  const card = (d) => {
    const r = all[d.id];
    const pct = r && r.tries ? Math.round((r.wins / r.tries) * 100) : 0;
    const status = !r || !r.tries ? "" : r.wins === r.tries ? "perfect" : r.wins ? "won" : "lost";
    return el("button", { class: "drill-card", onclick: () => startDrill(d, Math.floor(Math.random() * d.positions)) },
      d.fen ? ChessBoard.mini(d.fen, { flipped: d.fen.split(" ")[1] === "b" }) : null,
      el("span", { class: "drill-text" },
        el("span", { class: "drill-card-head" }, el("strong", {}, d.name)),
        el("span", { class: "muted small" }, `${d.material} · goal: ${GOAL_WORDS[d.goal] || d.goal}`),
        el("span", { class: "summary" }, d.summary),
        el("span", { class: "drill-progress" },
          el("span", { class: `bar-track ${status}` }, el("span", { class: "bar-fill", style: `width: ${pct}%` })),
          el("span", { class: `record ${status}` }, recordText(d.id)))));
  };
  const levels = [];
  for (const d of state.drills) if (!levels.includes(d.level)) levels.push(d.level);
  $("#drill-list").replaceChildren(...levels.map((level) =>
    el("section", { class: "drill-group" },
      el("h2", {}, level),
      el("div", { class: "drill-list" }, ...state.drills.filter((d) => d.level === level).map(card)))));
}

async function loadDrills() {
  try {
    const res = await fetch("/api/endgames");
    state.drills = await res.json();
    renderList();
  } catch (err) {
    $("#list-error").textContent = "Couldn't load the endgames.";
    $("#list-error").hidden = false;
  }
}

// ---------- Drill ----------

async function startDrill(drill, start) {
  Object.assign(state, {
    drill,
    start,
    moves: [],
    sans: [],
    fen: null,
    legal: [],
    selected: null,
    lastMove: null,
    eval: null,
    prevEval: null,
    result: null,
    expected: null,
    hint: startHint(),
    counted: !learning(),
    busy: true,
  });
  show("drill");
  showError("");
  try {
    const data = await post("/api/endgames/turn", { drill: drill.id, start, moves: [] });
    state.flipped = data.fen.split(" ")[1] === "b"; // you're always the side to move at the start
    apply(data);
  } catch (err) {
    showError(err.message);
  } finally {
    state.busy = false;
    render();
  }
}

function apply(data) {
  Object.assign(state, {
    startFen: data.start_fen,
    moves: data.moves,
    sans: data.sans,
    fen: data.fen,
    legal: data.legal,
    prevEval: state.eval,
    eval: data.eval,
    selected: null,
    expected: data.expected || null,
    hint: startHint(),
  });
  if (data.result && !state.result) {
    state.result = { result: data.result, message: data.message };
    if (state.counted) saveRecord(state.drill.id, data.result === "won", data.user_moves);
  }
}

const canMove = () => !state.busy && !state.result && state.legal.length > 0;

function targetsFrom(square) {
  return [...new Set(state.legal.filter((u) => u.startsWith(square)).map((u) => u.slice(2, 4)))];
}

async function onMove(from, to, how = {}) {
  const candidates = state.legal.filter((u) => u.startsWith(from + to));
  if (!candidates.length) return;
  const uci = candidates.find((u) => u.length === 4 || u.endsWith("q")) || candidates[0]; // promote to a queen
  state.busy = true;
  state.selected = null;
  state.expected = null;
  showError("");
  try {
    // Your move first, then Stockfish's reply a moment later.
    const shown = await post("/api/play", { fen: state.startFen, moves: [...state.moves, uci] });
    state.fen = shown.fen;
    state.lastMove = uci;
    render();
    if (!how.dragged) ChessBoard.glide(boardEl, uci, GLIDE_MS.click);
    const [data] = await Promise.all([
      post("/api/endgames/turn", { drill: state.drill.id, start: state.start, moves: [...state.moves, uci] }),
      sleep(REPLY_DELAY_MS),
    ]);
    apply(data);
    if (data.reply) {
      state.lastMove = data.reply.uci;
      state.busy = false;
      render();
      await ChessBoard.glide(boardEl, data.reply.uci, GLIDE_MS.reply);
    }
  } catch (err) {
    showError(err.message);
  } finally {
    state.busy = false;
    render();
  }
}

function setHint(level) {
  state.hint = level;
  render();
}

async function takeBack() {
  if (state.busy || state.moves.length < 1) return;
  // Back to your previous turn: your last move and Stockfish's reply to it.
  const keep = state.moves.length % 2 === 0 ? state.moves.length - 2 : state.moves.length - 1;
  state.busy = true;
  try {
    const data = await post("/api/endgames/turn", { drill: state.drill.id, start: state.start, moves: state.moves.slice(0, Math.max(0, keep)) });
    state.result = null;
    state.eval = null;
    apply(data);
    state.prevEval = null;
    state.lastMove = data.moves[data.moves.length - 1] || null;
  } catch (err) {
    showError(err.message);
  } finally {
    state.busy = false;
    render();
  }
}

function showError(msg) {
  $("#drill-error").textContent = msg;
  $("#drill-error").hidden = !msg;
}

// ---------- Drawing ----------

function evalNote() {
  const ev = state.eval;
  if (!ev) return null;
  const prev = state.prevEval;
  let trend = "";
  if (prev && ev.mate > 0 && prev.mate > 0) {
    if (ev.mate < prev.mate) trend = "closer";
    else if (ev.mate > prev.mate + 1) trend = "slower";
  }
  const extra = trend === "closer" ? ` (was ${prev.mate}): good progress` : trend === "slower" ? ` (was ${prev.mate}): that move lost time` : "";
  return el("p", { class: `drill-eval ${ev.winning ? "good" : ev.text === "Draw" ? "even" : "bad"}` },
    el("span", { class: "muted" }, "Stockfish: "), `${ev.text}${extra}`);
}

function render() {
  const d = state.drill;
  if (!d || !state.fen) return;
  const last = state.lastMove;
  ChessBoard.render(boardEl, state.fen, {
    flipped: state.flipped,
    highlight: last ? [last.slice(0, 2), last.slice(2, 4)] : [],
    selected: state.selected,
    targets: state.selected ? targetsFrom(state.selected) : [],
  });
  const showMove = canMove() && state.hint >= 2 && state.expected;
  ChessBoard.drawArrows($("#arrow-layer"), showMove ? [[state.expected.uci, "user"]] : [], state.flipped);
  renderPlayers();

  $("#drill-level").textContent = `${d.level} · position ${state.start + 1} of ${d.positions}`;
  $("#drill-name").textContent = d.name;
  $("#drill-goal").replaceChildren(el("strong", {}, "Goal: "), GOALS[d.goal] || "");
  $("#eval-line").replaceChildren(...[evalNote()].filter(Boolean));
  const r = state.result;
  $("#drill-result").replaceChildren(...(r
    ? [el("div", { class: `box ${r.result === "won" ? "better" : "wrong"}` },
        el("h3", {}, r.result === "won" ? "Drill complete" : "Not this time"),
        el("p", {}, r.message),
        state.counted ? null : el("p", { class: "muted small" }, "Learn mode: this try isn't added to your record. Switch to Practice to count it."),
        el("div", { class: "row" },
          r.result === "won" ? null : el("button", { class: "small-button", onclick: takeBack }, "Take back and try again"),
          el("button", { class: "small-button", onclick: () => startDrill(d, state.start) }, "Restart")))]
    : []));
  $("#drill-tips").replaceChildren(...d.tips.map((t) => el("li", {}, t)));
  $("#drill-moves").textContent = state.sans.map((s, i) => {
    const white = state.startFen.split(" ")[1] === "w";
    const ply = i + (white ? 0 : 1);
    const n = Math.floor(ply / 2) + 1;
    return ply % 2 === 0 ? `${n}. ${s}` : i === 0 ? `${n}... ${s}` : s;
  }).join(" ");
  renderPrompt();
  $("#undo").disabled = state.busy || state.moves.length === 0;
}

function renderPrompt() {
  const box = $("#drill-prompt");
  const ex = state.expected;
  if (state.result || !state.fen) return box.replaceChildren();
  if (state.busy || !ex) return box.replaceChildren(el("p", { class: "muted" }, "…"));
  if (learning()) {
    return box.replaceChildren(
      el("p", {}, el("strong", {}, `Play ${ex.san}`), " (Stockfish's move)"),
      el("p", { class: "hint" }, ex.idea),
      el("p", { class: "muted small" }, "Follow the arrow."));
  }
  const nodes = [el("p", {}, el("strong", {}, "Your move."), " Find Stockfish's best move.")];
  if (state.hint >= 1) nodes.push(el("p", { class: "hint" }, `Hint: ${ex.idea}`));
  if (state.hint >= 2) nodes.push(el("p", { class: "hint" }, `The move is ${ex.san} (arrow).`));
  nodes.push(el("div", { class: "row" },
    state.hint < 1 ? el("button", { onclick: () => setHint(1) }, "Hint") : null,
    state.hint < 2 ? el("button", { onclick: () => setHint(2) }, "Show the move") : null));
  box.replaceChildren(...nodes);
}

function renderPlayers() {
  const userColor = state.flipped ? "black" : "white";
  for (const [id, color] of [["#top-player", userColor === "white" ? "black" : "white"], ["#bottom-player", userColor]]) {
    const mine = color === userColor;
    const avatar = el("span", { class: `avatar ${color}`, "aria-hidden": "true" }, mine ? "Y" : "SF");
    const info = el("div", { class: "pinfo" }, el("span", { class: "pname" }, mine ? `You · ${color}` : `Stockfish · ${color}`));
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

$("#back-to-list").addEventListener("click", () => {
  state.drill = null;
  renderList();
  show("list");
});
document.querySelectorAll("[data-mode]").forEach((b) =>
  b.addEventListener("click", () => {
    state.mode = b.dataset.mode;
    store("endgameMode", state.mode);
    renderList();
  })
);
$("#undo").addEventListener("click", takeBack);
$("#restart").addEventListener("click", () => state.drill && startDrill(state.drill, state.start));
$("#another").addEventListener("click", () => {
  const d = state.drill;
  if (!d) return;
  const next = d.positions > 1 ? (state.start + 1 + Math.floor(Math.random() * (d.positions - 1))) % d.positions : 0;
  startDrill(d, next);
});

if (["learn", "practice"].includes(store("endgameMode"))) state.mode = store("endgameMode");
loadDrills();
