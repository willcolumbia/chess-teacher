"use strict";

const GLYPHS = { k: "♚", q: "♛", r: "♜", b: "♝", n: "♞", p: "♟" };
const BAD = ["inaccuracy", "mistake", "blunder"];
const PLURALS = { inaccuracy: "inaccuracies", mistake: "mistakes", blunder: "blunders" };
const PATTERNS = {
  "hanging-piece": "Leaving a piece where it can be taken",
  "fork": "Walking into a fork",
  "pin": "Walking into a pin",
  "discovered-check": "Allowing a discovered check",
  "discovered-attack": "Moving a piece that was shielding another",
  "ignored-threat": "Missing the opponent's threat",
  "loses-material": "Losing material in an exchange",
  "allows-mate": "Allowing checkmate",
  "missed-mate": "Missing a checkmate",
  "stalemate": "Stalemating a won position",
  "king-safety": "King safety",
  "development": "Slow development",
  "positional": "Positional slips",
};
const $ = (sel) => document.querySelector(sel);

// step 0 = intro, steps 1..n = moves, step n+1 = summary.
const state = { result: null, step: 0, view: "played", flipped: false, myColor: null };

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

// ---------- Screen 1: input ----------

$("#username").value = store("username") || "";

$("#file").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (file) $("#pgn").value = await file.text();
});

$("#analyze").addEventListener("click", analyze);
$("#new-game").addEventListener("click", () => show("input"));

function showError(msg) {
  $("#error").textContent = msg;
  $("#error").hidden = !msg;
}

// ---------- Screen 2: progress ----------

function setProgress(done, total) {
  const pct = total ? Math.round((done / total) * 100) : 0;
  $("#screen-progress .bar").style.width = pct + "%";
  $("#screen-progress .progress-label").textContent = total
    ? `Position ${done} of ${total}`
    : "Starting the engine…";
}

