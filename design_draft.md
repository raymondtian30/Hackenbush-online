# Hackenbush Online

*   **Author:** Raymond Tian
*   **Status:** Draft
*   **Date:** 2026-11-15

--------------------------------------------------------------------------------

## Overview

A web app where two people play Red-Blue Partisan Hackenbush in real time. One
player creates a game and gets a 5-character code. The other enters it. The
server holds the authoritative game state, rejects illegal moves, and sends the
new board to both browsers.

Constraints from the project brief: Node.js server (22 or later), the `ws`
library for WebSockets, a plain browser client, in-memory rooms, no database.

### Game rules

The board is a drawing of colored line segments (edges) joined at points
(nodes), standing on a ground line. Each edge is Red or Blue. Players alternate
turns. Red may delete only Red edges and Blue only Blue edges. When an edge is
deleted, every edge and node with no path of edges down to the ground falls
off. A player who cannot move on their turn loses. A stalk is a chain of edges
rising from the ground, and branches split off it.

## Problem Statement

Two people on different networks should be able to play Hackenbush with no
install. That needs a lobby that creates or joins a game by code, a board
showing the graph, and a server that keeps both players in step and rejects
illegal moves.

## Goals

*   Two players on different networks can play a full game using a join code.
*   The server decides what is legal. A cut of an edge of the wrong color, out
    of turn, or of an edge that does not exist is rejected and changes nothing.
*   A cut removes everything no longer connected to the ground, and both
    players see it fall away.
*   A dropped connection does not end the game. The player can rejoin with the
    same code within 60 seconds.
*   Runs locally with `node server.js`. The README explains how to deploy it.

## Non-Goals

*   Level editor, accounts, persistence, matchmaking, chat, move timers, AI.
*   Surviving a server restart. Rooms live in memory. A restart, or a free-tier
    host going to sleep, ends all games and the client says so (CUJ 5).
*   More than one server process.
*   Defending against a determined attacker. The only protections are a global
    room cap, a message size limit, and unguessable seat tokens (see Risks &
    Mitigations). Per-IP rate limiting is deferred until abuse is seen.
*   Rematch and spectators. These are stretch items, built only after the core
    game works. They are not in the v1 message schema.

## Open Questions

*   **Server host.** The author wants a Vercel deployment. Vercel functions are
    serverless and, per Vercel's documentation, do not support holding a
    WebSocket server or in-memory state between requests, so the game server
    needs a long-lived host (Render, Fly.io, or Railway). Working decision: the
    static client goes on Vercel and the server on one of those hosts (the
    "split deployment" in Proposed Architecture). Which server host, and its
    account, is still to be chosen before the deploy step.

## Critical User Journeys (CUJs)

### CUJ 1: Create and play

*   **Given**: Two people with browsers, no existing game.
*   **When**: Player A clicks Create Game. The client calls `POST /create-game`,
    then opens the socket and sends `join` with the returned code. A sees a
    waiting screen with the code and a join link (`/?code=ABCDE`, which opens
    the lobby with the code filled in). Player B enters the code and sends
    `join`. Players alternate cutting edges of their own color.
*   **Then**: Seats go in join order: A is Red, B is Blue. Red moves first. Each
    cut updates both boards. When the player to move has no edge of their
    color, the other player is shown as the winner on both screens.

### CUJ 2: Illegal move

*   **Given**: A running game.
*   **When**: A client sends a cut for an edge of the other color, out of turn,
    or for an edge that is already gone.
*   **Then**: The server answers with an `error` and changes nothing.

### CUJ 3: Disconnect and rejoin

*   **Given**: A running game, and one player's connection drops.
*   **When**: That player reloads the tab within 60 seconds.
*   **Then**: They get their seat and the current board back. The opponent sees
    "opponent disconnected", then "opponent reconnected".

### CUJ 3b: Disconnect and do not return

*   **Given**: A running game, and one player's connection drops.
*   **When**: 60 seconds pass without that player rejoining.
*   **Then**: The game ends as a forfeit and the other player is shown as the
    winner.

### CUJ 4: Bad code

*   **Given**: A code with no room, or a room with two players.
*   **When**: A client sends `join`.
*   **Then**: The lobby shows the server's error message (`room_not_found` or
    `room_full`). No room is created.

### CUJ 5: Game no longer exists

*   **Given**: A player holds a saved seat token for a room.
*   **When**: The client rejoins and gets `room_not_found`.
*   **Then**: The client shows "This game no longer exists on the server. It
    may have ended, or the server may have restarted." and offers Create Game.

## Proposed Architecture

```text
 Browser (Red)  --\                      +-------------------------+
                   >-- WebSocket /ws --> | server.js               |
 Browser (Blue) --/                      |  http: static + create  |
                                         |  ws: join / cut         |
                                         |  rooms (Map by code)    |
                                         |  game logic (pure)      |
                                         +-------------------------+
```

