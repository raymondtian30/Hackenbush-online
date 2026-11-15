const test = require("node:test");
const assert = require("node:assert/strict");
const { createRegistry, RoomCapError, cleanName } = require("../server/rooms");

const OPTS = { waitingMs: 600000, graceMs: 60000, idleMs: 1800000 };

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

const last = (conn, type) => conn.sent.filter((m) => m.type === type).at(-1);
const room = (conn) => last(conn, "room").room;
const err = (conn) => last(conn, "error");
const queue = (...values) => (max) => (values.length ? values.shift() : 0) % (max || 1);

function makeRegistry(t, opts = {}) {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const registry = createRegistry({ ...OPTS, ...opts });
  t.after(() => registry.shutdown());
  return registry;
}

// A room with host Ana (m1) and guest Ben (m2), both connected, in the lobby.
function twoInLobby(t, opts = {}) {
  const registry = makeRegistry(t, opts);
  const code = registry.createRoom();
  const host = fakeConn();
  const guest = fakeConn();
  registry.join(host, code, "Ana");
  registry.join(guest, code, "Ben");
  return { registry, code, host, guest };
}

// Same, then a started game on classic with the host as Red.
function started(t, mode = "redblue") {
  const ctx = twoInLobby(t, { rng: queue(0) });
  ctx.registry.updateSettings(ctx.host, { mode, board: "classic", redPlayer: "host" });
  ctx.registry.start(ctx.host);
  return ctx;
}

test("room codes use the 32-character alphabet", (t) => {
  const registry = makeRegistry(t);
  for (let i = 0; i < 50; i++) assert.match(registry.createRoom(), /^[A-HJ-NP-Z2-9]{5}$/);
});

test("createRoom throws RoomCapError at maxRooms", (t) => {
  const registry = makeRegistry(t, { maxRooms: 2 });
  registry.createRoom();
  registry.createRoom();
  assert.throws(() => registry.createRoom(), RoomCapError);
});

test("a room nobody joins is deleted after waitingMs", (t) => {
  const registry = makeRegistry(t);
  const code = registry.createRoom();
  t.mock.timers.tick(600000);
  const conn = fakeConn();
  registry.join(conn, code, "Ana");
  assert.equal(err(conn).code, "room_not_found");
});

test("cleanName strips invisible and control characters, trims, and cuts to 20 code points", () => {
  assert.equal(cleanName(" ‮Ana\u0000 "), "Ana");
  assert.equal(cleanName("​‏ "), "");
  assert.equal(cleanName("x".repeat(25)), "x".repeat(20));
  assert.equal(Array.from(cleanName("\u{1F600}".repeat(25))).length, 20);
});

test("a lowercase code joins; the first joiner is host; joined carries the member id", (t) => {
  const registry = makeRegistry(t);
  const code = registry.createRoom();
  const conn = fakeConn();
  registry.join(conn, code.toLowerCase(), "Ana");
  const joined = last(conn, "joined");
  assert.equal(joined.code, code);
  assert.equal(joined.memberId, "m1");
  assert.equal(room(conn).hostId, "m1");
  assert.deepEqual(room(conn).members, [{ id: "m1", name: "Ana", connected: true }]);
});

test("an empty name gets bad_name, an unknown code room_not_found", (t) => {
  const registry = makeRegistry(t);
  const code = registry.createRoom();
  const a = fakeConn();
  registry.join(a, code, "  ​ ");
  assert.equal(err(a).code, "bad_name");
  assert.equal(a.session, null);
  const b = fakeConn();
  registry.join(b, "ZZZZZ", "Ana");
  assert.equal(err(b).code, "room_not_found");
});

test("a third joiner gets room_full; joining twice on one conn gets bad_message", (t) => {
  const { registry, code, host } = twoInLobby(t);
  const third = fakeConn();
  registry.join(third, code, "Cat");
  assert.equal(err(third).code, "room_full");
  registry.join(host, code, "Ana");
  assert.equal(err(host).code, "bad_message");
});

test("member ids are never reused, and a removed member's token joins as a new member", (t) => {
  const { registry, code, guest } = twoInLobby(t);
  const token = last(guest, "joined").token;
  registry.leave(guest);
  const again = fakeConn();
  registry.join(again, code, "Ben", token);
  assert.equal(last(again, "joined").memberId, "m3");
  assert.deepEqual(room(again).members.map((m) => m.id), ["m1", "m3"]);
});

test("a rejoin with the token closes the old conn with 4000 and updates the name", (t) => {
  const { registry, code, host, guest } = twoInLobby(t);
  const token = last(guest, "joined").token;
  const fresh = fakeConn();
  registry.join(fresh, code, "Benny", token);
  assert.deepEqual(guest.closed, { code: 4000, reason: "replaced" });
  assert.equal(guest.session, null);
  assert.equal(room(host).members[1].name, "Benny");
  registry.cut(guest, 0);
  assert.equal(err(guest).code, "not_joined");
});

