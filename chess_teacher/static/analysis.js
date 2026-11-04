"use strict";

const BAD = ["inaccuracy", "mistake", "miss", "blunder"];
const NOTABLE = ["brilliant", "great", ...BAD]; // marked in the timeline and move list
const TABLE_CLASSES = ["book", "brilliant", "great", "best", "good", "inaccuracy", "mistake", "miss", "blunder"];
const PLURALS = { inaccuracy: "inaccuracies", mistake: "mistakes", miss: "misses", blunder: "blunders" };
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
  "missed-capture": "Missing a free capture",
  "stalemate": "Stalemating a won position",
  "king-safety": "King safety",
  "development": "Slow development",
  "positional": "Positional slips",
};
const $ = (sel) => document.querySelector(sel);

// step 0 = intro, steps 1..n = moves, step n+1 = summary.
const state = { result: null, step: 0, view: "played", flipped: false, myColor: null };
// "Show best move": the arrow appears first, then the move is played on the board.
const bestMove = { played: false, timer: null };
const BEST_MOVE_DELAY_MS = 900;
// "Show why" playback: idea.index = null (off) or 0..line length; 0 is the starting position.
const idea = { index: null, timer: null, kind: null };
const IDEA_DELAY_MS = 1600;
const GLIDE_MS = 300; // how long a piece takes to slide to its square when stepping forward

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

// Two tabs: your Chess.com games, or a PGN pasted / uploaded. The last one used is remembered.
function selectTab(tab) {
  for (const b of document.querySelectorAll("[data-tab]")) {
    const on = b.dataset.tab === tab;
    b.setAttribute("aria-selected", String(on));
    b.tabIndex = on ? 0 : -1;
    $(`#panel-${b.dataset.tab}`).hidden = !on;
  }
  store("analysisTab", tab);
}
document.querySelectorAll("[data-tab]").forEach((b) => b.addEventListener("click", () => selectTab(b.dataset.tab)));
selectTab(store("analysisTab") === "pgn" ? "pgn" : "chesscom");

// Analysis depth (Stockfish's search depth per move), remembered too.
const depthChoice = () => Number((document.querySelector('input[name="depth"]:checked') || {}).value || 16);
{
  const saved = document.querySelector(`input[name="depth"][value="${store("depth")}"]`);
  if (saved) saved.checked = true;
  document.querySelectorAll('input[name="depth"]').forEach((r) => r.addEventListener("change", () => store("depth", r.value)));
}

// A game handed over from the home page ("Analyze this game").
try {
  const handed = sessionStorage.getItem("pendingPgn");
  if (handed) {
    $("#pgn").value = handed;
    sessionStorage.removeItem("pendingPgn");
    selectTab("pgn");
  }
} catch (e) {
  // storage unavailable; the user can paste the PGN instead
}

async function loadFile(file) {
  if (file) $("#pgn").value = await file.text();
}
$("#file").addEventListener("change", (e) => loadFile(e.target.files[0]));

// Drag a .pgn file onto the drop area.
const dropzone = $("#dropzone");
for (const type of ["dragenter", "dragover"]) {
  dropzone.addEventListener(type, (e) => {
    e.preventDefault();
    dropzone.classList.add("over");
  });
}
for (const type of ["dragleave", "drop"]) dropzone.addEventListener(type, () => dropzone.classList.remove("over"));
dropzone.addEventListener("drop", (e) => {
  e.preventDefault();
  loadFile(e.dataTransfer && e.dataTransfer.files[0]);
});

$("#clear-pgn").addEventListener("click", () => {
  $("#pgn").value = "";
  $("#file").value = ""; // so loading the same file again still works
  showError("");
  $("#pgn").focus();
});

$("#analyze").addEventListener("click", analyze);

// ---------- Recent Chess.com games ----------

const RECENT_REFRESH_MS = 60000; // re-check for new games while this screen is open
const RECENT_SHOWN = 10;
let latestGameEnd = 0;

function ago(seconds) {
  const s = Math.max(0, Date.now() / 1000 - seconds);
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}