Two deployment shapes use the same code:

*   **Single host.** `server.js` serves `public/` and the API from one origin.
    `SERVER_URL` is empty and `ALLOWED_ORIGIN` is unset, so only same-origin
    room creation and socket upgrades are accepted.
*   **Split deployment.** `public/` is on Vercel and `server.js` on a long-lived
    host. `public/config.js` sets `window.SERVER_URL` to the server's `https://` URL,
    edited before deploying. The server's `ALLOWED_ORIGIN` holds the exact
    Vercel production origin. The server uses it to answer the CORS preflight
    (`OPTIONS`) and add `Access-Control-Allow-Origin` on `POST /create-game`, and
    to reject a `POST /create-game` or WebSocket upgrade whose `Origin` header
    differs. Vercel preview
    URLs are not allowed. The client connects with `wss://`, which also keeps
    seat tokens off the wire in the clear.

### Game state

The board is a graph.

*   **Node**: `{id, x, y, ground}`. `ground: true` marks a node on the ground
    line. All ground nodes together are the single root of the graph.
*   **Edge**: `{id, a, b, color}`. `a` and `b` are node ids. `color` is `"red"`
    or `"blue"`. Edge ids never change during a game. Parallel edges, cycles,
    and edges between two ground nodes are allowed.
*   Node ids and edge ids are separate numbering spaces.
*   **Positions are part of the board.** The server sends `x` and `y`, so the
    client only draws.
*   **Game**: `{board, turn, status, winner, reason}`. `turn` and `winner` are
    colors; `winner` and `reason` are null until the game is finished. `reason`
    is `"no_moves"` or `"forfeit"`. `status` is `"waiting"`, `"playing"`, or
    `"finished"`. Game status is also room state (see Room lifecycle).
*   A player's role is the color of the seat they hold.

A cut is legal only when the game is `playing`, the caller holds the seat whose
turn it is, the edge exists, and the edge color is the caller's color. A legal
cut removes the edge, then removes every edge and node that no longer reaches a
ground node, then passes the turn. If the player now to move has no edge of
their color, the game is `finished` with `reason: "no_moves"` and the other
color wins. The server returns the removed ids as `fell: {edges, nodes}`, so the
client removes exactly what the server removed.

The default board is a fixed set of stalks with branches, mixed red and blue,
defined in `server/board.js`. It is checked at startup: every node reaches the
ground and both colors have at least one edge.

### Message schema

JSON over one WebSocket at `/ws`. Unknown fields are ignored. An unknown `type`
is a `bad_message` error.

Client to server:

| `type` | Fields           | Meaning                                             |
| :----- | :--------------- | :-------------------------------------------------- |
| `join` | `code`, `token?` | Attach to a room. `token` reclaims an earlier seat. |
| `cut`  | `edgeId`         | Cut this edge.                                      |

Server to client:

| `type`   | Fields                         | Meaning                                         |
| :------- | :----------------------------- | :---------------------------------------------- |
| `joined` | `code`, `role`, `token`        | Join accepted. `role` is `red` or `blue`.       |
| `state`  | `game`, `players`, `lastMove?` | Full snapshot, sent after every change.         |
| `error`  | `code`, `message`              | Request rejected, state unchanged.              |
| `ping`   | none                           | Sent every 30 seconds. A client that hears nothing for 45 seconds treats the connection as dead and reconnects. |

`players` is `{red: {connected}, blue: {connected}}`. `lastMove` is
`{edgeId, fell: {edges, nodes}}`, and is absent after a forfeit. The server
sends the full state every time: the board is small, and a rejoining client
then needs no special case. The client shows the error's `message` text to the
player.

| Error `code`     | When                                                               |
| :--------------- | :----------------------------------------------------------------- |
| `bad_message`    | Not valid JSON, unknown `type`, or a missing or wrong-typed field.  |
| `room_not_found` | `join` with a code that has no room.                               |
| `room_full`      | `join` without a matching token while both seats are taken.        |
| `not_joined`     | `cut` from a socket that has not completed `join`.                 |
| `illegal_move`   | Any other failed `cut` check: game not `playing`, not the caller's turn, edge of the other color, or no such edge. The `message` text says which. |

Seating: a `join` without a token takes the first empty seat (Red, then Blue).
A `join` with a token reclaims that token's seat, even if the room is full.
Room creation is `POST /create-game`, returning `{code}`; it creates the room
with no seats, and the first `join` seats Red. Creating it over HTTP lets the
lobby show a code and a join link before any socket exists.

### Identity and seats

Each seat gets a token when first filled: 16 bytes from the operating
system's random source, hex encoded. The client stores it in
`sessionStorage`, keyed by room code, so a reload keeps the seat and each tab
holds its own seat (two windows of one browser can play each other). Closing
the tab loses the seat. One socket per seat: a newer connection with a valid
token replaces the older one, which is closed with WebSocket close code 4000;
a client closed with 4000 does not reconnect.

