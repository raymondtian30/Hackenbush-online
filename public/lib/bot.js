// The bot: exact game values and move choice. Runs in the browser
// (window.HackenbushBot); Node loads it only in tests.
//
// Values (see Berlekamp, Conway, Guy, Winning Ways, vol. 1):
//  - Red-Blue: a dyadic number. Positive means Red wins whoever moves first,
//    negative means Blue wins, zero means the player to move loses.
//  - Green: a nim-value. Zero means the player to move loses.
// Both formulas need every board to be a set of trees (plus loops), one ground
// node per tree; boards.js and validateBoard guarantee that.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./game.js"));
  else root.HackenbushBot = factory(root.HackenbushGame);
})(typeof self !== "undefined" ? self : this, function (Game) {
  "use strict";

  // ---- Dyadic numbers: {n: BigInt, e: Number} means n / 2^e, e >= 0. ----

  function norm(n, e) {
    if (n === 0n) return { n: 0n, e: 0 };
    while (e > 0 && n % 2n === 0n) {
      n /= 2n;
      e -= 1;
    }
    return { n, e };
  }

  const dy = (k) => ({ n: BigInt(k), e: 0 });

  function align(a, b) {
    const e = Math.max(a.e, b.e);
    return [a.n << BigInt(e - a.e), b.n << BigInt(e - b.e), e];
  }

  function add(a, b) {
    const [x, y, e] = align(a, b);
    return norm(x + y, e);
  }

  const neg = (a) => ({ n: -a.n, e: a.e });

  function cmp(a, b) {
    const [x, y] = align(a, b);
    return x < y ? -1 : x > y ? 1 : 0;
  }

  // Floor, as a BigInt (BigInt >> rounds toward minus infinity).
  const floor = (a) => a.n >> BigInt(a.e);

  const half = (a, k) => norm(a.n, a.e + k);

  function toString(a) {
    return a.e === 0 ? String(a.n) : `${a.n}/${2n ** BigInt(a.e)}`;
  }

  // ---- Walking the trees. ----

  // Calls visit(node, parentEdge|null, children) for each node of each tree,
  // children first. Loops are returned separately, per node.
  function forEachNodeBottomUp(board, visit) {
    const adj = new Map(board.nodes.map((n) => [n.id, []]));
    const loops = new Map(board.nodes.map((n) => [n.id, []]));
    for (const e of board.edges) {
      if (e.a === e.b) loops.get(e.a).push(e);
      else {
        adj.get(e.a).push({ edge: e, to: e.b });
        adj.get(e.b).push({ edge: e, to: e.a });
      }
    }
    const roots = [];
    for (const g of board.nodes.filter((n) => n.ground)) {
      const order = [];
      const parent = new Map([[g.id, null]]);
      const stack = [g.id];
      while (stack.length) {
        const id = stack.pop();
        order.push(id);
        for (const { edge, to } of adj.get(id)) {
          if (!parent.has(to)) {
            parent.set(to, { edge, from: id });
            stack.push(to);
          }
        }
      }
      for (let i = order.length - 1; i >= 0; i--) {
        const id = order[i];
        visit(id, parent.get(id), loops.get(id));
      }
      roots.push(g.id);
    }
    return roots;
  }

  function edgeValue(color, x) {
    if (color === "blue") return neg(edgeValue("red", neg(x)));
    const n = Math.max(1, Number(floor(add(dy(1), neg(x)))) + 1);
    return half(add(x, dy(n)), n - 1);
  }

  function redBlueValue(board) {
    if (board.edges.some((e) => e.color === "green")) throw new Error("Green edge in Red-Blue value");
    const val = new Map();
    const roots = forEachNodeBottomUp(board, (id, parent, loops) => {
      let v = val.get(id) || dy(0);
      for (const loop of loops) v = add(v, dy(loop.color === "red" ? 1 : -1));
      val.set(id, v);
      if (parent) val.set(parent.from, add(val.get(parent.from) || dy(0), edgeValue(parent.edge.color, v)));
    });
    return roots.reduce((sum, id) => add(sum, val.get(id)), dy(0));
  }

  function greenValue(board) {
    const val = new Map();
    const roots = forEachNodeBottomUp(board, (id, parent, loops) => {
      let v = val.get(id) || 0;
      for (let i = 0; i < loops.length; i++) v ^= 1;
      val.set(id, v);
      if (parent) val.set(parent.from, (val.get(parent.from) || 0) ^ (v + 1));
    });
    return roots.reduce((x, id) => x ^ val.get(id), 0);
  }

  // ---- Choosing moves. ----

  // Ids of the legal cuts that keep the best result for `side`, in board order.
  function bestMoves(game, side) {
    const moves = Game.legalMoves(game, side);
    if (moves.length === 0) return [];
    const scored = moves.map((id) => {
      const g = structuredClone(game);
      g.turn = side;
      Game.applyCut(g, side, id);
      return { id, board: g.board };
    });
    if (game.mode === "green") {
      const zero = scored.filter((s) => greenValue(s.board) === 0).map((s) => s.id);
      return zero.length ? zero : moves;
    }
    const values = scored.map((s) => ({ id: s.id, v: redBlueValue(s.board) }));
    let best = values[0].v;
    for (const { v } of values) {
      if (side === "red" ? cmp(v, best) > 0 : cmp(v, best) < 0) best = v;
    }
    return values.filter(({ v }) => cmp(v, best) === 0).map(({ id }) => id);
  }

  const BEST_CHANCE = { hard: 1, medium: 0.65, easy: 0.2 };

  // Picks a cut: a best move with the difficulty's chance, otherwise any legal
  // move. `rand` returns floats in [0, 1); it is injectable for tests.
  function chooseMove(game, side, difficulty, rand = Math.random) {
    const legal = Game.legalMoves(game, side);
    if (legal.length === 0) return null;
    const list = rand() < BEST_CHANCE[difficulty] ? bestMoves(game, side) : legal;
    return list[Math.floor(rand() * list.length)];
  }

  return { redBlueValue, greenValue, bestMoves, chooseMove, dy, add, neg, cmp, half, floor, toString };
});
