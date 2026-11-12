"use strict";

// Openings trainer. The server (/api/openings/turn) judges each of your moves, plays the
// opponent's reply from the book (or Stockfish once out of book) and returns your next
// recommended move. This page keeps the conversation log and the board.

const $ = (sel) => document.querySelector(sel);
const boardEl = $("#board");
const REPLY_DELAY_MS = 600;
const GLIDE_MS = { reply: 330, click: 200 }; // how long a piece takes to slide over, as on the Play page

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
  mode: "learn", // "learn": every move is shown and explained first; "practice": find it yourself
  preview: null, // { fen, arrows, caption } while comparing a past move on the board
  log: [],
  score: { firstTry: 0, total: 0, misses: [] },
  traineeMoves: 0,
  length: 10,
  line: null, // practicing a weak spot: the moves that lead to it (the opponent follows them)
};

// ---------- Your record: where you go wrong (localStorage) ----------
// openingStats[openingId] = { runs, completed, spots: { "e2e4,e7e5": { moves, sans, fen, expected, played, misses, streak, last } } }
// A spot is a position where you played something other than the recommended move. Getting it
// right twice in a row in Practice mode (without "Show the move") clears it.

const FIXED_AFTER = 2;

function allStats() {
  try {
    return JSON.parse(store("openingStats") || "{}") || {};
  } catch (e) {
    return {};
  }
}

function statsFor(id) {
  const all = allStats();
  return all[id] || { runs: 0, completed: 0, spots: {} };
}

function updateStats(id, change) {
  const all = allStats();
  const st = all[id] || { runs: 0, completed: 0, spots: {} };
  change(st);
  all[id] = st;
  store("openingStats", JSON.stringify(all));
}

// Your move at ply `index` of `moves`: right or wrong, and whether it counts toward clearing a spot.
function recordMove(moves, sans, index, fb, counts, fen) {
  const prefix = moves.slice(0, index);
  const key = prefix.join(",");
  updateStats(state.opening.id, (st) => {
    const spot = st.spots[key];
    if (!fb.correct) {
      st.spots[key] = {
        moves: prefix,
        sans: sans.slice(0, index),
        fen: fen || (spot && spot.fen) || null,
        expected: fb.expected.san,
        played: fb.played.san,
        misses: (spot ? spot.misses : 0) + 1,
        streak: 0,
        last: Date.now(),
      };
    } else if (spot && counts) {
      spot.streak += 1;
      if (spot.streak >= FIXED_AFTER) delete st.spots[key];
    }
  });
}

// "1. e4 e5 2. Nf3" for a list of SANs from the start.
function movesText(sans) {
  return sans.map((s, i) => (i % 2 === 0 ? `${i / 2 + 1}. ${s}` : s)).join(" ");
}

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

