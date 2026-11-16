# Hackenbush Online v2: Rooms, Names, Green Hackenbush, Big Boards, Bot

*   **Author:** Raymond Tian
*   **Status:** Implemented
*   **Date:** 2026-11-15
*   **Builds on:** [design_draft.md](./design_draft.md) (v1). Everything in
    v1 stays unless this document changes it. The protocol tables below are
    the complete v2 protocol and replace v1's.

--------------------------------------------------------------------------------

## Overview

Hackenbush is a game of coloured edges standing on the ground: players take
turns cutting an edge they are allowed to cut, everything no longer connected
to the ground falls, and a player with no move on their turn loses
(Berlekamp, Conway and Guy, *Winning Ways*). v1 is a two-player Red-Blue
Hackenbush game. It has one fixed board. The game
starts the moment a second player joins, and players are known only as Red and
Blue.

v2 adds:

*   **Names.** Every player types a name. Names appear everywhere, and the end
    message reads "Raymond won the game!".
*   **Rooms.** Creating or joining puts players in a room first. The room shows
    both names and the host's settings. The host starts the game. When it ends,
    both players are back in the room and can play again. Anyone can leave at
    any time, including during a game.
*   **Green Hackenbush.** The host chooses Red-Blue or Green. In Green, every
    edge is green and either player may cut any edge.
*   **Bigger boards.** There are several named boards drawn as pictures of
    flowers and trees. Some flowers have loop-shaped petals.
*   **Single player.** You play a bot with three difficulty levels. The whole
    game runs in the browser, with no server. The bot calculates the exact game
    value of each possible move and chooses according to its difficulty. Players
    never see the value.
*   **Copy code.** The copy button copies only the 5-character code. v1 copied a
    join URL (`…/?code=XXXXX`). Opening such a URL still pre-fills the code.

## Problem Statement

Players cannot tell who they are playing. They cannot play twice with the same
person without making a new game. Every game uses the same board, and there is
no way to play alone. Playing alone must not depend on the free server, which
sleeps when idle.

## Goals

*   A player's name appears in the room, the game header, the turn status and
    the result ("Sam won the game!").
*   A room survives across games. After a game ends, both players are back in
    the same room with the same code. A player leaves only by choice, after
    being disconnected for 60 seconds, or when the room is closed after 30
    minutes without activity.
*   Only the host can change settings or start a game. If the host leaves, the
    other member (the "guest") becomes host.
*   The host chooses the mode (Red-Blue or Green), the board, and who plays
    Red. Red always moves first, so in Green this decides who moves first.
*   At least three new boards, each with 30 to 60 edges, drawn as recognisable
    pictures. Flower Garden and Bouquet have flowers with loop petals.
*   Single player works while the game server is asleep or unreachable, when
    the page is served from Vercel (the beta setup). If the page is instead
    served by the game server itself, a sleeping server means the page does
    not load at all.
*   On Hard, the bot never turns a winnable position into a lost one.
*   The copy button copies exactly the 5-letter code.

## Non-Goals

*   Spectators. A third person still gets `room_full`.
*   Showing position values to players.
*   These board features, which the exact value calculation cannot handle
    (see Bot). v1 allowed them, but its only board had none:
    *   cycles other than single-edge loops;
    *   parallel edges;
    *   edges between two ground nodes.
*   Accounts, chat, more than two players per room, and a level editor.
*   Saving single-player games across page reloads.

## Critical User Journeys (CUJs)

### CUJ 1: Room, settings, play, play again

*   **Given**: Ana has typed the name "Ana"; Ben has typed "Ben".
*   **When**: Ana clicks Create Room. She sees the room: the code, herself as
    host, and the settings. Ben joins with the code. Both see "Ana (host)" and
    "Ben". Ana picks Green, then Flower Garden, then "Ben plays first", and
    clicks Start.
*   **Then**: Both see the board. The status says whose turn it is. When the
    game ends, both see "Ben won the game!" over the final board for 3
    seconds. Then both are back in the room, which shows the result. Ana can
    change settings and start again.

