const test = require("node:test");
const assert = require("node:assert/strict");
const {
  validateBoard,
  newGame,
  canCut,
  legalMoves,
  applyCut,
  cutEdge,
  prune,
  forfeit,
  otherColor,
} = require("../public/lib/game.js");

const SIDES = { red: { id: "m1", name: "A" }, blue: { id: "m2", name: "B" } };
const COLOR = { R: "red", B: "blue", G: "green" };

// nodes: [[id, x, y, ground?]], edges: [[id, a, b, "R"|"B"|"G", angle?]].
function buildBoard(nodes, edges) {
  return {
    width: 600,
    height: 340,
    nodes: nodes.map(([id, x, y, ground = false]) => ({ id, x, y, ground })),
    edges: edges.map(([id, a, b, c, angle]) => {
      const e = { id, a, b, color: COLOR[c] };
      if (angle !== undefined) e.angle = angle;
      return e;
    }),
  };
}

function removeEdge(board, id) {
  board.edges = board.edges.filter((e) => e.id !== id);
}

// Small, fixed rules fixture; catalog layouts may grow without changing these
// focused assertions about pruning, illegal moves and end conditions.
const classic = () => buildBoard(
  [[0, 100, 0, true], [1, 300, 0, true], [2, 500, 0, true],
    [3, 100, 90], [4, 100, 180], [5, 40, 250], [6, 160, 250],
    [7, 300, 90], [8, 300, 180], [9, 240, 250], [10, 360, 250],
    [11, 360, 320], [12, 500, 90], [13, 500, 180], [14, 440, 250], [15, 560, 250]],
  [[0, 0, 3, "R"], [1, 3, 4, "B"], [2, 4, 5, "R"], [3, 4, 6, "B"],
    [4, 1, 7, "B"], [5, 7, 8, "R"], [6, 8, 9, "B"], [7, 8, 10, "R"],
    [8, 10, 11, "B"], [9, 2, 12, "R"], [10, 12, 13, "B"], [11, 13, 14, "R"], [12, 13, 15, "B"]],
);
const playing = (board = classic(), mode = "redblue") => newGame(board, mode, SIDES);

test("the classic board is valid", () => {
  assert.doesNotThrow(() => validateBoard(classic()));
});

test("validateBoard rejects a duplicate node id", () => {
  const b = buildBoard([[0, 0, 0, true], [0, 0, 100]], [[0, 0, 0, "R"]]);
  assert.throws(() => validateBoard(b), /node id/);
});

test("validateBoard rejects a duplicate edge id", () => {
  const b = buildBoard([[0, 0, 0, true], [1, 0, 100]], [[0, 0, 1, "R"], [0, 0, 1, "B"]]);
  assert.throws(() => validateBoard(b), /edge id/);
});

test("validateBoard rejects an edge naming a missing node", () => {
  const b = buildBoard([[0, 0, 0, true], [1, 0, 100]], [[0, 0, 1, "R"], [1, 1, 9, "B"]]);
  assert.throws(() => validateBoard(b), /missing node/);
});

test("validateBoard rejects a node with no path to ground", () => {
  const b = buildBoard(
    [[0, 0, 0, true], [1, 0, 100], [2, 50, 200], [3, 50, 300]],
    [[0, 0, 1, "R"], [1, 2, 3, "R"]],
  );
  assert.throws(() => validateBoard(b), /ground/);
});

test("validateBoard rejects an invalid edge color", () => {
  const b = buildBoard([[0, 0, 0, true], [1, 0, 100]], [[0, 0, 1, "R"]]);
  b.edges[0].color = "purple";
  assert.throws(() => validateBoard(b), /invalid color/);
});

test("validateBoard accepts a cycle", () => {
  const b = buildBoard(
    [[0, 0, 0, true], [1, 0, 100], [2, 50, 150], [3, -50, 150]],
    [[0, 0, 1, "R"], [1, 1, 2, "B"], [2, 2, 3, "R"], [3, 3, 1, "B"]],
  );
  assert.doesNotThrow(() => validateBoard(b));
});

test("validateBoard accepts parallel edges", () => {
  const b = buildBoard([[0, 0, 0, true], [1, 0, 100]], [[0, 0, 1, "R"], [1, 0, 1, "B"]]);
  assert.doesNotThrow(() => validateBoard(b));
});

test("validateBoard accepts multiple ground nodes in one component", () => {
  const b = buildBoard([[0, 0, 0, true], [1, 100, 0, true]], [[0, 0, 1, "R"]]);
  assert.doesNotThrow(() => validateBoard(b));
});