// Back to the list of openings, with your updated record.
function backToPick() {
  state.line = null;
  renderPick();
  show("pick");
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

const learning = () => state.mode === "learn" && !state.line; // a weak spot is always practiced
const startHint = () => (learning() ? 2 : 0); // Learn mode shows each move up front

function renderPick() {
  for (const b of document.querySelectorAll("[data-side]")) b.classList.toggle("active", b.dataset.side === state.side);
  for (const b of document.querySelectorAll("[data-mode]")) b.classList.toggle("active", b.dataset.mode === state.mode);
  const flipped = state.side === "black";
  const mine = state.openings.filter((o) => o.color === state.side);
  $("#list-title").textContent = flipped ? "Defenses for Black" : "Openings for White";
  $("#opening-list").replaceChildren(
    ...mine.map((o) => {
      const st = statsFor(o.id);
      const spots = Object.keys(st.spots).length;
      const record = st.runs
        ? `Practiced ${st.runs}×${spots ? ` · ${spots} weak spot${spots === 1 ? "" : "s"}` : " · no weak spots"}`
        : "Not practiced yet";
      return el("button", { class: "opening-card", onclick: () => start(o) },
        o.fen ? ChessBoard.mini(o.fen, { flipped }) : null,
        el("span", { class: "opening-text" },
          el("strong", {}, o.name),
          el("span", { class: "line" }, o.first_moves),
          el("span", { class: "summary" }, o.summary),
          el("span", { class: `record ${spots ? "weak" : st.runs ? "clean" : ""}` }, record)));
    })
  );
  renderWeakSpots(mine);
}

// "4. c3 Nf6 5. ?": the last few moves before a weak spot, and whose turn it is.
function spotLead(sans) {
  const from = Math.max(0, sans.length - 4);
  const parts = [];
  for (let i = from; i <= sans.length; i++) {
    const n = Math.floor(i / 2) + 1;
    const text = i < sans.length ? sans[i] : "?";
    if (i % 2 === 0) parts.push(`${n}. ${text}`);
    else parts.push(i === from ? `${n}... ${text}` : text);
  }
  return parts.join(" ");
}

// "5. d4" / "4...Nc6": the move you played at ply `ply`.
function plyLabel(ply, san) {
  const n = Math.floor(ply / 2) + 1;
  return ply % 2 === 0 ? `${n}. ${san}` : `${n}...${san}`;
}

// Spots saved before boards were shown have no position: ask the server once and keep it.
async function fillSpotBoard(opening, key, spot, holder, flipped) {
  try {
    const data = await post("/api/play", { moves: spot.moves });
    updateStats(opening.id, (st) => { if (st.spots[key]) st.spots[key].fen = data.fen; });
    holder.replaceChildren(spotBoard(data.fen, spot, flipped));
  } catch (e) {
    // no picture, that's all
  }
}

function spotBoard(fen, spot, flipped) {
  const last = spot.moves[spot.moves.length - 1];
  return ChessBoard.mini(fen, { flipped, highlight: last ? [last.slice(0, 2), last.slice(2, 4)] : [] });
}

// The positions you've got wrong most often (for the side you picked), worst first.
function renderWeakSpots(openings) {
  const box = $("#weak-spots");
  const spots = [];
  for (const o of openings) {
    for (const [key, spot] of Object.entries(statsFor(o.id).spots)) spots.push({ opening: o, key, spot });
  }
  spots.sort((a, b) => b.spot.misses - a.spot.misses || b.spot.last - a.spot.last);
  box.hidden = !spots.length;
  if (!spots.length) return box.replaceChildren();
  const flipped = state.side === "black";
  box.replaceChildren(
    el("div", { class: "weak-head" },
      el("h2", {}, "Your weak spots"),
      el("span", { class: "muted small" }, "Get one right twice in a row and it's cleared")),
    el("div", { class: "weak-list" },
      ...spots.slice(0, 6).map(({ opening, key, spot }) => {
        const holder = el("span", { class: "weak-board" });
        if (spot.fen) holder.append(spotBoard(spot.fen, spot, flipped));
        else fillSpotBoard(opening, key, spot, holder, flipped);
        const sans = spot.sans || [];
        return el("div", { class: "weak-spot" },
          holder,
          el("span", { class: "weak-text" },
            el("span", { class: "weak-top" },
              el("strong", {}, opening.name),
              el("span", { class: "chip" }, `Missed ${spot.misses}×`)),
            el("span", { class: "line" }, spot.moves.length ? spotLead(sans) : "Your first move"),
            el("span", { class: "weak-detail" }, "You played ", el("strong", {}, plyLabel(spot.moves.length, spot.played)), ". Find the book move."),
            el("button", { class: "small-button", onclick: () => start(opening, spot.moves) }, "Practice this spot")));
      })));
}

document.querySelectorAll("[data-mode]").forEach((b) =>
  b.addEventListener("click", () => {
    state.mode = b.dataset.mode;
    store("openingMode", state.mode);
    renderPick();
  })
);

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
    if (["learn", "practice"].includes(store("openingMode"))) state.mode = store("openingMode");
    renderPick();
  } catch (err) {
    $("#pick-error").textContent = "Couldn't load the openings.";
    $("#pick-error").hidden = false;
  }
}

// ---------- Drill ----------

async function start(opening, line = null) {
  Object.assign(state, {
    opening,
    line,
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
    hint: startHint(),
    preview: null,
    log: [],
    score: { firstTry: 0, total: 0, misses: [] },
    traineeMoves: 0,
    length: opening.length,
  });
  $("#drill-title").textContent = `${opening.name} · you play ${opening.color === "white" ? "White" : "Black"}`;
  addLog({ kind: "info", text: line ? "Practicing a weak spot: your opponent heads for the position you got wrong before. Find the move yourself." : opening.summary });
  updateStats(opening.id, (st) => { st.runs += 1; });
  show("drill");
  render();
  try {
    const data = await post("/api/openings/turn", { opening: opening.id, moves: [], line });
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
    if (fb.correct && (learning() || state.hint < 2)) state.score.firstTry += 1;
    if (!fb.correct) state.score.misses.push({ played: label(data.sans, playedIndex), expected: fb.expected.san });
    recordMove(data.moves, data.sans, playedIndex, fb, !learning() && state.hint < 2, fenBefore);
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
    hint: startHint(),
    selected: null,
  });
  if (data.variation) state.variation = data.variation;
  if (data.reply) {
    render();
    await ChessBoard.glide(boardEl, data.reply.uci, GLIDE_MS.reply);
  }

  if (state.expected && wasBook && state.expected.source === "engine") {
    addLog({
      kind: "info",
      text: fb && !fb.correct
        ? "You've left the book, so Stockfish takes over: it recommends your moves and picks your opponent's replies."
        : "That's the end of the book line. From here Stockfish recommends your moves and picks your opponent's replies.",
    });
  }
  if (state.done) {
    addLog({ kind: "recap" });
    updateStats(state.opening.id, (st) => { st.completed += 1; });
  }
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
          arrows: [[fb.played.uci, "played"], [exp.uci, "user"]],
          caption: `Red: what you played (${fb.played.san}). Yellow: the ${source} move (${exp.san}).`,
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

