# Hackenbush Online

Play Red-Blue or Green Hackenbush with a friend or an offline bot.
Try the [live beta](https://hackenbush-online.vercel.app).

Enter your name, create a room and share its five-character code. The host
chooses the mode, board and starting side, then presses **Start**. Both players
return to the room after the result and can play again. **Copy code** copies
only the code. Names are saved on your device.

**Play vs Bot** runs entirely in your browser, even when the game server is
unreachable. Choose Easy, Medium or Hard, your side and a board: Classic,
Flower Garden, Forest or Bouquet. Hard chooses using exact game values;
Medium and Easy mix those moves with random legal moves.

## How the game works

Players take turns cutting an edge. In Red-Blue, Red cuts red edges and Blue
cuts blue edges. In Green, either player can cut any edge. Anything no longer
connected to the ground falls, including flower petals. If you have no legal
move on your turn, you lose. Red moves first (the first player in Green).

## Requirements

Node.js 22 or later.

## Run locally

```sh
npm install
npm start
```

Open <http://localhost:3000> in two browser windows. Enter names, click
**Create Room** in one, then enter its code in the other and click **Join**.
The host chooses settings and starts the game. Each tab has its own membership.
Reloading or losing the connection keeps your place for 60 seconds. **Leave**
returns to the menu immediately; leaving during play awards the other player
the win. If the host leaves, the other member becomes host.

## Updating the live beta

- **Server:** push to `feature/hackenbush`, the branch Render tracks; Render redeploys it.
  This beta branch stays separate from `main`; PR #1 remains open.
- **Web page:** run `npm run deploy:client`. Needed only after changes in
  `public/`. It defaults to the beta server
  `https://hackenbush-server.onrender.com`.

## Tests

```sh
npm test
```

## Configuration

| Setting | Where | Meaning |
| :------ | :---- | :------ |
| `PORT` | server environment | Port to listen on. Default `3000`. |
| `ALLOWED_ORIGIN` | server environment | Origin of a client hosted elsewhere, for example `https://my-game.vercel.app`. Must match exactly, with no trailing slash. Unset means only pages served by this server may connect. |
| `window.SERVER_URL` | `public/config.js` | Address of the game server when the client is hosted elsewhere, for example `https://my-game.onrender.com`. Empty means the server that served the page. |

## Deploying

The server must run as a long-lived process with a public URL, because the
WebSocket connections and the in-memory rooms live in that process. Hosts such
as Render, Fly.io and Railway work. Vercel serverless functions cannot hold a
WebSocket server, so the server cannot run on Vercel.

Two ways to deploy:

1. **Single host.** Deploy the whole repository to the long-lived host with
   `npm start` as the start command. The server serves the page and the game.
   Nothing to configure.
2. **Client on Vercel, server on Render.**
   1. In Render, create a **Blueprint** from this repository (`render.yaml`).
      It creates the `hackenbush-server` web service. Note its URL, for
      example `https://hackenbush-server.onrender.com`.
   2. Deploy the web page to Vercel (log in once with `npx vercel login`):

      ```sh
      SERVER_URL=https://hackenbush-server.onrender.com npm run deploy:client
      ```

      This copies `public/` to a temporary folder, writes the server URL into
      the copy's `config.js`, and deploys the copy to the Vercel project
      `hackenbush-online` (change it with `VERCEL_PROJECT`). The repository's
      own `public/config.js` stays empty, so local runs are unaffected. Add
      `-- --dry-run` to build the copy without deploying. (The copy is
      deployed rather than the repository root because Vercel reads
      `render.yaml` as a Node service and refuses a static build next to it.)
   3. Back in Render, set `ALLOWED_ORIGIN` to the Vercel site's origin, for
      example `https://hackenbush-online.vercel.app`, and let it redeploy.

Use `https` URLs in both places; the client then connects with encrypted
`wss://` WebSockets. Only the one origin in `ALLOWED_ORIGIN` may create or join
rooms, so Vercel preview URLs are refused, and a misconfigured origin shows up
in the menu as "Cannot reach the server."

Limits and behavior to know:

- At most 500 rooms exist at once. Past that, Create Game reports that the
  server is full.
- Empty rooms expire after 10 minutes; joined rooms close after 30 minutes
  without activity. Disconnected members are removed after 60 seconds, in the
  lobby as well as during play. Rooms remain available for rematches.
- All games live in memory. A restart, a redeploy, or a free-tier host going to
  sleep ends every game in progress; players see that the game no longer exists.
- Players need the code to join a game, but there are no accounts and no rate
  limiting. Anyone with a code can take a free seat.
