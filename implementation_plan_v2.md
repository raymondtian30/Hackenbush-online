# Hackenbush Online v2: Implementation Plan

*   **Author:** Raymond Tian
*   **Status:** Draft
*   **Date:** 2026-11-15
*   **Design:** [design_v2.md](./design_v2.md). Behaviour, protocol and lifecycle
    are defined there and are not repeated here. This plan fixes the files,
    functions, data and order of work.

## Detailed Implementation Plan

### Order of work

For each task, write its tests first and watch them fail. Then implement. Then
check that the **whole** suite is green, commit, and run an EGM review of that
increment. Each task leaves the suite green.

| Task | Files (C = create, M = modify, R = rewrite, D = delete) |
| :--- | :------------------------------------------------------ |
| 1. Shared rules and boards | C `public/lib/game.js` (a copy of `server/game.js`, then changed), C `public/lib/boards.js`, C `test/lib-game.test.js`, C `test/boards.test.js`. `server/*.js` and the v1 tests are not touched. |
| 2. Bot | C `public/lib/bot.js`, C `test/bot.test.js` |
| 3. Rooms v2 server | R `server/rooms.js`, M `server.js`, D `server/game.js`, D `server/board.js`, D `test/game.test.js` (its cases now live in `test/lib-game.test.js`), R `test/rooms.test.js`, R `test/server.test.js` |
| 4. Client | M `public/index.html`, M `public/style.css`, M `public/render.js`, R `public/app.js`, M `test/server.test.js` (static cases for the new page and `/lib/`) |
| 5. Docs and ship | M `README.md`, M `design_v2.md` (status), then the final review and ship steps |

No other files change. Browser-check scripts live in the session scratchpad and
are not committed.

### Module wrapper (every `public/lib/*.js`)

```text
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(/* deps via require("./game.js") */);
  else root.<Global> = factory(/* deps via root.HackenbushGame */);
})(typeof self !== "undefined" ? self : this, function (/* deps */) { "use strict"; /* ... */ return api; });
```

| File | Global | Deps |
| :--- | :----- | :--- |
| `game.js` | `HackenbushGame` | none |
| `boards.js` | `HackenbushBoards` | none |
| `bot.js` | `HackenbushBot` | `game.js` |

### Task 1: `public/lib/game.js`

Copy `server/game.js` into this file, then change it as follows.

*   **`validateBoard(board)`** keeps its unique-id, endpoint and reachability
    checks, with the same messages. It drops the both-colours check. The
    checks run in this order: ids, endpoints, colour, reachability, then tree.
    It adds:
    *   any edge colour other than `red`, `blue` or `green` throws
        `Edge <id> has an invalid color`;
    *   the tree check (`<id>` is the lowest node id in the part): ignoring loops, every connected part must contain
        exactly one ground node (`Part with node <id> has <k> ground nodes`)
        and have edges = nodes - 1 (`Part with node <id> has a cycle or
        parallel edges`).

    `newGame` does not call `validateBoard`.
*   **`newGame(board, mode, sides)`** returns `{mode, board:
    structuredClone(board), turn: "red", status: "playing", winner: null,
    reason: null, sides}`. `startGame` is removed.
*   **`canCut(edge, side)`** returns `edge.color === side || edge.color ===
    "green"`.
*   **`legalMoves(game, side)`** returns the ids of edges, in board order,
    where `canCut` is true.
*   **`applyCut(game, side, edgeId)`** checks in the v1 order with the v1
    messages. The colour check uses `canCut`. On success it:
    1.  removes the edge;
    2.  calls `prune`;
    3.  sets `turn` to the other side;
    4.  if `legalMoves(game, game.turn)` is empty, sets `status:
        "finished"`, `winner: side` (the player who just moved) and `reason:
        "no_moves"`.

    It returns `{ok: true, fell}` as in v1.
*   **`cutEdge(board, edgeId)`** (new) returns a cut-and-pruned
    `structuredClone(board)` without any turn checks. It exists for
    brute-force tests.
*   **`forfeit(game, loserSide, reason)`** sets `status: "finished"`, `winner`
    to the other side and `reason`.
*   **`prune(board)`** and **`otherColor(side)`** are unchanged.
*   **Exports:** `validateBoard`, `newGame`, `canCut`, `legalMoves`,
    `applyCut`, `cutEdge`, `prune`, `forfeit`, `otherColor`.

### Task 1: `public/lib/boards.js`

*   **`mulberry32(seed)`** is exactly the following. Check:
    `mulberry32(1)()` is `0.6270739405881613`, and the second call gives
    `0.002735721180215478`.

    ```text
    function mulberry32(a) { return function () { a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
    ```
*   **`BOARDS`** is `[{id:"classic",name:"Classic"},
    {id:"flowers",name:"Flower Garden"}, {id:"forest",name:"Forest"},
    {id:"bouquet",name:"Bouquet"}]`.
