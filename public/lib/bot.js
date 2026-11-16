// The bot: exact tree values and graph-aware move choice. Runs in the browser
// (window.HackenbushBot); Node loads it only in tests.
//
// Values (see Berlekamp, Conway, Guy, Winning Ways, vol. 1):
//  - Red-Blue: a dyadic number. Positive means Red wins whoever moves first,
//    negative means Blue wins, zero means the player to move loses.
//  - Green: a nim-value. Zero means the player to move loses.
// These formulas require trees with one ground node each. Shared-support
// scenes use exact endgame search and a mobility/cascade heuristic on large graphs.
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
    if (!Game.isTreeBoard(board)) throw new Error("Exact tree values cannot evaluate cycles or shared ground supports");
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

  // Small graph endgames are solved by normal-play minimax. Remaining edge
  // ids completely identify a position within this one search and seed.
  function graphEndgame(board, side, memo) {
    const key = side + ":" + board.edges.map(e => e.id).join(",");
    if (memo.has(key)) return memo.get(key);
    for (const edge of board.edges) {
      if (Game.canCut(edge, side) && !graphEndgame(Game.cutEdge(board, edge.id), Game.otherColor(side), memo)) {
        memo.set(key, true);
        return true;
      }
    }
    memo.set(key, false);
    return false;
  }

  function graphMoves(game, side, moves) {
    const opponent = Game.otherColor(side);
    if (game.board.edges.length <= 10) {
      const memo = new Map();
      const winning = moves.filter(id => !graphEndgame(Game.cutEdge(game.board, id), opponent, memo));
      return winning.length ? winning : moves;
    }
    const ground = new Set(game.board.nodes.filter(n => n.ground).map(n => n.id));
    const scored = moves.map(id => {
      // prune only replaces the node/edge arrays, so these scoring positions
      // can safely share immutable node and edge records with the live board.
      const board = { ...game.board, edges: game.board.edges.filter(e => e.id !== id) };
      Game.prune(board);
      let mine = 0, theirs = 0, mySupports = 0, theirSupports = 0;
      for (const e of board.edges) {
        const supported = ground.has(e.a) || ground.has(e.b);
        if (Game.canCut(e, side)) { mine++; if (supported) mySupports++; }
        if (Game.canCut(e, opponent)) { theirs++; if (supported) theirSupports++; }
      }
      // Reward opponent cascades and preserve legal moves and ground access.
      // Green has shared mobility; use the parity of the actual remaining graph
      // only as a heuristic, never as an asserted exact nim-value.
      const score = !theirs ? 1e6 : !mine ? -1e6 : game.mode === "green"
        ? (board.edges.length % 2 === 0 ? 1 : -1) + (game.board.edges.length - board.edges.length) / 1000
        : mine - theirs + (mySupports - theirSupports) / 4;
      return { id, score };
    });
    const best = Math.max(...scored.map(s => s.score));
    return scored.filter(s => s.score === best).map(s => s.id);
  }

  // Highest-ranked legal cuts for `side`, in board order. Tree values and small
  // graph endgames are exact; large graph positions use the heuristic above.
  function bestMoves(game, side) {
    const moves = Game.legalMoves(game, side);
    if (moves.length === 0) return [];
    if (game.mode === "redbluegreen" || !Game.isTreeBoard(game.board)) return graphMoves(game, side, moves);
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
