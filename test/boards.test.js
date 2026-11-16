const test = require("node:test");
const assert = require("node:assert/strict");
const { BOARDS, SIZES, makeBoard, pickBoardId, mulberry32 } = require("../public/lib/boards.js");
const { validateBoard, newGame, applyCut, legalMoves, otherColor, isTreeBoard } = require("../public/lib/game.js");

const EDGE_COUNTS = {
  small: { classic: 138, houses: 180, cars: 154, animals: 120 },
  medium: { classic: 288, houses: 360, cars: 324, animals: 262 },
  big: { classic: 448, houses: 540, cars: 492, animals: 398 },
};
const ROOT_COUNTS = { small: 12, medium: 24, big: 36 };

test("every board size is valid in all three modes, for 200 seeds", () => {
  for (const { id: size } of SIZES) for (const { id } of BOARDS) {
    for (const mode of ["redblue", "redbluegreen", "green"]) {
      for (let seed = 0; seed < 200; seed++) {
        const b = makeBoard(id, mode, seed, size);
        validateBoard(b);
        assert.equal(b.edges.length, EDGE_COUNTS[size][id], `${id} ${mode} ${seed}`);
        if (mode === "green") assert.ok(b.edges.every((e) => e.color === "green"));
        else {
          assert.ok(b.edges.some((e) => e.color === "red"), `${id} ${seed} red`);
          assert.ok(b.edges.some((e) => e.color === "blue"), `${id} ${seed} blue`);
          assert.ok(b.edges.every((e) => e.color === "red" || e.color === "blue" || (mode === "redbluegreen" && e.color === "green")));
          if (mode === "redbluegreen") assert.ok(b.edges.some(e => e.color === "green"));
        }
        for (const n of b.nodes) {
          assert.ok(n.x >= 0 && n.x <= b.width && n.y >= 0 && n.y <= b.height, `${id} node ${n.id}`);
        }
      }
    }
  }
});

test("cars have circular wheels, and every scene has shared floor junctions", () => {
  const wheels = makeBoard("cars", "green", 0).edges.filter(e => e.loopRadius);
  assert.ok(wheels.length > 0);
  assert.ok(wheels.every(e => e.a === e.b && e.loopRadius > 0));
  for (const { id } of BOARDS) {
    const board = makeBoard(id, "green", 0);
    const ground = new Set(board.nodes.filter(n => n.ground).map(n => n.id));
    const supports = new Map();
    for (const e of board.edges) {
      if (ground.has(e.a)) supports.set(e.b, (supports.get(e.b) || 0) + 1);
      if (ground.has(e.b)) supports.set(e.a, (supports.get(e.a) || 0) + 1);
    }
    assert.equal(supports.size, 18, id);
    assert.ok([...supports.values()].every(n => n >= 2), id);
    assert.ok(!isTreeBoard(board), id);
  }
});

test("the same arguments give the same board; different seeds recolor", () => {
  assert.deepEqual(makeBoard("houses", "redblue", 1), makeBoard("houses", "redblue", 1));
  const a = makeBoard("houses", "redblue", 1).edges.map((e) => e.color).join();
  const b = makeBoard("houses", "redblue", 2).edges.map((e) => e.color).join();
  assert.notEqual(a, b);
});

test("every Red-Blue size and seed has equal edge counts and ground access", () => {
  for (const { id: size } of SIZES) for (const { id } of BOARDS) {
    for (let seed = 0; seed < 200; seed++) {
      const board = makeBoard(id, "redblue", seed, size);
      const ground = new Set(board.nodes.filter(n => n.ground).map(n => n.id));
      const roots = board.edges.filter(e => ground.has(e.a) || ground.has(e.b));
      assert.ok(roots.length >= ROOT_COUNTS[size], `${id} seed ${seed}`);
      for (const color of ["red", "blue"]) {
        assert.equal(roots.filter(e => e.color === color).length, roots.length / 2);
        assert.equal(board.edges.filter(e => e.color === color).length, board.edges.length / 2);
      }
    }
  }
});

test("floor-first games meet each size minimum despite cascading cuts", () => {
  for (const { id: size } of SIZES) for (const { id } of BOARDS) {
    for (const mode of ["redblue", "redbluegreen", "green"]) {
      for (let seed = 0; seed < 20; seed++) {
        const game = newGame(makeBoard(id, mode, seed, size), mode, {});
        const ground = new Set(game.board.nodes.filter(n => n.ground).map(n => n.id));
        const floorEdges = game.board.edges.filter(e => ground.has(e.a) || ground.has(e.b)).length;
        let moves = 0;
        while (game.status === "playing") {
          const legal = new Set(legalMoves(game, game.turn));
          const edge = game.board.edges.find(e => legal.has(e.id) && (ground.has(e.a) || ground.has(e.b)))
            || game.board.edges.find(e => legal.has(e.id));
          assert.ok(edge, "each remaining component has a legal root");
          assert.ok(applyCut(game, game.turn, edge.id).ok);
          moves++;
        }
        if (mode === "redbluegreen") assert.ok(moves >= ROOT_COUNTS[size], `${id} ${mode} seed ${seed}`);
        else assert.equal(moves, floorEdges, `${id} ${mode} seed ${seed}`);
      }
    }
  }
});