*   **`pickBoardId(rand)`**: `rand` returns a float in [0, 1). Returns
    `BOARDS[Math.floor(rand() * BOARDS.length)].id`.
*   **`makeBoard(id, mode, seed)`** throws `Unknown board <id>` for an unknown
    id. Otherwise:
    1.  Build the shape. Nodes are `{id, x, y, ground}`. Edges are `{id, a, b,
        color: null}`, and loops also carry `angle`. Ids follow creation
        order, starting from 0.
    2.  Colour it:
        *   Green: every edge is `"green"`.
        *   Red-Blue `classic`: the v1 colours.
        *   Other Red-Blue boards: `const r = mulberry32(seed)`, then each
            edge in id order gets `r() < 0.5 ? "red" : "blue"`. If a colour is
            missing, the highest-id edge is switched to it.
    3.  Return `{width, height, nodes, edges}`.

    Coordinates have `y` going up from the ground at 0. Nodes and edges use
    separate id counters, both starting at 0.

**Exports:** `mulberry32`, `BOARDS`, `pickBoardId`, `makeBoard`.

The shapes, in creation order:

*   **`classic`**: `width: 600, height: 340`. The v1 nodes and edges are
    copied exactly, with the same ids and coordinates. v1 already used `y` up
    from 0; its renderer drew `svgY = 360 - y`.
*   **`flowers`**: `width: 900, height: 380`. For `i` from 0 to 5, with `x =
    75 + 150*i` and `s = i % 2 === 0 ? -1 : 1`:
    *   nodes: ground `(x,0)`, `(x,110)`, `(x,220)`, head `(x,300)`, leaf `(x +
        45*s, 160)`;
    *   edges, in this order: ground→110, 110→220, 220→head, 110→leaf;
    *   loops on the head at angles `0, 60, 120, 240, 300`. Angle 180 is
        skipped because the stem uses it.

    54 edges.
*   **`forest`**: `width: 820, height: 390`. For each `x` in `150, 410, 670`:
    *   nodes: ground `(x,0)`, `(x,100)`, `(x,190)`;
    *   edges: ground→100, then 100→190;
    *   then three levels, built breadth-first with the left child first:
        *   each level-1 node at `(cx,cy)` gets children `(cx∓70, cy+70)`;
        *   each level-2 node gets `(cx∓35, cy+60)`;
        *   each level-3 node gets `(cx∓17, cy+50)`.

        Each child edge is created right after its child node.

    48 edges.
*   **`bouquet`**: `width: 600, height: 400`.
    *   nodes: ground `(300,0)` and knot `(300,80)`, joined by the edge
        ground→knot;
    *   for `i` from 0 to 6, with `t = (-60 + 20*i)` degrees:
        *   node mid at `knot + 120*(sin t, cos t)`, then node head at `knot +
            250*(sin t, cos t)`;
        *   edges knot→mid and mid→head;
        *   loops on the head at `t-60, t-20, t+20, t+60`.

    Coordinates are rounded to integers. 43 edges.

### Task 1 tests

**`test/lib-game.test.js`** carries over the cases from v1's
`test/game.test.js`, with these changes:

*   It requires `../public/lib/game.js` and `../public/lib/boards.js`.
*   v1's local `makeBoard` helper becomes `buildBoard` and adds `"G"` for
    green.
*   The default board becomes `makeBoard("classic","redblue",0)`.
*   `playingGame` becomes `newGame(board, "redblue", SIDES)`, where `SIDES =
    {red:{id:"m1",name:"A"}, blue:{id:"m2",name:"B"}}`.
*   These v1 cases are dropped: "no red edge" and "no blue edge" (the check
    has gone), "newGame starts waiting" (now: starts `playing`), and "a cut is
    rejected while waiting".
*   The forfeit case now expects `reason` to be the passed value.

New cases:

*   in Green, red and blue can each cut the same kind of edge;
*   a Green game ends when no edges remain, and the side to move loses;
*   red may cut a green edge on a mixed board;
*   cutting a loop gives `fell` `{edges:[],nodes:[]}`;
*   a loop falls when its node is cut off;
*   the tree check rejects a cycle, parallel edges, and an edge between two
    ground nodes, and accepts loops;
*   an invalid colour is rejected;
*   `cutEdge` does not change its input.

**`test/boards.test.js`** checks every board in both modes for seeds 0 to 199:

*   it passes `validateBoard`;
*   its edge counts are exactly 13, 54, 48 and 43;
*   every edge is green in Green;
*   both colours appear in Red-Blue;
*   every node lies within `0..width` and `0..height`.

It also checks that:

*   `makeBoard("flowers","redblue",1)` deep-equals another call with the same
    arguments;
*   the colours from seeds 1 and 2 differ on `flowers`;
*   `pickBoardId(() => 0.99)` is `"bouquet"` and `pickBoardId(() => 0)` is
    `"classic"`;
*   the `mulberry32(1)` values match those above;
*   an unknown id throws.

### Task 2: `public/lib/bot.js`