function gameRow(game, lastSeen) {
  const mark = { win: "W", loss: "L", draw: "D" }[game.outcome];
  const side = game.color === "white" ? "White" : "Black";
  const timeClass = game.time_class ? game.time_class[0].toUpperCase() + game.time_class.slice(1) : "";
  const king = el("img", { src: `/static/pieces/${game.color === "white" ? "w" : "b"}K.svg`, alt: "" });
  return el("button", {
    class: "recent-game",
    title: "Analyze this game",
    onclick: () => {
      store("recentSeen", String(latestGameEnd)); // games up to now are no longer "New"
      $("#pgn").value = game.pgn;
      analyze();
    },
  },
    el("span", { class: `outcome o-${game.outcome}`, "aria-label": game.outcome }, mark),
    el("span", { class: "game-info" },
      el("span", { class: "who" }, `vs ${game.opponent}`, game.opponent_rating ? el("span", { class: "muted" }, ` (${game.opponent_rating})`) : null),
      el("span", { class: "meta" }, king, [side, timeClass, ago(game.end_time)].filter(Boolean).join(" · "))),
    game.end_time > lastSeen ? el("span", { class: "chip you" }, "New") : el("span"),
    el("span", { class: "go" }, "Analyze ›"));
}

async function loadRecent() {
  const box = $("#recent");
  const user = $("#username").value.trim();
  if (!user) {
    box.replaceChildren(el("p", { class: "muted small" }, "Enter your Chess.com username to see your latest games here."));
    return;
  }
  try {
    const res = await fetch(`/api/chesscom/${encodeURIComponent(user)}`);
    const games = await res.json();
    if (!res.ok) throw new Error(games.error || "Couldn't load your games.");
    const lastSeen = Number(store("recentSeen") || 0);
    box.replaceChildren(...(games.length
      ? games.slice(0, RECENT_SHOWN).map((g) => gameRow(g, lastSeen))
      : [el("p", { class: "muted small" }, "No games in the last two months.")]));
    if (games.length) latestGameEnd = games[0].end_time;
  } catch (err) {
    box.replaceChildren(el("p", { class: "error" }, err.message));
  }
}

function showGames() {
  store("username", $("#username").value.trim());
  loadRecent();
}
$("#username").addEventListener("change", showGames);
$("#username").addEventListener("keydown", (e) => e.key === "Enter" && showGames());
$("#show-games").addEventListener("click", showGames);
loadRecent();
setInterval(() => {
  if (!$("#screen-input").hidden) loadRecent();
}, RECENT_REFRESH_MS);
$("#new-game").addEventListener("click", () => show("input"));
$("#next-mistake").addEventListener("click", () => nextMistake());

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
      body: JSON.stringify({ pgn, depth: depthChoice() }),
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
  const opening = state.result.opening ? `${state.result.opening.eco} · ${state.result.opening.name}` : null;
  const result = [h.Result, h.Termination].filter((x) => x && x !== "?" && x !== "*").join(" · ");
  $("#game-sub").replaceChildren(...[timeControl(h.TimeControl), opening, result, h.Date]
    .filter((x) => x && x !== "?" && !x.startsWith("????"))
    .map((x) => el("span", { class: "chip" }, x)));
  buildTimeline();
  buildMoveList();
  buildReport();
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

// "180+2" → "3+2"; "600" → "10 min"
function timeControl(tc) {
  const match = /^(\d+)(?:\+(\d+))?$/.exec(tc || "");
  if (!match) return null;
  const minutes = Number(match[1]) / 60;
  const base = Number.isInteger(minutes) ? String(minutes) : minutes.toFixed(1);
  return match[2] != null ? `${base}+${match[2]}` : `${base} min`;
}

function buildTimeline() {
  const box = $("#timeline");
  box.replaceChildren();
  moves().forEach((m, i) => {
    const cls = [isMine(m) ? "mine" : "", isMine(m) && NOTABLE.includes(m.classification) ? `t-${m.classification}` : ""];
    box.append(el("button", { class: cls.join(" "), title: `${moveLabel(m)} · ${m.classification}`, onclick: () => go(i + 1) }));
  });
}