### CUJ 2: Leaving

*   **Given**: Ana and Ben are mid-game.
*   **When**: Ben clicks Leave.
*   **Then**: Ben goes to the main menu. Ana sees "Ana won the game! (Ben
    left)". She is back in the room as host, waiting, and someone new can join
    with the same code.
*   **When (in the lobby)**: Ana, the host, clicks Leave while Ben is there.
*   **Then**: Ben becomes host. If nobody is left, the room closes.

### CUJ 3: Dropped connection

*   **Given**: A player is in a room, in the lobby or mid-game.
*   **When**: They reload, or their network drops, and they come back within
    60 seconds.
*   **Then**: They are back where they were, with the same name and seat.
*   **When (60 seconds pass)**: They do not come back.
*   **Then**: They are removed from the room. If a game was running, the other
    player wins with "(Ben lost connection)".

### CUJ 4: Single player

*   **Given**: Any page state. The game server may be asleep or unreachable.
*   **When**: Ana clicks Play vs Bot and chooses Red-Blue, Forest, Hard, and "I
    play Blue". Then she clicks Start.
*   **Then**: The game runs entirely in her browser. The bot is Red and moves
    first. After each of Ana's moves it replies after a short pause. The end
    shows "Ana won the game!" or "Bot (Hard) won the game!", with Play Again
    (same settings; a Random board is picked again, and Red-Blue colours are
    re-drawn except on `classic`) and Menu. Menu is also shown during the game,
    and quits at once.

### CUJ 5: Copy code

*   **When**: A player clicks Copy code in the room.
*   **Then**: The clipboard holds exactly the code, such as `K7QM2`, and the
    button briefly reads "Copied". If the clipboard is unavailable, the code is
    shown selected in a text field instead.

## Proposed Architecture

```text
 public/lib/game.js    rules for both modes: cut, prune, legal moves, win, board checks
 public/lib/boards.js  named boards: fixed shapes, colouring for a mode from a seed
 public/lib/bot.js     exact values and move choice by difficulty
   game.js and boards.js: loaded by the browser (script tags) and required by the server.
   bot.js: loaded by the browser only; Node loads it only in tests.
 server/rooms.js       rooms v2: members, host, settings, lobby/playing, timers
 server.js             HTTP + WebSocket wiring; v2 message validation
 public/app.js         screens: menu, room, online game, bot setup, bot game
 public/render.js      draws any board: viewBox from board size, loop petals, green
```

### Shared rules

v1 kept the rules on the server only and rejected sharing them with the
browser, because the browser decided nothing. v2 reverses that: single player
needs the rules in the browser.

Each `public/lib/` file works both as a classic browser script and as a
CommonJS module, with no build step. As a browser script it sets a global:
`window.HackenbushGame`, `window.HackenbushBoards` or `window.HackenbushBot`.
The server requires `public/lib/game.js` and `public/lib/boards.js`. The server
still decides every move in online games.

### Game state

Terms used below:

*   An edge's `a` and `b` are its two end nodes.
*   **Pruning** removes every edge and node no longer connected to the ground.
*   **Above** a node means further from that tree's ground node, not higher on
    the screen.

Changes from v1:

*   `edge.color` is `"red"`, `"blue"` or `"green"`.
*   A **loop** is an edge with `a === b`. It also has `angle` (degrees, 0 =
    pointing up), which sets the petal's direction. Cutting a loop removes only
    the loop. A loop falls when its node falls. The v1 `prune` already behaves
    this way.
*   `game` is `{ mode, board, turn, status, winner, reason, sides }`:
    *   `mode` is `"redblue"` or `"green"`.
    *   `status` is `"playing"` or `"finished"`. v1's `"waiting"` state now
        belongs to the room, not the game.
    *   `turn` and `winner` are sides: `"red"` or `"blue"`.
    *   `reason` is `null`, `"no_moves"`, `"left"` or `"timeout"`.
    *   `sides` is `{ red: { id, name }, blue: { id, name } }`. It copies each
        player's id and name at Start; the game header and the result always
        use these names, even if a player rejoins under a new name mid-game.
        Member ids are strings (`m1`, `m2`, ...) never reused within a room.