test("pickBoardId maps a float in [0,1) to a board id", () => {
  assert.equal(pickBoardId(() => 0), "classic");
  assert.equal(pickBoardId(() => 0.99), "animals");
});

test("mulberry32 matches the reference values", () => {
  const r = mulberry32(1);
  assert.equal(r(), 0.6270739405881613);
  assert.equal(r(), 0.002735721180215478);
});

test("an unknown board id throws", () => {
  assert.throws(() => makeBoard("nope", "redblue", 0), /Unknown board nope/);
});

test("larger sizes add structures and width; omitted size preserves Big", () => {
  for (const { id } of BOARDS) {
    const boards = SIZES.map(s => makeBoard(id, "redblue", 17, s.id));
    for (let i = 1; i < boards.length; i++) {
      assert.ok(boards[i].edges.length > boards[i - 1].edges.length, id);
      assert.ok(boards[i].width > boards[i - 1].width, id);
    }
    assert.deepEqual(makeBoard(id, "redblue", 17), boards[2]);
  }
});

test("an unknown board size throws", () => {
  for (const size of ["huge", "toString", null]) {
    assert.throws(() => makeBoard("classic", "redblue", 0, size), /Unknown board size/);
  }
});

function components(board) {
  const adj = new Map(board.nodes.map(n => [n.id, []]));
  for (const e of board.edges) { adj.get(e.a).push(e.b); adj.get(e.b).push(e.a); }
  const seen = new Set(), parts = [];
  for (const n of board.nodes) {
    if (seen.has(n.id)) continue;
    const part = [], stack = [n.id]; seen.add(n.id);
    while (stack.length) {
      const id = stack.pop(); part.push(id);
      for (const next of adj.get(id)) if (!seen.has(next)) { seen.add(next); stack.push(next); }
    }
    const ids = new Set(part);
    parts.push({ nodes: board.nodes.filter(n => ids.has(n.id)), edges: board.edges.filter(e => ids.has(e.a)) });
  }
  return parts;
}

test("every object has a graph-identical, reflected, opposite-color twin", () => {
  for (const size of SIZES) for (const { id } of BOARDS) for (const mode of ["redblue", "redbluegreen"]) for (let seed = 0; seed < 20; seed++) {
    const board = makeBoard(id, mode, seed, size.id), parts = components(board);
    assert.equal(parts.length, size.pairs * 2);
    for (let i = 0; i < parts.length; i += 2) {
      const left = parts[i], right = parts[i + 1];
      assert.equal(left.nodes.length, right.nodes.length);
      assert.equal(left.edges.length, right.edges.length);
      const offset = right.nodes[0].id - left.nodes[0].id;
      left.nodes.forEach((n, j) => assert.deepEqual(right.nodes[j], { ...n, id: n.id + offset, x: board.width - n.x }));
      left.edges.forEach((e, j) => {
        const expected = { ...e, id: right.edges[j].id, a: e.a + offset, b: e.b + offset, color: e.color === "green" ? "green" : otherColor(e.color) };
        if (e.a === e.b) expected.angle = -e.angle || 0;
        assert.deepEqual(right.edges[j], expected);
      });
    }
  }
});

test("mixed mode only recolors seeded Red-Blue edges, with variable shared positions", () => {
  for (const size of SIZES) for (const { id } of BOARDS) {
    const patterns = new Set();
    for (let seed = 0; seed < 100; seed++) {
      const plain = makeBoard(id, "redblue", seed, size.id);
      const mixed = makeBoard(id, "redbluegreen", seed, size.id);
      assert.deepEqual(mixed.nodes, plain.nodes);
      assert.deepEqual(mixed, makeBoard(id, "redbluegreen", seed, size.id));
      const ground = new Set(mixed.nodes.filter(n => n.ground).map(n => n.id));
      const privateFloor = { red: 0, blue: 0 };
      let greens = 0;
      mixed.edges.forEach((e, i) => {
        if (e.color === "green") greens++;
        else assert.equal(e.color, plain.edges[i].color);
        assert.deepEqual({ ...e, color: plain.edges[i].color }, plain.edges[i]);
        if (e.color !== "green" && (ground.has(e.a) || ground.has(e.b))) privateFloor[e.color]++;
      });
      assert.ok(greens > 0 && greens < mixed.edges.length / 2);
      assert.equal(privateFloor.red, privateFloor.blue);
      assert.ok(privateFloor.red >= ROOT_COUNTS[size.id] / 2);
      patterns.add(mixed.edges.filter(e => e.color === "green").map(e => e.id).join(","));
    }
    assert.ok(patterns.size > 90);
  }
});
