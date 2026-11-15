const test = require("node:test");
const assert = require("node:assert/strict");
const { defaultBoard } = require("../server/board");
const {
  validateBoard,
  newGame,
  startGame,
  prune,
  applyCut,
  forfeit,
  otherColor,
} = require("../server/game");

// Builds a board from compact lists:
// nodes: [[id, x, y, ground?]], edges: [[id, a, b, "R"|"B"]].
function makeBoard(nodes, edges) {
  return {
    nodes: nodes.map(([id, x, y, ground = false]) => ({ id, x, y, ground })),
    edges: edges.map(([id, a, b, c]) => ({ id, a, b, color: c === "R" ? "red" : "blue" })),
  };
}

function removeEdge(board, id) {
  board.edges = board.edges.filter((e) => e.id !== id);
}

function playingGame(board = defaultBoard) {
  const game = newGame(board);
  startGame(game);
  return game;
}

test("default board is valid", () => {
  assert.doesNotThrow(() => validateBoard(defaultBoard));
});

test("validateBoard rejects a duplicate node id", () => {
  const b = makeBoard([[0, 0, 0, true], [0, 0, 100]], [[0, 0, 0, "R"], [1, 0, 0, "B"]]);
  assert.throws(() => validateBoard(b), /node id/);
});

test("validateBoard rejects a duplicate edge id", () => {
  const b = makeBoard([[0, 0, 0, true], [1, 0, 100]], [[0, 0, 1, "R"], [0, 0, 1, "B"]]);
  assert.throws(() => validateBoard(b), /edge id/);
});

test("validateBoard rejects an edge naming a missing node", () => {
  const b = makeBoard([[0, 0, 0, true], [1, 0, 100]], [[0, 0, 1, "R"], [1, 1, 9, "B"]]);
  assert.throws(() => validateBoard(b), /missing node/);
});

test("validateBoard rejects a node with no path to ground", () => {
  const b = makeBoard(
    [[0, 0, 0, true], [1, 0, 100], [2, 50, 200], [3, 50, 300]],
    [[0, 0, 1, "R"], [1, 0, 1, "B"], [2, 2, 3, "R"]],
  );
  assert.throws(() => validateBoard(b), /ground/);
});

test("validateBoard rejects a board with no blue edge", () => {
  const b = makeBoard([[0, 0, 0, true], [1, 0, 100]], [[0, 0, 1, "R"]]);
  assert.throws(() => validateBoard(b), /blue/);
});

test("newGame copies the board and starts waiting with red to move", () => {
  const game = newGame(defaultBoard);
  assert.notEqual(game.board, defaultBoard);
  assert.deepEqual(game.board, defaultBoard);
  assert.equal(game.turn, "red");
  assert.equal(game.status, "waiting");
  assert.equal(game.winner, null);
  assert.equal(game.reason, null);
});

test("cutting edge 0 drops the stalk above it", () => {
  const game = playingGame();
  const result = applyCut(game, "red", 0);
  assert.deepEqual(result, { ok: true, fell: { edges: [1, 2, 3], nodes: [3, 4, 5, 6] } });
  assert.equal(game.turn, "blue");
  assert.ok(!game.board.edges.some((e) => [0, 1, 2, 3].includes(e.id)));
  assert.ok(!game.board.nodes.some((n) => [3, 4, 5, 6].includes(n.id)));
});

test("cutting a leaf edge drops only its end node", () => {
  const game = playingGame();
  applyCut(game, "red", 0);
  const result = applyCut(game, "blue", 12);
  assert.deepEqual(result, { ok: true, fell: { edges: [], nodes: [15] } });
});

test("pruning a cycle keeps nodes still connected the other way round", () => {
  const b = makeBoard(
    [[0, 0, 0, true], [1, 0, 100], [2, 50, 150], [3, -50, 150]],
    [[0, 0, 1, "R"], [1, 1, 2, "B"], [2, 2, 3, "R"], [3, 3, 1, "B"]],
  );
  removeEdge(b, 1);
  assert.deepEqual(prune(b), { edges: [], nodes: [] });
  removeEdge(b, 3);
  assert.deepEqual(prune(b), { edges: [2], nodes: [2, 3] });
});