*   Red always moves first. A side may cut an edge whose colour is its own
    side or `"green"`. In Green mode, every edge is green and the UI shows
    names instead of side colours.
*   The player to move with no legal cut loses, as in v1.
*   `board` gains `width` and `height`. The ground is at `y = 0` and `y` grows
    upward. The client flips it to SVG coordinates and sets the `viewBox`.
*   `validateBoard(board)` now checks structure only:
    *   ids are unique;
    *   endpoints exist;
    *   every node reaches the ground;
    *   ignoring loops, every connected part is a tree containing exactly one
        ground node. This rules out other cycles, parallel edges, and edges
        between two ground nodes.

    v1's "both colours present" check moves to the board tests (see Boards),
    so a Green board is valid.

### Boards (`public/lib/boards.js`)

This replaces v1's `server/board.js`, which is deleted. The v1 board becomes
`classic`.

*   **Interface.** `BOARDS` lists `{ id, name }` for `classic`, `flowers`
    (Flower Garden), `forest` and `bouquet`. `makeBoard(id, mode, seed)`
    returns a board.
*   **Shape and colour.** Each board's shape is fixed. In Green mode every edge
    is green. In Red-Blue mode, colours come from a small seeded random
    generator (mulberry32). `classic` keeps its v1 colours. Every Red-Blue
    board is forced to have at least one edge of each colour.
*   **Where boards are built.**
    *   Online: the server builds the board at Start, with a seed from
        `crypto.randomInt`.
    *   Single player: the browser builds it, with a seed from `Math.random`.
    *   `random` is a board choice in both. It picks one of the four boards
        when the game starts.
*   **Tests.** Every board, in both modes, across 200 seeds:
    *   passes `validateBoard`;
    *   has 30 to 60 edges, except `classic`;
    *   in Red-Blue, has both colours.

    `validateBoard` itself is tested to reject a cycle, parallel edges and an
    edge between two ground nodes.

### Bot (`public/lib/bot.js`)

**What a value means.** These rules come from Berlekamp, Conway and Guy,
*Winning Ways*, vol. 1.

*   In Red-Blue, a position's value is a number:
    *   positive means Red wins whoever moves first;
    *   negative means Blue wins;
    *   zero means the player to move loses.
*   In Green, a position's value is a nim-value: 0 means the player to move
    loses.

**Red-Blue value.** The value is computed exactly as a dyadic rational, a
fraction whose denominator is a power of 2, with `BigInt` numerators. It is
computed from the top of each tree down:

*   A node's value is the sum of its child edges' contributions.
*   A red edge carrying value `x` above it contributes `(x + n) / 2^(n-1)`,
    where `n` is the smallest positive integer with `x + n > 1`.
*   A blue edge contributes the negative of the red formula applied to `-x`.
*   A loop contributes `+1` if red and `-1` if blue, the same as a single
    leaf edge.
*   The board's value is the sum over its ground nodes.

**Green value.** A node's value is the XOR, over its child edges, of (the
value of the node at the edge's upper end, plus 1). This is the colon principle. A loop contributes 1. The board's
value is the XOR over its ground nodes.

**Choosing a move.** For each legal cut, the bot applies the cut to a copy of
the game and computes the resulting value.

*   **Red-Blue:** a best move maximizes the result when the bot is Red, and
    minimizes it when the bot is Blue. If any move keeps a win, the best move
    does.
*   **Green:** a best move leaves nim-value 0, if one exists. Otherwise every
    move counts as best.

Tests check the Red-Blue formula against a brute-force calculation of the
exact value (the simplest number between the best Red and best Blue options),
and the Green formula against brute-force nim-values (mex of options), on
small random tree positions.