test("the snapshot never contains a token", (t) => {
  const { host, guest } = twoInLobby(t);
  const token = last(guest, "joined").token;
  assert.ok(!JSON.stringify(last(host, "room")).includes(token));
});

test("settings, start, cut and leave before joining get not_joined", (t) => {
  const registry = makeRegistry(t);
  const conn = fakeConn();
  registry.updateSettings(conn, { mode: "green" });
  registry.start(conn);
  registry.cut(conn, 0);
  registry.leave(conn);
  assert.deepEqual(conn.sent.map((m) => m.code), ["not_joined", "not_joined", "not_joined", "not_joined"]);
});

test("a new room starts with the default settings and no game", (t) => {
  const { host } = twoInLobby(t);
  assert.deepEqual(room(host).settings, { mode: "redblue", board: "random", redPlayer: "random" });
  assert.equal(room(host).game, null);
  assert.equal(room(host).status, "lobby");
});

test("only the host changes settings, only in the lobby, and errors come in order", (t) => {
  const { registry, host, guest } = twoInLobby(t, { rng: queue(0) });
  registry.updateSettings(guest, { mode: "green" });
  assert.equal(err(guest).code, "not_host");
  registry.start(guest);
  assert.equal(err(guest).code, "not_host");
  registry.updateSettings(host, { mode: "green", board: "classic" });
  assert.equal(room(guest).settings.mode, "green");
  registry.start(host);
  assert.equal(room(host).status, "playing");
  registry.updateSettings(guest, { mode: "redblue" });
  assert.equal(err(guest).code, "not_host");
  registry.updateSettings(host, { mode: "redblue" });
  assert.equal(err(host).code, "not_in_lobby");
  registry.start(host);
  assert.equal(err(host).code, "not_in_lobby");
});

test("start needs two connected members", (t) => {
  const registry = makeRegistry(t);
  const code = registry.createRoom();
  const host = fakeConn();
  registry.join(host, code, "Ana");
  registry.start(host);
  assert.equal(err(host).code, "not_ready");
  const guest = fakeConn();
  registry.join(guest, code, "Ben");
  registry.disconnect(guest);
  registry.start(host);
  assert.equal(err(host).code, "not_ready");
});

test("a cut in the lobby, before or after a game, gets illegal_move", (t) => {
  const { registry, host } = twoInLobby(t);
  registry.cut(host, 0);
  assert.deepEqual([err(host).code, err(host).message], ["illegal_move", "The game is not in progress."]);
});

test("redPlayer host and guest decide the sides", (t) => {
  for (const [redPlayer, redId] of [["host", "m1"], ["guest", "m2"]]) {
    const { registry, host } = twoInLobby(t, { rng: queue(0) });
    registry.updateSettings(host, { board: "classic", redPlayer });
    registry.start(host);
    assert.equal(room(host).game.sides.red.id, redId);
    assert.equal(room(host).game.sides.red.name, redId === "m1" ? "Ana" : "Ben");
  }
});

test("redPlayer random and board random use rng in the order board, red player, seed", (t) => {
  let ctx = twoInLobby(t, { rng: queue(0, 0) });
  ctx.registry.updateSettings(ctx.host, { board: "classic", redPlayer: "random" });
  ctx.registry.start(ctx.host);
  assert.equal(room(ctx.host).game.sides.red.id, "m1");

  ctx = twoInLobby(t, { rng: queue(1, 0) });
  ctx.registry.updateSettings(ctx.host, { board: "classic", redPlayer: "random" });
  ctx.registry.start(ctx.host);
  assert.equal(room(ctx.host).game.sides.red.id, "m2");

  ctx = twoInLobby(t, { rng: queue(2, 0) });
  ctx.registry.updateSettings(ctx.host, { board: "random", redPlayer: "host" });
  ctx.registry.start(ctx.host);
  assert.equal(room(ctx.host).game.board.width, 820);
});

test("redPlayer host means the new host after a hand-over", (t) => {
  const { registry, code, host, guest } = twoInLobby(t, { rng: queue(0) });
  registry.leave(host);
  const cat = fakeConn();
  registry.join(cat, code, "Cat");
  assert.equal(room(guest).hostId, "m2");
  registry.updateSettings(guest, { board: "classic", redPlayer: "host" });
  registry.start(guest);
  assert.equal(room(cat).game.sides.red.id, "m2");
});

test("a Red-Blue game ends back in the lobby with the finished game and the winner", (t) => {
  const { registry, host, guest } = started(t);
  assert.equal(room(host).status, "playing");
  assert.equal(room(host).gameNumber, 1);
  registry.cut(host, 0);
  registry.cut(guest, 4);
  registry.cut(host, 9);
  for (const conn of [host, guest]) {
    const r = room(conn);
    assert.equal(r.status, "lobby");
    assert.equal(r.game.status, "finished");
    assert.equal(r.game.winner, "red");
    assert.equal(r.game.reason, "no_moves");
    assert.equal(r.game.sides.red.name, "Ana");
  }
  assert.deepEqual(last(host, "room").lastMove, { edgeId: 9, fell: { edges: [10, 11, 12], nodes: [12, 13, 14, 15] } });
});