test("pruning keeps a node held by a parallel edge", () => {
  const b = makeBoard([[0, 0, 0, true], [1, 0, 100]], [[0, 0, 1, "R"], [1, 0, 1, "B"]]);
  removeEdge(b, 0);
  assert.deepEqual(prune(b), { edges: [], nodes: [] });
});

test("an edge between two ground nodes never falls", () => {
  const b = makeBoard(
    [[0, 0, 0, true], [1, 100, 0, true], [2, 50, 100]],
    [[0, 0, 1, "R"], [1, 1, 2, "B"]],
  );
  assert.deepEqual(prune(b), { edges: [], nodes: [] });
  removeEdge(b, 1);
  assert.deepEqual(prune(b), { edges: [], nodes: [2] });
  assert.deepEqual(b.edges.map((e) => e.id), [0]);
});

function assertRejected(game, role, edgeId, message) {
  const before = structuredClone(game);
  assert.deepEqual(applyCut(game, role, edgeId), { ok: false, code: "illegal_move", message });
  assert.deepEqual(game, before);
}

test("a cut is rejected while the game is waiting", () => {
  assertRejected(newGame(defaultBoard), "red", 0, "The game is not in progress.");
});

test("a cut is rejected once the game is finished", () => {
  const game = playingGame();
  forfeit(game, "blue");
  assertRejected(game, "red", 0, "The game is not in progress.");
});

test("a cut is rejected out of turn", () => {
  assertRejected(playingGame(), "blue", 1, "It is not your turn.");
});

test("a cut is rejected for a missing edge", () => {
  assertRejected(playingGame(), "red", 99, "No such edge.");
});

test("a cut is rejected for the other color's edge", () => {
  assertRejected(playingGame(), "red", 1, "That edge is not your color.");
});

test("the player left with no edge of their color loses", () => {
  const game = playingGame();
  applyCut(game, "red", 0);
  applyCut(game, "blue", 4);
  applyCut(game, "red", 9);
  assert.equal(game.status, "finished");
  assert.equal(game.winner, "red");
  assert.equal(game.reason, "no_moves");
});

test("the game ends when the player to move has no edge of their color, even if other edges remain", () => {
  const b = makeBoard(
    [[0, 0, 0, true], [1, 0, 100], [2, 0, 200], [3, 50, 100]],
    [[0, 0, 1, "R"], [1, 1, 2, "B"], [2, 0, 3, "R"]],
  );
  const game = playingGame(b);
  assert.deepEqual(applyCut(game, "red", 0), { ok: true, fell: { edges: [1], nodes: [1, 2] } });
  assert.equal(game.status, "finished");
  assert.equal(game.winner, "red");
  assert.equal(game.reason, "no_moves");
  assert.deepEqual(game.board.edges.map((e) => e.id), [2]);
});

test("a cut that leaves both colors with edges keeps the game playing", () => {
  const game = playingGame();
  applyCut(game, "red", 0);
  assert.equal(game.status, "playing");
  assert.equal(game.winner, null);
});

test("turn is checked before edge color", () => {
  assertRejected(playingGame(), "blue", 0, "It is not your turn.");
});

test("an edge that already fell cannot be cut", () => {
  const game = playingGame();
  applyCut(game, "red", 0);
  applyCut(game, "blue", 12);
  assertRejected(game, "red", 2, "No such edge.");
});

test("newGame deep-copies the board", () => {
  const game = newGame(defaultBoard);
  assert.notEqual(game.board.edges, defaultBoard.edges);
  assert.notEqual(game.board.edges[0], defaultBoard.edges[0]);
});

test("validateBoard rejects a board with no red edge", () => {
  const b = makeBoard([[0, 0, 0, true], [1, 0, 100]], [[0, 0, 1, "B"]]);
  assert.throws(() => validateBoard(b), /red/);
});

test("forfeit gives the win to the other color", () => {
  const game = playingGame();
  forfeit(game, "red");
  assert.equal(game.status, "finished");
  assert.equal(game.winner, "blue");
  assert.equal(game.reason, "forfeit");
});

test("otherColor swaps red and blue", () => {
  assert.equal(otherColor("red"), "blue");
  assert.equal(otherColor("blue"), "red");
});
