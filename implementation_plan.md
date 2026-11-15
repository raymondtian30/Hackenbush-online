# Hackenbush Online: Implementation Plan

*   **Author:** Raymond Tian
*   **Status:** Draft
*   **Date:** 2026-11-15
*   **Design:** [design_draft.md](./design_draft.md). Game and server numbers
    (code length, room cap, timer lengths, payload limit, heartbeat) come from
    the design. Choices the design does not make, including client timings, are
    listed under "Decisions made here".

## Detailed Implementation Plan

### Order of work

Each step ends with that step's tests passing (steps 3 and 4 are also checked
by hand and in a browser) and an Elephant-Goldfish Model (EGM) review of the
increment: fresh-context reviewer agents read the new code with no knowledge of
this conversation.

1.  **Project setup and game logic**: `package.json`, `package-lock.json`,
    `.gitignore`, `server/board.js`, `server/game.js`, `test/game.test.js`.
2.  **Room server**: `server/rooms.js`, `server.js`, `test/rooms.test.js`,
    `test/server.test.js` (all cases except static files).
3.  **Client**: `public/index.html`, `public/style.css`, `public/config.js`,
    `public/render.js`, `public/app.js`; add the static-file cases to
    `test/server.test.js`.
4.  **Wire together and document**: run locally, fix defects, write
    `README.md`.
5.  **Final whole-diff EGM review.**

Deployment is out of scope for this plan. It needs the server-host decision
listed under Open Questions in the design, and the user's account access, and
gets its own short plan afterwards.

The complete set of files this plan creates is the list above. No other file
is created or changed, except `design_draft.md` if a defect in it is found.

### Files

#### `package.json`

Exact contents:

```json
{
  "name": "hackenbush-online",
  "version": "0.1.0",
  "private": true,
  "type": "commonjs",
  "engines": { "node": ">=22" },
  "scripts": { "start": "node server.js", "test": "node --test" },
  "dependencies": { "ws": "^8.18.0" }
}
```

#### `package-lock.json`

Written by `npm install`.

#### `.gitignore`

One line: `node_modules/`.

#### `server/board.js`

Exports `defaultBoard`, shaped as:

```text
{ nodes: [{ id, x, y, ground }], edges: [{ id, a, b, color }] }
```

`nodes` and `edges` are arrays. `ground` is `true` or `false` on every node.
`color` is `"red"` or `"blue"`. `x` runs 0 to 600; `y` runs upward from the
ground at `y = 0`. Values (`g` means `ground: true`; `R` is `"red"`, `B` is
`"blue"`):

```text
nodes  0:100,0 g   1:300,0 g   2:500,0 g
       3:100,90    4:100,180   5:40,250    6:160,250
       7:300,90    8:300,180   9:240,250   10:360,250   11:360,320
       12:500,90   13:500,180  14:440,250  15:560,250

edges  0: 0-3 R    1: 3-4 B    2: 4-5 R    3: 4-6 B
       4: 1-7 B    5: 7-8 R    6: 8-9 B    7: 8-10 R    8: 10-11 B
       9: 2-12 R   10: 12-13 B  11: 13-14 R  12: 13-15 B
```

#### `server/game.js`

No input or output; every function works on plain data. Exports:

*   `validateBoard(board)`: throws `Error` unless node ids are unique, edge ids
    are unique, every edge's `a` and `b` name existing nodes, every node reaches
    a ground node through edges, and both colors have at least one edge.
*   `newGame(board)`: returns `{board: structuredClone(board), turn: "red",
    status: "waiting", winner: null, reason: null}`.
*   `startGame(game)`: sets `status` to `"playing"`.
*   `prune(board)`: breadth-first search from every `ground: true` node across
    edges in both directions. Removes every edge with an unreached endpoint and
    every unreached node, from the arrays in place. Returns `{edges, nodes}`,
    the removed ids in ascending order. Ground nodes are always reached.