test("validateBoard accepts loops, and a green-only board", () => {
  const b = buildBoard([[0, 0, 0, true], [1, 0, 100]], [[0, 0, 1, "G"], [1, 1, 1, "G", 90]]);
  assert.doesNotThrow(() => validateBoard(b));
});

test("newGame copies the board and starts playing with red to move", () => {
  const board = classic();
  const game = newGame(board, "redblue", SIDES);
  assert.notEqual(game.board.edges, board.edges);
  assert.deepEqual(game.board, board);
  assert.equal(game.mode, "redblue");
  assert.equal(game.turn, "red");
  assert.equal(game.status, "playing");
  assert.equal(game.winner, null);
  assert.equal(game.reason, null);
  assert.deepEqual(game.sides, SIDES);
});

test("cutting edge 0 drops the stalk above it", () => {
  const game = playing();
  const result = applyCut(game, "red", 0);
  assert.deepEqual(result, { ok: true, fell: { edges: [1, 2, 3], nodes: [3, 4, 5, 6] } });
  assert.equal(game.turn, "blue");
});

test("cutting a leaf edge drops only its end node", () => {
  const game = playing();
  applyCut(game, "red", 0);
  assert.deepEqual(applyCut(game, "blue", 12), { ok: true, fell: { edges: [], nodes: [15] } });
});

test("pruning keeps nodes still connected, and drops the rest", () => {
  const b = buildBoard(
    [[0, 0, 0, true], [1, 0, 100], [2, 50, 150]],
    [[0, 0, 1, "R"], [1, 1, 2, "B"]],
  );
  removeEdge(b, 0);
  assert.deepEqual(prune(b), { edges: [1], nodes: [1, 2] });
});

function assertRejected(game, side, edgeId, message) {
  const before = structuredClone(game);
  assert.deepEqual(applyCut(game, side, edgeId), { ok: false, code: "illegal_move", message });
  assert.deepEqual(game, before);
}

test("a cut is rejected once the game is finished", () => {
  const game = playing();
  forfeit(game, "blue", "left");
  assertRejected(game, "red", 0, "The game is not in progress.");
});

test("turn is checked before edge color", () => {
  assertRejected(playing(), "blue", 0, "It is not your turn.");
});

test("a cut is rejected for a missing edge, and for a fallen edge", () => {
  const game = playing();
  assertRejected(game, "red", 99, "No such edge.");
  applyCut(game, "red", 0);
  applyCut(game, "blue", 12);
  assertRejected(game, "red", 2, "No such edge.");
});

test("a cut is rejected for the other color's edge", () => {
  assertRejected(playing(), "red", 1, "That edge is not your color.");
});

test("the R0, B4, R9 game ends with Red winning by no_moves", () => {
  const game = playing();
  applyCut(game, "red", 0);
  applyCut(game, "blue", 4);
  applyCut(game, "red", 9);
  assert.equal(game.status, "finished");
  assert.equal(game.winner, "red");
  assert.equal(game.reason, "no_moves");
});

test("the game ends when the mover has no edge of their color, even if others remain", () => {
  const b = buildBoard(
    [[0, 0, 0, true], [1, 0, 100], [2, 0, 200], [3, 50, 100]],
    [[0, 0, 1, "R"], [1, 1, 2, "B"], [2, 0, 3, "R"]],
  );
  const game = playing(b);
  assert.deepEqual(applyCut(game, "red", 0), { ok: true, fell: { edges: [1], nodes: [1, 2] } });
  assert.equal(game.status, "finished");
  assert.equal(game.winner, "red");
  assert.deepEqual(game.board.edges.map((e) => e.id), [2]);
});

test("a cut that leaves the next player a move keeps the game playing", () => {
  const game = playing();
  applyCut(game, "red", 0);
  assert.equal(game.status, "playing");
  assert.equal(game.winner, null);
});

test("forfeit gives the win to the other color and records the reason", () => {
  const game = playing();
  forfeit(game, "red", "timeout");
  assert.equal(game.status, "finished");
  assert.equal(game.winner, "blue");
  assert.equal(game.reason, "timeout");
});

test("otherColor swaps red and blue", () => {
  assert.equal(otherColor("red"), "blue");
  assert.equal(otherColor("blue"), "red");
});

test("in Green, either side may cut any edge", () => {
  const b = buildBoard([[0, 0, 0, true], [1, 0, 100], [2, 50, 150]], [[0, 0, 1, "G"], [1, 1, 2, "G"]]);
  const game = playing(b, "green");
  assert.deepEqual(legalMoves(game, "red"), [0, 1]);
  assert.deepEqual(legalMoves(game, "blue"), [0, 1]);
  assert.equal(applyCut(game, "red", 1).ok, true);
  assert.equal(applyCut(game, "blue", 0).ok, true);
});

