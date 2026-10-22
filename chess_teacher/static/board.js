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

  function pieceImage(piece) {
    const color = piece === piece.toUpperCase() ? "w" : "b";
    const img = make("img", "piece");
    img.src = `/static/pieces/${color}${piece.toUpperCase()}.svg`;
    img.alt = piece;
    img.draggable = false;
    return img;
  }

  // Options: flipped, highlight (squares tinted yellow), selected (square),
  // targets (squares to mark as legal destinations).
  function render(boardEl, fen, { flipped = false, highlight = [], selected = null, targets = [] } = {}) {
    const grid = parseFen(fen);
    boardEl.replaceChildren();
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const rank = flipped ? r : 7 - r; // 0 = rank 1
        const file = flipped ? 7 - c : c;
        const name = String.fromCharCode(97 + file) + (rank + 1);
        const piece = grid[7 - rank][file];
        const classes = ["sq", (rank + file) % 2 ? "light" : "dark"];
        if (highlight.includes(name)) classes.push("hl");
        if (name === selected) classes.push("selected");
        if (targets.includes(name)) classes.push(piece ? "target capture" : "target");
        const sq = make("div", classes.join(" "));
        sq.dataset.square = name;
        if (piece) sq.append(pieceImage(piece));
        if (r === 7) sq.append(make("span", "coord file", String.fromCharCode(97 + file)));
        if (c === 0) sq.append(make("span", "coord rank", String(rank + 1)));
        boardEl.append(sq);
      }
    }
  }

  // Centre of a square in the 8x8 SVG overlay's coordinates.
  function squareXY(name, flipped) {
    const file = name.charCodeAt(0) - 97;
    const rank = Number(name[1]) - 1;
    return flipped ? [7 - file + 0.5, rank + 0.5] : [file + 0.5, 7 - rank + 0.5];
  }

  // arrows: [[uci, kind], ...]; kind picks the CSS class arrow-<kind> and marker #head-<kind>.
  function drawArrows(layerEl, arrows, flipped) {
    layerEl.replaceChildren();
    for (const [uci, kind] of arrows) {
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
      const line = document.createElementNS(SVG_NS, "polyline");
      line.setAttribute("points", points.map((p) => p.join(",")).join(" "));
      line.setAttribute("class", `arrow-${kind}`);
      line.setAttribute("marker-end", `url(#head-${kind})`);
      layerEl.append(line);
    }
  }

  // Click-to-move and drag-and-drop. The page owns the state; hooks:
  //   canMove()            may the user move now?
  //   targetsFrom(square)  legal destination squares for the piece on `square`
  //   fen()                current position
  //   selected()           currently selected square (or null)
  //   select(square)       set the selection (null clears it) and re-render
  //   move(from, to)       the user made a move
  //   touched()            optional: called whenever the user presses on the board
  function attachInput(boardEl, hooks) {
    let drag = null; // { from, ghost, size, moved, wasSelected }

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
      const sq = e.target.closest(".sq");
      if (!sq || !hooks.canMove()) return;
      const square = sq.dataset.square;
      if (hooks.touched) hooks.touched();

      const selected = hooks.selected();
      if (selected && hooks.targetsFrom(selected).includes(square)) {
        hooks.move(selected, square);
        return;
      }
      if (!hooks.targetsFrom(square).length) {
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
      if (to && to !== from && hooks.targetsFrom(from).includes(to)) {
        hooks.move(from, to);
      } else {
        // A second click on a piece puts it down; otherwise it stays selected
        // so a click on a target square finishes the move.
        hooks.select(!moved && wasSelected ? null : from);
      }
    }

    boardEl.addEventListener("pointerup", (e) => endDrag(e, false));
    boardEl.addEventListener("pointercancel", (e) => endDrag(e, true));
  }

  return { render, drawArrows, pieceAt, pieceImage, attachInput };
})();
