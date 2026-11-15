const test = require("node:test");
const assert = require("node:assert/strict");
const { BOARDS, makeBoard, pickBoardId, mulberry32 } = require("../public/lib/boards.js");
const { validateBoard } = require("../public/lib/game.js");

const EDGE_COUNTS = { classic: 13, flowers: 54, forest: 48, bouquet: 43 };

test("every board is valid with the right size in both modes, for 200 seeds", () => {
  for (const { id } of BOARDS) {
    for (const mode of ["redblue", "green"]) {
      for (let seed = 0; seed < 200; seed++) {
        const b = makeBoard(id, mode, seed);
        validateBoard(b);
        assert.equal(b.edges.length, EDGE_COUNTS[id], `${id} ${mode} ${seed}`);
        if (mode === "green") assert.ok(b.edges.every((e) => e.color === "green"));
        else {
          assert.ok(b.edges.some((e) => e.color === "red"), `${id} ${seed} red`);
          assert.ok(b.edges.some((e) => e.color === "blue"), `${id} ${seed} blue`);
          assert.ok(b.edges.every((e) => e.color === "red" || e.color === "blue"));
        }
        for (const n of b.nodes) {
          assert.ok(n.x >= 0 && n.x <= b.width && n.y >= 0 && n.y <= b.height, `${id} node ${n.id}`);
        }
      }
    }
  }
});

test("flowers, forest and bouquet have loops; loops carry an angle", () => {
  for (const id of ["flowers", "bouquet"]) {
    const loops = makeBoard(id, "green", 0).edges.filter((e) => e.a === e.b);
    assert.ok(loops.length > 0, id);
    assert.ok(loops.every((e) => typeof e.angle === "number"));
  }
  assert.equal(makeBoard("forest", "green", 0).edges.filter((e) => e.a === e.b).length, 0);
});

test("the same arguments give the same board; different seeds recolor", () => {
  assert.deepEqual(makeBoard("flowers", "redblue", 1), makeBoard("flowers", "redblue", 1));
  const a = makeBoard("flowers", "redblue", 1).edges.map((e) => e.color).join();
  const b = makeBoard("flowers", "redblue", 2).edges.map((e) => e.color).join();
  assert.notEqual(a, b);
});

test("classic keeps its v1 colors and shape", () => {
  const b = makeBoard("classic", "redblue", 99);
  assert.equal(b.width, 600);
  assert.equal(b.height, 340);
  assert.deepEqual(b.edges.filter((e) => e.color === "red").map((e) => e.id), [0, 2, 5, 7, 9, 11]);
});

test("pickBoardId maps a float in [0,1) to a board id", () => {
  assert.equal(pickBoardId(() => 0), "classic");
  assert.equal(pickBoardId(() => 0.99), "bouquet");
});

test("mulberry32 matches the reference values", () => {
  const r = mulberry32(1);
  assert.equal(r(), 0.6270739405881613);
  assert.equal(r(), 0.002735721180215478);
});

test("an unknown board id throws", () => {
  assert.throws(() => makeBoard("nope", "redblue", 0), /Unknown board nope/);
});