**Dyadic numbers.** A dyadic number is `{n: BigInt, e: Number}` with value
`n/2^e` and `e >= 0`. It is normalized: `e === 0` or `n` is odd, and zero is
`{n: 0n, e: 0}`.

*   `dy(k)` accepts a Number or a BigInt.
*   `add`, `neg` and `cmp` (returning -1, 0 or 1) align exponents.
*   `floor(x)` returns a **BigInt**, `x.n >> BigInt(x.e)`, rounding toward
    minus infinity.
*   `half(x, k)` returns `{n: x.n, e: x.e + k}`, normalized.
*   `toString(x)` returns `"3/4"`, `"-1/2"` or `"2"`.

**`redBlueValue(board)`.** Throws `Green edge in Red-Blue value` if any edge
is green.

1.  Build an adjacency list that ignores loops.
2.  From each ground node, run an iterative DFS that records the parent edge.
3.  Process nodes in reverse DFS order. `val(v)` is the sum, over the child
    edges `c` of `v`, of `edgeValue(c.color, val(child))`. Add `dy(1)` for
    each red loop on `v` and `dy(-1)` for each blue loop.
4.  `edgeValue("red", x)`:
    *   `n = Math.max(1, Number(floor(add(dy(1), neg(x)))) + 1)`;
    *   return `half(add(x, dy(n)), n - 1)`.
5.  `edgeValue("blue", x)` is `neg(edgeValue("red", neg(x)))`.
6.  The board's value is the sum of `val(g)` over all ground nodes.

**`greenValue(board)`.** The same walk, using Numbers. `val(v)` is the XOR,
over child edges, of `(val(child) + 1)`, then XOR 1 for each loop. The board's
value is the XOR over ground nodes.

**`bestMoves(game, side)`.** For each id in `legalMoves(game, side)`, score
the position after it:

*   Let `g = structuredClone(game)` and `g.turn = side`, then `applyCut(g,
    side, id)`.
*   In Red-Blue, the score is `redBlueValue(g.board)`. The best moves have the
    maximum score when `side` is red, or the minimum when blue.
*   In Green, the score is `greenValue(g.board)`. The best moves score 0; if
    none do, every legal move is best.

Returns ids in board order.

**`chooseMove(game, side, difficulty, rand = Math.random)`.**

1.  If there are no legal moves, return `null`.
2.  Set `p` to 1, 0.65 or 0.2 for `hard`, `medium` or `easy`.
3.  Call `rand()` once, as `u`.
4.  Choose the list: `bestMoves` if `u < p`, otherwise `legalMoves`.
5.  Return `list[Math.floor(rand() * list.length)]`.

**Exports:** `redBlueValue`, `greenValue`, `bestMoves`, `chooseMove`, `dy`,
`add`, `neg`, `cmp`, `half`, `floor`, `toString`.

### Task 2 tests: `test/bot.test.js`

Stalks are written from the ground up: `RB` means red at the bottom.

*   **Stalk values.** R=1, B=-1, RR=2, RB=1/2, RBB=1/4, RRB=3/2, RBR=3/4 and
    BR=-1/2. A red loop on a ground node is 1. A red edge carrying one red and
    one blue twig is 1.
*   **Green values.** A stalk of k edges is k. Two 3-stalks give 0. A loop on a
    ground node is 1.
*   **Random position generator.** `randomPosition(seed, colors)` uses
    `mulberry32(seed)`.
    1.  Start with 1 ground node, or 2 when `r() < 0.5`, at `x = 0, 100, ...`.
    2.  Add `1 + floor(r()*7)` edges. Each is:
        *   a loop, when `r() < 0.25`, on a random existing node;
        *   otherwise, a new node joined to a random existing node.
    3.  Each edge's colour is `colors[floor(r()*colors.length)]`. Red-Blue
        uses `["red","blue"]`; Green uses `["green"]`.
*   **Brute-force Red-Blue value.** `bruteRB(board, memo)`:
    *   `L` is the values of `cutEdge(board, id)` over red edges, and `R` the
        same over blue edges.
    *   The value is `simplest(max L, min R)`, where an empty `L` gives minus
        infinity and an empty `R` gives plus infinity.
    *   `memo` is keyed by the sorted remaining edge ids, and a new memo is
        made for each position.

    `simplest(a, b)` finds the simplest number strictly between `a` and `b`:
    *   if `a < 0 < b`, it is 0;
    *   if `a >= 0`, it is `m = floor(a)+1` if `m < b`;
    *   if `b <= 0`, it is `m = ceil(b)-1` if `m > a`;
    *   otherwise, for `k = 1, 2, ...`, it is the first `m/2^k` with `m =
        floor(a*2^k)+1` and `m/2^k < b`.

    Both infinities give 0. Check: across 300 seeds, `bruteRB` (a Number)
    equals `Number(v.n) / 2 ** v.e` for `v = redBlueValue(board)`.
*   **Brute-force Green value.** `bruteG` is the mex of the options' values,
    with the same memo rule. Across 300 seeds, it equals `greenValue`.