async function analyze() {
  showError("");
  const pgn = $("#pgn").value.trim();
  if (!pgn) return showError("Paste a PGN first.");
  store("username", $("#username").value.trim());
  setProgress(0, 0);
  show("progress");
  try {
    const res = await fetch("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pgn, depth: Number($("#depth").value) }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Analysis failed.");
    loaded(await poll(data.job_id));
  } catch (err) {
    show("input");
    showError(err.message);
  }
}

async function poll(jobId) {
  for (;;) {
    await new Promise((r) => setTimeout(r, 400));
    const res = await fetch(`/api/jobs/${jobId}`);
    const job = await res.json();
    if (!res.ok) throw new Error(job.error || "Lost track of the analysis.");
    if (job.status === "done") return job.result;
    if (job.status === "error") throw new Error(job.error);
    setProgress(job.progress.done, job.progress.total);
  }
}

// ---------- Screen 3: pick a side ----------

function loaded(result) {
  state.result = result;
  const user = (store("username") || "").toLowerCase();
  const h = result.headers;
  if (user && (h.White || "").toLowerCase() === user) return start("white");
  if (user && (h.Black || "").toLowerCase() === user) return start("black");

  const box = $("#side-buttons");
  box.replaceChildren();
  for (const color of ["white", "black"]) {
    const name = color === "white" ? h.White : h.Black;
    box.append(el("button", {
      class: "primary",
      onclick: () => {
        if (name && name !== "?") {
          store("username", name);
          $("#username").value = name;
        }
        start(color);
      },
    }, `${color === "white" ? "♔ White" : "♚ Black"}${name && name !== "?" ? ` — ${name}` : ""}`));
  }
  show("side");
}

// ---------- Screen 4: walkthrough ----------

function start(color) {
  state.myColor = color;
  state.flipped = color === "black";
  state.step = 0;
  state.view = "played";
  const h = state.result.headers;
  $("#game-title").textContent = `${h.White || "White"} vs ${h.Black || "Black"}`;
  $("#game-sub").textContent = [h.Result, h.Termination, h.Date].filter((x) => x && x !== "?").join(" · ");
  buildTimeline();
  show("walk");
  render();
}

const moves = () => state.result.moves;
const lastStep = () => moves().length + 1;
const isMine = (m) => m.color === state.myColor;
const isMyMistake = (m) => isMine(m) && BAD.includes(m.classification);

function moveLabel(m) {
  return m.color === "white" ? `${m.move_number}. ${m.san}` : `${m.move_number}... ${m.san}`;
}

function playerName(color) {
  const h = state.result.headers;
  const name = color === "white" ? h.White : h.Black;
  const elo = color === "white" ? h.WhiteElo : h.BlackElo;
  const you = color === state.myColor ? " (you)" : "";
  return `${color === "white" ? "♔" : "♚"} ${name || color}${elo ? ` · ${elo}` : ""}${you}`;
}

function buildTimeline() {
  const box = $("#timeline");
  box.replaceChildren();
  moves().forEach((m, i) => {
    const cls = [isMine(m) ? "mine" : "", isMine(m) && BAD.includes(m.classification) ? `t-${m.classification}` : ""];
    box.append(el("button", { class: cls.join(" "), title: `${moveLabel(m)} · ${m.classification}`, onclick: () => go(i + 1) }));
  });
}

function go(step) {
  state.step = Math.max(0, Math.min(lastStep(), step));
  const m = moves()[state.step - 1];
  // Start on the comparison for your own mistakes, otherwise on the move played.
  state.view = m && isMyMistake(m) ? "better" : "played";
  render();
}

function render() {
  const m = moves()[state.step - 1] || null;
  const top = state.flipped ? "white" : "black";
  $("#top-player").textContent = playerName(top);
  $("#bottom-player").textContent = playerName(top === "white" ? "black" : "white");

  [...$("#timeline").children].forEach((b, i) => b.classList.toggle("current", i === state.step - 1));
  $("#counter").textContent =
    state.step === 0 ? "Introduction" : state.step === lastStep() ? "Summary" : `Step ${state.step} of ${moves().length}`;
  $("#prev").disabled = state.step === 0;
  $("#next").disabled = state.step === lastStep();
  $("#next").textContent = state.step === 0 ? "Start ▶" : state.step === lastStep() - 1 ? "Summary ▶" : "Next ▶";

  const hasBetter = m && m.best_uci !== m.uci;
  $("#board-tabs").hidden = !hasBetter;
  for (const tab of document.querySelectorAll("[data-view]")) {
    tab.classList.toggle("active", tab.dataset.view === state.view);
  }

  if (!m) {
    const fen = state.step === 0 ? state.result.start_fen : state.result.final_fen;
    renderBoard(fen, null, null);
    renderEval(state.step === 0 ? moves()[0].eval_before : moves()[moves().length - 1].eval_after);
    $("#caption").textContent = state.step === 0 ? "Starting position" : "Final position";
    renderStep(state.step === 0 ? introCard() : summaryCard());
    return;
  }

  if (state.view === "better" && hasBetter) {
    renderBoard(m.fen_before, [m.uci.slice(0, 2), m.uci.slice(2, 4)], [[m.uci, "played"], [m.best_uci, "best"]]);
    renderEval(m.eval_before);
    $("#caption").textContent = `Position before ${moveLabel(m)}. Red: what was played. Green: the better move, ${m.best_san}.`;
  } else {
    renderBoard(m.fen_after, [m.uci.slice(0, 2), m.uci.slice(2, 4)], []);
    renderEval(m.eval_after);
    $("#caption").textContent = `After ${moveLabel(m)}`;
  }
  renderStep(moveCard(m));
}

function renderStep(nodes) {
  $("#step").replaceChildren(...nodes);
}

// ---------- Step cards ----------

function introCard() {
  const s = state.result.summary[state.myColor];
  const mine = moves().filter(isMyMistake);
  return [
    el("h2", {}, "Let's go through your game"),
    el("p", {}, `You played ${state.myColor === "white" ? "White" : "Black"}. We'll step through all ${moves().length} moves — yours and your opponent's — and look at what each one does, whether it was good, and what was better.`),
    el("div", { class: "stats" },
      el("div", { class: "stat" }, el("div", { class: "big" }, s.accuracy == null ? "–" : `${s.accuracy}%`), el("div", { class: "muted" }, "your accuracy")),
      ...BAD.map((label) => el("div", { class: "stat" },
        el("div", { class: "big" }, String(s.counts[label])),
        el("div", { class: "muted" }, s.counts[label] === 1 ? label : PLURALS[label])))),
    el("p", { class: "callout" }, mine.length
      ? "Your mistakes are marked in color on the timeline above. Press Start to begin from move 1, or n to jump straight to your next mistake."
      : "No inaccuracies, mistakes or blunders from you. Press Start to walk through the game anyway."),
  ];
}

function verdict(m) {
  const yours = isMine(m);
  const whose = yours ? "your" : "their";
  switch (m.classification) {
    case "best":
      return "Best move — exactly what the engine would play.";
    case "good":
      return `Good move. The engine's top choice was ${m.best_san}, but the difference is small.`;
    default:
      return `${m.classification[0].toUpperCase()}${m.classification.slice(1)}: this lowered ${whose} winning chances by ${m.win_drop}%.`;
  }
}

function moveCard(m) {
  const yours = isMine(m);
  const bad = BAD.includes(m.classification);
  const nodes = [
    el("div", { class: "who" },
      el("span", { class: "chip" + (yours ? " you" : "") }, yours ? "Your move" : "Opponent's move"),
      el("span", { class: `badge c-${m.classification}` }, m.classification),
      m.clock != null ? el("span", { class: "muted" }, `⏱ ${formatClock(m.clock)} left`) : null),
    el("div", { class: "san" }, moveLabel(m)),

    el("h3", {}, "What the move does"),
    el("p", {}, m.description),

    el("h3", {}, "Verdict"),
    el("p", {}, verdict(m)),
    el("p", { class: "muted" }, `Evaluation: ${m.eval_before.text} → ${m.eval_after.text} (plus is good for White, minus for Black)`),
  ];

  if (bad && m.explanation) {
    nodes.push(el("h3", {}, "Why it's a problem"), el("p", { class: "callout c-warn" }, m.explanation));
  }

  if (m.best_uci !== m.uci) {
    nodes.push(
      el("h3", {}, yours ? "What you could have played" : "What they should have played"),
      el("p", {}, el("strong", {}, m.best_san), m.best_description ? ` — ${lowerFirst(m.best_description)}` : ""),
      m.best_line ? el("p", { class: "line" }, `Engine line: ${m.best_line}`) : null,
      el("button", { onclick: () => setView(state.view === "better" ? "played" : "better") },
        state.view === "better" ? "Show the move played" : "Show the better move on the board")
    );
  }

  if (m.reply_san) {
    const note = m.reply_note ? ` — ${m.reply_note}` : "";
    if (yours) {
      nodes.push(el("h3", {}, "What to watch for next"), el("p", {}, `Your opponent's best reply is ${m.reply_san}${note}.`));
    } else {
      nodes.push(el("h3", {}, "Your turn"));
      if (bad) nodes.push(el("p", { class: "callout" }, `Your opponent slipped here. The best way to punish it: ${m.reply_san}${note}.`));
      else nodes.push(el("p", {}, `The best reply here is ${m.reply_san}${note}.`));
      if (m.reply_line) nodes.push(el("p", { class: "line" }, `Engine line: ${m.reply_line}`));
    }
  }
  return nodes;
}

function summaryCard() {
  const mine = moves().map((m, i) => [m, i]).filter(([m]) => isMyMistake(m));
  const counts = {};
  for (const [m] of mine) {
    if (moverWin(m) < 10) continue; // already lost; not a pattern worth learning from
    const theme = (m.themes || [])[0];
    if (theme) counts[theme] = (counts[theme] || 0) + 1;
  }
  const patterns = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const you = state.result.summary[state.myColor];
  const them = state.result.summary[state.myColor === "white" ? "black" : "white"];
  return [
    el("h2", {}, "Summary"),
    el("div", { class: "stats" },
      el("div", { class: "stat" }, el("div", { class: "big" }, `${you.accuracy}%`), el("div", { class: "muted" }, "your accuracy")),
      el("div", { class: "stat" }, el("div", { class: "big" }, `${them.accuracy}%`), el("div", { class: "muted" }, "opponent's accuracy"))),
    patterns.length ? el("h3", {}, "Patterns in your mistakes") : null,
    ...patterns.map(([theme, n]) => el("p", {}, `• ${PATTERNS[theme] || theme}${n > 1 ? ` (${n}×)` : ""}`)),
    el("h3", {}, mine.length ? "Review your mistakes again" : "No mistakes from you — well played!"),
    ...mine.map(([m, i]) => el("button", { class: "list-item", onclick: () => go(i + 1) },
      el("span", { class: `badge c-${m.classification}` }, m.classification), " ", moveLabel(m),
      el("span", { class: "sub" }, `Better: ${m.best_san}`))),
  ];
}

function lowerFirst(text) {
  return text[0].toLowerCase() + text.slice(1);
}

// Mover's winning chances before the move, 0-100.
function moverWin(m) {
  return m.color === "white" ? m.eval_before.white_win : 100 - m.eval_before.white_win;
}

function formatClock(seconds) {
  const s = Math.round(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function setView(view) {
  state.view = view;
  render();
}

// ---------- Board ----------

function squareXY(name) {
  const file = name.charCodeAt(0) - 97;
  const rank = Number(name[1]) - 1;
  return state.flipped ? [7 - file + 0.5, rank + 0.5] : [file + 0.5, 7 - rank + 0.5];
}

function renderBoard(fen, highlight, arrows) {
  const grid = fen.split(" ")[0].split("/").map((row) => {
    const cells = [];
    for (const ch of row) {
      if (/\d/.test(ch)) for (let i = 0; i < Number(ch); i++) cells.push(null);
      else cells.push(ch);
    }
    return cells;
  });
  const board = $("#board");
  board.replaceChildren();
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const rank = state.flipped ? r : 7 - r; // 0 = rank 1
      const file = state.flipped ? 7 - c : c;
      const name = String.fromCharCode(97 + file) + (rank + 1);
      const piece = grid[7 - rank][file];
      const sq = el("div", { class: `sq ${(rank + file) % 2 ? "light" : "dark"}${highlight && highlight.includes(name) ? " hl" : ""}` });
      if (piece) {
        const white = piece === piece.toUpperCase();
        sq.append(el("span", { class: `piece ${white ? "w" : "b"}` }, GLYPHS[piece.toLowerCase()] + "︎"));
      }
      if (r === 7) sq.append(el("span", { class: "coord file" }, String.fromCharCode(97 + file)));
      if (c === 0) sq.append(el("span", { class: "coord rank" }, String(rank + 1)));
      board.append(sq);
    }
  }
  const layer = $("#arrow-layer");
  layer.replaceChildren();
  for (const [uci, kind] of arrows || []) addArrow(layer, uci, kind);
}

function addArrow(layer, uci, kind) {
  const [x1, y1] = squareXY(uci.slice(0, 2));
  const [x2, y2] = squareXY(uci.slice(2, 4));
  const len = Math.hypot(x2 - x1, y2 - y1);
  const k = (len - 0.3) / len; // stop short so the arrowhead sits inside the target square
  const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
  line.setAttribute("x1", x1);
  line.setAttribute("y1", y1);
  line.setAttribute("x2", x1 + (x2 - x1) * k);
  line.setAttribute("y2", y1 + (y2 - y1) * k);
  line.setAttribute("class", `arrow-${kind}`);
  line.setAttribute("marker-end", `url(#head-${kind})`);
  layer.append(line);
}

function renderEval(ev) {
  const bar = $(".evalbar");
  bar.classList.toggle("flipped", state.flipped);
  bar.querySelector(".white-fill").style.height = ev.white_win + "%";
  bar.querySelector(".eval-text").textContent = ev.text;
}

// ---------- Navigation ----------

function nextMistake() {
  const list = moves();
  const after = list.findIndex((m, i) => i + 1 > state.step && isMyMistake(m));
  const first = list.findIndex(isMyMistake);
  const target = after >= 0 ? after : first;
  if (target >= 0) go(target + 1);
}

$("#prev").addEventListener("click", () => go(state.step - 1));
$("#next").addEventListener("click", () => go(state.step + 1));
document.querySelectorAll("[data-view]").forEach((b) => b.addEventListener("click", () => setView(b.dataset.view)));

document.addEventListener("keydown", (e) => {
  if ($("#screen-walk").hidden) return;
  if (e.target instanceof Element && e.target.matches("textarea, input, select")) return;
  const actions = {
    ArrowLeft: () => go(state.step - 1),
    ArrowRight: () => go(state.step + 1),
    Home: () => go(0),
    End: () => go(lastStep()),
    n: nextMistake,
    b: () => setView(state.view === "better" ? "played" : "better"),
    f: () => { state.flipped = !state.flipped; render(); },
  };
  if (actions[e.key]) {
    e.preventDefault();
    actions[e.key]();
  }
});
