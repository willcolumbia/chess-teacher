"use strict";

// Preset puzzles, sorted by skill. /api/puzzles lists the skills; /api/puzzles/<skill> has a
// skill's puzzles ready to play. A puzzle opens with your opponent's last move. Then you play
// the solution: your move has to be the puzzle's (any checkmate counts too), and the replies
// come by themselves. What you have solved is kept in this browser.
// Puzzles made from your own games are on /puzzles/mine (my-puzzles.js).

const $ = (sel) => document.querySelector(sel);
const boardEl = $("#board");
const GLIDE_MS = { setup: 450, reply: 330, click: 200 };
const SETUP_DELAY_MS = 600; // a look at the position before your opponent's move is played
const REPLY_DELAY_MS = 450; // a beat between your move and the reply
const WRONG_MS = 1000; // how long a wrong move stays on the board
const PROGRESS_KEY = "puzzleProgress";

const state = {
  skills: [], // from /api/puzzles
  loaded: {}, // skill id -> that skill with its puzzles
  skill: null,
  index: 0, // which puzzle of the skill
  puzzle: null,
  step: 0, // which of puzzle.steps you have to find now
  fen: null,
  legal: [],
  selected: null,
  flipped: false,
  lastMove: null,
  phase: "idle", // "setup" (your opponent's move is on its way), "solve", "wrong", "reply", "done"
  helped: false, // a wrong move, a hint or the answer was used on this try
  hint: 0, // 0 nothing, 1 the piece to move is ringed, 2 the move is drawn
  feedback: null, // { kind: "right" | "wrong", title, text }
  run: 0, // goes up with every new puzzle, so anything still pending for an old one is dropped
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

function showError(id, msg) {
  $(id).textContent = msg;
  $(id).hidden = !msg;
}

// ---------- What you have solved (localStorage) ----------

// { puzzle id: { tries, clean } }. A puzzle is in here once you have played it to the end;
// "clean" means at least once with no wrong move, hint or answer.
function progress() {
  try {
    const all = JSON.parse(localStorage.getItem(PROGRESS_KEY) || "{}");
    return all && typeof all === "object" ? all : {};
  } catch (e) {
    return {};
  }
}

function saveSolved(id, clean) {
  const all = progress();
  const p = all[id] || { tries: 0, clean: false };
  p.tries += 1;
  p.clean = p.clean || clean;
  all[id] = p;
  try {
    localStorage.setItem(PROGRESS_KEY, JSON.stringify(all));
  } catch (e) {
    // just not remembered
  }
}

const statusOf = (all, id) => (!all[id] ? "" : all[id].clean ? "clean" : "helped");

function tally(ids, all) {
  return {
    total: ids.length,
    solved: ids.filter((id) => all[id]).length,
    clean: ids.filter((id) => all[id] && all[id].clean).length,
  };
}

// ---------- Pick a skill ----------

function renderList() {
  const all = progress();
  const t = tally(state.skills.flatMap((s) => s.puzzles), all);
  $("#puzzle-stats").replaceChildren(...(t.solved
    ? [el("div", { class: "drill-stat" }, el("strong", {}, `${t.solved} of ${t.total}`), el("span", {}, "puzzles solved")),
       el("div", { class: "drill-stat" }, el("strong", {}, String(t.clean)), el("span", {}, "solved without help"))]
    : []));
  const card = (s) => {
    const c = tally(s.puzzles, all);
    const done = c.total > 0 && c.solved === c.total;
    const status = !done ? "" : c.clean === c.total ? "perfect" : "won";
    const record = !c.solved ? "Not started" : done ? `All ${c.total} solved` : `${c.solved} of ${c.total} solved`;
    return el("button", { class: "drill-card", onclick: () => openSkill(s.id) },
      s.fen ? ChessBoard.mini(s.fen, { flipped: s.fen.split(" ")[1] === "b" }) : null,
      el("span", { class: "drill-text" },
        el("span", { class: "drill-card-head" }, el("strong", {}, s.name)),
        el("span", { class: "muted small" }, `${c.total} puzzles`),
        el("span", { class: "summary" }, s.summary),
        el("span", { class: "drill-progress" },
          el("span", { class: `bar-track ${status}` }, el("span", { class: "bar-fill", style: `width: ${c.total ? Math.round((c.solved / c.total) * 100) : 0}%` })),
          el("span", { class: `record ${status}` }, record))));
  };
  const levels = [];
  for (const s of state.skills) if (!levels.includes(s.level)) levels.push(s.level);
  $("#skill-list").replaceChildren(...levels.map((level) =>
    el("section", { class: "drill-group" },
      el("h2", {}, level),
      el("div", { class: "drill-list" }, ...state.skills.filter((s) => s.level === level).map(card)))));
  renderMine();
}

// The link to the puzzles made from your own analyzed games.
function renderMine() {
  const n = PuzzleStore.all().length;
  const due = PuzzleStore.due().length;
  $("#mine-card").replaceChildren(
    el("span", { class: "mine-text" },
      el("strong", {}, "Your own mistakes"),
      el("span", { class: "summary" }, n
        ? "The positions where you went wrong in games you analyzed. Find the move you should have played."
        : "Analyze one of your games and every mistake you made becomes a puzzle here.")),
    el("span", { class: `record ${due ? "due" : ""}` }, n ? `${n} puzzle${n === 1 ? "" : "s"} · ${due} due now` : "None yet"));
}

async function loadSkills() {
  try {
    const res = await fetch("/api/puzzles");
    if (!res.ok) throw new Error();
    state.skills = await res.json();
    renderList();
  } catch (err) {
    showError("#list-error", "Couldn't load the puzzles.");
  }
}

async function openSkill(id) {
  showError("#list-error", "");
  let skill = state.loaded[id];
  if (!skill) {
    try {
      const res = await fetch(`/api/puzzles/${encodeURIComponent(id)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      skill = state.loaded[id] = data;
    } catch (err) {
      return showError("#list-error", "Couldn't load these puzzles.");
    }
  }
  if (!skill.puzzles.length) return showError("#list-error", "This set has no puzzles yet.");
  state.skill = skill;
  show("solve");
  startPuzzle(Math.max(0, nextOpen(-1)));
}

// The puzzle to do after number `from`: the next one you haven't solved, or else the next one
// you only solved with help. -1 when the whole set is solved without help.
function nextOpen(from) {
  const all = progress();
  const list = state.skill.puzzles;
  const order = list.map((_, i) => (from + 1 + i) % list.length);
  const unsolved = order.find((i) => !all[list[i].id]);
  if (unsolved !== undefined) return unsolved;
  const helped = order.find((i) => !all[list[i].id].clean);
  return helped === undefined ? -1 : helped;
}

function backToList() {
  state.run += 1;
  state.puzzle = null;
  renderList();
  show("list");
}

// ---------- Solving ----------

async function startPuzzle(index) {
  const p = state.skill.puzzles[index];
  const run = ++state.run;
  Object.assign(state, {
    index,
    puzzle: p,
    step: 0,
    fen: p.start_fen,
    legal: [],
    selected: null,
    flipped: p.color === "black",
    lastMove: null,
    phase: "setup",
    helped: false,
    hint: 0,
    feedback: null,
  });
  render();
  // Show the position first, then the move your opponent just made.
  await sleep(SETUP_DELAY_MS);
  if (run !== state.run) return;
  Object.assign(state, { fen: p.setup.fen, lastMove: p.setup.uci, legal: p.steps[0].legal, phase: "solve" });
  render();
  ChessBoard.glide(boardEl, p.setup.uci, GLIDE_MS.setup);
}

const canMove = () => state.phase === "solve";
const opponent = () => (state.puzzle.color === "white" ? "Black" : "White");

function targetsFrom(square) {
  return [...new Set(state.legal.filter((u) => u.startsWith(square)).map((u) => u.slice(2, 4)))];
}

function onMove(from, to, how = {}) {
  const step = state.puzzle.steps[state.step];
  const candidates = state.legal.filter((u) => u.startsWith(from + to));
  if (!candidates.length) return;
  const uci = candidates.find((u) => u.length === 4 || u.endsWith("q")) || candidates[0]; // promote to a queen
  state.selected = null;
  if (uci === step.uci) return played(uci, step.fen, null, how);
  const mate = step.mates[uci];
  if (mate) return played(uci, mate.fen, mate.san, how);
  return wrong(uci, how);
}

// The right move (or another checkmate, `otherMate` being its name): on to the reply, or done.
async function played(uci, fen, otherMate, how) {
  const p = state.puzzle;
  const run = state.run;
  const answer = p.steps[state.step].san;
  const last = Boolean(otherMate) || state.step === p.steps.length - 1;
  Object.assign(state, { fen, lastMove: uci, hint: 0 });
  if (last) {
    const clean = !state.helped;
    saveSolved(p.id, clean);
    state.phase = "done";
    state.feedback = {
      kind: "right",
      title: clean ? "Solved!" : "Solved, with some help",
      text: otherMate ? `${otherMate.replace("#", "")} is checkmate too. The puzzle's own answer was ${answer}.` : p.idea,
    };
  } else {
    state.phase = "reply";
    state.feedback = { kind: "right", title: "Right. Keep going.", text: "" };
  }
  render();
  if (!how.dragged) ChessBoard.glide(boardEl, uci, GLIDE_MS.click);
  if (last) return;

  await sleep(REPLY_DELAY_MS);
  if (run !== state.run) return;
  const reply = p.steps[state.step + 1];
  state.step += 2;
  Object.assign(state, { fen: reply.fen, lastMove: reply.uci, legal: p.steps[state.step].legal, phase: "solve" });
  state.feedback = { kind: "right", title: "Right. Keep going.", text: `${opponent()} answered ${reply.san}. Find your next move.` };
  render();
  ChessBoard.glide(boardEl, reply.uci, GLIDE_MS.reply);
}

// Not the move: show it for a moment, say why if Stockfish has a reason, then put it back.
async function wrong(uci, how) {
  const run = state.run;
  const before = { fen: state.fen, lastMove: state.lastMove };
  const fb = { kind: "wrong", title: "Not that one", text: "Try again." };
  Object.assign(state, { helped: true, phase: "wrong", feedback: fb });
  let shown = null;
  try {
    shown = await post("/api/play", { fen: before.fen, moves: [uci] });
  } catch (err) {
    shown = null;
  }
  if (run !== state.run) return;
  if (shown) {
    Object.assign(state, { fen: shown.fen, lastMove: uci });
    fb.text = `${shown.sans[shown.sans.length - 1]} isn't the move.`;
  }
  render();
  if (shown && !how.dragged) ChessBoard.glide(boardEl, uci, GLIDE_MS.click);
  explain(fb, before.fen, uci, run);
  await sleep(WRONG_MS);
  if (run !== state.run) return;
  Object.assign(state, before, { phase: "solve" });
  render();
}

// The problems (/api/rate's problem_theme) worth showing after a wrong move: the ones where
// the move loses something. What it merely misses would give the answer away.
const LOSSES = ["stalemate", "allows-mate", "loses-material", "hanging-piece", "ignored-threat", "discovered-attack", "fork", "pin", "discovered-check", "free-piece", "capture"];

// /api/rate's note on a bad move, cut down for a puzzle: what the move loses, without the
// engine's lines (your own moves in them could be the answer). "" if it loses nothing much.
function lossNote(rating) {
  const text = rating.problem || "";
  if (!LOSSES.includes(rating.problem_theme) || /\b1 point of material/.test(text)) return "";
  return text
    .replace(/\s*\([^)]*\)/g, "") // a line in brackets
    .replace(/: \d+\.[^:]*?(\. Net result:)/, "$1") // "...wins it: 28...Rxe4 29. Kh2. Net result:"
    .replace(/(allows a forced mate in \d+): .*$/, "$1.")
    .replace(/ \u2014 /g, ": ");
}

// Adds to a "not that one" note what the move loses, if it loses anything.
async function explain(fb, fen, uci, run) {
  let rating;
  try {
    rating = await post("/api/rate", { fen, moves: [uci] });
  } catch (err) {
    return;
  }
  if (run !== state.run || state.feedback !== fb) return;
  const answer = state.puzzle.steps[state.step].san.replace(/[+#]/g, "");
  const note = lossNote(rating);
  if (note && !note.includes(answer)) fb.text = note;
  else if (["best", "great", "brilliant", "good", "book"].includes(rating.classification)) fb.text = `${rating.san} isn't bad, but there is something much stronger here.`;
  else fb.text = `${rating.san} lets the chance slip. There is something much stronger here.`;
  render();
}

function giveHint(level) {
  state.hint = level;
  state.helped = true;
  render();
}

// ---------- Drawing ----------

function render() {
  const p = state.puzzle;
  if (!p) return;
  const skill = state.skill;
  const step = p.steps[state.step];
  const solving = state.phase === "solve";
  const last = state.lastMove;
  ChessBoard.render(boardEl, state.fen, {
    flipped: state.flipped,
    highlight: last ? [last.slice(0, 2), last.slice(2, 4)] : [],
    selected: state.selected,
    targets: state.selected ? targetsFrom(state.selected) : [],
    chances: solving && state.hint >= 1 ? [step.uci.slice(0, 2)] : [],
  });
  ChessBoard.drawArrows($("#arrow-layer"), solving && state.hint >= 2 ? [[step.uci, "user"]] : [], state.flipped);
  renderPlayers();

  $("#puzzle-count").textContent = `${skill.name} · ${state.index + 1} of ${skill.puzzles.length}`;
  $("#puzzle-level").textContent = p.difficulty;
  $("#puzzle-title").textContent = skill.goal;
  const you = p.color === "white" ? "White" : "Black";
  $("#puzzle-context").textContent = state.phase !== "setup" && state.step === 0
    ? `You play ${you}. ${opponent()} has just played ${p.setup.san}.`
    : `You play ${you}.`;

  const parts = [];
  const fb = state.feedback;
  if (fb) {
    parts.push(el("div", { class: `box ${fb.kind === "right" ? "better" : "wrong"}` },
      el("h3", {}, fb.title),
      fb.text ? el("p", {}, fb.text) : null));
  }
  if (solving && state.hint === 1) parts.push(el("div", { class: "box" }, el("p", {}, `Hint: move the piece on ${step.uci.slice(0, 2)} (blue ring).`)));
  if (solving && state.hint === 2) parts.push(el("div", { class: "box" }, el("p", {}, `The move is ${step.san} (arrow). Play it on the board.`)));
  const all = progress();
  const t = tally(skill.puzzles.map((q) => q.id), all);
  if (state.phase === "done" && t.solved === t.total) {
    parts.push(el("div", { class: "box" },
      el("h3", {}, "Set complete"),
      el("p", {}, t.clean === t.total
        ? `All ${t.total} solved without help.`
        : `All ${t.total} solved, ${t.clean} of them without help. The rest come up again so you can get them clean.`)));
  }
  $("#puzzle-feedback").replaceChildren(...parts);

  const buttons = [];
  if (state.phase === "done") {
    const next = nextOpen(state.index);
    const again = el("button", { onclick: () => startPuzzle(state.index) }, "Try again");
    if (next === -1) {
      buttons.push(el("button", { class: "primary", onclick: backToList }, "All skills"), again);
    } else if (next === state.index) {
      again.className = "primary";
      buttons.push(again, el("button", { onclick: backToList }, "All skills"));
    } else {
      buttons.push(el("button", { class: "primary", onclick: () => startPuzzle(next) }, "Next puzzle"));
      if (state.helped) buttons.push(again);
    }
  } else {
    const off = solving ? {} : { disabled: "" };
    if (state.hint < 1) buttons.push(el("button", { onclick: () => giveHint(1), ...off }, "Hint"));
    if (state.hint < 2) buttons.push(el("button", { onclick: () => giveHint(2), ...off }, "Show the move"));
    buttons.push(el("button", { onclick: () => startPuzzle((state.index + 1) % skill.puzzles.length) }, "Skip"));
  }
  $("#puzzle-buttons").replaceChildren(...buttons);

  $("#puzzle-dots").replaceChildren(...skill.puzzles.map((q, i) => {
    const status = statusOf(all, q.id);
    const label = `Puzzle ${i + 1}${status === "clean" ? ", solved" : status === "helped" ? ", solved with help" : ""}`;
    return el("button", {
      class: `dot ${status}${i === state.index ? " current" : ""}`,
      title: label,
      "aria-label": label,
      ...(i === state.index ? { "aria-current": "true" } : {}),
      onclick: () => startPuzzle(i),
    }, String(i + 1));
  }));
  $("#puzzle-tips").replaceChildren(...skill.tips.map((tip) => el("li", {}, tip)));
}

function renderPlayers() {
  const mine = state.puzzle.color;
  for (const [id, color] of [["#top-player", mine === "white" ? "black" : "white"], ["#bottom-player", mine]]) {
    const me = color === mine;
    const avatar = el("span", { class: `avatar ${color}`, "aria-hidden": "true" }, me ? "Y" : "O");
    const info = el("div", { class: "pinfo" },
      el("span", { class: "pname" }, me ? `You · ${color}` : `Opponent · ${color}`),
      ChessBoard.capturedRow(state.fen, color));
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

$("#back-to-list").addEventListener("click", backToList);

renderMine();
loadSkills();
