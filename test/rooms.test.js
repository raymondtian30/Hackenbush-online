const test = require("node:test");
const assert = require("node:assert/strict");
const { createRegistry, RoomCapError } = require("../server/rooms");

const OPTS = { waitingMs: 600000, graceMs: 60000, finishedMs: 60000 };

function fakeConn() {
  return {
    session: null,
    sent: [],
    closed: null,
    send(obj) {
      this.sent.push(obj);
    },
    close(code, reason) {
      this.closed = { code, reason };
    },
  };
}

function last(conn, type) {
  return conn.sent.filter((m) => m.type === type).at(-1);
}

// A registry with a room that red and blue have both joined.
function twoPlayers(t, opts = {}) {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const registry = createRegistry({ ...OPTS, ...opts });
  t.after(() => registry.shutdown());
  const code = registry.createRoom();
  const red = fakeConn();
  const blue = fakeConn();
  registry.join(red, code);
  registry.join(blue, code);
  return { registry, code, red, blue };
}

test("createRoom returns a 5-character code from the alphabet", (t) => {
  const registry = createRegistry();
  t.after(() => registry.shutdown());
  for (let i = 0; i < 50; i++) {
    assert.match(registry.createRoom(), /^[A-HJ-NP-Z2-9]{5}$/);
  }
});

test("createRoom throws RoomCapError at maxRooms", (t) => {
  const registry = createRegistry({ maxRooms: 2 });
  t.after(() => registry.shutdown());
  registry.createRoom();
  registry.createRoom();
  assert.throws(() => registry.createRoom(), RoomCapError);
});

test("seats go red then blue, and a third player without a token is refused", (t) => {
  const { registry, code, red, blue } = twoPlayers(t);
  assert.equal(last(red, "joined").role, "red");
  assert.equal(last(blue, "joined").role, "blue");
  assert.equal(last(red, "state").game.status, "playing");
  const third = fakeConn();
  registry.join(third, code);
  assert.equal(last(third, "error").code, "room_full");
  assert.equal(third.session, null);
});

test("a join with a seat's token reclaims it and closes the old conn with 4000", (t) => {
  const { registry, code, red } = twoPlayers(t);
  const token = last(red, "joined").token;
  const again = fakeConn();
  registry.join(again, code, token);
  assert.equal(last(again, "joined").role, "red");
  assert.deepEqual(red.closed, { code: 4000, reason: "replaced" });
  assert.equal(red.session, null);
  registry.cut(red, 0);
  assert.equal(last(red, "error").code, "not_joined");
  registry.cut(again, 0);
  assert.equal(last(again, "state").lastMove.edgeId, 0);
});

test("an unknown code gets room_not_found", (t) => {
  const registry = createRegistry();
  t.after(() => registry.shutdown());
  const conn = fakeConn();
  registry.join(conn, "ZZZZZ");
  assert.equal(last(conn, "error").code, "room_not_found");
});

test("a lowercase code joins, and joined.code is upper case", (t) => {
  const registry = createRegistry();
  t.after(() => registry.shutdown());
  const code = registry.createRoom();
  const conn = fakeConn();
  registry.join(conn, code.toLowerCase());
  assert.equal(last(conn, "joined").code, code);
});

test("cut before join gets not_joined", (t) => {
  const registry = createRegistry();
  t.after(() => registry.shutdown());
  const conn = fakeConn();
  registry.cut(conn, 0);
  assert.equal(last(conn, "error").code, "not_joined");
});

test("a second join on one conn gets bad_message", (t) => {
  const registry = createRegistry();
  t.after(() => registry.shutdown());
  const code = registry.createRoom();
  const conn = fakeConn();
  registry.join(conn, code);
  registry.join(conn, code);
  assert.equal(last(conn, "error").code, "bad_message");
  assert.equal(conn.sent.filter((m) => m.type === "joined").length, 1);
});

test("an illegal cut gets illegal_move and changes nothing", (t) => {
  const { registry, blue, red } = twoPlayers(t);
  const before = red.sent.length;
  registry.cut(blue, 1);
  assert.equal(last(blue, "error").code, "illegal_move");
  assert.equal(red.sent.length, before);
});

test("the R0, B4, R9 game ends with Red the winner on both conns", (t) => {
  const { registry, red, blue } = twoPlayers(t);
  registry.cut(red, 0);
  registry.cut(blue, 4);
  registry.cut(red, 9);
  for (const conn of [red, blue]) {
    const s = last(conn, "state");
    assert.equal(s.game.status, "finished");
    assert.equal(s.game.winner, "red");
    assert.deepEqual(s.lastMove, { edgeId: 9, fell: { edges: [10, 11, 12], nodes: [12, 13, 14, 15] } });
  }
});

test("a state broadcast shows a disconnected opponent", (t) => {
  const { registry, red, blue } = twoPlayers(t);
  registry.disconnect(blue);
  assert.deepEqual(last(red, "state").players, { red: { connected: true }, blue: { connected: false } });
});

test("a rejoin within the grace period keeps the game playing", (t) => {
  const { registry, code, red, blue } = twoPlayers(t);
  const token = last(blue, "joined").token;
  registry.disconnect(blue);
  t.mock.timers.tick(59000);
  const back = fakeConn();
  registry.join(back, code, token);
  t.mock.timers.tick(10000);
  assert.equal(last(red, "state").game.status, "playing");
  assert.deepEqual(last(red, "state").players.blue, { connected: true });
});

test("a disconnect past the grace period forfeits to the other color", (t) => {
  const { registry, red, blue } = twoPlayers(t);
  registry.disconnect(blue);
  t.mock.timers.tick(60000);
  const s = last(red, "state");
  assert.equal(s.game.status, "finished");
  assert.equal(s.game.winner, "red");
  assert.equal(s.game.reason, "forfeit");
  assert.equal(s.lastMove, undefined);
});

test("a seat disconnected while waiting starts its grace timer when the game starts", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const registry = createRegistry(OPTS);
  t.after(() => registry.shutdown());
  const code = registry.createRoom();
  const red = fakeConn();
  registry.join(red, code);
  registry.disconnect(red);
  t.mock.timers.tick(120000);
  const blue = fakeConn();
  registry.join(blue, code);
  assert.equal(last(blue, "state").game.status, "playing");
  t.mock.timers.tick(60000);
  const s = last(blue, "state");
  assert.equal(s.game.winner, "blue");
  assert.equal(s.game.reason, "forfeit");
});

test("an unjoined room is deleted after waitingMs", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const registry = createRegistry(OPTS);
  t.after(() => registry.shutdown());
  const code = registry.createRoom();
  t.mock.timers.tick(600000);
  const conn = fakeConn();
  registry.join(conn, code);
  assert.equal(last(conn, "error").code, "room_not_found");
});

test("a finished room is deleted after finishedMs and its conns are closed", (t) => {
  const { registry, code, red, blue } = twoPlayers(t);
  registry.cut(red, 0);
  registry.cut(blue, 4);
  registry.cut(red, 9);
  t.mock.timers.tick(59000);
  assert.equal(red.closed, null);
  t.mock.timers.tick(1000);
  assert.deepEqual(red.closed, { code: 1000, reason: "room closed" });
  assert.equal(red.session, null);
  const conn = fakeConn();
  registry.join(conn, code);
  assert.equal(last(conn, "error").code, "room_not_found");
});
