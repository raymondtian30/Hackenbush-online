// Named boards, drawn as pictures. Shapes are fixed; colors come from the mode
// and a seed. Every shape is a set of trees (one ground node each), plus
// single-edge loops, which keeps the bot's exact value calculation valid.
// Loaded by the browser (window.HackenbushBoards) and required by the server.
//
// Coordinates: y grows upward from the ground at y = 0. A loop's `angle` is in
// degrees, 0 = pointing up, clockwise.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.HackenbushBoards = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const BOARDS = [
    { id: "classic", name: "Classic" },
    { id: "flowers", name: "Flower Garden" },
    { id: "forest", name: "Forest" },
    { id: "bouquet", name: "Bouquet" },
  ];

  // 32-bit seeded generator; returns floats in [0, 1).
  function mulberry32(a) {
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function pickBoardId(rand) {
    return BOARDS[Math.floor(rand() * BOARDS.length)].id;
  }

  // Builder with separate id counters for nodes and edges, both from 0.
  function builder(width, height) {
    const nodes = [];
    const edges = [];
    return {
      width,
      height,
      nodes,
      edges,
      node(x, y, ground = false) {
        nodes.push({ id: nodes.length, x: Math.round(x), y: Math.round(y), ground });
        return nodes.length - 1;
      },
      edge(a, b) {
        edges.push({ id: edges.length, a, b, color: null });
      },
      loop(a, angle) {
        edges.push({ id: edges.length, a, b: a, color: null, angle });
      },
    };
  }

  const rad = (deg) => (deg * Math.PI) / 180;

  function classicShape() {
    const b = builder(600, 340);
    const g0 = b.node(100, 0, true);
    const g1 = b.node(300, 0, true);
    const g2 = b.node(500, 0, true);
    const n3 = b.node(100, 90);
    const n4 = b.node(100, 180);
    const n5 = b.node(40, 250);
    const n6 = b.node(160, 250);
    const n7 = b.node(300, 90);
    const n8 = b.node(300, 180);
    const n9 = b.node(240, 250);
    const n10 = b.node(360, 250);
    const n11 = b.node(360, 320);
    const n12 = b.node(500, 90);
    const n13 = b.node(500, 180);
    const n14 = b.node(440, 250);
    const n15 = b.node(560, 250);
    [[g0, n3], [n3, n4], [n4, n5], [n4, n6], [g1, n7], [n7, n8], [n8, n9], [n8, n10], [n10, n11],
      [g2, n12], [n12, n13], [n13, n14], [n13, n15]].forEach(([p, q]) => b.edge(p, q));
    return b;
  }

  const CLASSIC_RED = new Set([0, 2, 5, 7, 9, 11]);

  function flowersShape() {
    const b = builder(900, 380);
    for (let i = 0; i < 6; i++) {
      const x = 75 + 150 * i;
      const s = i % 2 === 0 ? -1 : 1;
      const ground = b.node(x, 0, true);
      const low = b.node(x, 110);
      const high = b.node(x, 220);
      const head = b.node(x, 300);
      const leaf = b.node(x + 45 * s, 160);
      b.edge(ground, low);
      b.edge(low, high);
      b.edge(high, head);
      b.edge(low, leaf);
      for (const angle of [0, 60, 120, 240, 300]) b.loop(head, angle);
    }
    return b;
  }

  function forestShape() {
    const b = builder(820, 390);
    const levels = [[70, 70], [35, 60], [17, 50]];
    for (const x of [150, 410, 670]) {
      const ground = b.node(x, 0, true);
      const mid = b.node(x, 100);
      const top = b.node(x, 190);
      b.edge(ground, mid);
      b.edge(mid, top);
      let frontier = [{ id: top, x, y: 190 }];
      for (const [dx, dy] of levels) {
        const next = [];
        for (const p of frontier) {
          for (const sign of [-1, 1]) {
            const cx = p.x + sign * dx;
            const cy = p.y + dy;
            const child = b.node(cx, cy);
            b.edge(p.id, child);
            next.push({ id: child, x: cx, y: cy });
          }
        }
        frontier = next;
      }
    }
    return b;
  }

  function bouquetShape() {
    const b = builder(600, 400);
    const ground = b.node(300, 0, true);
    const knot = b.node(300, 80);
    b.edge(ground, knot);
    for (let i = 0; i < 7; i++) {
      const t = -60 + 20 * i;
      const sx = Math.sin(rad(t));
      const cy = Math.cos(rad(t));
      const mid = b.node(300 + 120 * sx, 80 + 120 * cy);
      const head = b.node(300 + 250 * sx, 80 + 250 * cy);
      b.edge(knot, mid);
      b.edge(mid, head);
      for (const angle of [t - 60, t - 20, t + 20, t + 60]) b.loop(head, angle);
    }
    return b;
  }

  const SHAPES = { classic: classicShape, flowers: flowersShape, forest: forestShape, bouquet: bouquetShape };

  function colorEdges(id, edges, mode, seed) {
    if (mode === "green") {
      for (const e of edges) e.color = "green";
    } else if (id === "classic") {
      for (const e of edges) e.color = CLASSIC_RED.has(e.id) ? "red" : "blue";
    } else {
      const r = mulberry32(seed);
      for (const e of edges) e.color = r() < 0.5 ? "red" : "blue";
      for (const color of ["red", "blue"]) {
        if (!edges.some((e) => e.color === color)) edges[edges.length - 1].color = color;
      }
    }
  }

  function makeBoard(id, mode, seed) {
    const shape = SHAPES[id];
    if (!shape) throw new Error(`Unknown board ${id}`);
    const b = shape();
    colorEdges(id, b.edges, mode, seed);
    return { width: b.width, height: b.height, nodes: b.nodes, edges: b.edges };
  }

  return { mulberry32, BOARDS, pickBoardId, makeBoard };
});