// Like the Play page, the last move is shown by its squares, not an arrow. Your own right-click arrows
// and the move to play (Learn mode, or after a hint) use the same yellow arrow as the Play page.
function drawBoardArrows() {
  const view = state.preview;
  const arrows = view ? [...view.arrows] : drawn.arrows.map((a) => [a, "user"]);
  if (!view && state.hint >= 2 && state.expected) arrows.push([state.expected.uci, "user"]);
  ChessBoard.drawArrows($("#arrow-layer"), arrows, state.flipped);
}

function render() {
  if (!state.opening) return;
  const view = state.preview;
  ChessBoard.render(boardEl, view ? view.fen : state.fen, {
    flipped: state.flipped,
    highlight: !view && state.lastMove ? [state.lastMove.slice(0, 2), state.lastMove.slice(2, 4)] : [],
    selected: view ? null : state.selected,
    targets: !view && state.selected ? targetsFrom(state.selected) : [],
    icon: view ? null : state.mark,
    marked: view ? [] : drawn.marks,
  });
  renderPlayers(view ? view.fen : state.fen);
  drawBoardArrows();
  $("#caption").textContent = view ? view.caption : state.hint >= 2 && state.expected ? `Yellow: ${state.expected.san}` : "";

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
      el("button", { onclick: backToPick }, "Another opening"),
      el("button", { onclick: continuePlaying }, "Continue playing vs Stockfish")));
}

function renderPrompt() {
  const box = $("#prompt");
  if (state.done || !state.opening) return box.replaceChildren();
  if (state.busy || !state.expected) return box.replaceChildren(el("p", { class: "muted" }, "…"));
  if (learning()) {
    box.replaceChildren(
      el("p", {}, el("strong", {}, `Play ${state.expected.san}`), state.expected.source === "book" ? " (book move)" : " (Stockfish's move)"),
      el("p", { class: "hint" }, state.expected.idea),
      el("p", { class: "muted small" }, "Follow the yellow arrow.")
    );
    return;
  }
  const nodes = [el("p", {}, el("strong", {}, "Your move."), state.expected.source === "book" ? " Play the book move." : " Play Stockfish's recommended move.")];
  const spot = statsFor(state.opening.id).spots[state.moves.join(",")];
  if (spot) nodes.push(el("p", { class: "weak-note" }, `You've missed this one ${spot.misses}× before (you played ${spot.played}).`));
  if (state.hint >= 1) nodes.push(el("p", { class: "hint" }, `Hint: ${state.expected.idea}`));
  if (state.hint >= 2) nodes.push(el("p", { class: "hint" }, `The move is ${state.expected.san} (yellow arrow).`));
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

async function onMove(from, to, how = {}) {
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
    drawn.clear(); // your arrows and marks go away once you move, as on the Play page
    render();
    if (!how.dragged) ChessBoard.glide(boardEl, uci, GLIDE_MS.click); // a dragged piece is already there
    const data = await post("/api/openings/turn", { opening: state.opening.id, moves: [...state.moves, uci], line: state.line });
    state.hint = hintLevel;
    await apply(data, fenBefore);
  } catch (err) {
    showError(err.message);
  } finally {
    state.busy = false;
    render();
  }
}

// Name strips above and below the board, with the pieces each side has captured.
function renderPlayers(fen) {
  const mine = state.opening.color;
  const bottom = state.flipped ? "black" : "white";
  for (const [id, color] of [["#top-player", bottom === "white" ? "black" : "white"], ["#bottom-player", bottom]]) {
    const avatar = document.createElement("span");
    avatar.className = `avatar ${color}`;
    avatar.setAttribute("aria-hidden", "true");
    const info = document.createElement("div");
    info.className = "pinfo";
    const name = document.createElement("span");
    name.className = "pname";
    name.textContent = color === mine ? `You · ${color}` : `Opponent · ${color}`;
    avatar.textContent = color === mine ? "Y" : "O";
    info.append(name, ChessBoard.capturedRow(fen, color));
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

const drawn = ChessBoard.attachDrawing(boardEl, {
  fen: () => (state.preview ? state.preview.fen : state.fen),
  changed: ({ cleared }) => (cleared ? drawBoardArrows() : render()), // a left click may be picking up a piece: don't redraw the board
});

// Take this position to the Play page and play it out against Stockfish.
function continuePlaying() {
  try {
    sessionStorage.setItem("continueGame", JSON.stringify({ moves: state.moves, color: state.opening.color }));
  } catch (e) {
    // the Play page will just start a fresh game
  }
  location.href = "/";
}

$("#restart").addEventListener("click", () => state.opening && start(state.opening));
$("#choose").addEventListener("click", backToPick);
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
