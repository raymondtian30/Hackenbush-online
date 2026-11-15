// SVG rendering of the board and the fall animation. Draws only what the
// server sends; decides nothing about the rules.
(function () {
  const SVG_NS = "http://www.w3.org/2000/svg";
  const GROUND_Y = 360;
  const FALL_MS = 600;

  let svg = null;
  let onEdgeClick = null;
  let drawn = false;

  function el(name, attrs) {
    const node = document.createElementNS(SVG_NS, name);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    return node;
  }

  function draw(board) {
    svg.appendChild(el("line", { class: "ground", x1: 0, y1: GROUND_Y, x2: 600, y2: GROUND_Y }));
    const pos = new Map(board.nodes.map((n) => [n.id, { x: n.x, y: GROUND_Y - n.y }]));
    for (const e of board.edges) {
      const a = pos.get(e.a);
      const b = pos.get(e.b);
      const line = { x1: a.x, y1: a.y, x2: b.x, y2: b.y };
      const g = el("g", { id: "e-" + e.id, class: e.color, "data-color": e.color });
      g.appendChild(el("line", { class: "stroke", ...line }));
      g.appendChild(el("line", { class: "hit", ...line }));
      svg.appendChild(g);
    }
    for (const n of board.nodes) {
      const p = pos.get(n.id);
      svg.appendChild(el("circle", { id: "n-" + n.id, cx: p.x, cy: p.y, r: 7 }));
    }
    drawn = true;
  }

  function fall(id) {
    const node = svg.querySelector("#" + id);
    if (!node || node.classList.contains("fall")) return;
    node.classList.add("fall");
    setTimeout(() => node.remove(), FALL_MS);
  }

  window.Render = {
    init(svgEl, clickHandler) {
      svg = svgEl;
      onEdgeClick = clickHandler;
      svg.addEventListener("click", (event) => {
        const g = event.target.closest('g[id^="e-"]');
        if (!g || !g.classList.contains("mine") || svg.classList.contains("waiting-turn")) return;
        onEdgeClick(Number(g.id.slice(2)));
      });
    },

    reset() {
      if (svg) svg.replaceChildren();
      drawn = false;
    },

    update(game, lastMove, role) {
      if (!drawn) {
        draw(game.board);
      } else if (lastMove) {
        fall("e-" + lastMove.edgeId);
        for (const id of lastMove.fell.edges) fall("e-" + id);
        for (const id of lastMove.fell.nodes) fall("n-" + id);
      }

      // Anything the server no longer has, and is not already falling, goes now
      // (covers a snapshot received after a reconnect).
      const edgeIds = new Set(game.board.edges.map((e) => "e-" + e.id));
      const nodeIds = new Set(game.board.nodes.map((n) => "n-" + n.id));
      for (const node of svg.querySelectorAll('[id^="e-"], [id^="n-"]')) {
        if (node.classList.contains("fall")) continue;
        if (!edgeIds.has(node.id) && !nodeIds.has(node.id)) node.remove();
      }

      for (const g of svg.querySelectorAll('g[id^="e-"]')) {
        g.classList.toggle("mine", g.dataset.color === role);
      }
      const myTurn = game.status === "playing" && game.turn === role;
      svg.classList.toggle("waiting-turn", !myTurn);
    },
  };
})();
