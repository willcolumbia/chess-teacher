"use strict";

const GLYPHS = { k: "♚", q: "♛", r: "♜", b: "♝", n: "♞", p: "♟" };
const BAD = ["inaccuracy", "mistake", "blunder"];
const PLURALS = { inaccuracy: "inaccuracies", mistake: "mistakes", blunder: "blunders" };
const $ = (sel) => document.querySelector(sel);

// pos = i shows the position before move i (with arrows); pos = moves.length shows the final position.
const state = { result: null, pos: 0, flipped: false, myColor: null };

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === "class") node.className = value;
    else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value);
  }
  for (const child of children) {
    if (child != null) node.append(child);
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

// ---------- Input ----------

$("#username").value = store("username") || "";
$("#username").addEventListener("change", (e) => {
  store("username", e.target.value.trim());
  if (state.result) setup(state.result);
});

$("#file").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (file) $("#pgn").value = await file.text();
});

$("#analyze").addEventListener("click", analyze);

function showError(msg) {
  $("#error").textContent = msg;
  $("#error").hidden = !msg;
}

function setProgress(done, total) {
  const pct = total ? Math.round((done / total) * 100) : 0;
  $("#progress .bar").style.width = pct + "%";
  $("#progress .label").textContent = total ? `Analyzing position ${done} of ${total}` : "Starting engine…";
}

