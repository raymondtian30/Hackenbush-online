const test = require("node:test");
const assert = require("node:assert/strict");
const { mulberry32, BOARDS, makeBoard } = require("../public/lib/boards.js");
const { newGame, legalMoves, cutEdge } = require("../public/lib/game.js");
const bot = require("../public/lib/bot.js");

const SIDES = { red: { id: "m1", name: "A" }, blue: { id: "m2", name: "B" } };
const COLOR = { R: "red", B: "blue", G: "green" };

// Stalk read from the ground up: "RB" is red at the bottom, blue on top.
function stalk(letters) {
  const nodes = [{ id: 0, x: 0, y: 0, ground: true }];
  const edges = [];
  [...letters].forEach((c, i) => {
    nodes.push({ id: i + 1, x: 0, y: (i + 1) * 50, ground: false });
    edges.push({ id: i, a: i, b: i + 1, color: COLOR[c] });
  });
  return { width: 600, height: 340, nodes, edges };
}

const rbValue = (letters) => bot.toString(bot.redBlueValue(stalk(letters)));

test("Red-Blue stalk values", () => {
  const want = { R: "1", B: "-1", RR: "2", RB: "1/2", RBB: "1/4", RRB: "3/2", RBR: "3/4", BR: "-1/2" };
  for (const [letters, value] of Object.entries(want)) assert.equal(rbValue(letters), value, letters);
});

test("a red loop on a ground node is worth 1", () => {
  const b = { width: 600, height: 340, nodes: [{ id: 0, x: 0, y: 0, ground: true }], edges: [{ id: 0, a: 0, b: 0, color: "red", angle: 0 }] };
  assert.equal(bot.toString(bot.redBlueValue(b)), "1");
});

test("a red edge carrying one red and one blue twig is worth 1", () => {
  const b = {
    width: 600,
    height: 340,
    nodes: [
      { id: 0, x: 0, y: 0, ground: true },
      { id: 1, x: 0, y: 50, ground: false },
      { id: 2, x: 0, y: 100, ground: false },
      { id: 3, x: 50, y: 100, ground: false },
    ],
    edges: [
      { id: 0, a: 0, b: 1, color: "red" },
      { id: 1, a: 1, b: 2, color: "red" },
      { id: 2, a: 1, b: 3, color: "blue" },
    ],
  };
  assert.equal(bot.toString(bot.redBlueValue(b)), "1");
});

test("redBlueValue refuses green edges", () => {
  assert.throws(() => bot.redBlueValue(stalk("G")), /Green edge/);
});

test("Green values: a stalk of k edges is k, two equal stalks cancel, a loop is 1", () => {
  assert.equal(bot.greenValue(stalk("GGG")), 3);
  const two = stalk("GGG");
  two.nodes.push({ id: 10, x: 100, y: 0, ground: true }, { id: 11, x: 100, y: 50 }, { id: 12, x: 100, y: 100 }, { id: 13, x: 100, y: 150 });
  two.edges.push({ id: 10, a: 10, b: 11, color: "green" }, { id: 11, a: 11, b: 12, color: "green" }, { id: 12, a: 12, b: 13, color: "green" });
  assert.equal(bot.greenValue(two), 0);
  const loop = { width: 600, height: 340, nodes: [{ id: 0, x: 0, y: 0, ground: true }], edges: [{ id: 0, a: 0, b: 0, color: "green", angle: 0 }] };
  assert.equal(bot.greenValue(loop), 1);
});

// Random small tree position with loops, for brute-force comparison.
function randomPosition(seed, colors) {
  const r = mulberry32(seed);
  const nodes = [{ id: 0, x: 0, y: 0, ground: true }];
  if (r() < 0.5) nodes.push({ id: 1, x: 100, y: 0, ground: true });
  const edges = [];
  const count = 1 + Math.floor(r() * 7);
  for (let i = 0; i < count; i++) {
    const color = colors[Math.floor(r() * colors.length)];
    const at = nodes[Math.floor(r() * nodes.length)];
    if (r() < 0.25) {
      edges.push({ id: i, a: at.id, b: at.id, color, angle: 0 });
    } else {
      const id = nodes.length;
      nodes.push({ id, x: id * 10, y: 50, ground: false });
      edges.push({ id: i, a: at.id, b: id, color });
    }
  }
  return { width: 600, height: 340, nodes, edges };
}

// The simplest number strictly between a and b (either may be infinite).
function simplest(a, b) {
  if (a < 0 && b > 0) return 0;
  if (a >= 0) {
    const m = Math.floor(a) + 1;
    if (m < b) return m;
  } else if (b <= 0) {
    const m = Math.ceil(b) - 1;
    if (m > a) return m;
  }
  for (let k = 1; ; k++) {
    const m = Math.floor(a * 2 ** k) + 1;
    if (m / 2 ** k < b) return m / 2 ** k;
  }
}