### Room lifecycle

| State      | Entered when                | Leaves when                                                      |
| :--------- | :-------------------------- | :--------------------------------------------------------------- |
| `waiting`  | `POST /create-game`         | Second player seated (`playing`), or 10 minutes pass (deleted).  |
| `playing`  | Second player seated        | A player has no move (`finished`), or a seat stays disconnected for 60 seconds (`finished`, forfeit won by the other color). |
| `finished` | Win or forfeit              | Deleted 60 seconds later.                                        |

While `playing`, a disconnect marks the seat disconnected and starts that
seat's 60 second timer, and a rejoin cancels it. While `waiting`, a disconnect
starts no timer; if the game then starts with a seat disconnected, that seat's
timer starts when the game starts. A server ping every 30 seconds closes dead sockets so
disconnects are noticed. If both seats are disconnected, whichever timer
expires first decides the forfeit. Codes use a 32-character alphabet without
look-alike characters, stored upper case and matched case-insensitively.
Creation checks the code is not in use.

### Risks & Mitigations

| Risk | Mitigation |
| :--- | :--------- |
| Code guessing (32^5, about 33 million codes). | Accepted. A guessed code can only fill a free seat in a room, never take a held one, and unjoined rooms last 10 minutes. |
| Memory growth from room creation. | A cap of 500 rooms in total; over it, `POST /create-game` returns HTTP 429. A room is a few KB, and 500 is the supported ceiling stated in the README. |
| Oversized messages. | `ws` `maxPayload` of 1 KB. |
| Seat token theft. | Tokens are unguessable. The client inserts player-visible text without interpreting it as HTML, and deployment uses `https`/`wss`. A token grants one seat in one game. |
| Cross-origin misconfiguration in a split deployment. | `ALLOWED_ORIGIN` is one origin; unset means same origin only. |
| One process; sleep or restart loses all rooms. | Accepted (Non-Goals). CUJ 5 makes it visible; the README notes free-tier sleep. |

### Verification

*   Unit tests (`node --test`) for game logic: legal and illegal cuts, pruning
    with a cycle, with parallel edges, and with an edge between two ground
    nodes, win and forfeit detection, board validation.
*   Tests for room lifecycle with fake timers: grace expiry, rejoin, 10 minute
    deletion, the room cap.
*   A scripted two-socket test that plays a full game against a running server.
*   A manual two-browser run, then the same against the deployed URLs.

### File layout

```text
server.js            HTTP (static files, POST /create-game) and WebSocket wiring
server/game.js       Pure game logic: cut, pruning, win check, board validation
server/board.js      The fixed default board (nodes and edges)
server/rooms.js      Room registry, seats, tokens, grace timers, cleanup, room cap
public/index.html    Lobby screen and game screen containers
public/config.js     window.SERVER_URL setting (empty means same origin)
public/app.js        Socket handling, screen switching, reconnect
public/render.js     SVG rendering and fall animation
public/style.css     Layout and colors
test/game.test.js    Unit tests for game logic
test/rooms.test.js   Tests for room lifecycle
test/server.test.js  Tests over real HTTP and WebSocket connections
README.md            Local run and deploy notes
```

The server never imports client code and the client never imports server code.
The only link is the message schema above.

## Alternatives Considered

Each option below was not chosen, for the reason given.

*   **React for the client.** The client is two screens and one SVG. A
    framework adds a build step and a dependency tree for no gain.
*   **Create the room with a WebSocket message instead of HTTP.** It removes one
    endpoint, but the lobby would need an open socket before it has a code, and
    HTTP keeps the join-link flow simple.
*   **No seat tokens, rejoin by code alone.** Anyone with the code could take
    over a disconnected player's seat.
*   **Send only the change, not full state.** A missed or reordered message
    would leave a client wrong, and rejoin would need a separate snapshot path
    anyway.
*   **Share the game logic between server and client.** The client decides
    nothing, so sharing adds a module-format constraint for no gain.
*   **One ground node instead of many ground-flagged nodes.** Every stalk would
    need a line to one point; flagged nodes draw each stalk where it stands.
*   **Write rooms to a file or key-value store so restarts survive.** Adds a
    write on every cut and stores tokens at rest, against the no-database
    constraint. CUJ 5 covers the visible failure.
*   **Server-Sent Events or long polling instead of WebSocket.** Two-way traffic
    would need a second channel for cuts, and the brief specifies `ws`.
*   **Everything on Vercel with a managed realtime service.** Game authority
    would live outside our server, and the brief requires a Node `ws` server.
*   **Single host only (no Vercel).** Simplest to deploy, but the author asked
    for Vercel. It remains supported as the single-host shape above.
*   **Rematch and spectators in v1.** Not in the goals, and who must agree to a
    rematch is undecided. Deferred as stretch items (see Non-Goals).