*   **Hard keeps every win.** Over 100 seeds and each mode, take the position
    with `side` red, then again with `side` blue.
    *   In Red-Blue, red to move wins when brute value > 0, and blue to move
        wins when value < 0.
    *   In Green, the mover wins when the nim-value is not 0.

    When the mover wins, every id in `bestMoves` must leave a position where
    the mover still wins: Red-Blue value >= 0 for red, <= 0 for blue; Green
    nim-value 0.
*   **Difficulty.**
    *   Position: edge 0 is a red loop on the ground node, edge 1 is red from
        that ground node up to a second node, and edge 2 is blue on top of
        edge 1. Red is to move.
    *   Red's legal moves are `[0, 1]`. Cutting 0 leaves the stalk RB, worth
        1/2. Cutting 1 drops edge 2 and leaves the loop, worth 1. So
        `bestMoves` is `[1]`.
    *   `easy` with `rand` returning 0.99 then 0.0 picks from `legalMoves`
        and gives 0.
    *   `hard` with the same `rand` gives 1.
    *   `medium` with 0.5 then 0.0 gives 1.
*   **Speed.** `chooseMove` with `"hard"` on every board, in both modes,
    finishes in under 200 ms, using seed 0.

### Task 3: `server/rooms.js` (rewrite)

It requires `../public/lib/game.js` and `../public/lib/boards.js`.

**Options:** `{maxRooms: 500, waitingMs: 600000, graceMs: 60000, idleMs:
1800000, rng: crypto.randomInt}`. `rng(max)` returns an integer in
`[0, max)`. Room codes always use `crypto.randomInt` directly; `rng` is only
used by `start`, in this order: the board (when `random`), the red player
(when `random`), then the seed. Tests give `rng` a queue of values; an empty
queue returns 0.

**Room shape:**

```text
{ code, status, hostId, members, nextMemberNum: 1, settings, game, gameNumber: 0,
  waitingTimer, idleTimer, deleted }
```

`gameNumber` goes up by one at each Start and is part of the snapshot. The
client uses it to tell a new game from the old one.

**Members.** A member is `{id, name, token, conn, graceTimer}`. A conn's
`session` is `{room, memberId}`. `memberOf(conn)` returns the member when the
session is set, the room is not deleted, and `member.conn === conn`.
Otherwise it returns null.

**Error messages:**

| Code | Message |
| :--- | :------ |
| `bad_name` | "Enter a name." |
| `room_not_found` | "No game with that code." |
| `room_full` | "That room already has two players." |
| `not_joined` | "Join a room first." |
| `not_host` | "Only the host can do that." |
| `not_in_lobby` | "A game is in progress." |
| `not_ready` | "Waiting for a second player." |
| `illegal_move`, no game running | "The game is not in progress." |

**After a method succeeds.** If the room was not deleted, the method resets
`idleTimer` (to `idleMs`, then `deleteRoom(room, 4001)`) and broadcasts. A
rejected message changes nothing, the idle timer included. Every timer
callback returns at once if `room.deleted`.

**Methods:**

*   **`createRoom()`.** The v1 cap and code rules. The room starts as
    `status: "lobby"` with settings `{mode:"redblue", board:"random",
    redPlayer:"random"}`. It sets `waitingTimer` (`waitingMs`, then
    `deleteRoom`) and starts `idleTimer`.
*   **`cleanName(s)`** (exported):
    1.  strip the characters matched by the pattern `/[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g` (always written with `\u` escapes, never as raw characters);
    2.  `trim()`;
    3.  `Array.from(s).slice(0, 20).join("")`.
*   **`join(conn, code, name, token)`:**
    1.  If `conn.session` is set: `bad_message` "Already joined.".
    2.  `cleanName`; if the result is empty: `bad_name`.
    3.  Look up `code.toUpperCase()`. If missing: `room_not_found`.
    4.  If `token` matches a member, reclaim that member:
        *   if it has an old conn, clear `old.session` and call
            `old.close(4000,"replaced")`;
        *   clear `graceTimer`;
        *   set `member.conn = conn` and `member.name = cleaned`.
    5.  Otherwise, with 2 members: `room_full`. Otherwise push `{id: "m" +
        nextMemberNum++, name, token: crypto.randomBytes(16).toString("hex"),
        conn, graceTimer: null}`.
    6.  Clear `waitingTimer`. If `hostId` is null, set it to this member.
    7.  Set `conn.session`. Send `{type:"joined", code, memberId, token}`.
        Then do the after-success steps.
*   **`updateSettings(conn, patch)`.** Checks, in order: `not_joined`,
    `not_host`, `not_in_lobby`. Then it assigns the fields `patch` contains.
