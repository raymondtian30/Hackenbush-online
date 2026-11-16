// Named scenes with shared ground supports, closed outlines and branches.
// Every object has a reflected, opposite-colored twin to balance the sides.
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
    { id: "classic", name: "Town & Country" },
    { id: "houses", name: "Neighborhood" },
    { id: "cars", name: "Road Trip" },
    { id: "animals", name: "Animal Park" },
  ];

  const SIZES = [
    { id: "small", name: "Small", pairs: 3 },
    { id: "medium", name: "Medium", pairs: 6 },
    { id: "big", name: "Big", pairs: 9 },
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
      loop(a, angle, loopRadius) {
        const edge = { id: edges.length, a, b: a, color: null, angle: angle || 0 };
        if (loopRadius) edge.loopRadius = loopRadius;
        edges.push(edge);
      },
    };
  }

  function extend(b, parent, points) {
    for (const [x, y] of points) {
      const child = b.node(x, y);
      b.edge(parent, child);
      parent = child;
    }
    return parent;
  }

  function outline(b, points) {
    const start = b.node(...points[0]);
    const end = extend(b, start, points.slice(1));
    b.edge(end, start);
    return start;
  }

  // Two or three different floor edges meet at this single junction. A cut
  // only drops the picture after its final route to the ground is severed.
  function sharedSupports(b, y, third = false) {
    const joint = b.node(0, y);
    for (const x of third ? [-48, 0, 48] : [-48, 48]) {
      const ground = b.node(x, 0, true);
      b.edge(ground, joint);
    }
    return joint;
  }

  function houseShape(i) {
    const b = builder(150, 390);
    const floor = sharedSupports(b, 70, i % 3 === 2);
    const left = b.node(-62, 70), right = b.node(62, 70);
    const doorL = b.node(-14, 70), doorR = b.node(14, 70);
    b.edge(left, doorL); b.edge(doorL, floor); b.edge(floor, doorR); b.edge(doorR, right);
    const height = 188 + (i % 3) * 12;
    const eaveL = extend(b, left, [[-62, 150], [-62, height]]);
    const eaveR = extend(b, right, [[62, 150], [62, height]]);
    b.edge(eaveL, eaveR);
    const roof = b.node(0, height + (i % 2 ? 52 : 60));
    b.edge(eaveL, roof); b.edge(eaveR, roof);
    // A real doorway and two connected window frames create extra cycles.
    const doorTop = extend(b, doorL, [[-14, 130], [14, 130]]);
    b.edge(doorTop, doorR);
    for (const sign of [-1, 1]) {
      const window = outline(b, [[sign * 46, 174], [sign * 24, 174], [sign * 24, 148], [sign * 46, 148]]);
      b.edge(sign < 0 ? eaveL : eaveR, window);
    }
    if (i % 2 === 0) extend(b, roof, [[0, height + 83], [18, height + 83]]);
    else {
      const attic = outline(b, [[-12, height + 12], [12, height + 12], [0, height + 35]]);
      b.edge(roof, attic);
    }
    // Lower the foundation and keep the building compact and square.
    for (const n of b.nodes) if (!n.ground) n.y -= 34;
    return b;
  }

  function carShape(i) {
    const b = builder(150, 310);
    const axle = sharedSupports(b, 60, i % 3 === 2);
    const left = b.node(-65, 105), right = b.node(65, 105);
    const wheelL = b.node(-42, 105), wheelR = b.node(42, 105), floor = b.node(0, 105);
    b.edge(left, wheelL); b.edge(wheelL, floor); b.edge(floor, wheelR); b.edge(wheelR, right);
    b.edge(axle, wheelL); b.edge(axle, wheelR);
    if (i % 3 === 0) { // Sedan: segmented windows share their actual corner nodes.
      const windshield = extend(b, left, [[-65, 145], [-42, 145]]);
      const roofMid = extend(b, windshield, [[-20, 195], [0, 195]]);
      const dash = extend(b, roofMid, [[25, 195], [47, 145]]);
      const hood = extend(b, dash, [[65, 145]]);
      b.edge(hood, right);
      const divider = b.node(0, 145);
      b.edge(windshield, divider); b.edge(divider, dash);
      b.edge(floor, divider); b.edge(divider, roofMid);
    } else if (i % 3 === 1) { // Truck: high cab, cargo bed and exhaust stack.
      const roof = extend(b, left, [[-65, 205]]);
      const bed = extend(b, roof, [[-12, 205], [-12, 145], [20, 145]]);
      const tail = extend(b, bed, [[65, 145]]);
      b.edge(tail, right);
      const window = outline(b, [[-53, 192], [-25, 192], [-25, 170], [-53, 170]]);
      b.edge(roof, window);
      extend(b, bed, [[20, 225], [32, 225]]);
    } else { // Bus: tall roof with three independently attached windows.
      let roof = extend(b, left, [[-65, 205]]);
      for (const x of [-44, -10, 24]) {
        const next = b.node(x, 205); b.edge(roof, next); roof = next;
        const window = outline(b, [[x, 187], [x + 20, 187], [x + 20, 155], [x, 155]]);
        b.edge(roof, window);
      }
      const corner = extend(b, roof, [[65, 205]]);
      b.edge(corner, right);
    }
    // The wheel bottoms meet the ground; shared struts stay below the chassis.
    for (const n of b.nodes) if (!n.ground) n.y = n.id === axle ? 20 : n.y - 57;
    for (const wheel of [wheelL, wheelR]) b.loop(wheel, 180, 24);
    return b;
  }

  function animalShape(i) {
    const b = builder(150, 390);
    const belly = sharedSupports(b, 55, i % 3 === 2);
    if (i % 3 === 2) { // Bird: pointed beak, spread wings and a fan tail.
      const chest = extend(b, belly, [[-22, 110], [-12, 158], [10, 176], [30, 164], [48, 150], [29, 145], [22, 105]]);
      b.edge(chest, belly);
      for (const sign of [-1, 1]) {
        const wing = extend(b, belly, [[sign * 58, 115], [sign * 34, 130]]);
        b.edge(wing, belly);
      }
      extend(b, belly, [[0, 92], [0, 132]]);
      return b;
    }
    const hip = b.node(43, 112), shoulder = b.node(-35, 112);
    const flankR = b.node(43, 55), flankL = b.node(-35, 55);
    b.edge(belly, flankR); b.edge(flankR, hip);
    b.edge(belly, flankL); b.edge(flankL, shoulder); b.edge(hip, shoulder);
    const headStart = b.nodes.length;
    const head = extend(b, shoulder, [[-50, 145], [-45, 180], [-17, 182], [-4, 155], [-18, 137]]);
    b.edge(head, shoulder);
    if (i % 3 === 0) { // Dog: floppy ear, long snout, upright tail.
      extend(b, headStart, [[-68, 148], [-60, 160]]);
      extend(b, headStart + 2, [[-29, 167], [-24, 143]]);
      extend(b, hip, [[58, 126], [67, 153]]);
    } else { // Cat: triangular ears, whiskers and a curled tail.
      extend(b, headStart + 1, [[-51, 197], [-37, 180]]);
      extend(b, headStart + 2, [[-12, 199], [1, 178]]);
      const tail = extend(b, hip, [[62, 122], [62, 153]]);
      b.loop(tail, 0);
      for (const y of [148, 158]) extend(b, head, [[-61, y]]);
    }
    return b;
  }

  const SCENES = {
    classic: i => [houseShape, carShape, animalShape][i % 3](Math.floor(i / 3)),
    houses: i => i % 3 === 2 ? carShape(i) : houseShape(i),
    cars: i => i % 4 === 3 ? houseShape(i) : carShape(i),
    animals: i => i % 4 === 3 ? houseShape(i) : animalShape(i),
  };

  function sceneBoard(id, mode, seed, layout) {
    const b = builder(layout.pairs * 300, 420);
    const rand = mulberry32(seed), greenRand = mulberry32(seed ^ 0x9e3779b9), center = b.width / 2;
    for (let i = 0; i < layout.pairs; i++) {
      const distance = 75 + i * 150;
      pairedComponents(b, SCENES[id](i), (x, y) => [center - distance - x, y],
        (x, y) => [center + distance + x, y], mode, rand, greenRand);
    }
    return { width: b.width, height: b.height, nodes: b.nodes, edges: b.edges };
  }

  function pairedComponents(b, template, left, right, mode, rand, greenRand) {
    const colors = template.edges.map(() => rand() < 0.5 ? "red" : "blue");
    const shared = new Set();
    if (mode === "redbluegreen") {
      // Preserve two private floor supports per object, retaining the size's
      // minimum game length. Extra supports and all picture edges may be green.
      const protectedSupports = new Set(template.edges.filter(e =>
        template.nodes[e.a].ground || template.nodes[e.b].ground).slice(0, 2).map(e => e.id));
      const eligible = template.edges.filter(e => !protectedSupports.has(e.id));
      for (const e of eligible) if (greenRand() < 0.2) shared.add(e.id);
      if (!shared.size) shared.add(eligible[Math.floor(greenRand() * eligible.length)].id);
    }
    for (const [place, swap] of [[left, false], [right, true]]) {
      const offset = b.nodes.length;
      for (const n of template.nodes) {
        const [x, y] = place(n.x, n.y);
        b.node(x, y, n.ground);
      }
      for (const e of template.edges) {
        if (e.a === e.b) b.loop(e.a + offset, swap ? e.angle : -e.angle, e.loopRadius);
        else b.edge(e.a + offset, e.b + offset);
        b.edges[b.edges.length - 1].color = mode === "green" || shared.has(e.id) ? "green"
          : (swap ? (colors[e.id] === "red" ? "blue" : "red") : colors[e.id]);
      }
    }
  }

  function makeBoard(id, mode, seed, size = "big") {
    if (!Object.hasOwn(SCENES, id)) throw new Error(`Unknown board ${id}`);
    const layout = SIZES.find(s => s.id === size);
    if (!layout) throw new Error(`Unknown board size ${size}`);
    return sceneBoard(id, mode, seed, layout);
  }

  return { mulberry32, BOARDS, SIZES, pickBoardId, makeBoard };
});
