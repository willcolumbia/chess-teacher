"use strict";

// Puzzles made from your own mistakes, kept in this browser (localStorage).
// The Analysis page adds one for every mistake, miss or blunder you made in an analyzed game;
// the Puzzles page asks you to find the better move.
//
// Spaced repetition (Leitner boxes): solving a puzzle on the first try moves it up a box and
// it comes back later each time (1, 3, 7, 16, 35 days); missing it sends it back to box 0.
const PuzzleStore = (() => {
  const KEY = "puzzles";
  const DAY = 24 * 60 * 60 * 1000;
  const INTERVALS = [0, 1, 3, 7, 16, 35]; // days until a puzzle in each box comes back
  const KINDS = ["mistake", "miss", "blunder"];
  const MASTERED = 4; // box at which a puzzle counts as learned

  function all() {
    try {
      const list = JSON.parse(localStorage.getItem(KEY) || "[]");
      return Array.isArray(list) ? list : [];
    } catch (e) {
      return [];
    }
  }

  function save(list) {
    try {
      localStorage.setItem(KEY, JSON.stringify(list));
      return true;
    } catch (e) {
      return false;
    }
  }

  // Identifies a game, so analyzing it again doesn't add its puzzles twice.
  function gameKey(h) {
    if (h.Link) return h.Link;
    return [h.Site, h.Date, h.UTCTime, h.White, h.Black].map((x) => x || "").join("|");
  }

  // Add a puzzle for each of `color`'s bad moves in an /api/analyze result. Returns how many were new.
  function addFromAnalysis(result, color) {
    const h = result.headers || {};
    const key = gameKey(h);
    const opponent = color === "white" ? h.Black : h.White;
    const list = all();
    const have = new Set(list.map((p) => p.id));
    const now = Date.now();
    let added = 0;
    for (const m of result.moves || []) {
      if (m.color !== color || !KINDS.includes(m.classification) || !m.best_uci || m.best_uci === m.uci) continue;
      const id = `${key}#${m.ply}`;
      if (have.has(id)) continue;
      list.push({
        id,
        fen: m.fen_before,
        best: m.best_uci,
        bestSan: m.best_san,
        bestIdea: m.best_description || "",
        line: (m.best_line_moves || []).slice(0, 6).map(({ uci, san, label }) => ({ uci, san, label })),
        played: m.san,
        playedUci: m.uci,
        classification: m.classification,
        problem: m.problem || "",
        color,
        moveLabel: m.color === "white" ? `${m.move_number}. ${m.san}` : `${m.move_number}... ${m.san}`,
        opponent: opponent && opponent !== "?" ? opponent : "",
        date: h.Date && !h.Date.startsWith("????") ? h.Date : "",
        added: now,
        box: 0,
        due: now,
        tries: 0,
        solved: 0,
      });
      added++;
    }
    if (added) save(list);
    return added;
  }

  function due(now = Date.now()) {
    return all().filter((p) => p.due <= now).sort((a, b) => a.due - b.due || a.added - b.added);
  }

  // After an attempt: firstTry is true when it was solved with no wrong move, hint or answer.
  function record(id, firstTry, now = Date.now()) {
    const list = all();
    const p = list.find((x) => x.id === id);
    if (!p) return null;
    p.tries += 1;
    if (firstTry) {
      p.solved += 1;
      p.box = Math.min(p.box + 1, INTERVALS.length - 1);
    } else {
      p.box = 0;
    }
    p.due = now + INTERVALS[p.box] * DAY;
    p.last = now;
    save(list);
    return p;
  }

  function remove(id) {
    save(all().filter((p) => p.id !== id));
  }

  return { all, due, addFromAnalysis, record, remove, MASTERED, DAY };
})();
