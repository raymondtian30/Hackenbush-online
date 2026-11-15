// Pure Hackenbush rules. No I/O; every function works on plain data.
// Board: { nodes: [{id, x, y, ground}], edges: [{id, a, b, color}] }.

const COLORS = ["red", "blue"];

function otherColor(role) {
  return role === "red" ? "blue" : "red";
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
    if (!nodeIds.has(e.a) || !nodeIds.has(e.b)) {
      throw new Error(`Edge ${e.id} names a missing node`);
    }
  }
  const seen = reachable(board);
  for (const n of board.nodes) {
    if (!seen.has(n.id)) throw new Error(`Node ${n.id} has no path to ground`);
  }
  for (const color of COLORS) {
    if (!board.edges.some((e) => e.color === color)) {
      throw new Error(`Board has no ${color} edge`);
    }
  }
}

function newGame(board) {
  return { board: structuredClone(board), turn: "red", status: "waiting", winner: null, reason: null };
}

function startGame(game) {
  game.status = "playing";
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

function reject(message) {
  return { ok: false, code: "illegal_move", message };
}

function applyCut(game, role, edgeId) {
  if (game.status !== "playing") return reject("The game is not in progress.");
  if (role !== game.turn) return reject("It is not your turn.");
  const edge = game.board.edges.find((e) => e.id === edgeId);
  if (!edge) return reject("No such edge.");
  if (edge.color !== role) return reject("That edge is not your color.");

  game.board.edges = game.board.edges.filter((e) => e !== edge);
  const fell = prune(game.board);
  game.turn = otherColor(role);
  if (!game.board.edges.some((e) => e.color === game.turn)) {
    game.status = "finished";
    game.winner = role;
    game.reason = "no_moves";
  }
  return { ok: true, fell };
}

function forfeit(game, loserRole) {
  game.status = "finished";
  game.winner = otherColor(loserRole);
  game.reason = "forfeit";
}

module.exports = { validateBoard, newGame, startGame, prune, applyCut, forfeit, otherColor };