test("a Green game ends when no edges remain, and the player to move loses", () => {
  const b = buildBoard([[0, 0, 0, true], [1, 0, 100]], [[0, 0, 1, "G"]]);
  const game = playing(b, "green");
  applyCut(game, "red", 0);
  assert.equal(game.status, "finished");
  assert.equal(game.winner, "red");
});

test("a red side may cut a green edge on a mixed board", () => {
  const b = buildBoard([[0, 0, 0, true], [1, 0, 100], [2, 50, 150]], [[0, 0, 1, "G"], [1, 1, 2, "B"]]);
  const game = playing(b);
  assert.equal(canCut(game.board.edges[0], "red"), true);
  assert.equal(canCut(game.board.edges[1], "red"), false);
  assert.equal(applyCut(game, "red", 0).ok, true);
});

test("cutting a loop removes only the loop", () => {
  const b = buildBoard([[0, 0, 0, true], [1, 0, 100]], [[0, 0, 1, "R"], [1, 1, 1, "B", 90]]);
  const game = playing(b);
  applyCut(game, "red", 0);
  assert.equal(game.board.edges.length, 0);
  const b2 = buildBoard([[0, 0, 0, true], [1, 0, 100]], [[0, 0, 1, "B"], [1, 1, 1, "R", 90], [2, 0, 1, "B"]].slice(0, 2));
  const g2 = playing(b2);
  assert.deepEqual(applyCut(g2, "red", 1), { ok: true, fell: { edges: [], nodes: [] } });
  assert.deepEqual(g2.board.edges.map((e) => e.id), [0]);
});

test("a loop falls when its node is cut off", () => {
  const b = buildBoard(
    [[0, 0, 0, true], [1, 0, 100], [2, 50, 150]],
    [[0, 0, 1, "R"], [1, 1, 2, "B"], [2, 2, 2, "B", 0]],
  );
  const game = playing(b);
  assert.deepEqual(applyCut(game, "red", 0), { ok: true, fell: { edges: [1, 2], nodes: [1, 2] } });
});

test("cutEdge returns a pruned copy and leaves its input alone", () => {
  const board = classic();
  const before = structuredClone(board);
  const out = cutEdge(board, 0);
  assert.deepEqual(board, before);
  assert.equal(out.edges.length, 9);
  assert.equal(out.nodes.length, 12);
});

test("one shared support can be cut safely; the final support drops the object", () => {
  const board = buildBoard([[0, 0, 0, true], [1, 100, 0, true], [2, 50, 80], [3, 50, 160]],
    [[0, 0, 2, "R"], [1, 1, 2, "B"], [2, 2, 3, "R"]]);
  validateBoard(board);
  const game = playing(board);
  assert.deepEqual(applyCut(game, "red", 0), { ok: true, fell: { edges: [], nodes: [] } });
  assert.ok(game.board.nodes.some(n => n.id === 3));
  assert.deepEqual(applyCut(game, "blue", 1), { ok: true, fell: { edges: [2], nodes: [2, 3] } });
  assert.equal(game.status, "finished");
  assert.equal(game.winner, "blue");
});

test("a closed outline survives a cut while another route still reaches ground", () => {
  const board = buildBoard([[0, 0, 0, true], [1, 0, 100], [2, 60, 100], [3, 30, 180]],
    [[0, 0, 1, "G"], [1, 1, 2, "G"], [2, 2, 3, "G"], [3, 3, 1, "G"]]);
  const after = cutEdge(board, 1);
  assert.equal(after.nodes.length, 4);
  assert.equal(after.edges.length, 3);
  const fallen = cutEdge(after, 0);
  assert.equal(fallen.edges.length, 0);
});

test("Red-Blue-Green lets both players cut green, while private colors stay private", () => {
  const board = buildBoard([[0, 0, 0, true], [1, 20, 100], [2, 40, 100], [3, 60, 100], [4, 80, 100]],
    [[0, 0, 1, "R"], [1, 0, 2, "B"], [2, 0, 3, "G"], [3, 0, 4, "G"]]);
  const game = playing(board, "redbluegreen");
  assert.deepEqual(legalMoves(game, "red"), [0, 2, 3]);
  assert.deepEqual(legalMoves(game, "blue"), [1, 2, 3]);
  assertRejected(game, "red", 1, "That edge is not your color.");
  assert.ok(applyCut(game, "red", 2).ok);
  assertRejected(game, "blue", 0, "That edge is not your color.");
  assert.ok(applyCut(game, "blue", 3).ok);
  assert.equal(game.status, "playing");
});