**Difficulty.** On each turn the bot plays a best move with probability 1.0
(Hard), 0.65 (Medium) or 0.2 (Easy). Otherwise it cuts any legal edge chosen
uniformly at random. Ties among best moves are broken at random. The random
source can be injected, for tests.

**Pause.** The bot waits 500 to 900 ms before moving.

**Speed.** One value calculation takes time linear in the board size, and there
are at most about 60 moves. A test checks that a Hard move on the largest
board takes under 200 ms.

### Message schema (v2)

Client to server:

| `type`     | Fields                          | Meaning                                                        |
| :--------- | :------------------------------ | :------------------------------------------------------------- |
| `join`     | `code`, `name`, `token?`        | Enter a room. A valid `token` reclaims the same member; the sent `name` replaces the stored one. |
| `settings` | `mode?`, `board?`, `redPlayer?` | Host only, lobby only. `mode`: `redblue`/`green`. `board`: a board id or `random`. `redPlayer`: `host`/`guest`/`random`. |
| `start`    | none                            | Host only, lobby only, two connected members.                  |
| `cut`      | `edgeId`                        | During a game.                                                 |
| `leave`    | none                            | Leave the room. A game in progress is forfeited first. Afterwards the socket may `join` again. |

Server to client:

| `type`   | Fields                      | Meaning                                    |
| :------- | :-------------------------- | :----------------------------------------- |
| `joined` | `code`, `memberId`, `token` | Join accepted.                             |
| `room`   | `room`, `lastMove?`         | Full room snapshot after every change. Replaces v1's `state`. |
| `left`   | none                        | Confirms a `leave`.                        |
| `error`  | `code`, `message`           | Request rejected; nothing changed.         |
| `ping`   | none                        | As in v1. The client does not reply.       |

The `room` snapshot:

```text
{ code, status: "lobby" | "playing", hostId, gameNumber,
  members:  [{ id, name, connected }],
  settings: { mode, board, redPlayer },
  game:     null | game }
```

*   A new room starts with `settings` `{ mode: "redblue", board: "random",
    redPlayer: "random" }`.
*   `game` is `null` until the first Start.
*   During play it is the running game. After a game ends, the room is back in
    `"lobby"` but keeps the finished game until the next Start. That way the
    client can draw the final board, and the room can show the result.
*   `lastMove` is `{ edgeId, fell: { edges, nodes } }`. It is present only on
    the snapshot that follows a cut, as in v1.

`redPlayer` names a role, not a person. If the host changes, `"host"` now
means the new host.

Errors (v1 codes kept, new ones marked *):

| `code`            | When                                                                  |
| :---------------- | :-------------------------------------------------------------------- |
| `bad_message`     | Invalid JSON, unknown `type`, or a missing or wrong-typed field. This includes a missing `name` and invalid `settings` values. |
| `bad_name` *      | `name` is empty after cleaning.                                       |
| `room_not_found`  | No room with that code.                                               |
| `room_full`       | Two members already, and no matching token.                           |
| `not_joined`      | `settings`, `start`, `cut` or `leave` before joining.                 |
| `not_host` *      | `settings` or `start` from a non-host.                                |
| `not_in_lobby` *  | `settings` or `start` while `playing`.                                |
| `not_ready` *     | `start` without two connected members.                                |
| `illegal_move`    | A failed `cut`, including a cut in the lobby.                         |

Checks run in this order, and the first failure is reported: message shape
(`bad_message`), joined (`not_joined`), host (`not_host`), lobby
(`not_in_lobby`), ready (`not_ready`). A `join` from a socket that is already
in a room gets `bad_message` "Already joined.". A join with a token whose
member was already removed is treated as a new join. If a join that carried a
token gets `room_full`, the client removes that token.

### Room lifecycle (replaces v1's)

*   **Create.** `POST /create-game` makes an empty `lobby` room. The first
    member to join becomes host. If nobody joins within 10 minutes, the room is
    deleted. The first join cancels that timer.