*   **`start(conn)`.** Checks, in order: `not_joined`, `not_host`,
    `not_in_lobby`, then `not_ready` (fewer than 2 members, or one has no
    conn).
    1.  `boardId` is `settings.board`, or `BOARDS[rng(BOARDS.length)].id`
        when `random`.
    2.  `redMember` is the host for `host`, the other member for `guest`, and
        for `random` the host when `rng(2) === 0`, otherwise the other member.
    3.  `seed = rng(2 ** 31)`.
    4.  `game = newGame(makeBoard(boardId, mode, seed), mode, {red: {id,
        name}, blue: {id, name}})`.
    5.  `gameNumber++`, and `status` becomes `"playing"`.
*   **`cut(conn, edgeId)`.** Checks `not_joined`. If `status !== "playing"`:
    `illegal_move` "The game is not in progress.". The side is the one in
    `game.sides` whose `id` is the member's. Then `applyCut`. On failure it
    sends the error. On success:
    *   if the game is finished, `status` becomes `"lobby"`;
    *   the after-success steps run, with a broadcast carrying `lastMove:
        {edgeId, fell}`.
*   **`leave(conn)`.** Checks `not_joined`. Clears `conn.session`, sends
    `{type:"left"}`, then calls `removeMember(room, memberId, "left")`.
    `removeMember` already broadcasts, so `leave` does not broadcast again; if
    the room still exists it only resets `idleTimer`.
*   **`disconnect(conn)`.** If `memberOf(conn)` is set: `member.conn =
    null`, start `graceTimer` (`graceMs`, then `removeMember(room, id,
    "timeout")`), and broadcast. The idle timer is not reset.
*   **`removeMember(room, id, reason)`:**
    1.  If `playing`, call `forfeit(game, the side of id, reason)` and set
        `status` to `"lobby"`.
    2.  Clear the member's `graceTimer` and remove them.
    3.  If they were host, the remaining member becomes host, or `hostId`
        becomes null if nobody remains.
    4.  If no members remain, `deleteRoom(room)`. Otherwise broadcast.
*   **`deleteRoom(room, code = 1000)`.** Return if already deleted. Then:
    *   set `deleted`;
    *   clear `waitingTimer`, `idleTimer` and every `graceTimer`;
    *   for each member with a conn, clear its `session` and call
        `close(code, "room closed")`;
    *   delete the room from the map.
*   **`shutdown()`** calls `deleteRoom` on every room with code 1000.
*   **`broadcast(room, lastMove)`** sends `{type:"room", room:
    snapshot(room)}`, adding `lastMove` only when it is given.
*   **`snapshot(room)`** returns `{code, status, hostId, gameNumber, members:
    [{id, name, connected: Boolean(conn)}], settings, game}`. It never
    includes tokens or conns.

### Task 3: `server.js`

*   Require `./public/lib/boards.js` for the board ids.
*   Update the header comment so it no longer names `server/game.js`.
*   Validate each message:
    *   `join` needs a string `code` and a string `name`. `token` may be
        absent, `null` or a string.
    *   `settings` fields are each optional, and an empty object is accepted.
        The server passes only the fields present among `mode`, `board` and
        `redPlayer` to `updateSettings`, never the raw message.
        `mode` must be one of `redblue`, `green`; `board` one of the board ids
        or `random`; `redPlayer` one of `host`, `guest`, `random`. Any other
        value is `bad_message`.
    *   `start` and `leave` ignore extra fields.
    *   `cut` is unchanged.
*   Unknown fields are ignored everywhere.
*   Dispatch to `join`, `updateSettings`, `start`, `cut` and `leave`.
*   Everything else is unchanged.

### Task 3 tests

**`test/rooms.test.js`** uses fake conns and `t.mock.timers.enable({apis:
["setTimeout"]})`. The registry is created with an `rng` that returns values
from a queue.

*   **Codes and capacity:** the code format; the cap throws `RoomCapError`;
    `waitingMs` with no join deletes the room.
*   **Joining:**
    *   lowercase codes work;
    *   names are cleaned: the JavaScript string `"\u202EAna\u0000 "` (with a leading space) becomes `"Ana"`, and 25
        characters are cut to 20;
    *   an empty name gives `bad_name`;
    *   an unknown code gives `room_not_found`;
    *   the first joiner is host;
    *   a third joiner gets `room_full`;
    *   joining twice on one conn gives `bad_message`;
    *   ids are `m1`, `m2`, `m3` and are never reused;
    *   a token for a member who has been removed joins as a new member;
    *   a rejoin with the token closes the old conn with 4000, clears its
        session, and updates the name;
    *   the snapshot has no `token` anywhere.
*   **`not_joined`:** `settings`, `start`, `cut` and `leave` before joining.
*   **Errors in order:**
    *   a guest's settings during play give `not_host`;
    *   the host's settings during play give `not_in_lobby`;
    *   a guest's `start` gives `not_host`;
    *   the host's `start` during play gives `not_in_lobby`;
    *   `start` with one member, or with two where one is disconnected, gives
        `not_ready`;
    *   a cut in the lobby before any game, and after a game, gives
        `illegal_move`.