*   `applyCut(game, role, edgeId)`: mutates `game`. Checks in this order and
    returns `{ok: false, code: "illegal_move", message}` on the first failure:
    status not `"playing"` ("The game is not in progress."); `role !==
    game.turn` ("It is not your turn."); no edge with that id ("No such
    edge."); edge color not `role` ("That edge is not your color."). On
    success: removes the edge, calls `prune`, sets `turn` to the other color,
    and if no edge of the new `turn` color remains, sets `status: "finished"`,
    `winner: role`, `reason: "no_moves"`. Returns `{ok: true, fell}` where
    `fell` is `prune`'s result (the cut edge is not in it).
*   `forfeit(game, loserRole)`: sets `status: "finished"`, `winner` to the
    other color, `reason: "forfeit"`.
*   `otherColor(role)`: `"red"` to `"blue"` and back.

#### `test/game.test.js`

`node:test` and `node:assert/strict`. Fixtures are given as node and edge
lists in the same notation as `server/board.js`.

*   `validateBoard(defaultBoard)` does not throw. It throws for a duplicate node
    id, a duplicate edge id, an edge naming a missing node, a node with no path
    to ground, and a board with no blue edge.
*   Default board, Red cuts edge 0: `fell` is `{edges: [1, 2, 3], nodes: [3, 4,
    5, 6]}`, turn is blue.
*   Default board, Red cuts edge 0, Blue cuts edge 12: `fell` is `{edges: [],
    nodes: [15]}`.
*   Cycle. Nodes `0:0,0 g`, `1:0,100`, `2:50,150`, `3:-50,150`. Edges
    `0: 0-1 R`, `1: 1-2 B`, `2: 2-3 R`, `3: 3-1 B`. Remove edge 1 and call
    `prune`: `{edges: [], nodes: []}`. Then remove edge 3 and call `prune`:
    `{edges: [2], nodes: [2, 3]}`.
*   Parallel edges. Nodes `0:0,0 g`, `1:0,100`. Edges `0: 0-1 R`, `1: 0-1 B`.
    Remove edge 0 and call `prune`: `{edges: [], nodes: []}`.
*   Ground to ground. Nodes `0:0,0 g`, `1:100,0 g`, `2:50,100`. Edges
    `0: 0-1 R`, `1: 1-2 B`. `prune` on the full board removes nothing. Remove
    edge 1 and call `prune`: `{edges: [], nodes: [2]}`; edge 0 remains.
*   Each `applyCut` failure message: game `waiting`, game `finished`, wrong
    turn, missing edge, wrong color; the game is unchanged after each.
*   Full game on the default board: R0, B4, R9. After R9, `status` is
    `"finished"`, `winner` is `"red"`, `reason` is `"no_moves"`.
*   `forfeit(game, "red")` sets `winner: "blue"`, `reason: "forfeit"`.

#### `server/rooms.js`

Exports `createRegistry(options = {})` and `RoomCapError` (a subclass of
`Error`). Options and defaults: `{maxRooms: 500, waitingMs: 600000, graceMs:
60000, finishedMs: 60000}`. `createRegistry` calls
`validateBoard(defaultBoard)` once.

A **conn** is any object with `send(obj)`, `close(code, reason)`, and a
`session` property (`null`, or `{room, role}` set by the registry). The registry
never sees a `ws` socket. Tests use fake conns.

A room is `{code, game, seats: {red, blue}, waitingTimer, finishedTimer,
deleted}`. A seat is `null` or `{token, conn, graceTimer}`; `conn` is `null`
while disconnected. A conn **owns** a seat when `seat.conn === conn`.

The returned object has these methods:

*   `createRoom()`: throws `RoomCapError` when the map holds `maxRooms` rooms.
    Picks 5 characters with `crypto.randomInt` from
    `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`, retrying until the code is unused.
    Creates the room with `newGame(defaultBoard)`, starts `waitingTimer`
    (`waitingMs`, calls `deleteRoom`), and returns the code.
*   `join(conn, code, token)` (`token` is a string or `undefined`):
    1.  If `conn.session` is set: send `error` `bad_message` "Already joined."
        and stop.
    2.  Look up `code.toUpperCase()`. Missing: send `error` `room_not_found`
        "No game with that code." and stop.
    3.  If `token` matches a seat's token: reclaim that seat. If the seat's
        `conn` is set, clear that conn's `session` and call its
        `close(4000, "replaced")`. Clear `graceTimer`. Set `seat.conn = conn`.
    4.  Otherwise take the first `null` seat, red then blue, with `token =
        crypto.randomBytes(16).toString("hex")`. None free: send `error`
        `room_full` "That game already has two players." and stop.
    5.  Set `conn.session = {room, role}`. Send `{type: "joined", code:
        room.code, role, token}`.
    6.  If both seats are non-null and status is `"waiting"`: clear
        `waitingTimer`, call `startGame`, and start a grace timer for any seat
        whose `conn` is `null`.
    7.  Broadcast `state`.
*   `cut(conn, edgeId)`: if `conn.session` is null or the conn does not own its
    seat, send `error` `not_joined` "Join a game first." Otherwise call
    `applyCut`. On failure send the `error`. On success broadcast `state` with
    `lastMove: {edgeId, fell}`, then if the game is finished call `finish`.
*   `disconnect(conn)`: stop if `conn.session` is null, the room is deleted,
    or the conn does not own its seat. Set `seat.conn = null` and clear
    `conn.session`. If the game is `"playing"`, start the seat's grace timer.
    Broadcast `state`.
*   `shutdown()`: calls `deleteRoom` on every room. Used by `createApp`'s
    `close()` and by tests.

Internal functions:

*   Grace timer (`graceMs`): calls `forfeit(game, role)`, then `finish`, then
    broadcasts `state` without `lastMove`.
*   `finish(room)`: clears both grace timers and starts `finishedTimer`
    (`finishedMs`, calls `deleteRoom`).
*   `deleteRoom(room)`: sets `deleted`, clears every timer, and for each seat
    with a `conn`, clears that conn's `session` before calling `close(1000,
    "room closed")`. Removes the room from the map.
*   Broadcast: sends `{type: "state", game, players, lastMove}` (omitting
    `lastMove` when absent) to each seat's non-null `conn`. `players` is `{red:
    {connected}, blue: {connected}}`; `connected` is false for an empty seat.

#### `test/rooms.test.js`

Fake conns record sent messages and close calls. Each test that needs time
calls `t.mock.timers.enable({apis: ["setTimeout"]})` first, before
`createRegistry`, and advances with `t.mock.timers.tick(ms)`; the test-scoped
mock is reset automatically when the test ends. Each test calls
`registry.shutdown()` at the end.

Cases: the code matches `/^[A-HJ-NP-Z2-9]{5}$/`; `createRoom` at `maxRooms`
throws `RoomCapError`; first join is red, second blue, third without a token
gets `room_full`; third with red's token reclaims red and the old conn is
closed with code 4000; a stale conn's `cut` gets `not_joined`; unknown code
gets `room_not_found`; lowercase code works and `joined.code` is upper case;
`cut` before `join` gets `not_joined`; a second `join` on one conn gets
`bad_message`; the R0, B4, R9 game ends `finished` with Red the winner on both
conns; a disconnect then a rejoin before `graceMs` keeps the game `playing`; a
disconnect then `graceMs` forfeits to the other color; Red disconnects while
`waiting`, Blue joins, and `graceMs` later Blue wins by forfeit; an unjoined
room is gone after `waitingMs`; a finished room is gone after `finishedMs`.

#### `server.js`

Exports `createApp(options = {})`. It does not listen. It returns `{server,
wss, registry, close}`: `server` is an `http.Server`, `wss` a
`ws.WebSocketServer({noServer: true, maxPayload: 1024})`, `registry` from
`createRegistry(options.registry)`. `options.allowedOrigin` defaults to
`process.env.ALLOWED_ORIGIN`; an empty string means unset. `close()` clears the
heartbeat interval, calls `registry.shutdown()`, terminates every ws client,
and returns a promise that resolves when `server.close` completes. When run
directly (`require.main === module`) it calls `server.listen(process.env.PORT
|| 3000)`, logs the URL, and on `SIGINT` or `SIGTERM` awaits `close()` and
exits.

*   `parsePath(req)`: `new URL(req.url, "http://localhost").pathname` inside
    try/catch; returns `null` if it throws.
*   `originAllowed(req)`: no `Origin` header is allowed. Otherwise, inside
    try/catch, with `allowedOrigin` set the header must equal it; without it,
    `new URL(origin).host` must equal `req.headers.host`. Any parse error
    (including `Origin: null`) means not allowed. Used for `POST /create-game`
    and upgrades.
*   HTTP handler. `parsePath` returning `null` gives 400. JSON responses use
    `Content-Type: application/json`.
    *   `/create-game` with `OPTIONS`: 204. When `allowedOrigin` is set and
        equals `Origin`, add `Access-Control-Allow-Origin: <origin>`,
        `Access-Control-Allow-Methods: POST, OPTIONS`, `Vary: Origin`.
    *   `/create-game` with `POST`: 403 `{"error": "origin"}` if the origin is
        not allowed. Otherwise `registry.createRoom()` and 200 `{code}`, or 429
        `{"error": "server_full"}` on `RoomCapError`. Same CORS headers as
        `OPTIONS`.
    *   `/create-game` with any other method: 405.
    *   `GET` or `HEAD` for any other path: `decodeURIComponent` the path (400
        if it throws); map `/` to `/index.html`; `path.join(publicDir,
        decoded)` where `publicDir` is the absolute `public/` directory; 404
        unless the result starts with `publicDir + path.sep`, has an extension
        in the MIME map (`.html` `text/html; charset=utf-8`, `.js`
        `text/javascript; charset=utf-8`, `.css` `text/css; charset=utf-8`,
        `.svg` `image/svg+xml`), and `fs.promises.stat` says it is a regular
        file. Any `fs` error gives 404. Send with `Cache-Control: no-cache`.
    *   Any other method: 405.
*   `upgrade`: attach `socket.on("error", () => {})`. If `parsePath` is not
    `/ws` or `originAllowed` fails, write `HTTP/1.1 403
    Forbidden\r\nConnection: close\r\n\r\n` and destroy the socket.
    Otherwise `wss.handleUpgrade` and emit `connection`.
*   `connection`: `ws.on("error", () => {})` (a message over `maxPayload`
    emits `error` before the close, and an unhandled `error` would crash the
    process). Create the conn: `send(obj)` sends `JSON.stringify(obj)` when
    `ws.readyState === ws.OPEN`; `close(code, reason)` calls
    `ws.close(code, reason)`; `session: null`.
*   `message`: parse JSON inside try/catch. Send `error` `bad_message`
    "Malformed message." when: the value is not a plain object (`null` and
    arrays are rejected); `type` is unknown; `join` lacks a string `code`, or
    has a `token` that is neither absent, `null`, nor a string; `cut` lacks an
    integer `edgeId`. A `null` token is treated as absent. Otherwise call
    `registry.join(conn, code, token ?? undefined)` or
    `registry.cut(conn, edgeId)`.
*   `close`: `registry.disconnect(conn)`.
*   Heartbeat: every 30 seconds, terminate each client that has not answered
    the previous ping, else mark it unanswered and `ping()`. A `pong` marks it
    answered.

#### `test/server.test.js`

Each test calls `createApp({allowedOrigin: "", ...})` (so the developer's
environment cannot change results), calls `server.listen(0)`, awaits
`events.once(server, "listening")`, reads the port from
`server.address().port`, and awaits `close()` at the end. Uses the `ws` client,
global `fetch`, and `http.request` for raw paths and headers.

Step 2 cases:

*   `POST /create-game` returns a 5-character code.
*   Two sockets join (the first with no `token` field, the second with `token:
    null`), play R0, B4, R9, and both receive a final `state` whose
    `game.winner` is `"red"`.
*   A 1500-byte message closes that socket with code 1009, and a new
    `POST /create-game` still succeeds.
*   Invalid JSON, `null`, and `[]` each get `bad_message`.
*   `registry: {maxRooms: 0}`: `POST /create-game` gets 429.
*   `GET /create-game` gets 405.
*   Same origin (`allowedOrigin` unset): `Origin` whose host equals `Host`
    succeeds for `POST` and upgrade; a different host gets 403 for both;
    `Origin: null` gets 403 for both.
*   `allowedOrigin: "https://a.example"`: `OPTIONS` with that origin returns
    204 with the three CORS headers; `POST` with it returns 200 with
    `Access-Control-Allow-Origin`; an upgrade with it succeeds; `Origin:
    https://b.example` gets 403 for `POST` and upgrade.

