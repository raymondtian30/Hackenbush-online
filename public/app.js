// Screens, local bot games and reconnecting online rooms.
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const Game = window.HackenbushGame, Boards = window.HackenbushBoards, Bot = window.HackenbushBot;
  const base = (window.SERVER_URL || '').replace(/\/+$/, '');
  const socketUrl = base ? base.replace(/^http/, 'ws') + '/ws' : (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws';
  const GONE_TEXT = 'This game no longer exists on the server. It may have ended, or the server may have restarted.';
  const state = { screen: 'menu', mode: 'online', name: '', code: null, memberId: null, socket: null,
    joinedOnSocket: false, everJoined: false, inRoom: false, retryMs: 1000, retryTimer: null,
    flashTimer: null, bannerTimer: null, lastHeard: 0, leaving: true, room: null,
    prevStatus: null, gameNumber: null, bot: null };
  const tokenKey = code => 'hackenbush:' + code;
  const getToken = code => sessionStorage.getItem(tokenKey(code));
  const removeToken = () => { if (state.code) sessionStorage.removeItem(tokenKey(state.code)); };
  function show(screen) {
    state.screen = screen;
    for (const id of ['menu', 'room', 'game', 'bot-setup']) $(id).hidden = id !== screen;
  }
  function closeSocket() {
    const s = state.socket; state.socket = null;
    if (s) s.close();
  }
  function goToMenu(error) {
    state.leaving = true;
    clearTimeout(state.retryTimer); clearTimeout(state.flashTimer); clearTimeout(state.bannerTimer);
    clearTimeout(state.bot?.timer);
    state.retryTimer = state.flashTimer = state.bannerTimer = null;
    closeSocket(); Render.reset(); state.inRoom = false;
    state.room = state.prevStatus = state.gameNumber = state.bot = null;
    $('banner').hidden = true;
    history.replaceState(null, '', location.pathname);
    show('menu'); $('menu-error').textContent = error || '';
  }
  function requireName() {
    state.name = $('name-input').value.trim();
    if (!state.name) { $('menu-error').textContent = 'Enter your name first.'; return false; }
    $('menu-error').textContent = ''; return true;
  }
  function send(msg) {
    if (state.socket?.readyState === WebSocket.OPEN) state.socket.send(JSON.stringify(msg));
  }
  function mySide(game) { return ['red', 'blue'].find(s => game.sides[s].id === state.memberId); }
  function resultText(game) {
    const win = game.sides[game.winner], lose = game.sides[Game.otherColor(game.winner)];
    let text = win.name + ' won the game!';
    if (game.reason === 'left') text += ` (${lose.name} left)`;
    if (game.reason === 'timeout') text += ` (${lose.name} lost connection)`;
    return text;
  }
  function statusText() {
    const game = state.mode === 'bot' ? state.bot?.game : state.room?.game;
    if (!game) return 'Connecting...';
    if (game.status === 'finished') return 'Game over.';
    const side = state.mode === 'bot' ? state.bot.humanSide : mySide(game);
    const opponent = game.sides[Game.otherColor(side)];
    if (state.mode === 'online' && state.room.members.some(m => m.id === opponent.id && !m.connected)) {
      return opponent.name + ' disconnected. They have 60 seconds to return.';
    }
    return game.turn === side ? 'Your turn' : game.sides[game.turn].name + "'s turn";
  }
  function showStatus() { clearTimeout(state.flashTimer); state.flashTimer = null; $('status').textContent = statusText(); }
  function flash(text) {
    clearTimeout(state.flashTimer); $('status').textContent = text;
    state.flashTimer = setTimeout(showStatus, 3000);
  }
  function drawGame(game, lastMove, side) {
    const { red, blue } = game.sides;
    $('players').textContent = game.mode === 'green' ? `${red.name} vs ${blue.name}` : `${red.name} (Red) vs ${blue.name} (Blue)`;
    $('leave-game').textContent = state.mode === 'bot' ? 'Menu' : 'Leave';
    $('play-again').hidden = $('banner-menu').hidden = state.mode !== 'bot';
    Render.update(game, lastMove, side); showStatus();
  }
  function labels(modeId, sideId, online) {
    const green = $(modeId).value === 'green';
    const captions = online ? (green ? ['Host goes first', 'Guest goes first'] : ['Host plays Red', 'Guest plays Red']) :
      (green ? ['I go first', 'Bot goes first'] : ['I play Red', 'I play Blue']);
    Array.from($(sideId).options).forEach((o, i) => { o.textContent = captions[i] || 'Random'; });
  }
  function refreshRoom() {
    const r = state.room; if (!r) return;
    $('room-code').textContent = r.code;
    $('members').replaceChildren(...r.members.map(m => {
      const li = document.createElement('li');
      li.textContent = m.name + (m.id === r.hostId ? ' (host)' : '') + (m.connected ? '' : ' — disconnected'); return li;
    }));
    const host = r.hostId === state.memberId;
    for (const [field, id] of Object.entries({ mode: 'setting-mode', board: 'setting-board', redPlayer: 'setting-red' })) {
      $(id).value = r.settings[field]; $(id).disabled = !host;
    }
    labels('setting-mode', 'setting-red', true);
    $('start').hidden = !host;
    $('start').disabled = r.members.length !== 2 || r.members.some(m => !m.connected);
    $('last-result').textContent = r.game?.status === 'finished' ? resultText(r.game) : '';
  }
  function onRoom(msg) {
    const r = msg.room; state.room = r; refreshRoom();
    if (r.gameNumber !== state.gameNumber) { Render.reset(); state.gameNumber = r.gameNumber; }
    if (r.status === 'playing') {
      clearTimeout(state.bannerTimer); state.bannerTimer = null; $('banner').hidden = true;
      show('game'); drawGame(r.game, msg.lastMove, mySide(r.game));
    } else if (r.game?.status === 'finished' && state.prevStatus === 'playing') {
      show('game'); drawGame(r.game, msg.lastMove, mySide(r.game));
      $('result').textContent = resultText(r.game); $('banner').hidden = false;
      clearTimeout(state.bannerTimer);
      state.bannerTimer = setTimeout(() => {
        state.bannerTimer = null; $('banner').hidden = true; refreshRoom(); show('room');
      }, 3000);
    } else if (!state.bannerTimer) { $('banner').hidden = true; show('room'); }
    state.prevStatus = r.status;
  }
  function scheduleReconnect() {
    if (!state.inRoom) return;
    if (state.screen === 'game') $('status').textContent = 'Reconnecting...';
    else $('room-error').textContent = 'Reconnecting...';
    clearTimeout(state.retryTimer); state.retryTimer = setTimeout(connect, state.retryMs);
    state.retryMs = Math.min(state.retryMs * 2, 5000);
  }
  function forceReconnect() { closeSocket(); scheduleReconnect(); }
  function connect() {
    const socket = new WebSocket(socketUrl); state.socket = socket; state.joinedOnSocket = false;
    socket.addEventListener('open', () => {
      if (socket !== state.socket) return;
      state.lastHeard = Date.now();
      const msg = { type: 'join', code: state.code, name: state.name }, token = getToken(state.code);
      if (token) msg.token = token; send(msg);
    });
    socket.addEventListener('message', event => {
      if (socket !== state.socket) return;
      state.lastHeard = Date.now();
      let msg; try { msg = JSON.parse(event.data); } catch { return; }
      if (msg.type === 'joined') {
        state.joinedOnSocket = state.everJoined = state.inRoom = true; state.retryMs = 1000;
        state.memberId = msg.memberId; state.code = msg.code; state.prevStatus = null;
        sessionStorage.setItem(tokenKey(msg.code), msg.token);
        $('room-error').textContent = ''; history.replaceState(null, '', location.pathname + '?code=' + msg.code);
      } else if (msg.type === 'room') onRoom(msg);
      else if (msg.type === 'left') { removeToken(); goToMenu(); }
      else if (msg.type === 'error') {
        if (!state.joinedOnSocket) {
          const hadToken = Boolean(getToken(state.code)); let text = msg.message;
          if (hadToken && ['room_full', 'room_not_found'].includes(msg.code)) removeToken();
          if (hadToken && msg.code === 'room_not_found') text = GONE_TEXT;
          goToMenu(text);
        } else if (state.screen === 'room') $('room-error').textContent = msg.message;
        else flash(msg.message);
      }
    });
    socket.addEventListener('close', event => {
      if (socket !== state.socket) return;
      if (event.code === 4000) return goToMenu('This game was opened in another tab.');
      if (event.code === 4001) { removeToken(); return goToMenu('The room closed after 30 minutes without activity.'); }
      if (state.leaving) return;
      if (state.inRoom) scheduleReconnect(); else goToMenu('Cannot reach the server.');
    });
  }
  function joinRoom(code) {
    goToMenu(); state.mode = 'online'; state.code = code; state.memberId = null;
    state.everJoined = false; state.leaving = false; state.retryMs = 1000; connect();
  }
  function leave() { if (state.mode === 'online') { send({ type: 'leave' }); removeToken(); } goToMenu(); }
  setInterval(() => {
    if (state.inRoom && state.socket?.readyState === WebSocket.OPEN && Date.now() - state.lastHeard > 45000) forceReconnect();
  }, 5000);
  window.addEventListener('online', () => { if (state.inRoom) forceReconnect(); });
  $('name-input').value = localStorage.getItem('hackenbush:name') || '';
  $('name-input').addEventListener('input', () => localStorage.setItem('hackenbush:name', $('name-input').value));
  $('create').addEventListener('click', async () => {
    if (!requireName()) return;
    $('create').disabled = true;
    try {
      const res = await fetch(base + '/create-game', { method: 'POST' });
      if (res.status === 200) joinRoom((await res.json()).code);
      else $('menu-error').textContent = res.status === 429 ? 'Server is full. Try again later.' : 'Cannot reach the server.';
    } catch { $('menu-error').textContent = 'Cannot reach the server.'; }
    finally { $('create').disabled = false; }
  });
  function joinFromInput() {
    if (!requireName()) return;
    const code = $('code-input').value.trim().toUpperCase();
    if (!code) { $('menu-error').textContent = 'Enter a game code.'; return; }
    joinRoom(code);
  }
  $('join').addEventListener('click', joinFromInput);
  $('code-input').addEventListener('keydown', e => { if (e.key === 'Enter') joinFromInput(); });
  for (const [field, id] of Object.entries({ mode: 'setting-mode', board: 'setting-board', redPlayer: 'setting-red' })) {
    $(id).addEventListener('change', () => {
      labels('setting-mode', 'setting-red', true); send({ type: 'settings', [field]: $(id).value });
    });
  }
  $('start').addEventListener('click', () => send({ type: 'start' }));
  $('leave-room').addEventListener('click', leave); $('leave-game').addEventListener('click', leave);
  $('copy-code').addEventListener('click', async () => {
    const code = state.code;
    try {
      await navigator.clipboard.writeText(code); $('copy-code').textContent = 'Copied';
      setTimeout(() => { $('copy-code').textContent = 'Copy code'; }, 2000);
    } catch {
      $('copy-fallback').hidden = false; $('copy-fallback').value = code; $('copy-fallback').select();
    }
  });
  for (const id of ['setting-board', 'bot-board']) {
    for (const b of [...Boards.BOARDS, { id: 'random', name: 'Random' }]) {
      const o = document.createElement('option'); o.value = b.id; o.textContent = b.name; $(id).appendChild(o);
    }
    $(id).value = 'random';
  }
  $('bot-mode').addEventListener('change', () => labels('bot-mode', 'bot-side', false));
  $('play-bot').addEventListener('click', () => { if (requireName()) { state.mode = 'bot'; show('bot-setup'); } });
  $('bot-back').addEventListener('click', () => goToMenu());
  function updateBot(lastMove) {
    const b = state.bot; drawGame(b.game, lastMove, b.humanSide);
    if (b.game.status === 'finished') { $('result').textContent = resultText(b.game); $('banner').hidden = false; }
  }
  function scheduleBot() {
    const b = state.bot;
    b.timer = setTimeout(() => {
      if (state.bot !== b || b.game.status !== 'playing') return;
      b.timer = null;
      const edgeId = Bot.chooseMove(b.game, b.game.turn, b.difficulty);
      const result = Game.applyCut(b.game, b.game.turn, edgeId);
      updateBot({ edgeId, fell: result.fell });
    }, 500 + Math.random() * 400);
  }
  function startBot() {
    clearTimeout(state.bot?.timer); clearTimeout(state.flashTimer); state.flashTimer = null;
    const mode = $('bot-mode').value;
    const boardId = $('bot-board').value === 'random' ? Boards.pickBoardId(Math.random) : $('bot-board').value;
    const choice = $('bot-side').value;
    const humanSide = choice === 'random' ? (Math.random() < .5 ? 'red' : 'blue') : choice === 'human-first-or-red' ? 'red' : 'blue';
    const seed = Math.floor(Math.random() * 2 ** 31), difficulty = $('bot-difficulty').value;
    const sides = { [humanSide]: { id: 'you', name: state.name },
      [Game.otherColor(humanSide)]: { id: 'bot', name: 'Bot (' + difficulty[0].toUpperCase() + difficulty.slice(1) + ')' } };
    Render.reset(); state.mode = 'bot';
    state.bot = { game: Game.newGame(Boards.makeBoard(boardId, mode, seed), mode, sides), humanSide, difficulty, timer: null };
    $('banner').hidden = true; show('game'); updateBot();
    if (humanSide === 'blue') scheduleBot();
  }
  function humanCut(edgeId) {
    const b = state.bot;
    if (!b || b.game.status !== 'playing' || b.game.turn !== b.humanSide) return;
    const result = Game.applyCut(b.game, b.humanSide, edgeId);
    if (!result.ok) return flash(result.message);
    updateBot({ edgeId, fell: result.fell });
    if (b.game.status === 'playing') scheduleBot();
  }
  $('bot-start').addEventListener('click', startBot); $('play-again').addEventListener('click', startBot);
  $('banner-menu').addEventListener('click', () => goToMenu());
  Render.init($('board'), id => state.mode === 'bot' ? humanCut(id) : send({ type: 'cut', edgeId: id }));
  const code = (new URLSearchParams(location.search).get('code') || '').trim().toUpperCase();
  if (code) { $('code-input').value = code; if (getToken(code) && $('name-input').value.trim()) { state.name = $('name-input').value.trim(); joinRoom(code); } }
})();