*   **Start** (`rng` calls are made in the order board if `random`, red player
    if `random`, then seed):
    *   `redPlayer: host` makes the host red and `guest` makes the guest red
        (board set to `classic`);
    *   `redPlayer: random` with the queue `[0, 0]` (red player, seed) makes
        the host red, and with `[1, 0]` the guest;
    *   `board: random` with the queue `[2, 0]` (board, seed) gives `forest`
        (red player set to `host`);
    *   after a host hand-over, `host` means the new host.
*   **Game** (on `classic`):
    *   a Green game where both sides cut ends with status `lobby`, the game
        `finished`, and the right `winner` and `reason` `no_moves`;
    *   play again sets `gameNumber` to 2.
*   **Leaving:**
    *   leaving mid-game: the other side wins with `reason` `left`, the leaver
        receives `left`, and the remaining member is host;
    *   the host leaving in the lobby makes the guest host;
    *   the last member leaving deletes the room.
*   **Disconnects:**
    *   disconnect then rejoin within grace keeps the member;
    *   a disconnect mid-game, then `graceMs`, gives `reason` `timeout` and
        removes the member;
    *   a disconnect in the lobby, then `graceMs`, removes the member;
    *   a grace timer started mid-game still fires after the game ends with a
        normal win.
*   **Idle:**
    *   after `idleMs` the room is deleted and its conns closed with 4001;
    *   an accepted message resets the idle timer, and a rejected one does
        not.

**`test/server.test.js`** adapts the v1 cases:

*   `join` sends `name`, and `room` replaces `state`. The R0/B4/R9 game now
    runs after `settings` `{board:"classic", redPlayer:"host"}` and `start`.
*   **New:**
    *   a real-socket flow: two joins, settings, start, a game to the end,
        then the room is back in the lobby with `gameNumber` 1, start again,
        and leave;
    *   a missing `name` gives `bad_message`;
    *   `settings {mode:"purple"}` gives `bad_message`.
*   **Kept from v1:** the origin cases, the payload limit, 429, the heartbeat
    `ping`, HEAD, `GET /create-game` 405, `DELETE /` 405, paths outside
    `public/` giving 404, the `POST /create-game` code format, and the
    malformed-message cases (adapted to v2 messages).
*   **Static:** the static cases stay as in v1 in Task 3. In Task 4, the `GET
    /` check expects `id="menu"`, and a new check confirms `GET /lib/game.js`
    is served as JavaScript.

### Task 4: client

**`public/index.html`.** Scripts load in this order: `config.js`,
`lib/game.js`, `lib/boards.js`, `lib/bot.js`, `render.js`, `app.js`. There are
four screens, `#menu`, `#room`, `#game` and `#bot-setup`, and exactly one is
visible at a time.

| Screen | Elements |
| :----- | :------- |
| `#menu` | `#name-input` (maxlength 20), `#create`, `#code-input`, `#join`, `#play-bot`, `#menu-error` |
| `#room` | `#room-code`, `#copy-code`, `#copy-fallback` (a read-only input, hidden), `#members` (a list), selects `#setting-mode`, `#setting-board` and `#setting-red`, `#start`, `#leave-room`, `#last-result`, `#room-error` |
| `#game` | `#players`, `#status`, `.board-wrap` holding `#board` (an svg) and `#banner` (holding `#result`, `#play-again` and `#banner-menu`), then `#leave-game` |
| `#bot-setup` | `#bot-mode`, `#bot-board`, `#bot-difficulty`, `#bot-side`, `#bot-start`, `#bot-back` |

For the guest, the selects are `disabled`. They then read as plain text, which
satisfies the design's "read-only".

**Option values and captions.**

| Element | Options (value: caption) |
| :------ | :----------------------- |
| `#setting-mode`, `#bot-mode` | `redblue`: "Red-Blue", `green`: "Green" |
| `#setting-board`, `#bot-board` | built from `HackenbushBoards.BOARDS` (`id`: `name`), then `random`: "Random" |
| `#bot-difficulty` | `easy`: "Easy", `medium`: "Medium", `hard`: "Hard" |
| `#setting-red` | `host`, `guest`, `random` |
| `#bot-side` | `human-first-or-red`, `bot-first-or-blue`, `random` (captions below) |

Button captions: `#create` "Create Room", `#join` "Join", `#play-bot` "Play vs
Bot", `#start` "Start", `#leave-room` "Leave", `#copy-code` "Copy code",
`#bot-start` "Start", `#bot-back` "Back", `#play-again` "Play Again",
`#banner-menu` "Menu", `#leave-game` "Leave" (online) or "Menu" (bot).

**Labels:**

| Element | Red-Blue | Green |
| :------ | :------- | :---- |
| `#setting-red` | "Host plays Red", "Guest plays Red", "Random" | "Host goes first", "Guest goes first", "Random" |
| `#bot-side` | "I play Red", "I play Blue", "Random" | "I go first", "Bot goes first", "Random" |

The labels change when the mode select changes.