Step 3 cases: `GET /` returns `text/html` containing `id="lobby"`; `HEAD /`
returns 200 with no body; `GET /?code=ABCDE` returns the same page; raw
`GET /..%2fpackage.json`, `GET /%2e%2e%2fpackage.json` and `GET /%00` return
404; `DELETE /` returns 405.

#### `public/config.js`

One line: `window.SERVER_URL = "";`. Empty means same origin. Set it to the
server's `https://` URL, with no trailing slash, before a split deployment.

#### `public/index.html`

`<!doctype html>`, `<html lang="en">`, `<meta charset="utf-8">`, `<meta
name="viewport" content="width=device-width, initial-scale=1">`,
`<title>Hackenbush Online</title>`, `<link rel="icon" href="data:,">` (stops a
favicon request), and `style.css`. At the end of `<body>`, classic scripts in
order: `config.js`, `render.js`, `app.js`. Body:

*   `<section id="lobby">`: `<h1>Hackenbush Online</h1>`, `<button
    id="create">Create Game</button>`, `<input id="code-input" maxlength="5"
    autocomplete="off" aria-label="Game code">`, `<button id="join">Join
    Game</button>`, `<p id="lobby-error" role="alert">`.
*   `<section id="game" hidden>`: `<span id="room-code">`, `<button
    id="copy-link">Copy join link</button>`, `<span id="role">`, `<p
    id="status" aria-live="polite">`, `<svg id="board" viewBox="0 0 600 400">`,
    `<div id="banner" hidden>` holding `<p id="result">` and `<button
    id="back">Back to lobby</button>`.

