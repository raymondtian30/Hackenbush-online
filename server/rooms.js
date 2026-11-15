// Room registry: codes, seats, tokens, timers, cleanup. No network code.
// A conn is any object with send(obj), close(code, reason) and a `session`
// property the registry sets to {room, role} or null.

const crypto = require("node:crypto");
const { defaultBoard } = require("./board");
const { validateBoard, newGame, startGame, applyCut, forfeit } = require("./game");

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 5;
const ROLES = ["red", "blue"];

class RoomCapError extends Error {
  constructor() {
    super("Room limit reached");
    this.name = "RoomCapError";
  }
}

function createRegistry(options = {}) {
  const { maxRooms = 500, waitingMs = 600000, graceMs = 60000, finishedMs = 60000 } = options;
  validateBoard(defaultBoard);
  const rooms = new Map();

  function newCode() {
    let code;
    do {
      code = "";
      for (let i = 0; i < CODE_LENGTH; i++) code += ALPHABET[crypto.randomInt(ALPHABET.length)];
    } while (rooms.has(code));
    return code;
  }

  function sendError(conn, code, message) {
    conn.send({ type: "error", code, message });
  }

  function players(room) {
    const out = {};
    for (const role of ROLES) out[role] = { connected: Boolean(room.seats[role]?.conn) };
    return out;
  }

  function broadcast(room, lastMove) {
    const msg = { type: "state", game: room.game, players: players(room) };
    if (lastMove) msg.lastMove = lastMove;
    for (const role of ROLES) room.seats[role]?.conn?.send(msg);
  }

  function ownsSeat(conn) {
    const s = conn.session;
    return Boolean(s && !s.room.deleted && s.room.seats[s.role]?.conn === conn);
  }

  function startGrace(room, role) {
    const seat = room.seats[role];
    clearTimeout(seat.graceTimer);
    seat.graceTimer = setTimeout(() => {
      seat.graceTimer = null;
      forfeit(room.game, role);
      finish(room);
      broadcast(room);
    }, graceMs);
  }

  function finish(room) {
    for (const role of ROLES) {
      const seat = room.seats[role];
      if (seat) {
        clearTimeout(seat.graceTimer);
        seat.graceTimer = null;
      }
    }
    room.finishedTimer = setTimeout(() => deleteRoom(room), finishedMs);
  }

  function deleteRoom(room) {
    if (room.deleted) return;
    room.deleted = true;
    clearTimeout(room.waitingTimer);
    clearTimeout(room.finishedTimer);
    for (const role of ROLES) {
      const seat = room.seats[role];
      if (!seat) continue;
      clearTimeout(seat.graceTimer);
      if (seat.conn) {
        const conn = seat.conn;
        seat.conn = null;
        conn.session = null;
        conn.close(1000, "room closed");
      }
    }
    rooms.delete(room.code);
  }

  function createRoom() {
    if (rooms.size >= maxRooms) throw new RoomCapError();
    const code = newCode();
    const room = {
      code,
      game: newGame(defaultBoard),
      seats: { red: null, blue: null },
      waitingTimer: null,
      finishedTimer: null,
      deleted: false,
    };
    room.waitingTimer = setTimeout(() => deleteRoom(room), waitingMs);
    rooms.set(code, room);
    return code;
  }

  function join(conn, code, token) {
    if (conn.session) return sendError(conn, "bad_message", "Already joined.");
    const room = rooms.get(String(code).toUpperCase());
    if (!room) return sendError(conn, "room_not_found", "No game with that code.");

    let role = token === undefined ? null : ROLES.find((r) => room.seats[r]?.token === token) || null;
    if (role) {
      const seat = room.seats[role];
      if (seat.conn) {
        const old = seat.conn;
        old.session = null;
        old.close(4000, "replaced");
      }
      clearTimeout(seat.graceTimer);
      seat.graceTimer = null;
      seat.conn = conn;
    } else {
      role = ROLES.find((r) => room.seats[r] === null);
      if (!role) return sendError(conn, "room_full", "That game already has two players.");
      room.seats[role] = { token: crypto.randomBytes(16).toString("hex"), conn, graceTimer: null };
    }

    conn.session = { room, role };
    conn.send({ type: "joined", code: room.code, role, token: room.seats[role].token });

    if (room.seats.red && room.seats.blue && room.game.status === "waiting") {
      clearTimeout(room.waitingTimer);
      room.waitingTimer = null;
      startGame(room.game);
      for (const r of ROLES) if (!room.seats[r].conn) startGrace(room, r);
    }
    broadcast(room);
  }

  function cut(conn, edgeId) {
    if (!ownsSeat(conn)) return sendError(conn, "not_joined", "Join a game first.");
    const { room, role } = conn.session;
    const result = applyCut(room.game, role, edgeId);
    if (!result.ok) return sendError(conn, result.code, result.message);
    broadcast(room, { edgeId, fell: result.fell });
    if (room.game.status === "finished") finish(room);
  }

  function disconnect(conn) {
    if (!ownsSeat(conn)) return;
    const { room, role } = conn.session;
    room.seats[role].conn = null;
    conn.session = null;
    if (room.game.status === "playing") startGrace(room, role);
    broadcast(room);
  }

  function shutdown() {
    for (const room of [...rooms.values()]) deleteRoom(room);
  }

  return { createRoom, join, cut, disconnect, shutdown };
}

module.exports = { createRegistry, RoomCapError };