// Every move in two columns; the ones worth a look carry their icon.
function buildMoveList() {
  const box = $("#move-list");
  box.replaceChildren();
  moves().forEach((m, i) => {
    if (m.color === "white" || i === 0) box.append(el("span", { class: "n" }, `${m.move_number}.`));
    if (i === 0 && m.color === "black") box.append(el("span", {}, "…"));
    box.append(el("button", { onclick: () => go(i + 1), title: ChessBoard.LABELS[m.classification] || "" },
      m.san, NOTABLE.includes(m.classification) ? ChessBoard.icon(m.classification) : null));
  });
}

// Accuracy and how many moves of each kind, both players side by side.
function buildReport() {
  const h = state.result.headers;
  const sides = state.myColor === "black" ? ["black", "white"] : ["white", "black"];
  const name = (color) => (color === "white" ? h.White : h.Black) || color;
  const summary = state.result.summary;
  $("#report").replaceChildren(
    el("div", { class: "acc-tiles" }, ...sides.map((color) =>
      el("div", { class: `acc-tile ${color}` },
        el("span", {}, `${name(color)}${color === state.myColor ? " (you)" : ""}`),
        el("strong", {}, summary[color].accuracy == null ? "–" : String(summary[color].accuracy))))),
    el("table", { class: "counts" },
      el("thead", {}, el("tr", {}, el("th", {}), el("th", {}), ...sides.map((color) => el("th", { title: name(color) }, color === state.myColor ? "You" : "Them")))),
      el("tbody", {}, ...TABLE_CLASSES.map((c) => el("tr", {},
        el("td", {}, ChessBoard.icon(c)),
        el("td", {}, ChessBoard.LABELS[c]),
        ...sides.map((color, k) => el("td", { class: k ? "num them" : "num" }, String(summary[color].counts[c] || 0))))))),
    el("p", { class: "muted small", style: "margin: 10px 0 0" }, comparisonNote()));
}

function go(step) {
  const forward = step === state.step + 1;
  stopIdea();
  idea.index = null;
  state.step = Math.max(0, Math.min(lastStep(), step));
  state.view = "played"; // the best move shows only when asked for
  resetBestMove();
  render();
  const m = moves()[state.step - 1];
  if (forward && m) glideMove(m.uci); // one move ahead: slide the piece over, like on the Play page
}

// Slide the piece that just moved along `uci`; call right after render().
function glideMove(uci) {
  ChessBoard.glide($("#board"), uci, GLIDE_MS);
}

function render() {
  const m = moves()[state.step - 1] || null;

  [...$("#timeline").children].forEach((b, i) => b.classList.toggle("current", i === state.step - 1));
  markMoveList();
  $("#counter").textContent =
    state.step === 0 ? "Introduction" : state.step === lastStep() ? "Summary" : `Step ${state.step} of ${moves().length}`;
  $("#prev").disabled = state.step === 0;
  $("#next").disabled = state.step === lastStep();
  $("#next").textContent = state.step === 0 ? "Start ▶" : state.step === lastStep() - 1 ? "Summary ▶" : "Next ▶";

  const hasBetter = m && m.best_uci !== m.uci;
  const showingIdea = m && idea.index !== null;
  $("#idea-controls").hidden = !showingIdea;

  if (!m) {
    const fen = state.step === 0 ? state.result.start_fen : state.result.final_fen;
    renderBoard(fen, null, null);
    renderEval(state.step === 0 ? moves()[0].eval_before : moves()[moves().length - 1].eval_after);
    $("#caption").textContent = state.step === 0 ? "Starting position" : "Final position";
    renderStep(state.step === 0 ? introCard() : summaryCard());
    return;
  }

  if (showingIdea) {
    renderIdea(m);
  } else if (state.view === "better" && hasBetter) {
    // "Show best move": the green arrow on the position before the move, then the move played.
    const best = (m.best_line_moves || [])[0];
    if (bestMove.played && best) {
      const squares = [m.best_uci.slice(0, 2), m.best_uci.slice(2, 4)];
      renderBoard(best.fen, squares, [[m.best_uci, "best"]], { square: squares[1], classification: "best" });
      $("#caption").textContent = `Best move played: ${best.label}. ${best.description}`;
    } else {
      renderBoard(m.fen_before, null, [[m.best_uci, "best"]]);
      $("#caption").textContent = `Position before ${moveLabel(m)}. Green: the engine's best move, ${m.best_san}.`;
    }
    renderEval(m.eval_before);
  } else {
    // The move as played (yellow). The best move only shows after "Show best move".
    renderBoard(m.fen_after, [m.uci.slice(0, 2), m.uci.slice(2, 4)], [[m.uci, "last"]], moveIcon(m));
    renderEval(m.eval_after);
    $("#caption").textContent = hasBetter
      ? `Yellow: ${moveLabel(m)} as played. Click "Show best move" to see the engine's choice.`
      : `Yellow: ${moveLabel(m)} as played — the engine's best move.`;
  }
  renderStep(moveCard(m));
}

