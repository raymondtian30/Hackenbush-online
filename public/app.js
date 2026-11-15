// Lobby, socket handling, screen switching and reconnect.
(function () {
  const $ = (id) => document.getElementById(id);
  const ui = {
    lobby: $("lobby"),
    game: $("game"),
    create: $("create"),
    codeInput: $("code-input"),
    join: $("join"),
    lobbyError: $("lobby-error"),
    roomCode: $("room-code"),
    copyLink: $("copy-link"),
    role: $("role"),
    status: $("status"),
    board: $("board"),
    banner: $("banner"),
    result: $("result"),
    back: $("back"),
  };

  const GONE_TEXT =
    "This game no longer exists on the server. It may have ended, or the server may have restarted.";

  const base = (window.SERVER_URL || "").replace(/\/+$/, "");
  const socketUrl = base
    ? base.replace(/^http/, "ws") + "/ws"
    : (location.protocol === "https:" ? "wss://" : "ws://") + location.host + "/ws";

  const state = {
    code: null,
    role: null,
    socket: null,
    joinedOnSocket: false,
    lastState: null,
    retryMs: 1000,
    retryTimer: null,
    flashTimer: null,
    leaving: true,
  };

  const tokenKey = (code) => "hackenbush:" + code;
  const getToken = (code) => sessionStorage.getItem(tokenKey(code));
  const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  const joinLink = () => location.origin + location.pathname + "?code=" + state.code;

  function send(obj) {
    if (state.socket && state.socket.readyState === WebSocket.OPEN) state.socket.send(JSON.stringify(obj));
  }

  function statusText() {
    const s = state.lastState;
    if (!s) return "Connecting...";
    const game = s.game;
    if (game.status === "waiting") {
      return "Waiting for an opponent. Share code " + state.code + " or the join link.";
    }
    if (game.status === "finished") return "Game over.";
    const opponent = state.role === "red" ? "blue" : "red";
    if (!s.players[opponent].connected) return "Opponent disconnected. They have 60 seconds to return.";
    return game.turn === state.role ? "Your turn" : "Opponent's turn";
  }

  function showStatus() {
    clearTimeout(state.flashTimer);
    state.flashTimer = null;
    ui.status.textContent = statusText();
  }

  function flash(text, ms) {
    clearTimeout(state.flashTimer);
    ui.status.textContent = text;
    state.flashTimer = setTimeout(showStatus, ms);
  }

  function showLobby(error) {
    ui.game.hidden = true;
    ui.banner.hidden = true;
    ui.lobby.hidden = false;
    ui.lobbyError.textContent = error || "";
  }

  function leaveGame(error) {
    state.leaving = true;
    clearTimeout(state.retryTimer);
    clearTimeout(state.flashTimer);
    const socket = state.socket;
    state.socket = null;
    if (socket) socket.close();
    Render.reset();
    state.lastState = null;
    history.replaceState(null, "", location.pathname);
    showLobby(error);
  }

  function startGame(code) {
    state.code = code;
    state.role = null;
    state.leaving = false;
    state.retryMs = 1000;
    state.lastState = null;
    ui.lobbyError.textContent = "";
    Render.reset();
    connect();
  }

  function connect() {
    const socket = new WebSocket(socketUrl);
    state.socket = socket;
    state.joinedOnSocket = false;

    socket.addEventListener("open", () => {
      if (socket !== state.socket) return;
      const msg = { type: "join", code: state.code };
      const token = getToken(state.code);
      if (token) msg.token = token;
      send(msg);
    });

    socket.addEventListener("message", (event) => {
      if (socket !== state.socket) return;
      let msg;
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }
      if (msg.type === "joined") onJoined(msg);
      else if (msg.type === "state") onState(msg);
      else if (msg.type === "error") onError(msg);
    });

    socket.addEventListener("close", (event) => {
      if (socket !== state.socket) return;
      if (event.code === 4000) {
        leaveGame("This game was opened in another tab.");
        return;
      }
      const finished = state.lastState && state.lastState.game.status === "finished";
      if (state.leaving || finished) return;
      ui.status.textContent = "Reconnecting...";
      state.retryTimer = setTimeout(connect, state.retryMs);
      state.retryMs = Math.min(state.retryMs * 2, 5000);
    });
  }

  function onJoined(msg) {
    state.joinedOnSocket = true;
    state.retryMs = 1000;
    state.code = msg.code;
    state.role = msg.role;
    sessionStorage.setItem(tokenKey(msg.code), msg.token);
    history.replaceState(null, "", location.pathname + "?code=" + msg.code);
    ui.roomCode.textContent = msg.code;
    ui.role.textContent = "You are " + capitalize(msg.role);
    ui.role.className = "role-" + msg.role;
    ui.lobby.hidden = true;
    ui.game.hidden = false;
  }

  function onState(msg) {
    const prev = state.lastState;
    state.lastState = msg;
    Render.update(msg.game, msg.lastMove, state.role);
    const game = msg.game;

    if (game.status === "finished") {
      const won = game.winner === state.role;
      let text = won ? "You win" : "You lose";
      if (game.reason === "forfeit") text += won ? " (your opponent left)" : " (you were away too long)";
      ui.result.textContent = text;
      ui.banner.hidden = false;
      sessionStorage.removeItem(tokenKey(state.code));
      showStatus();
      return;
    }

    const opponent = state.role === "red" ? "blue" : "red";
    const reconnected =
      prev &&
      prev.game.status === "playing" &&
      game.status === "playing" &&
      !prev.players[opponent].connected &&
      msg.players[opponent].connected;
    if (reconnected) flash("Opponent reconnected", 3000);
    else if (!state.flashTimer) showStatus();
  }

  function onError(msg) {
    if (!state.joinedOnSocket) {
      const hadToken = Boolean(getToken(state.code));
      let text = msg.message;
      if (msg.code === "room_not_found" && hadToken) {
        sessionStorage.removeItem(tokenKey(state.code));
        text = GONE_TEXT;
      }
      leaveGame(text);
      return;
    }
    flash(msg.message, 3000);
  }

  ui.create.addEventListener("click", async () => {
    ui.lobbyError.textContent = "";
    ui.create.disabled = true;
    try {
      const res = await fetch(base + "/create-game", { method: "POST" });
      if (res.status === 200) {
        const { code } = await res.json();
        startGame(code);
      } else if (res.status === 429) {
        ui.lobbyError.textContent = "Server is full. Try again later.";
      } else {
        ui.lobbyError.textContent = "Cannot reach the server.";
      }
    } catch {
      ui.lobbyError.textContent = "Cannot reach the server.";
    } finally {
      ui.create.disabled = false;
    }
  });

  function joinFromInput() {
    const code = ui.codeInput.value.trim().toUpperCase();
    if (!code) {
      ui.lobbyError.textContent = "Enter a game code.";
      return;
    }
    startGame(code);
  }

  ui.join.addEventListener("click", joinFromInput);
  ui.codeInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") joinFromInput();
  });

  ui.back.addEventListener("click", () => leaveGame());

  ui.copyLink.addEventListener("click", () => {
    const link = joinLink();
    if (!navigator.clipboard) {
      ui.status.textContent = link;
      return;
    }
    navigator.clipboard.writeText(link).then(
      () => flash("Link copied", 2000),
      () => {
        ui.status.textContent = link;
      },
    );
  });

  Render.init(ui.board, (edgeId) => send({ type: "cut", edgeId }));

  const params = new URLSearchParams(location.search);
  const codeParam = (params.get("code") || "").trim().toUpperCase();
  if (codeParam) {
    ui.codeInput.value = codeParam;
    if (getToken(codeParam)) startGame(codeParam);
  }
})();