*   **Start.** The board and red player are resolved (including `random`), the
    board is built, `sides` are set, and the status becomes `playing`.
*   **Game end.** On a win, `game.status` becomes `finished` and the room goes
    back to `lobby`, keeping `game`.
*   **Leave.** The member is removed. In `playing` the game first ends with
    `reason: "left"` and the other side winning. If the host leaves, the
    remaining member becomes host. A room with no members is deleted at once.
*   **Disconnect.** The member is marked `connected: false`, and one 60 second
    timer starts for that member. It keeps running across a game ending.
    Rejoining with the token cancels it. When it expires, the member is
    removed exactly like Leave, but with `reason: "timeout"`.
*   **Idle.** A room with no accepted message (one that did not produce an
    `error`) from any member for 30 minutes is deleted. Its sockets are closed
    with code 4001 ("room closed"), and the client goes to the Menu showing
    "The room closed after 30 minutes without activity.". Pings do not count.
    This stops idle tabs from holding rooms under the 500-room cap. Server
    shutdown still closes sockets with v1's 1000, so clients reconnect and show
    the v1 "game no longer exists" message.
*   **Unchanged from v1:** the 500-room cap, close code 4000 for a replaced
    connection, heartbeat and `ping`, the origin rules, and the 1 KB message
    limit.

### Names

*   Clean a name in this order:
    1.  remove control characters (U+0000-001F, U+007F-009F) and invisible or
        direction-changing characters (U+200B-200F, U+202A-202E, U+2066-2069,
        U+FEFF);
    2.  trim spaces;
    3.  cut to 20 Unicode code points.

    An empty result is `bad_name`.
*   Duplicate names are allowed; members are told apart by id.
*   The client remembers the name in `localStorage`, and its name field is
    limited to 20 characters.
*   Names are always shown with `textContent`.

### Client changes

**Screens:**

*   **Menu:** a name field, required before anything else. Then Create Room, a
    code field with Join, and Play vs Bot. A `?code=` URL pre-fills the code
    field.
*   **Room:**
    *   the code, with a Copy code button;
    *   the members, with "(host)" and a disconnected marker;
    *   the settings: selects for the host; for the guest, the same selects
        disabled, so they read as text;
    *   Start, for the host only, enabled with two connected members;
    *   Leave;
    *   the last result, if any.
*   **Online game:**
    *   a header like "Ana (Red) vs Ben (Blue)", or "Ana vs Ben" in Green;
    *   a status line such as "Your turn" or "Ben's turn";
    *   the board;
    *   Leave.

    The result banner shows over the final board for 3 seconds when a `room`
    snapshot in `lobby` with a finished `game` arrives and the previous
    snapshot on the same connection was `playing`. A client that reconnects
    into such a room goes straight to the Room screen, which shows the result.
    A `playing` snapshot that arrives during the banner cancels it.
*   **Bot setup:** mode, board (including Random), difficulty, and your side
    (Red, Blue or Random). In Green, the side choice reads "I go first", "Bot
    goes first" or Random. Then Start and Back.
*   **Bot game:** the same board view, with Menu at all times and Play Again at
    the end.

**Behaviour that changes from v1:**

*   **Seat token.** The token is kept for the life of the room membership, not
    removed when a game ends. It is removed on `left`, on `room_not_found`, and
    on close code 4001.
*   **Reconnect.** The client reconnects whenever it is in a room, in the lobby
    or mid-game. v1 stopped reconnecting after a game finished.
*   **Silence watchdog.** The v1 rule (reconnect after 45 seconds without a
    message) runs whenever the client is in a room.
*   **Rendering:**
    *   `render.js` takes its size from `board.width` and `board.height`, not
        the fixed 600 × 400;
    *   it draws loops as petal paths;
    *   it colours green edges;
    *   it treats green edges as clickable for either side.

**Rollout.** Render (server) and Vercel (page) deploy separately. For a minute
or two a v1 page may talk to a v2 server, or the other way round. Both get
`bad_message`, or messages they ignore. This is accepted for a beta. Players
reload.