// Highlight the current move in the move list and scroll the list (not the page) to it.
function markMoveList() {
  const list = $("#move-list");
  let current = null;
  list.querySelectorAll("button").forEach((b, i) => {
    b.classList.toggle("current", i === state.step - 1);
    if (i === state.step - 1) current = b;
  });
  if (!current) return;
  const top = current.offsetTop;
  if (top < list.scrollTop || top + current.offsetHeight > list.scrollTop + list.clientHeight) {
    list.scrollTop = top - list.clientHeight / 2;
  }
}

function renderStep(nodes) {
  $("#step").replaceChildren(...nodes);
}

// ---------- Step cards ----------

function introCard() {
  const mine = moves().filter(isMyMistake);
  return [
    el("h2", {}, "Let's go through your game"),
    el("p", {}, `You played ${state.myColor === "white" ? "White" : "Black"}. We'll step through all ${moves().length} moves — yours and your opponent's — and look at what each one does, whether it was good, and what was better.`),
    ...playersBlock(),
    el("p", { class: "callout" }, mine.length
      ? "Your mistakes are marked in color on the timeline above. Press Start to begin from move 1, or n to jump straight to your next mistake."
      : "No inaccuracies, mistakes or blunders from you. Press Start to walk through the game anyway."),
  ];
}

// ---------- Ratings vs accuracy ----------

function rating(color) {
  const value = parseInt(state.result.headers[color === "white" ? "WhiteElo" : "BlackElo"], 10);
  return Number.isFinite(value) ? value : null;
}

const seriousErrors = (s) => s.counts.mistake + s.counts.blunder;

function playersBlock() {
  const rows = ["white", "black"].map((color) => {
    const s = state.result.summary[color];
    const h = state.result.headers;
    const name = (color === "white" ? h.White : h.Black) || color;
    return el("tr", { class: color === state.myColor ? "me" : "" },
      el("td", {}, `${color === "white" ? "♔" : "♚"} ${name}${color === state.myColor ? " (you)" : ""}`),
      el("td", {}, rating(color) == null ? "–" : String(rating(color))),
      el("td", {}, s.accuracy == null ? "–" : `${s.accuracy}%`),
      ...TABLE_CLASSES.map((label) => el("td", {}, String(s.counts[label] || 0))));
  });
  const table = el("table", { class: "players" },
    el("thead", {}, el("tr", {},
      ...["Player", "Rating", "Accuracy"].map((x) => el("th", {}, x)),
      ...TABLE_CLASSES.map((c) => el("th", { title: ChessBoard.LABELS[c] }, ChessBoard.icon(c))))),
    el("tbody", {}, ...rows));
  return [
    el("div", { class: "table-wrap" }, table),
    el("p", { class: "muted small" }, "Accuracy uses the Lichess method: moves in sharp positions and big mistakes count more than quiet moves."),
    el("p", {}, comparisonNote()),
  ];
}