#### `public/style.css`

*   `[hidden] { display: none !important; }`.
*   Edge groups carry class `red` or `blue`. Their visible line (class
    `stroke`) is 6px wide, `#c62828` for red and `#1565c0` for blue. The
    transparent hit line (class `hit`) is 20px wide.
*   Nodes fill `#424242`. The ground line is 10px `#6d4c41`.
*   `.mine` on an edge group sets `cursor: pointer`; `.mine:hover .stroke` is
    9px wide.
*   `svg.waiting-turn .mine` has 50% opacity and the default cursor.
*   `.fall`: `transition: transform 0.6s ease-in, opacity 0.6s; transform:
    translateY(120px); opacity: 0; pointer-events: none`.
*   `#banner` is a centered overlay. The page is a single centered column up
    to 640px wide.

#### `public/render.js`

Defines `window.Render` with private `svg`, `onEdgeClick` and `drawn`:

*   `Render.init(svgEl, onEdgeClick)`: called once at page load. Stores both
    and attaches the only click listener to the svg: find the closest
    `g[id^="e-"]`; if it has `.mine` and the svg lacks `.waiting-turn`, call
    `onEdgeClick` with the numeric id.
*   `Render.reset()`: empties the svg and sets `drawn` to false.
*   `Render.update(game, lastMove, role)`:
    *   If `drawn` is false: draw the ground as a `<line>` from `(0, 360)` to
        `(600, 360)`; for each edge a `<g id="e-<id>" class="<color>">` holding
        a `<line class="stroke">` and a `<line class="hit">`; for each node a
        `<circle id="n-<id>" r="7">`. Positions use `sx = x`, `sy = 360 - y`.
        Edges are drawn before nodes. Set `drawn` to true and skip the falling
        step.
    *   Otherwise, when `lastMove` is present: for `lastMove.edgeId` and each
        id in `lastMove.fell.edges` take `e-<id>`, and for each id in
        `lastMove.fell.nodes` take `n-<id>`; add `.fall` and remove the element
        600 ms later.
    *   Then remove at once any `e-*` or `n-*` element without `.fall` whose id
        is not in `game.board` (this covers a reconnect snapshot).
    *   Set `.mine` on edge groups whose color equals `role`. Put
        `.waiting-turn` on the svg unless `game.status === "playing"` and
        `game.turn === role`.

