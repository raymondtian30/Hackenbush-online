// Pure Hackenbush rules for Red-Blue, Red-Blue-Green and Green. No I/O; every function works
// on plain data. Loaded by the browser (window.HackenbushGame) and required by
// the server.
//
// Board: { width, height, nodes: [{id, x, y, ground}], edges: [{id, a, b, color, angle?}] }.
// An edge with a === b is a loop. Colors: "red", "blue", "green".
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.HackenbushGame = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const COLORS = ["red", "blue", "green"];

  function otherColor(side) {
    return side === "red" ? "blue" : "red";
  }

  // Ids of every node that reaches a ground node through edges.
  function reachable(board) {
    const neighbors = new Map(board.nodes.map((n) => [n.id, []]));
    for (const e of board.edges) {
      if (neighbors.has(e.a)) neighbors.get(e.a).push(e.b);
      if (neighbors.has(e.b)) neighbors.get(e.b).push(e.a);
    }
    const seen = new Set();
    const queue = board.nodes.filter((n) => n.ground).map((n) => n.id);
    for (const id of queue) seen.add(id);
    while (queue.length) {
      const id = queue.shift();
      for (const next of neighbors.get(id) || []) {
        if (!seen.has(next)) {
          seen.add(next);
          queue.push(next);
        }
      }
    }
    return seen;
  }

  // Ignoring loops, every connected part must hold exactly one ground node and
  // be a tree (edges = nodes - 1). The exact bot values depend on this.
  function checkTrees(board) {
    const nodeById = new Map(board.nodes.map((n) => [n.id, n]));
    const adj = new Map(board.nodes.map((n) => [n.id, []]));
    for (const e of board.edges) {
      if (e.a === e.b) continue;
      adj.get(e.a).push(e.b);
      adj.get(e.b).push(e.a);
    }
    const seen = new Set();
    for (const start of [...board.nodes].sort((p, q) => p.id - q.id)) {
      if (seen.has(start.id)) continue;
      const part = [];
      const stack = [start.id];
      seen.add(start.id);
      while (stack.length) {
        const id = stack.pop();
        part.push(id);
        for (const next of adj.get(id)) {
          if (!seen.has(next)) {
            seen.add(next);
            stack.push(next);
          }
        }
      }
      const lowest = Math.min(...part);
      const grounds = part.filter((id) => nodeById.get(id).ground).length;
      if (grounds !== 1) throw new Error(`Part with node ${lowest} has ${grounds} ground nodes`);
      const partSet = new Set(part);
      const edges = board.edges.filter((e) => e.a !== e.b && partSet.has(e.a)).length;
      if (edges !== part.length - 1) {
        throw new Error(`Part with node ${lowest} has a cycle or parallel edges`);
      }
    }
  }

  // Throws if the board breaks a rule. Checks run in order: ids, endpoints,
  // colour and reachability. Cycles and shared ground supports are legal.
  function validateBoard(board) {
    const nodeIds = new Set();
    for (const n of board.nodes) {
      if (nodeIds.has(n.id)) throw new Error(`Duplicate node id ${n.id}`);
      nodeIds.add(n.id);
    }
    const edgeIds = new Set();
    for (const e of board.edges) {
      if (edgeIds.has(e.id)) throw new Error(`Duplicate edge id ${e.id}`);
      edgeIds.add(e.id);
    }
    for (const e of board.edges) {
      if (!nodeIds.has(e.a) || !nodeIds.has(e.b)) throw new Error(`Edge ${e.id} names a missing node`);
    }
    for (const e of board.edges) {
      if (!COLORS.includes(e.color)) throw new Error(`Edge ${e.id} has an invalid color`);
    }
    const seen = reachable(board);
    for (const n of board.nodes) {
      if (!seen.has(n.id)) throw new Error(`Node ${n.id} has no path to ground`);
    }
  }

  function isTreeBoard(board) {
    try { checkTrees(board); return true; }
    catch { return false; }
  }

  // sides: { red: {id, name}, blue: {id, name} }.
  function newGame(board, mode, sides) {
    return {
      mode,
      board: structuredClone(board),
      turn: "red",
      status: "playing",
      winner: null,
      reason: null,
      sides,
    };
  }

  function canCut(edge, side) {
    return edge.color === side || edge.color === "green";
  }

  function legalMoves(game, side) {
    return game.board.edges.filter((e) => canCut(e, side)).map((e) => e.id);
  }

  // Removes, in place, every edge and node no longer connected to the ground.
  function prune(board) {
    const seen = reachable(board);
    const fellEdges = board.edges.filter((e) => !seen.has(e.a) || !seen.has(e.b)).map((e) => e.id);
    const fellNodes = board.nodes.filter((n) => !seen.has(n.id)).map((n) => n.id);
    board.edges = board.edges.filter((e) => seen.has(e.a) && seen.has(e.b));
    board.nodes = board.nodes.filter((n) => seen.has(n.id));
    const asc = (x, y) => x - y;
    return { edges: fellEdges.sort(asc), nodes: fellNodes.sort(asc) };
  }

  // A pruned copy of the board with one edge cut; no turn checks.
  function cutEdge(board, edgeId) {
    const copy = structuredClone(board);
    copy.edges = copy.edges.filter((e) => e.id !== edgeId);
    prune(copy);
    return copy;
  }

  function reject(message) {
    return { ok: false, code: "illegal_move", message };
  }

  function applyCut(game, side, edgeId) {
    if (game.status !== "playing") return reject("The game is not in progress.");
    if (side !== game.turn) return reject("It is not your turn.");
    const edge = game.board.edges.find((e) => e.id === edgeId);
    if (!edge) return reject("No such edge.");
    if (!canCut(edge, side)) return reject("That edge is not your color.");

    game.board.edges = game.board.edges.filter((e) => e !== edge);
    const fell = prune(game.board);
    game.turn = otherColor(side);
    if (legalMoves(game, game.turn).length === 0) {
      game.status = "finished";
      game.winner = side;
      game.reason = "no_moves";
    }
    return { ok: true, fell };
  }

  function forfeit(game, loserSide, reason) {
    game.status = "finished";
    game.winner = otherColor(loserSide);
    game.reason = reason;
  }

  return { validateBoard, isTreeBoard, newGame, canCut, legalMoves, applyCut, cutEdge, prune, forfeit, otherColor };
});