function comparisonNote() {
  const me = state.myColor;
  const opp = me === "white" ? "black" : "white";
  const ys = state.result.summary[me];
  const os = state.result.summary[opp];
  if (ys.accuracy == null || os.accuracy == null) return "";
  const gap = ys.accuracy - os.accuracy;
  const level = Math.abs(gap) < 3 ? 0 : Math.sign(gap); // 1: you played better, -1: they did
  const detail = `${ys.accuracy}% vs ${os.accuracy}% accuracy, ${seriousErrors(ys)} vs ${seriousErrors(os)} mistakes and blunders`;
  let note = level === 0
    ? `You and your opponent played at about the same level (${detail}).`
    : level > 0 ? `You outplayed your opponent (${detail}).` : `Your opponent played better this game (${detail}).`;

  const mine = rating(me);
  const theirs = rating(opp);
  if (mine == null || theirs == null) return note;
  const diff = mine - theirs;
  if (diff <= -50) {
    note += level >= 0
      ? ` They're rated ${-diff} points higher, so you played above your rating.`
      : ` They're rated ${-diff} points higher, so that's about what you'd expect.`;
  } else if (diff >= 50) {
    note += level > 0
      ? ` You're rated ${diff} points higher, so that's about what you'd expect.`
      : ` You're rated ${diff} points higher, so you played below your rating.`;
  } else {
    note += ` Your ratings are close (${mine} vs ${theirs}), so ${
      level > 0 ? "this was a strong game for you" : level < 0 ? "there's room to catch up" : "an even game is what you'd expect"}.`;
  }
  return note;
}

const moveIcon = (m) => ({ square: m.uci.slice(2, 4), classification: m.classification });

// Icon plus label, e.g. [??] Blunder
function classBadge(classification) {
  return el("span", { class: `with-icon class-label t-${classification}` },
    ChessBoard.icon(classification), ChessBoard.LABELS[classification] || classification);
}