**`public/style.css`:**

*   `.green .stroke { stroke: #2e7d32 }`;
*   the v1 `#lobby-error` rule moves to `#menu-error` and `#room-error`;
*   `path.stroke, path.hit { fill: none }`;
*   layout for the room and setup screens;
*   `[hidden]` and `.fall` are kept.

**`public/render.js`:**

*   The header comment becomes "Draws a board; decides nothing about the
    rules."
*   At `draw`, `GROUND_Y = board.height + 20` and the viewBox is `0 0
    <width> <height + 60>`.
*   `svgY = GROUND_Y - y`. The ground line runs from 0 to `width`.
*   **Loops.** A loop is drawn as `path d="M x y C x1 y1 x2 y2 x y"`. Its two
    control points are 45 units from the node, at `angle - 40` and `angle +
    40` degrees, where 0 means up and angles run clockwise:
    *   `dx = 45*sin(θ)`, `dy = -45*cos(θ)`, in SVG coordinates;
    *   the `path.stroke` and `path.hit` sit in the edge's `<g>`.
*   `mine` is set when `color === role || color === "green"`. `role` is the
    viewer's side.
*   `Render.reset()` must be called before a new game is drawn.
*   `Render.init(svg, onEdgeClick)` is called once at page load.

**`public/app.js` (rewrite).**

*   **Shared state:** `{screen, mode: "online"|"bot", name, code, memberId,
    socket, joinedOnSocket, everJoined, inRoom, retryMs, retryTimer,
    flashTimer, bannerTimer, lastHeard, leaving, room, prevStatus, gameNumber,
    bot}`.
*   **`goToMenu(error)`** is the one way to the menu. It clears `retryTimer`,
    `flashTimer`, `bannerTimer` and `bot.timer`; closes the socket; calls
    `Render.reset()`; sets `inRoom` to false and `room`, `prevStatus`,
    `gameNumber` and `bot` to null; replaces the URL with the bare path; shows
    `#menu`; and shows `error` in `#menu-error` if given. Leave, `left`, close
    codes 4000 and 4001, `#leave-game` in bot mode and `#banner-menu` all call
    it. The `online` event handler reconnects only while `inRoom`.
*   **Name.** `#name-input` is filled from `localStorage["hackenbush:name"]`
    and saved on every input. Create, Join and Play vs Bot require a name.
    Without one, `#menu-error` reads "Enter your name first.".