#### `public/app.js`

*   State: `{code, role, socket, joinedOnSocket, game, lastState, retryMs,
    retryTimer, leaving}`.
*   `base` is `window.SERVER_URL` or `""`, with any trailing `/` removed. The
    socket URL is `base` with `^http` replaced by `ws`, plus `/ws`. When `base`
    is empty it is `(location.protocol === "https:" ? "wss://" : "ws://") +
    location.host + "/ws"`.
*   Tokens: `sessionStorage.getItem("hackenbush:" + code)`. Each tab has its
    own seat, so two windows of one browser can play each other.
*   On load: call `Render.init(svg, edgeId => send({type: "cut", edgeId}))`.
    If the URL has `?code=X`, fill `#code-input` with it, and if a token is
    stored for `X`, call `startGame(X)` at once (this is how a reload gets the
    seat back).
*   `startGame(code)`: set `code`, `leaving = false`, `retryMs = 1000`,
    `lastState = null`; `Render.reset()`; `connect()`.
*   `connect()`: open a socket and store it in `state.socket`, with
    `joinedOnSocket = false`. Every handler on a socket first checks that the
    socket is still `state.socket` and returns if not. On open, send `{type:
    "join", code}`, adding `token` only when one is stored.
*   `Create Game`: `fetch(base + "/create-game", {method: "POST"})`. On 200:
    `startGame(code)`. On 429: "Server is full. Try again later." On any other
    status or a network error: "Cannot reach the server.".