### Files

| File | Change |
| :--- | :----- |
| `public/lib/game.js` | **Move + modify** from `server/game.js`: browser/CommonJS wrapper, modes, green, sides, tree check; `newGame` starts `playing` (no `"waiting"`); `forfeit(game, loser, reason)` takes `"left"` or `"timeout"`. |
| `public/lib/boards.js` | **Create**. It replaces `server/board.js`. |
| `public/lib/bot.js` | **Create**. |
| `server/game.js`, `server/board.js` | **Delete**. |
| `server/rooms.js` | **Rewrite** for rooms v2. Requires `../public/lib/game.js` and `../public/lib/boards.js`. |
| `server.js` | **Modify**: v2 message validation, the `leave` and `left` handling, and close code 4001. |
| `public/index.html` | **Modify**: the new screens, and `<script>` tags for `lib/game.js`, `lib/boards.js`, `lib/bot.js` before `render.js` and `app.js`. |
| `public/style.css` | **Modify**: green edges, petals, and the room and setup screens. |
| `public/render.js` | **Modify**: board size, loops, green. |
| `public/app.js` | **Rewrite** for the screens and v2 protocol. |
| `test/game.test.js` | **Modify**: new `require` path, green, loops, tree check. |
| `test/boards.test.js`, `test/bot.test.js` | **Create**. |
| `test/rooms.test.js`, `test/server.test.js` | **Rewrite** for v2. |
| `README.md` | **Modify**: modes, rooms, single player. |

`scripts/deploy-client.js` already copies all of `public/`, including
`public/lib/`. The server's static file handler already serves `.js` from
subfolders.

## Risks & Mitigations

| Risk | Mitigation |
| :--- | :--------- |
| A wrong value formula makes the Hard bot play badly. | Tests compare the formula against brute-force minimax on small random tree positions in both modes. |
| Bigger boards make the bot slow. | Value calculation is linear in board size. A test caps a Hard move at 200 ms on the largest board. |
| Sharing rules forces a module format on both sides. | A small wrapper makes each file work as a script and as a CommonJS module, with no build step. |
| Idle rooms fill the 500-room cap. | The 30-minute idle deletion. |
| A disconnected member blocks the room forever. | Every disconnected member has one running 60 second timer, which ends in removal. |
| A v1 and v2 mismatch during a deploy. | Accepted for the beta (see Rollout). |

## Verification

*   **Unit tests:**
    *   rules for both modes, loops, and the tree check;
    *   every board across seeds;
    *   bot values against brute force;
    *   bot difficulty with a fixed random source;
    *   rooms v2 with fake timers: host hand-over, leave mid-game, timeout
        mid-game and in the lobby, the timer running across a game end, play
        again, idle deletion, and every error code.
*   **Server tests over real sockets:** join with names, settings, start, play
    to a result, then back in the lobby and play again.
*   **Browser checks:**
    *   two pages: names, room, settings, a Green game on Flower Garden, the
        result back in the room, and leave mid-game;
    *   single player against an unreachable server;
    *   Copy code puts exactly the code on the clipboard.

## Alternatives Considered

*   **Run the bot on the server.** Single player would then depend on the
    server, which sleeps on the free tier.
*   **Minimax search instead of value formulas.** The 30 to 60 edge boards are
    too large for exhaustive search, while exact values are linear.
*   **Boards with general cycles.** Exact Red-Blue values on graphs with cycles
    are expensive. Single-edge loops give the flower look and keep the values
    exact.
*   **Separate lobby and game messages.** One room snapshot covers both states
    and keeps rejoin simple.
*   **Balancing every Red-Blue board to value 0.** The host can pick `random`
    for who plays Red, so neither player knows in advance which side the board
    favours.
*   **Store `redPlayer` by member id instead of role.** It would survive a
    host change, but it would point at a person who may have left, and the
    guest's choice would then need its own setting. A role is simpler; its
    meaning after a host change is stated in the Message schema.
