// The fixed default board: three stalks with branches, mixed red and blue.
// x runs 0..600; y runs upward from the ground at y = 0.

const N = (id, x, y, ground = false) => ({ id, x, y, ground });
const E = (id, a, b, c) => ({ id, a, b, color: c === "R" ? "red" : "blue" });

const defaultBoard = {
  nodes: [
    N(0, 100, 0, true), N(1, 300, 0, true), N(2, 500, 0, true),
    N(3, 100, 90), N(4, 100, 180), N(5, 40, 250), N(6, 160, 250),
    N(7, 300, 90), N(8, 300, 180), N(9, 240, 250), N(10, 360, 250), N(11, 360, 320),
    N(12, 500, 90), N(13, 500, 180), N(14, 440, 250), N(15, 560, 250),
  ],
  edges: [
    E(0, 0, 3, "R"), E(1, 3, 4, "B"), E(2, 4, 5, "R"), E(3, 4, 6, "B"),
    E(4, 1, 7, "B"), E(5, 7, 8, "R"), E(6, 8, 9, "B"), E(7, 8, 10, "R"), E(8, 10, 11, "B"),
    E(9, 2, 12, "R"), E(10, 12, 13, "B"), E(11, 13, 14, "R"), E(12, 13, 15, "B"),
  ],
};

module.exports = { defaultBoard };