*   `Join Game`: uppercase and trim the input, `startGame(code)`.
*   `joined`: `joinedOnSocket = true`, `retryMs = 1000`; store the token; set
    `role`; `history.replaceState(null, "", "?code=" + code)`; show `#game`;
    set `#room-code` and `#role` ("You are Red" or "You are Blue").
*   `state`: call `Render.update(game, lastMove, role)`, set `lastState`, and
    set the status text from it:
    *   `waiting`: "Waiting for an opponent. Share code <code> or the join
        link." (`<code>` is the real code).
    *   `playing`: "Your turn" or "Opponent's turn"; if the opponent's
        `connected` is false, "Opponent disconnected. They have 60 seconds to
        return."; if the previous `lastState` was also `playing` and the
        opponent's `connected` went from false to true, show "Opponent
        reconnected" for 3 seconds, then the turn text.
    *   `finished`: show `#banner`. The winner sees "You win", plus " (your
        opponent left)" when `reason` is `"forfeit"`. The loser sees "You
        lose", plus " (you were away too long)" when `reason` is `"forfeit"`.
        Remove the stored token.
*   `error` while `joinedOnSocket` is false: `leaveGame()`, then show in
    `#lobby-error` either the `message`, or, when the code is `room_not_found`
    and a token was stored, the design's CUJ 5 text ("This game no longer
    exists on the server. It may have ended, or the server may have
    restarted.") and remove the token.
*   `error` while `joinedOnSocket` is true: show the `message` in `#status`
    for 3 seconds, then the text recomputed from `lastState`.
*   Socket close: if code is 4000, `leaveGame()` and show "This game was
    opened in another tab." in `#lobby-error`. Otherwise, if `leaving` is
    false and `lastState` is not `finished`, show "Reconnecting..." and call
    `connect()` after `retryMs`, then double `retryMs` up to 5000.
*   `leaveGame()`: `leaving = true`, clear `retryTimer`, close the socket,
    `Render.reset()`, hide `#banner` and `#game`, show `#lobby`, and
    `history.replaceState(null, "", location.pathname)`.
*   `Back to lobby`: `leaveGame()`.
*   `Copy join link`: if `navigator.clipboard` is missing, show the link text
    in `#status`. Otherwise `writeText(location.origin + location.pathname +
    "?code=" + code)`; on success show "Link copied" for 2 seconds; on
    rejection show the link text in `#status`.
*   All player-visible text is set with `textContent`.

#### `README.md`

Sections: what it is; requirements (Node 22 or later); run locally (`npm
install`, `npm start`, open `http://localhost:3000` in two windows); tests
(`npm test`); the rules in four sentences; environment variables (`PORT`,
`ALLOWED_ORIGIN`, which must exactly match the client's origin with no trailing
slash) and `window.SERVER_URL` in `public/config.js`; deploying (the server
needs a long-lived process and a public URL, such as Render, Fly.io or Railway;
Vercel serverless functions cannot hold a WebSocket server; for the split
deployment set `SERVER_URL` and `ALLOWED_ORIGIN` with `https` URLs; the
500-room ceiling; a host that sleeps or restarts loses all games).

### Verification per increment

1.  `npm test` passes `test/game.test.js`.
2.  `npm test` passes all three test files.
3.  `npm test` passes, including the static cases. `http://localhost:3000`
    loads with no console errors and the lobby renders, checked with the
    `browser-automation` skill and a screenshot.
4.  Two browser windows play the R0, B4, R9 game to a Red win. One window
    reloads mid-game and keeps its seat. In a second game, one window is closed
    and the other shows "Opponent disconnected", then the forfeit win after 60
    seconds.

### Decisions made here

*   Game logic mutates the game object in place; one room owns one game, so no
    copy is needed per cut.
*   Classic `<script>` tags and `window.Render`, not ES modules: no build step,
    and a split deployment needs no module MIME or CORS setup.
*   The registry works on abstract conns, so lifecycle tests need no network.
*   Node 22 or later. Node 18 and 20 are past end of life, and
    `t.mock.timers.enable({apis})` needs 20.11 or later.
*   A replaced conn is closed with WebSocket close code 4000, and the client
    does not reconnect after it, so two tabs holding one token do not take the
    seat back and forth. (The design already records this and the
    `sessionStorage` choice.)
*   A reload reclaims the seat because `joined` writes `?code=` into the URL
    and page load reconnects when a token is stored for that code.
*   Client timings: fall animation 600 ms and 120px; transient messages 3 s
    ("Link copied" 2 s); reconnect delay 1 s doubling to 5 s.
