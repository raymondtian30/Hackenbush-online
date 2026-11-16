// Draws a board; decides nothing about the rules.
(function () {
  const SVG_NS = "http://www.w3.org/2000/svg";
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
    const GROUND_Y = board.height + 20;
    svg.setAttribute("viewBox", `0 0 ${board.width} ${board.height + 60}`);
    svg.style.minWidth = Math.min(board.width, Math.max(640, board.width * 0.75)) + "px";
    svg.style.maxWidth = board.width + "px";
    svg.appendChild(el("line", { class: "ground", x1: 0, y1: GROUND_Y, x2: board.width, y2: GROUND_Y }));
    const pos = new Map(board.nodes.map((n) => [n.id, { x: n.x, y: GROUND_Y - n.y }]));
    for (const e of board.edges) {
      const a = pos.get(e.a);
      const b = pos.get(e.b);
      const line = { x1: a.x, y1: a.y, x2: b.x, y2: b.y };
      const g = el("g", { id: "e-" + e.id, class: e.color, "data-color": e.color });
      let shape = "line", attrs = line;
      if (e.a === e.b) {
        const point = angle => {
          const t = angle * Math.PI / 180;
          return `${a.x + 45 * Math.sin(t)} ${a.y - 45 * Math.cos(t)}`;
        };
        shape = "path";
        attrs = e.loopRadius ? {
          d: `M ${a.x} ${a.y} a ${e.loopRadius} ${e.loopRadius} 0 1 1 0 ${2 * e.loopRadius} a ${e.loopRadius} ${e.loopRadius} 0 1 1 0 ${-2 * e.loopRadius}`,
        } : { d: `M ${a.x} ${a.y} C ${point(e.angle - 40)} ${point(e.angle + 40)} ${a.x} ${a.y}` };
      }
      g.appendChild(el(shape, { class: "stroke", ...attrs }));
      g.appendChild(el(shape, { class: "hit", ...attrs }));
      svg.appendChild(g);
    }
    for (const n of board.nodes) {
      const p = pos.get(n.id);
      svg.appendChild(el("circle", { id: "n-" + n.id, cx: p.x, cy: p.y, r: 4 }));
    }
    drawn = true;
  }

  function fall(id) {
    const node = document.getElementById(id);
    if (!node || node.classList.contains("fall")) return;
    node.classList.add("fall");
    setTimeout(() => node.remove(), FALL_MS);
  }

  window.Render = {
    init(svgEl, clickHandler) {
      svg = svgEl;
      onEdgeClick = clickHandler;
      const activate = (target) => {
        const g = target.closest('g[id^="e-"]');
        if (!g || !g.classList.contains("mine") || svg.classList.contains("waiting-turn")) return;
        onEdgeClick(Number(g.id.slice(2)));
      };
      svg.addEventListener("click", (event) => activate(event.target));
      svg.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        activate(event.target);
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

      const myTurn = game.status === "playing" && game.turn === role;
      svg.classList.toggle("waiting-turn", !myTurn);
      for (const g of svg.querySelectorAll('g[id^="e-"]')) {
        const mine = g.dataset.color === role || g.dataset.color === "green";
        g.classList.toggle("mine", mine);
        if (mine && myTurn && !g.classList.contains("fall")) {
          g.setAttribute("tabindex", "0");
          g.setAttribute("role", "button");
          g.setAttribute("aria-label", "Cut " + g.dataset.color + " edge " + g.id.slice(2));
        } else {
          g.removeAttribute("tabindex");
          g.removeAttribute("role");
          g.removeAttribute("aria-label");
        }
      }
    },
  };
})();