function verdict(m) {
  const yours = isMine(m);
  const whose = yours ? "your" : "their";
  switch (m.classification) {
    case "book":
      return `Book move — standard opening theory${state.result.opening ? ` (${state.result.opening.name})` : ""}.`;
    case "brilliant":
      return "Brilliant! A sacrifice that works: it gives up material, and it's still the engine's best move.";
    case "great":
      return "Great move — the only move that keeps the position together. Every alternative was clearly worse.";
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
  const hasBetter = m.best_uci !== m.uci;
  const nodes = [
    el("div", { class: "who" },
      el("span", { class: "chip" + (yours ? " you" : "") }, yours ? "Your move" : "Opponent's move"),
      classBadge(m.classification)),
    el("div", { class: "san-row" },
      el("div", { class: "san" }, moveLabel(m)),
      hasBetter
        ? el("div", { class: "row" },
            el("button", { onclick: () => setView(state.view === "better" ? "played" : "better") },
              state.view === "better" ? "Show move played" : "Show best move"),
            ideaButton(m, "better"))
        : null),
    el("p", {}, m.description),
    el("p", {}, verdict(m)),
    el("div", { class: "stats" },
      stat("Move accuracy", `${Math.round(m.accuracy)}%`),
      stat("Evaluation", `${m.eval_before.text} → ${m.eval_after.text}`, "Plus is good for White, minus for Black"),
      stat(yours ? "Your win chance" : "Their win chance", `${Math.round(moverWin(m))}% → ${Math.round(moverWinAfter(m))}%`)),
  ];

  if (bad && (m.problem || m.explanation)) {
    nodes.push(el("div", { class: "box wrong" },
      el("h3", {}, "Why it's a problem"),
      el("p", {}, m.problem || m.explanation),
      ideaSection(m, yours, "punish")));
  }

  if (hasBetter) {
    nodes.push(el("div", { class: "box better" },
      el("h3", {}, yours ? `What you could have played: ${m.best_san}` : `What they should have played: ${m.best_san}`),
      m.best_description ? el("p", {}, m.best_description) : null,
      m.best_line ? el("p", { class: "line" }, m.best_line) : null,
      ideaSection(m, yours, "better", false)));
  }

  if (m.reply_san) {
    const note = m.reply_note ? ` — ${m.reply_note}` : "";
    if (yours) {
      nodes.push(el("h3", {}, "What to watch for next"), el("p", {}, `Your opponent's best reply is ${m.reply_san}${note}.`));
    } else {
      nodes.push(el("h3", {}, "Your turn"));
      if (bad) nodes.push(el("p", { class: "callout" }, `Your opponent slipped here. The best way to punish it: ${m.reply_san}${note}.`));
      else nodes.push(el("p", {}, `The best reply here is ${m.reply_san}${note}.`));
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
  return [
    el("h2", {}, "Summary"),
    ...playersBlock(),
    patterns.length ? el("h3", {}, "Patterns in your mistakes") : null,
    ...patterns.map(([theme, n]) => el("p", {}, `• ${PATTERNS[theme] || theme}${n > 1 ? ` (${n}×)` : ""}`)),
    el("h3", {}, mine.length ? "Review your mistakes again" : "No mistakes from you — well played!"),
    ...mine.map(([m, i]) => el("button", { class: "list-item", onclick: () => go(i + 1) },
      classBadge(m.classification), " ", moveLabel(m),
      el("span", { class: "sub" }, `Better: ${m.best_san}`))),
  ];
}

// Mover's winning chances before the move, 0-100.
function moverWin(m) {
  return m.color === "white" ? m.eval_before.white_win : 100 - m.eval_before.white_win;
}

// ...and after it.
function moverWinAfter(m) {
  return m.color === "white" ? m.eval_after.white_win : 100 - m.eval_after.white_win;
}

function stat(label, value, title) {
  return el("div", { class: "stat", ...(title ? { title } : {}) }, el("span", {}, label), el("strong", {}, value));
}

function formatClock(seconds) {
  const s = Math.round(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function setView(view) {
  stopIdea();
  idea.index = null;
  state.view = view;
  resetBestMove();
  if (view === "better") {
    bestMove.timer = setTimeout(() => {
      bestMove.played = true;
      render();
      const m = moves()[state.step - 1];
      if (m) glideMove(m.best_uci);
    }, BEST_MOVE_DELAY_MS);
  }
  render();
}

function resetBestMove() {
  clearTimeout(bestMove.timer);
  bestMove.timer = null;
  bestMove.played = false;
}

// ---------- "Show why": play out a line on the board ----------
// Two kinds of line:
//   "better": the engine's best move and what follows it.
//   "punish": the move actually played and how the engine expects the game to go from there.

const IDEA_KINDS = {
  better: {
    moves: (m) => m.best_line_moves || [],
    eval: (m) => m.eval_before,
    arrow: (m, ply) => (ply.color === m.color ? "best" : "reply"),
    button: (m) => `▶ Show why ${m.best_san} is better`,
    intro: (m) => `The idea behind ${m.best_san}. Press ▶ to play it out.`,
    outro: (m) => `That's the idea: after ${m.best_san} and this line, the engine rates the position ${m.eval_before.text}, compared with ${m.eval_after.text} after the move that was played (${m.san}).`,
  },
  punish: {
    moves: (m) => m.punish_line_moves || [],
    eval: (m) => m.eval_after,
    arrow: (m, ply, i) => (i === 0 ? "played" : ply.color === m.color ? "neutral" : "reply"),
    button: (m) => (isMine(m) ? `▶ Show why ${m.san} is a ${m.classification}` : `▶ Show how to punish ${m.san}`),
    intro: (m) => `What happens after ${m.san}? Press ▶ to see how the game could go.`,
    outro: (m) => `After ${m.san} and this line, the engine rates the position ${m.eval_after.text}. With ${m.best_san} instead it would have been ${m.eval_before.text}.`,
  },
};

function ideaLine(m) {
  return idea.kind ? IDEA_KINDS[idea.kind].moves(m) : [];
}

// The button that starts (or closes) a playback; null when there's no line to play.
function ideaButton(m, kind) {
  const spec = IDEA_KINDS[kind];
  if (!spec.moves(m).length) return null;
  return idea.index !== null && idea.kind === kind
    ? el("button", { onclick: closeIdea }, "✕ Close")
    : el("button", { class: kind === "punish" ? "warn" : "primary", onclick: () => startIdea(kind) }, spec.button(m));
}

// The playback's move chips and closing note, shown while it is open.
// withButton: also include the start/close button (the "better" one lives next to the move name).
function ideaSection(m, yours, kind, withButton = true) {
  const spec = IDEA_KINDS[kind];
  const line = spec.moves(m);
  const active = idea.index !== null && idea.kind === kind;
  const box = el("div", { class: "idea" });
  const button = withButton ? ideaButton(m, kind) : null;
  if (button) box.append(el("div", { class: "row" }, button));

  if (active) {
    const list = el("ol", { class: "idea-list" });
    line.forEach((ply, i) => {
      const mover = ply.color === m.color ? (yours ? "You" : "Opponent") : (yours ? "Opponent" : "You");
      const tag = kind === "punish" && i === 0 ? ` · ${m.classification}` : "";
      list.append(el("li", { class: i + 1 === idea.index ? "current" : i + 1 < idea.index ? "done" : "" },
        el("button", { class: "idea-move", onclick: () => { pauseIdea(); idea.index = i + 1; render(); } },
          el("strong", {}, ply.label), el("span", { class: "muted" }, ` · ${mover}${tag}`))));
    });
    box.append(list);
    if (idea.index === line.length) {
      box.append(el("p", { class: "callout" }, `${spec.outro(m)} Plus is good for White, minus for Black.`));
    }
  }
  return box;
}

function renderIdea(m) {
  const spec = IDEA_KINDS[idea.kind];
  const line = spec.moves(m);
  const i = idea.index;
  if (i === 0) {
    renderBoard(m.fen_before, null, [[line[0].uci, spec.arrow(m, line[0], 0)]]);
    $("#caption").textContent = spec.intro(m);
  } else {
    const ply = line[i - 1];
    // In the mistake playback, the first move is the one that was played: mark it.
    const mark = idea.kind === "punish" && i === 1 ? moveIcon(m) : null;
    renderBoard(ply.fen, [ply.uci.slice(0, 2), ply.uci.slice(2, 4)], [[ply.uci, spec.arrow(m, ply, i - 1)]], mark);
    $("#caption").textContent = `${i} of ${line.length}: ${ply.label} — ${ply.description}`;
  }
  renderEval(spec.eval(m));
  $("#idea-play").textContent = idea.timer ? "⏸" : "▶";
  $("#idea-prev").disabled = i === 0;
  $("#idea-next").disabled = i === line.length;
}

function startIdea(kind) {
  const m = moves()[state.step - 1];
  if (!m || !IDEA_KINDS[kind].moves(m).length) return;
  idea.kind = kind;
  idea.index = 0;
  playIdea();
}

function playIdea() {
  const m = moves()[state.step - 1];
  const length = m ? ideaLine(m).length : 0;
  if (!length) return;
  if (idea.index === null || idea.index >= length) idea.index = 0;
  stopIdea();
  idea.timer = setInterval(() => {
    idea.index += 1;
    if (idea.index >= length) stopIdea();
    render();
    glideIdea(m);
  }, IDEA_DELAY_MS);
  render();
}

// Slide the playback's latest move in.
function glideIdea(m) {
  const ply = ideaLine(m)[idea.index - 1];
  if (ply) glideMove(ply.uci);
}

function stopIdea() {
  clearInterval(idea.timer);
  idea.timer = null;
}

function pauseIdea() {
  stopIdea();
  render();
}

function stepIdea(delta) {
  const m = moves()[state.step - 1];
  stopIdea();
  const before = idea.index;
  idea.index = Math.max(0, Math.min(ideaLine(m).length, idea.index + delta));
  render();
  if (idea.index === before + 1) glideIdea(m);
}

function closeIdea() {
  stopIdea();
  idea.index = null;
  render();
}

// ---------- Board ----------

function renderBoard(fen, highlight, arrows, icon = null) {
  ChessBoard.render($("#board"), fen, { flipped: state.flipped, highlight: highlight || [], icon });
  renderPlayers(fen);
  ChessBoard.drawArrows($("#arrow-layer"), arrows || [], state.flipped);
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
$("#idea-start").addEventListener("click", () => stepIdea(-99));
$("#idea-prev").addEventListener("click", () => stepIdea(-1));
$("#idea-play").addEventListener("click", () => (idea.timer ? pauseIdea() : playIdea()));
$("#idea-next").addEventListener("click", () => stepIdea(1));
$("#idea-close").addEventListener("click", closeIdea);
$("#next").addEventListener("click", () => go(state.step + 1));

document.addEventListener("keydown", (e) => {
  if ($("#screen-walk").hidden) return;
  if (e.target instanceof Element && e.target.matches("textarea, input, select")) return;
  if (idea.index !== null) {
    const ideaKeys = {
      ArrowLeft: () => stepIdea(-1),
      ArrowRight: () => stepIdea(1),
      " ": () => (idea.timer ? pauseIdea() : playIdea()),
      Escape: closeIdea,
    };
    if (ideaKeys[e.key]) {
      e.preventDefault();
      ideaKeys[e.key]();
      return;
    }
  }
  const actions = {
    w: () => startIdea("better"),
    x: () => startIdea("punish"),
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

// The move panel is exactly as tall as the board column, whatever the move says.
// Player names above and below the board, each with the pieces they've captured in `fen`.
function renderPlayers(fen) {
  const top = state.flipped ? "white" : "black";
  const bottom = top === "white" ? "black" : "white";
  const h = state.result.headers;
  for (const [id, color] of [["#top-player", top], ["#bottom-player", bottom]]) {
    const name = (color === "white" ? h.White : h.Black) || (color === "white" ? "White" : "Black");
    const elo = color === "white" ? h.WhiteElo : h.BlackElo;
    const extra = [elo && elo !== "?" ? `(${elo})` : null, color === state.myColor ? "you" : null].filter(Boolean).join(" · ");
    const clock = clockAt(color);
    $(id).replaceChildren(
      el("span", { class: `avatar ${color}`, "aria-hidden": "true" }, name[0].toUpperCase()),
      el("div", { class: "pinfo" },
        el("span", { class: "pname" }, name, extra ? el("span", { class: "muted" }, ` ${extra}`) : null),
        ChessBoard.capturedRow(fen, color)),
      clock != null ? el("span", { class: `clock ${color}`, title: "Time left" }, formatClock(clock)) : null);
  }
  syncPanelHeight();
}

// `color`'s clock after the moves up to the current step: their last recorded time, else the starting time.
function clockAt(color) {
  const played = moves().slice(0, state.step === lastStep() ? moves().length : state.step);
  for (let i = played.length - 1; i >= 0; i--) {
    if (played[i].color === color && played[i].clock != null) return played[i].clock;
  }
  if (!moves().some((m) => m.clock != null)) return null;
  const base = /^(\d+)/.exec(state.result.headers.TimeControl || "");
  return base ? Number(base[1]) : null;
}

// The move panel lines up with the board itself: same top edge, same height.
function syncPanelHeight() {
  const step = $("#step");
  if (window.matchMedia("(max-width: 860px)").matches) {
    step.style.height = step.style.marginTop = "";
    return;
  }
  const board = $("#board").getBoundingClientRect();
  const column = $(".board-col").getBoundingClientRect();
  step.style.marginTop = `${board.top - column.top}px`;
  step.style.height = `${board.height}px`;
}
if (window.ResizeObserver) new ResizeObserver(syncPanelHeight).observe($("#board"));
window.addEventListener("resize", syncPanelHeight);
