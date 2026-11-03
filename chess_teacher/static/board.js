"use strict";

// Board drawing shared by the home page and the analysis page.
const ChessBoard = (() => {
  const SVG_NS = "http://www.w3.org/2000/svg";

  function make(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  // "rnbqkbnr/pppppppp/..." -> grid[row 0 = rank 8][file 0 = a]
  function parseFen(fen) {
    return fen.split(" ")[0].split("/").map((row) => {
      const cells = [];
      for (const ch of row) {
        if (/\d/.test(ch)) for (let i = 0; i < Number(ch); i++) cells.push(null);
        else cells.push(ch);
      }
      return cells;
    });
  }

  function pieceAt(fen, square) {
    const file = square.charCodeAt(0) - 97;
    const rank = Number(square[1]) - 1;
    return parseFen(fen)[7 - rank][file];
  }

  // En passant: the capturing pawn lands on the empty square behind the enemy pawn, but most
  // people try to drop it on the enemy pawn itself. Accept that too: returns
  // { alias: square of the pawn being taken, target: the real landing square } or null.
  function enPassantAlias(fen, from, targets) {
    const ep = fen.split(" ")[3];
    if (!ep || ep === "-" || !targets.includes(ep)) return null;
    const piece = pieceAt(fen, from);
    if (!piece || piece.toLowerCase() !== "p") return null;
    return { alias: ep[0] + from[1], target: ep };
  }

  function pieceImage(piece) {
    const color = piece === piece.toUpperCase() ? "w" : "b";
    const img = make("img", "piece");
    img.src = `/static/pieces/${color}${piece.toUpperCase()}.svg`;
    img.alt = piece;
    img.draggable = false;
    return img;
  }

  // ---------- Move-quality icons (Chess.com style) ----------

  const LABELS = {
    brilliant: "Brilliant",
    great: "Great",
    best: "Best",
    good: "Good",
    book: "Book",
    inaccuracy: "Inaccuracy",
    mistake: "Mistake",
    miss: "Miss",
    blunder: "Blunder",
  };
  const GLYPHS = {
    brilliant: { text: "!!" },
    great: { text: "!" },
    best: { path: "M10 3.6l1.9 4.1 4.4.5-3.3 3 .9 4.4L10 13.4l-3.9 2.2.9-4.4-3.3-3 4.4-.5z" },
    good: { path: "M5.6 10.4l3 3 5.9-6.6", stroke: true },
    book: { path: "M5 5.5c1.8-.6 3.6-.4 5 .8 1.4-1.2 3.2-1.4 5-.8v9c-1.8-.6-3.6-.4-5 .8-1.4-1.2-3.2-1.4-5-.8z" },
    inaccuracy: { text: "?!" },
    mistake: { text: "?" },
    miss: { path: "M6.5 6.5l7 7M13.5 6.5l-7 7", stroke: true },
    blunder: { text: "??" },
  };

  // A round icon for a move classification, or null for unknown ones.
  function icon(classification) {
    const glyph = GLYPHS[classification];
    if (!glyph) return null;
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("viewBox", "0 0 20 20");
    svg.setAttribute("class", `mv-icon i-${classification}`);
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", LABELS[classification]);
    const title = document.createElementNS(SVG_NS, "title");
    title.textContent = LABELS[classification];
    const circle = document.createElementNS(SVG_NS, "circle");
    circle.setAttribute("cx", "10");
    circle.setAttribute("cy", "10");
    circle.setAttribute("r", "10");
    svg.append(title, circle);
    if (glyph.text) {
      const text = document.createElementNS(SVG_NS, "text");
      text.setAttribute("x", "10");
      text.setAttribute("y", "14.4");
      text.setAttribute("text-anchor", "middle");
      text.setAttribute("font-size", glyph.text.length > 1 ? "11" : "13");
      text.textContent = glyph.text;
      svg.append(text);
    } else {
      const path = document.createElementNS(SVG_NS, "path");
      path.setAttribute("d", glyph.path);
      if (glyph.stroke) path.setAttribute("class", "stroke");
      svg.append(path);
    }
    return svg;
  }

  // Squares whose piece is still gliding in, per board; render() keeps those pieces hidden.
  const gliding = new WeakMap();

  // Options: flipped, highlight (squares tinted yellow), selected (square),
  // targets (squares to mark as legal destinations), icon ({ square, classification }),
  // premove (squares tinted red for a queued premove), marked (squares you tinted red with a right-click).
  function render(boardEl, fen, { flipped = false, highlight = [], selected = null, targets = [], icon: mark = null, premove = [], marked = [] } = {}) {
    const grid = parseFen(fen);
    const ep = selected ? enPassantAlias(fen, selected, targets) : null;
    if (ep) targets = [...targets, ep.alias]; // ring the pawn that en passant would take
    const busy = gliding.get(boardEl);
    boardEl.replaceChildren();
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const rank = flipped ? r : 7 - r; // 0 = rank 1
        const file = flipped ? 7 - c : c;
        const name = String.fromCharCode(97 + file) + (rank + 1);
        const piece = grid[7 - rank][file];
        const classes = ["sq", (rank + file) % 2 ? "light" : "dark"];
        if (highlight.includes(name)) classes.push("hl");
        if (premove.includes(name)) classes.push("premove");
        if (marked.includes(name)) classes.push("marked");
        if (name === selected) classes.push("selected");
        if (targets.includes(name)) classes.push(piece ? "target capture" : "target");
        const sq = make("div", classes.join(" "));
        sq.dataset.square = name;
        if (piece) {
          const img = pieceImage(piece);
          if (busy && busy.has(name)) img.style.visibility = "hidden";
          sq.append(img);
        }
        if (mark && mark.square === name) {
          const badge = icon(mark.classification);
          if (badge) {
            badge.classList.add("sq-icon");
            sq.append(badge);
          }
        }
        if (r === 7) sq.append(make("span", "coord file", String.fromCharCode(97 + file)));
        if (c === 0) sq.append(make("span", "coord rank", String(rank + 1)));
        boardEl.append(sq);
      }
    }
  }

  // Slide the piece that just landed on `uci`'s target square in from where it started
  // (and the rook as well, when castling). Call it right after render(). Resolves once landed.
  function glide(boardEl, uci, ms) {
    const from = uci.slice(0, 2);
    const to = uci.slice(2, 4);
    const paths = [[from, to]];
    const mover = boardEl.querySelector(`[data-square="${to}"] .piece`);
    if (mover && mover.alt.toLowerCase() === "k" && Math.abs(from.charCodeAt(0) - to.charCodeAt(0)) === 2) {
      paths.push(to[0] === "g" ? ["h" + to[1], "f" + to[1]] : ["a" + to[1], "d" + to[1]]);
    }
    if (!ms || matchMedia("(prefers-reduced-motion: reduce)").matches) return Promise.resolve();
    if (!gliding.has(boardEl)) gliding.set(boardEl, new Set());
    const busy = gliding.get(boardEl);

    return Promise.all(
      paths.map(([a, b]) => {
        const start = boardEl.querySelector(`[data-square="${a}"]`);
        const img = boardEl.querySelector(`[data-square="${b}"] .piece`);
        if (!start || !img) return null;
        const s = start.getBoundingClientRect();
        const e = img.getBoundingClientRect();
        const clone = pieceImage(img.alt);
        clone.classList.add("glide");
        Object.assign(clone.style, { left: `${e.left}px`, top: `${e.top}px`, width: `${e.width}px`, height: `${e.height}px` });
        document.body.append(clone);
        busy.add(b);
        img.style.visibility = "hidden";
        const anim = clone.animate(
          [{ transform: `translate(${s.left - e.left}px, ${s.top - e.top}px)` }, { transform: "none" }],
          { duration: ms, easing: "ease-in-out" }
        );
        // The timer lands the piece even if the animation stalls (e.g. in a background tab).
        const timer = new Promise((r) => setTimeout(r, ms + 100));
        return Promise.race([anim.finished.catch(() => {}), timer]).then(() => {
          anim.cancel();
          clone.remove();
          busy.delete(b);
          const landed = boardEl.querySelector(`[data-square="${b}"] .piece`);
          if (landed) landed.style.visibility = "";
        });
      })
    );
  }

  // Centre of a square in the 8x8 SVG overlay's coordinates.
  function squareXY(name, flipped) {
    const file = name.charCodeAt(0) - 97;
    const rank = Number(name[1]) - 1;
    return flipped ? [7 - file + 0.5, rank + 0.5] : [file + 0.5, 7 - rank + 0.5];
  }

  // The polyline points for an arrow along `uci`, in the SVG overlay's coordinates.
  function arrowPoints(uci, flipped) {
    const [x1, y1] = squareXY(uci.slice(0, 2), flipped);
    const [x2, y2] = squareXY(uci.slice(2, 4), flipped);
    const dx = Math.abs(x2 - x1);
    const dy = Math.abs(y2 - y1);
    // Only knight moves are 1x2 or 2x1; draw those as an L, long leg first.
    const points = [[x1, y1]];
    if ((dx === 1 && dy === 2) || (dx === 2 && dy === 1)) points.push(dx === 2 ? [x2, y1] : [x1, y2]);
    const [px, py] = points[points.length - 1];
    const len = Math.hypot(x2 - px, y2 - py);
    const k = (len - 0.3) / len; // stop short so the arrowhead sits inside the target square
    points.push([px + (x2 - px) * k, py + (y2 - py) * k]);
    return points;
  }

  // An arrow through `points`; kind picks the CSS class arrow-<kind> and marker #head-<kind>.
  function arrowLine(points, kind) {
    const line = document.createElementNS(SVG_NS, "polyline");
    line.setAttribute("points", points.map((p) => p.join(",")).join(" "));
    line.setAttribute("class", `arrow-${kind}`);
    line.setAttribute("marker-end", `url(#head-${kind})`);
    return line;
  }

  // arrows: [[uci, kind], ...]
  function drawArrows(layerEl, arrows, flipped) {
    layerEl.replaceChildren(...arrows.map(([uci, kind]) => arrowLine(arrowPoints(uci, flipped), kind)));
  }

  // Click-to-move and drag-and-drop. The page owns the state; hooks:
  //   canMove()            may the user move now?
  //   targetsFrom(square)  legal destination squares for the piece on `square`
  //   fen()                current position
  //   selected()           currently selected square (or null)
  //   select(square)       set the selection (null clears it) and re-render
  //   move(from, to, how)  the user made a move; how.dragged is true for drag-and-drop
  //   touched()            optional: called whenever the user presses on the board
  function attachInput(boardEl, hooks) {
    let drag = null; // { from, ghost, size, moved, wasSelected }

    // Legal destinations, plus the en passant victim's square as a stand-in for the real one.
    function targets(square) {
      const list = hooks.targetsFrom(square);
      const ep = enPassantAlias(hooks.fen(), square, list);
      return ep ? [...list, ep.alias] : list;
    }

    function move(from, to, how) {
      const ep = enPassantAlias(hooks.fen(), from, hooks.targetsFrom(from));
      hooks.move(from, ep && to === ep.alias ? ep.target : to, how);
    }

    function squareAt(x, y) {
      const hit = document.elementFromPoint(x, y);
      const sq = hit && hit.closest(".sq");
      return sq && boardEl.contains(sq) ? sq.dataset.square : null;
    }

    function moveGhost(x, y) {
      drag.ghost.style.left = `${x - drag.size / 2}px`;
      drag.ghost.style.top = `${y - drag.size / 2}px`;
    }

    boardEl.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return; // only the main button moves pieces; pages may use right-click
      const sq = e.target.closest(".sq");
      if (!sq || !hooks.canMove()) return;
      const square = sq.dataset.square;
      if (hooks.touched) hooks.touched();

      const selected = hooks.selected();
      if (selected && targets(selected).includes(square)) {
        move(selected, square, { dragged: false });
        return;
      }
      if (!targets(square).length) {
        hooks.select(null);
        return;
      }

      // Pick up a piece that can move.
      const wasSelected = selected === square;
      hooks.select(square);
      const img = boardEl.querySelector(`[data-square="${square}"] .piece`);
      const size = img.getBoundingClientRect().width;
      const ghost = pieceImage(pieceAt(hooks.fen(), square));
      ghost.classList.add("ghost");
      ghost.style.width = ghost.style.height = `${size}px`;
      document.body.append(ghost);
      img.classList.add("lifted");
      drag = { from: square, ghost, size, moved: false, wasSelected };
      moveGhost(e.clientX, e.clientY);
      boardEl.setPointerCapture(e.pointerId);
      e.preventDefault();
    });

    boardEl.addEventListener("pointermove", (e) => {
      if (!drag) return;
      drag.moved = true;
      moveGhost(e.clientX, e.clientY);
    });

    function endDrag(e, cancelled) {
      if (!drag) return;
      const { from, ghost, moved, wasSelected } = drag;
      drag = null;
      ghost.remove();
      const to = cancelled ? null : squareAt(e.clientX, e.clientY);
      if (to && to !== from && targets(from).includes(to)) {
        move(from, to, { dragged: true });
      } else {
        // A second click on a piece puts it down; otherwise it stays selected
        // so a click on a target square finishes the move.
        hooks.select(!moved && wasSelected ? null : from);
      }
    }

    boardEl.addEventListener("pointerup", (e) => endDrag(e, false));
    boardEl.addEventListener("pointercancel", (e) => endDrag(e, true));
  }

  // ---------- Captured material ----------

  const START = { p: 8, n: 2, b: 2, r: 2, q: 1 };
  const VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9 };

  // Pieces each side has taken, worked out from what's missing on the board.
  // { white: ["p", "n", ...] (black pieces White took), black: [...], lead: White's material lead }
  function captured(fen) {
    const counts = { w: {}, b: {} };
    for (const row of parseFen(fen)) {
      for (const piece of row) {
        if (!piece) continue;
        const side = piece === piece.toUpperCase() ? "w" : "b";
        const type = piece.toLowerCase();
        counts[side][type] = (counts[side][type] || 0) + 1;
      }
    }
    const taken = (side) => {
      const out = [];
      for (const type of ["p", "n", "b", "r", "q"]) {
        for (let i = (counts[side][type] || 0); i < START[type]; i++) out.push(type);
      }
      return out;
    };
    const material = (side) => Object.entries(counts[side]).reduce((sum, [t, n]) => sum + (VALUE[t] || 0) * n, 0);
    return { white: taken("b"), black: taken("w"), lead: material("w") - material("b") };
  }

  // Small icons of the pieces `color` has captured, plus "+N" if that side is ahead.
  function capturedRow(fen, color) {
    const info = captured(fen);
    const box = make("span", "captured");
    const victim = color === "white" ? (t) => t : (t) => t.toUpperCase();
    for (const type of info[color]) box.append(pieceImage(victim(type)));
    const lead = color === "white" ? info.lead : -info.lead;
    if (lead > 0) box.append(make("span", "lead", `+${lead}`));
    return box;
  }

  return { render, glide, drawArrows, pieceAt, pieceImage, attachInput, icon, LABELS, captured, capturedRow };
})();