async function analyze() {
  showError("");
  const button = $("#analyze");
  button.disabled = true;
  $("#progress").hidden = false;
  setProgress(0, 0);
  try {
    const res = await fetch("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pgn: $("#pgn").value, depth: Number($("#depth").value) }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Analysis failed.");
    const result = await poll(data.job_id);
    setup(result);
  } catch (err) {
    showError(err.message);
  } finally {
    button.disabled = false;
    $("#progress").hidden = true;
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

// ---------- Results ----------

function setup(result) {
  state.result = result;
  const user = (store("username") || "").toLowerCase();
  const h = result.headers;
  state.myColor =
    user && (h.White || "").toLowerCase() === user ? "white"
    : user && (h.Black || "").toLowerCase() === user ? "black"
    : null;
  state.flipped = state.myColor === "black";
  const first = result.moves.findIndex(isMyMistake);
  state.pos = first >= 0 ? first : 0;
  $("#results").hidden = false;
  renderSummary();
  render();
  $("#results").scrollIntoView({ behavior: "smooth", block: "start" });
}

function isMyMistake(m) {
  return BAD.includes(m.classification) && (!state.myColor || m.color === state.myColor);
}

function moveLabel(m) {
  return m.color === "white" ? `${m.move_number}. ${m.san}` : `${m.move_number}...${m.san}`;
}

function playerName(color) {
  const h = state.result.headers;
  const name = color === "white" ? h.White : h.Black;
  const elo = color === "white" ? h.WhiteElo : h.BlackElo;
  return `${color === "white" ? "♔" : "♚"} ${name || color}${elo ? ` (${elo})` : ""}`;
}

function renderSummary() {
  const box = $("#summary");
  box.replaceChildren();
  for (const color of ["white", "black"]) {
    const s = state.result.summary[color];
    const counts = el("div", { class: "counts" });
    for (const label of BAD) {
      counts.append(el("span", {}, el("span", { class: `dot c-${label}` }), `${s.counts[label]} ${s.counts[label] === 1 ? label : PLURALS[label]}`));
    }
    box.append(
      el("div", { class: "side" + (state.myColor === color ? " me" : "") },
        el("div", { class: "name" }, playerName(color) + (state.myColor === color ? " · you" : "")),
        el("div", { class: "acc" }, s.accuracy == null ? "–" : `${s.accuracy}%`),
        el("div", { class: "muted" }, "accuracy"),
        counts)
    );
  }
}

function render() {
  const { moves } = state.result;
  const move = moves[state.pos] || null;
  renderBoard(move ? move.fen_before : state.result.final_fen, move);
  renderEval(move ? move.eval_before : moves[moves.length - 1].eval_after);
  renderDetail(move);
  renderMoveList();

  const top = state.flipped ? "white" : "black";
  $("#top-player").textContent = playerName(top);
  $("#bottom-player").textContent = playerName(top === "white" ? "black" : "white");
  $("#caption").textContent = move
    ? `Position before ${moveLabel(move)}. Red arrow: move played. Green arrow: engine's best move.`
    : `Final position · ${state.result.headers.Result || ""}`;
}

function squareXY(name) {
  const file = name.charCodeAt(0) - 97;
  const rank = Number(name[1]) - 1;
  return state.flipped ? [7 - file + 0.5, rank + 0.5] : [file + 0.5, 7 - rank + 0.5];
}

function renderBoard(fen, move) {
  const rows = fen.split(" ")[0].split("/");
  const grid = []; // grid[rank 7..0][file 0..7]
  for (const row of rows) {
    const cells = [];
    for (const ch of row) {
      if (/\d/.test(ch)) for (let i = 0; i < Number(ch); i++) cells.push(null);
      else cells.push(ch);
    }
    grid.push(cells);
  }
  const highlight = move ? [move.uci.slice(0, 2), move.uci.slice(2, 4)] : [];
  const board = $("#board");
  board.replaceChildren();
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const rank = state.flipped ? r : 7 - r; // 0-based, 0 = rank 1
      const file = state.flipped ? 7 - c : c;
      const name = String.fromCharCode(97 + file) + (rank + 1);
      const piece = grid[7 - rank][file];
      const sq = el("div", { class: `sq ${(rank + file) % 2 ? "light" : "dark"}${highlight.includes(name) ? " hl" : ""}` });
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
  if (!move) return;
  if (move.best_uci !== move.uci) addArrow(layer, move.uci, "played");
  addArrow(layer, move.best_uci, "best");
}

function addArrow(layer, uci, kind) {
  const [x1, y1] = squareXY(uci.slice(0, 2));
  const [x2, y2] = squareXY(uci.slice(2, 4));
  // Stop short so the arrowhead sits inside the target square.
  const len = Math.hypot(x2 - x1, y2 - y1);
  const k = (len - 0.3) / len;
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

function renderDetail(move) {
  const box = $("#detail");
  box.replaceChildren();
  if (!move) {
    box.append(el("h2", {}, "Game over"), el("p", {}, state.result.headers.Termination || state.result.headers.Result || ""));
    return;
  }
  const whose = state.myColor ? (move.color === state.myColor ? "Your move" : "Opponent's move") : `${move.color[0].toUpperCase()}${move.color.slice(1)}'s move`;
  box.append(
    el("h2", {}, moveLabel(move), el("span", { class: `badge c-${move.classification}` }, move.classification)),
    el("p", { class: "muted" }, `${whose} · eval ${move.eval_before.text} → ${move.eval_after.text}`)
  );
  if (move.explanation) {
    box.append(el("p", {}, move.explanation));
  } else if (move.classification === "best") {
    box.append(el("p", {}, "This was the engine's top choice."));
  } else {
    box.append(el("p", {}, `A reasonable move. The engine slightly preferred ${move.best_san}.`));
  }
  if (move.best_san !== move.san && move.best_line) {
    box.append(el("p", { class: "line" }, `Best line: ${move.best_line}`));
  }
}

function renderMoveList() {
  const box = $("#moves");
  box.replaceChildren();
  const { moves } = state.result;

  if ($("#only-mine").checked) {
    const list = moves.map((m, i) => [m, i]).filter(([m]) => isMyMistake(m));
    if (!list.length) box.append(el("p", { class: "empty" }, "No inaccuracies, mistakes or blunders. Nice game!"));
    for (const [m, i] of list) {
      box.append(
        el("button", { class: "mv mistake-item" + (i === state.pos ? " selected" : ""), onclick: () => go(i) },
          moveLabel(m), " ", el("span", { class: `badge c-${m.classification}` }, m.classification),
          el("span", { class: "why" }, `Better: ${m.best_san}`))
      );
    }
    return;
  }

  let row = null;
  moves.forEach((m, i) => {
    if (m.color === "white" || !row) {
      row = el("div", { class: "move-row" }, el("span", { class: "num" }, `${m.move_number}.`));
      if (m.color === "black") row.append(el("span", {}, "…"));
      box.append(row);
    }
    const button = el("button", { class: "mv" + (i === state.pos ? " selected" : ""), onclick: () => go(i) }, m.san);
    if (m.classification !== "best" && m.classification !== "good") {
      button.prepend(el("span", { class: `dot c-${m.classification}`, title: m.classification }));
    }
    row.append(button);
  });
  const selected = box.querySelector(".selected");
  if (selected) selected.scrollIntoView({ block: "nearest" });
}

$("#only-mine").addEventListener("change", renderMoveList);

function go(pos) {
  const n = state.result.moves.length;
  state.pos = Math.max(0, Math.min(n, pos));
  render();
}

function nav(action) {
  if (!state.result) return;
  const { moves } = state.result;
  if (action === "start") go(0);
  else if (action === "prev") go(state.pos - 1);
  else if (action === "next") go(state.pos + 1);
  else if (action === "end") go(moves.length);
  else if (action === "flip") { state.flipped = !state.flipped; render(); }
  else if (action === "mistake") {
    const next = moves.findIndex((m, i) => i > state.pos && isMyMistake(m));
    const wrap = moves.findIndex(isMyMistake);
    if (next >= 0) go(next);
    else if (wrap >= 0) go(wrap);
  }
}

document.querySelectorAll("[data-nav]").forEach((b) => b.addEventListener("click", () => nav(b.dataset.nav)));
document.addEventListener("keydown", (e) => {
  if (e.target instanceof Element && e.target.matches("textarea, input, select")) return;
  const keys = { ArrowLeft: "prev", ArrowRight: "next", Home: "start", End: "end", n: "mistake", f: "flip" };
  if (keys[e.key]) {
    e.preventDefault();
    nav(keys[e.key]);
  }
});