*   **Online play.** The v1 core is kept, with these changes:
    *   open sends `{type:"join", code, name}`, plus `token` when one is
        stored;
    *   messages handled are `joined`, `room`, `left`, `error` and `ping`;
    *   on close:
        *   code 4000: go to the menu with "This game was opened in another
            tab.";
        *   code 4001: remove the token and go to the menu with "The room
            closed after 30 minutes without activity.";
        *   otherwise, while `inRoom` (set from `joined` until leaving),
            reconnect;
    *   the silence watchdog runs while `inRoom`;
    *   on `joined`: store the token and `memberId`, set `inRoom`, set
        `prevStatus` to null, and replace the URL with `?code=`;
    *   on `room`:
        *   store it;
        *   if `room.gameNumber` differs from the stored `gameNumber`, call
            `Render.reset()` and store the new number;
        *   if `status` is `playing`, show `#game`, cancel any banner, and call
            `Render.update(game, lastMove, mySide)`. `mySide` is the side whose
            `id` is `memberId`;
        *   if `status` is `lobby` with a finished game and `prevStatus` was
            `playing`, call `Render.update` with `lastMove`, then show the
            banner for 3 seconds (`bannerTimer`), then show `#room`;
        *   if a `lobby` snapshot arrives while the banner is up, store it and
            refresh the room screen's contents, but stay on `#game` until
            `bannerTimer` fires;
        *   otherwise, show `#room`;
        *   set `prevStatus` to `status`;
    *   on `left`: remove the token and call `goToMenu()`;
    *   on `error` before `joined`: v1 behaviour. On `room_full` with a stored
        token, remove the token. On `room_not_found` with a stored token,
        show `GONE_TEXT` ("This game no longer exists on the server. It may
        have ended, or the server may have restarted.") and remove the token;
    *   on `error` after `joined`: show it in `#room-error` (room screen) or
        flash it in `#status` (game screen) for 3 seconds.
*   **Leave** (`#leave-room` and `#leave-game`): send `leave` if the socket is
    open, remove the token, then call `goToMenu()` at once without waiting for
    `left`. In a bot game, `#leave-game` (captioned "Menu") only calls
    `goToMenu()`.
*   **On load.** If `?code=X` is present, fill `#code-input`. If a token and a
    name are both stored for `X`, join at once (this is the reload rejoin).
*   **Room screen.** Built from the snapshot:
    *   members, as "Name (host)", with " — disconnected" when not connected;
    *   the selects, set from `settings`, and `disabled` unless `memberId ===
        hostId`. A change sends `settings` with that one field;
    *   `#start`, shown only for the host, and enabled only with 2 connected
        members;
    *   `#last-result`, the result text of `game` when it is finished.
*   **Copy code.** Write `code` with `navigator.clipboard.writeText`. Then
    `#copy-code` reads "Copied" for 2 seconds. If the clipboard is missing or
    the write fails, show `#copy-fallback` holding the code, selected.
*   **Texts:**

    | When | Text |
    | :--- | :--- |
    | header, Red-Blue | "<red name> (Red) vs <blue name> (Blue)" |
    | header, Green | "<red name> vs <blue name>" |
    | status, your turn | "Your turn" |
    | status, opponent's turn | "<name>'s turn" |
    | status, opponent disconnected | "<name> disconnected. They have 60 seconds to return." |
    | result | "<winner name> won the game!" |
    | result, reason `left` | the result plus " (<loser name> left)" |
    | result, reason `timeout` | the result plus " (<loser name> lost connection)" |

    Names come from `game.sides`.
*   **Bot game.**
    *   **Start** (`#bot-start` and `#play-again`):
        1.  Resolve the board: `random` picks with `pickBoardId(Math.random)`.
        2.  Resolve the human's side: `Random` is `Math.random() < 0.5 ?
            "red" : "blue"`. In Green, "I go first" means red.
        3.  `seed = Math.floor(Math.random() * 2 ** 31)`.
        4.  `sides`: the human is `{id: "you", name}`, and the bot is `{id:
            "bot", name: "Bot (Easy|Medium|Hard)"}`.
        5.  Call `Render.reset()`, set `bot = {game: newGame(makeBoard(...),
            mode, sides), humanSide, difficulty, timer: null}`, and show
            `#game`.
        6.  If the bot is red, schedule its move.
    *   **Click handler:** in bot mode, when it is the human's turn, call
        `applyCut` locally, then `Render.update`. If the game is not over,
        schedule the bot.
    *   **Bot move:** `timer = setTimeout(botMove, 500 + Math.random() *
        400)`. `botMove` returns at once if `bot` has been replaced. It calls
        `chooseMove`, then `applyCut`, then `Render.update`.
    *   **Game end:** the banner shows the result with `#play-again` and
        `#banner-menu`, and stays until a button is pressed.
    *   **Menu:** `#leave-game` (captioned "Menu" in bot mode) and
        `#banner-menu` call `goToMenu()`.
    *   `#play-again` and `#banner-menu` are hidden in online games, where the
        banner shows only `#result` and closes by itself.
    *   For a finished bot game, `#status` reads "Game over.".
    *   Bot moves call `Render.update(bot.game, {edgeId, fell}, bot.humanSide)`.
*   **Click routing.** `Render.init(board, id => mode === "bot" ?
    humanCut(id) : send({type:"cut", edgeId: id}))`.

**Browser checks.** Each is a scratchpad script.

*   Two pages, online:
    *   names;
    *   create and join;
    *   settings sync, where the guest sees the host's change;
    *   a Green Flower Garden game played to the end through `bestMoves`
        clicks;
    *   both pages show the result, then return to the room;
    *   play again;
    *   leave mid-game, after which the other page shows "(<name> left)" and
        becomes host.
*   A bot game with `config.js` served by `page.route` pointing at port 1, so
    the server is unreachable. It is played to the end with no console errors.
*   Copy code with clipboard permission granted: the clipboard holds exactly
    the code.
*   A screenshot of each board, in both modes. Each screenshot is checked by
    looking at it.

### Task 5: ship

1.  Bring the README up to date. Set `design_v2.md` Status to "Implemented".
2.  Commit to `feature/hackenbush`. Render tracks this branch; it is not
    merged to `main`, and PR #1 stays open.
3.  Run the final whole-diff review and fix what it finds.
4.  `git push origin feature/hackenbush`.
5.  Wait until `https://hackenbush-server.onrender.com/` serves the v2 page:
    `/lib/game.js` returns 200.
6.  `npm run deploy:client`.
7.  Check the live site:
    *   `https://hackenbush-online.vercel.app/lib/bot.js` returns 200;
    *   the two-page online flow and a bot game both pass against the live
        URLs.
8.  `git tag -a v0.1.0-beta.3 <pushed HEAD>`, push the tag, and run `gh
    release create v0.1.0-beta.3 --prerelease --verify-tag`, with notes
    listing the six changes (names, rooms, Green Hackenbush, bigger boards,
    single player with the bot, copy code) and the live URL.

### Decisions made here

*   Flower petal angles skip the stem direction (180°), so hit areas do not
    overlap.
*   Petals are drawn with control points 45 units out at ±40°, so they read as
    petals, not stubs.
*   `gameNumber` is added to the room snapshot. It tells the client when a new
    game starts, so the board resets.
*   The guest sees `disabled` selects, which serve as the design's read-only
    text.
*   A bot game's result banner stays until a button is pressed. An online
    game's banner closes after 3 seconds.