test("a Green game lets both sides cut, then play again starts game 2", (t) => {
  const { registry, host, guest } = started(t, "green");
  registry.cut(host, 0);
  registry.cut(guest, 4);
  registry.cut(host, 9);
  assert.equal(room(guest).game.winner, "red");
  assert.equal(room(guest).status, "lobby");
  registry.start(host);
  assert.equal(room(host).gameNumber, 2);
  assert.equal(room(host).status, "playing");
  assert.equal(room(host).game.status, "playing");
});

test("a Red-Blue illegal cut gets illegal_move and changes nothing", (t) => {
  const { registry, host, guest } = started(t);
  const before = host.sent.length;
  registry.cut(guest, 1);
  assert.equal(err(guest).code, "illegal_move");
  assert.equal(host.sent.length, before);
});

test("leaving mid-game: the other side wins with reason left and becomes host", (t) => {
  const { registry, host, guest } = started(t);
  registry.leave(guest);
  assert.ok(guest.sent.some((m) => m.type === "left"));
  assert.equal(guest.session, null);
  assert.equal(guest.closed, null);
  const r = room(host);
  assert.equal(r.status, "lobby");
  assert.equal(r.game.winner, "red");
  assert.equal(r.game.reason, "left");
  assert.deepEqual(r.members.map((m) => m.id), ["m1"]);
  assert.equal(host.sent.filter((m) => m.type === "room").length, 3, "one broadcast per change, none doubled");
});

test("the host leaving in the lobby makes the guest host; the last member leaving deletes the room", (t) => {
  const { registry, code, host, guest } = twoInLobby(t);
  registry.leave(host);
  assert.equal(room(guest).hostId, "m2");
  registry.leave(guest);
  const conn = fakeConn();
  registry.join(conn, code, "Cat");
  assert.equal(err(conn).code, "room_not_found");
});

test("disconnect then rejoin within the grace period keeps the member", (t) => {
  const { registry, code, host, guest } = twoInLobby(t);
  const token = last(guest, "joined").token;
  registry.disconnect(guest);
  assert.equal(room(host).members[1].connected, false);
  t.mock.timers.tick(59000);
  const back = fakeConn();
  registry.join(back, code, "Ben2", token);
  t.mock.timers.tick(60000);
  assert.deepEqual(room(host).members.map((m) => [m.id, m.name, m.connected]), [["m1", "Ana", true], ["m2", "Ben2", true]]);
});

test("a disconnect mid-game past the grace period forfeits with reason timeout", (t) => {
  const { registry, host, guest } = started(t);
  registry.disconnect(guest);
  t.mock.timers.tick(60000);
  const r = room(host);
  assert.equal(r.game.winner, "red");
  assert.equal(r.game.reason, "timeout");
  assert.equal(r.status, "lobby");
  assert.deepEqual(r.members.map((m) => m.id), ["m1"]);
});

test("a disconnect in the lobby past the grace period removes the member", (t) => {
  const { registry, host, guest } = twoInLobby(t);
  registry.disconnect(guest);
  t.mock.timers.tick(60000);
  assert.deepEqual(room(host).members.map((m) => m.id), ["m1"]);
});

test("a grace timer started mid-game still fires after the game ends by a normal win", (t) => {
  const { registry, host, guest } = started(t, "green");
  registry.cut(host, 0);
  registry.cut(guest, 4);
  registry.disconnect(guest);
  registry.cut(host, 9);
  assert.equal(room(host).game.reason, "no_moves");
  t.mock.timers.tick(60000);
  const r = room(host);
  assert.deepEqual(r.members.map((m) => m.id), ["m1"]);
  assert.equal(r.game.reason, "no_moves", "the finished result is not overwritten");
});

test("an idle room is deleted after idleMs and its conns closed with 4001", (t) => {
  const { registry, code, host, guest } = twoInLobby(t);
  t.mock.timers.tick(1800000);
  assert.deepEqual(host.closed, { code: 4001, reason: "room closed" });
  assert.deepEqual(guest.closed, { code: 4001, reason: "room closed" });
  const conn = fakeConn();
  registry.join(conn, code, "Cat");
  assert.equal(err(conn).code, "room_not_found");
});

test("an accepted message resets the idle timer and a rejected one does not", (t) => {
  const { registry, host } = twoInLobby(t);
  t.mock.timers.tick(1000000);
  registry.updateSettings(host, { mode: "green" });
  t.mock.timers.tick(1700000);
  assert.equal(host.closed, null);
  registry.cut(host, 0);
  assert.equal(err(host).code, "illegal_move");
  t.mock.timers.tick(100001);
  assert.deepEqual(host.closed, { code: 4001, reason: "room closed" });
});
