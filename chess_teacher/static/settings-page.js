"use strict";

// The Settings page: each control saves through ChessSettings (settings.js), and a small board shows the result.

const $ = (sel) => document.querySelector(sel);
const boardEl = $("#board");

// A position from the Italian Game; the preview plays 3. Bc4 and marks it as the best move.
const BEFORE = "r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3";
const AFTER = "r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R b KQkq - 3 3";
const MOVE = "f1c4";
const GLIDE_MS = 330; // same as Stockfish's moves on the Play page

function swatch(key, name, colors, group) {
  const button = document.createElement("button");
  button.className = "swatch";
  button.dataset[group] = key;
  const chip = document.createElement("span");
  chip.className = `swatch-chip ${group}-chip`;
  chip.setAttribute("aria-hidden", "true");
  for (const color of colors) {
    const part = document.createElement("span");
    part.style.background = color;
    chip.append(part);
  }
  button.append(chip, name);
  button.addEventListener("click", () => update({ [group]: key }));
  return button;
}

function build() {
  const { ACCENTS, BOARDS } = ChessSettings;
  $("#accents").replaceChildren(...Object.entries(ACCENTS).map(([key, a]) => swatch(key, a.name, [a.color], "accent")));
  $("#boards").replaceChildren(...Object.entries(BOARDS).map(([key, b]) => swatch(key, b.name, [b.light, b.dark, b.dark, b.light], "board")));
  document.querySelectorAll("[data-theme-choice]").forEach((b) => b.addEventListener("click", () => update({ theme: b.dataset.themeChoice })));
  document.querySelectorAll("[data-coords-choice]").forEach((b) => b.addEventListener("click", () => update({ coords: b.dataset.coordsChoice === "on" })));
  document.querySelectorAll("[data-motion-choice]").forEach((b) =>
    b.addEventListener("click", () => {
      update({ motion: b.dataset.motionChoice });
      replay(); // show what the new speed looks like
    })
  );
  $("#reset").addEventListener("click", () => {
    ChessSettings.reset();
    render();
  });
  $("#replay").addEventListener("click", replay);
  $("#preview-label").append(ChessBoard.icon("best"), ChessBoard.LABELS.best);
}

function update(changes) {
  ChessSettings.set(changes);
  render();
}

// Mark the chosen option in every group. (The *-choice names keep clear of <html data-coords / data-motion>.)
function render() {
  const s = ChessSettings.load();
  const pick = (attr, value) =>
    document.querySelectorAll(`[${attr}]`).forEach((b) => {
      const on = b.getAttribute(attr) === value;
      b.classList.toggle("active", on);
      b.setAttribute("aria-pressed", String(on));
    });
  pick("data-theme-choice", s.theme);
  pick("data-accent", s.accent);
  pick("data-board", s.board);
  pick("data-coords-choice", s.coords ? "on" : "off");
  pick("data-motion-choice", s.motion);
}

function showPosition(fen, played) {
  ChessBoard.render(boardEl, fen, {
    highlight: played ? [MOVE.slice(0, 2), MOVE.slice(2, 4)] : [],
    icon: played ? { square: MOVE.slice(2, 4), classification: "best" } : null,
  });
  ChessBoard.drawArrows($("#arrow-layer"), played ? [] : [[MOVE, "best"]], false);
}

let replayTimer = null;
function replay() {
  clearTimeout(replayTimer);
  showPosition(BEFORE, false);
  replayTimer = setTimeout(() => {
    showPosition(AFTER, true);
    ChessBoard.glide(boardEl, MOVE, GLIDE_MS);
  }, 600);
}

build();
render();
showPosition(AFTER, true);