const key = (board) => board.edges.map((e) => e.id).sort((p, q) => p - q).join(",");

function bruteRB(board, memo = new Map()) {
  const k = key(board);
  if (memo.has(k)) return memo.get(k);
  const side = (color) => board.edges.filter((e) => e.color === color).map((e) => bruteRB(cutEdge(board, e.id), memo));
  const left = side("red");
  const right = side("blue");
  const v = simplest(left.length ? Math.max(...left) : -Infinity, right.length ? Math.min(...right) : Infinity);
  memo.set(k, v);
  return v;
}

function bruteG(board, memo = new Map()) {
  const k = key(board);
  if (memo.has(k)) return memo.get(k);
  const options = new Set(board.edges.map((e) => bruteG(cutEdge(board, e.id), memo)));
  let v = 0;
  while (options.has(v)) v++;
  memo.set(k, v);
  return v;
}

const asNumber = (v) => Number(v.n) / 2 ** v.e;

test("Red-Blue value equals brute force on 300 random positions", () => {
  for (let seed = 0; seed < 300; seed++) {
    const board = randomPosition(seed, ["red", "blue"]);
    assert.equal(asNumber(bot.redBlueValue(board)), bruteRB(board), `seed ${seed}`);
  }
});

test("Green value equals brute force on 300 random positions", () => {
  for (let seed = 0; seed < 300; seed++) {
    const board = randomPosition(seed, ["green"]);
    assert.equal(bot.greenValue(board), bruteG(board), `seed ${seed}`);
  }
});

test("Hard's best moves keep every won position won", () => {
  let checked = 0;
  for (let seed = 0; seed < 100; seed++) {
    for (const mode of ["redblue", "green"]) {
      const board = randomPosition(seed, mode === "green" ? ["green"] : ["red", "blue"]);
      for (const side of ["red", "blue"]) {
        if (mode === "green" && side === "blue") continue;
        const game = newGame(board, mode, SIDES);
        if (legalMoves(game, side).length === 0) continue;
        let wins;
        if (mode === "green") wins = bruteG(board) !== 0;
        else {
          const v = bruteRB(board);
          wins = side === "red" ? v > 0 : v < 0;
        }
        if (!wins) continue;
        for (const id of bot.bestMoves(game, side)) {
          const after = cutEdge(board, id);
          if (mode === "green") assert.equal(bruteG(after), 0, `green seed ${seed}`);
          else if (side === "red") assert.ok(bruteRB(after) >= 0, `red seed ${seed} id ${id}`);
          else assert.ok(bruteRB(after) <= 0, `blue seed ${seed} id ${id}`);
        }
        checked++;
      }
    }
  }
  assert.ok(checked > 40, `only ${checked} winnable positions checked`);
});

test("difficulty picks best moves or any legal move by the random draw", () => {
  const board = {
    width: 600,
    height: 340,
    nodes: [
      { id: 0, x: 0, y: 0, ground: true },
      { id: 1, x: 0, y: 50, ground: false },
      { id: 2, x: 0, y: 100, ground: false },
    ],
    edges: [
      { id: 0, a: 0, b: 0, color: "red", angle: 0 },
      { id: 1, a: 0, b: 1, color: "red" },
      { id: 2, a: 1, b: 2, color: "blue" },
    ],
  };
  const game = newGame(board, "redblue", SIDES);
  assert.deepEqual(legalMoves(game, "red"), [0, 1]);
  assert.deepEqual(bot.bestMoves(game, "red"), [1]);
  const draws = (...values) => () => values.shift();
  assert.equal(bot.chooseMove(game, "red", "easy", draws(0.99, 0.0)), 0);
  assert.equal(bot.chooseMove(game, "red", "hard", draws(0.99, 0.0)), 1);
  assert.equal(bot.chooseMove(game, "red", "medium", draws(0.5, 0.0)), 1);
  assert.equal(bot.chooseMove(newGame({ ...board, edges: [board.edges[2]] }, "redblue", SIDES), "red", "hard"), null);
});

test("a hard move takes under 200 ms on every board in both modes", () => {
  for (const { id } of BOARDS) {
    for (const mode of ["redblue", "green"]) {
      const game = newGame(makeBoard(id, mode, 0), mode, SIDES);
      const start = performance.now();
      const move = bot.chooseMove(game, "red", "hard");
      const ms = performance.now() - start;
      assert.ok(move !== null);
      assert.ok(ms < 200, `${id} ${mode}: ${ms.toFixed(1)} ms`);
    }
  }
});
