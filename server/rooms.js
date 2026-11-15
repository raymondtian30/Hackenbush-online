// Room membership, host settings and lifecycle; no network code.
const crypto = require('node:crypto');
const { newGame, applyCut, forfeit } = require('../public/lib/game.js');
const { BOARDS, makeBoard } = require('../public/lib/boards.js');
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
class RoomCapError extends Error {
  constructor() { super('Room limit reached'); this.name = 'RoomCapError'; }
}
function cleanName(s) {
  return Array.from(s.replace(/[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g, '').trim()).slice(0, 20).join('');
}
function createRegistry(options = {}) {
  const { maxRooms = 500, waitingMs = 600000, graceMs = 60000, idleMs = 1800000, rng = crypto.randomInt } = options;
  const rooms = new Map();
  const error = (c, code, message) => c.send({ type: 'error', code, message });
  function memberOf(c) {
    const s = c.session;
    return s && !s.room.deleted ? s.room.members.find(m => m.id === s.memberId && m.conn === c) : null;
  }
  function snapshot(r) {
    return { code: r.code, status: r.status, hostId: r.hostId, gameNumber: r.gameNumber,
      members: r.members.map(m => ({ id: m.id, name: m.name, connected: Boolean(m.conn) })), settings: r.settings, game: r.game };
  }
  function broadcast(r, lastMove) {
    const msg = { type: 'room', room: snapshot(r) };
    if (lastMove) msg.lastMove = lastMove;
    for (const m of r.members) m.conn?.send(msg);
  }
  function deleteRoom(r, code = 1000) {
    if (r.deleted) return;
    r.deleted = true;
    clearTimeout(r.waitingTimer); clearTimeout(r.idleTimer);
    for (const m of r.members) {
      clearTimeout(m.graceTimer);
      if (m.conn) { m.conn.session = null; m.conn.close(code, 'room closed'); }
    }
    rooms.delete(r.code);
  }
  function resetIdle(r) {
    if (r.deleted) return;
    clearTimeout(r.idleTimer);
    r.idleTimer = setTimeout(() => { if (!r.deleted) deleteRoom(r, 4001); }, idleMs);
  }
  function success(r, lastMove) { if (!r.deleted) { resetIdle(r); broadcast(r, lastMove); } }
  function createRoom() {
    if (rooms.size >= maxRooms) throw new RoomCapError();
    let code;
    do { code = Array.from({ length: 5 }, () => ALPHABET[crypto.randomInt(ALPHABET.length)]).join(''); } while (rooms.has(code));
    const r = { code, status: 'lobby', hostId: null, members: [], nextMemberNum: 1,
      settings: { mode: 'redblue', board: 'random', redPlayer: 'random' }, game: null, gameNumber: 0,
      waitingTimer: null, idleTimer: null, deleted: false };
    rooms.set(code, r);
    r.waitingTimer = setTimeout(() => { if (!r.deleted) deleteRoom(r); }, waitingMs);
    resetIdle(r);
    return code;
  }
  function join(c, code, name, token) {
    if (c.session) return error(c, 'bad_message', 'Already joined.');
    name = cleanName(name);
    if (!name) return error(c, 'bad_name', 'Enter a name.');
    const r = rooms.get(code.toUpperCase());
    if (!r) return error(c, 'room_not_found', 'No game with that code.');
    let m = r.members.find(m => m.token === token);
    if (m) {
      if (m.conn) { m.conn.session = null; m.conn.close(4000, 'replaced'); }
      clearTimeout(m.graceTimer); m.graceTimer = null; m.conn = c; m.name = name;
    } else {
      if (r.members.length === 2) return error(c, 'room_full', 'That room already has two players.');
      m = { id: 'm' + r.nextMemberNum++, name, token: crypto.randomBytes(16).toString('hex'), conn: c, graceTimer: null };
      r.members.push(m);
    }
    clearTimeout(r.waitingTimer); r.waitingTimer = null;
    if (r.hostId === null) r.hostId = m.id;
    c.session = { room: r, memberId: m.id };
    c.send({ type: 'joined', code: r.code, memberId: m.id, token: m.token });
    success(r);
  }
  function joined(c) {
    const m = memberOf(c);
    if (!m) error(c, 'not_joined', 'Join a room first.');
    return m;
  }
  function hostLobby(c) {
    if (!joined(c)) return null;
    const r = c.session.room;
    if (r.hostId !== c.session.memberId) { error(c, 'not_host', 'Only the host can do that.'); return null; }
    if (r.status !== 'lobby') { error(c, 'not_in_lobby', 'A game is in progress.'); return null; }
    return r;
  }
  function updateSettings(c, patch) {
    const r = hostLobby(c); if (!r) return;
    r.settings = { ...r.settings, ...patch }; success(r);
  }
  function start(c) {
    const r = hostLobby(c); if (!r) return;
    if (r.members.length !== 2 || r.members.some(m => !m.conn)) return error(c, 'not_ready', 'Waiting for a second player.');
    const board = r.settings.board === 'random' ? BOARDS[rng(BOARDS.length)].id : r.settings.board;
    const host = r.members.find(m => m.id === r.hostId), guest = r.members.find(m => m !== host);
    const red = r.settings.redPlayer === 'host' ? host : r.settings.redPlayer === 'guest' ? guest : rng(2) === 0 ? host : guest;
    const blue = red === host ? guest : host;
    const seed = rng(2 ** 31);
    r.game = newGame(makeBoard(board, r.settings.mode, seed), r.settings.mode,
      { red: { id: red.id, name: red.name }, blue: { id: blue.id, name: blue.name } });
    r.gameNumber++; r.status = 'playing'; success(r);
  }
  const sideOf = (r, id) => ['red', 'blue'].find(s => r.game.sides[s].id === id);
  function cut(c, edgeId) {
    const m = joined(c); if (!m) return;
    const r = c.session.room;
    if (r.status !== 'playing') return error(c, 'illegal_move', 'The game is not in progress.');
    const result = applyCut(r.game, sideOf(r, m.id), edgeId);
    if (!result.ok) return error(c, result.code, result.message);
    if (r.game.status === 'finished') r.status = 'lobby';
    success(r, { edgeId, fell: result.fell });
  }
  function removeMember(r, id, reason) {
    if (r.deleted) return;
    const m = r.members.find(m => m.id === id); if (!m) return;
    if (r.status === 'playing') { forfeit(r.game, sideOf(r, id), reason); r.status = 'lobby'; }
    clearTimeout(m.graceTimer);
    r.members = r.members.filter(member => member.id !== id);
    // Filter by id: member ids are monotonic for the lifetime of the room.
    if (r.hostId === id) r.hostId = r.members[0]?.id ?? null;
    if (!r.members.length) deleteRoom(r); else broadcast(r);
  }
  function leave(c) {
    const m = joined(c); if (!m) return;
    const r = c.session.room; c.session = null; c.send({ type: 'left' });
    removeMember(r, m.id, 'left'); resetIdle(r);
  }
  function disconnect(c) {
    const m = memberOf(c); if (!m) return;
    const r = c.session.room; c.session = null; m.conn = null;
    clearTimeout(m.graceTimer);
    m.graceTimer = setTimeout(() => { if (!r.deleted) removeMember(r, m.id, 'timeout'); }, graceMs);
    success(r);
  }
  function shutdown() { for (const r of rooms.values()) deleteRoom(r); }
  return { createRoom, join, updateSettings, start, cut, leave, disconnect, shutdown };
}
module.exports = { createRegistry, RoomCapError, cleanName };
