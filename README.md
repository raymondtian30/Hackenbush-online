# Hackenbush Online

Two-player Red-Blue Hackenbush in the browser. One player creates a game and
shares a 5-character code (or a join link); the other joins with it. A Node.js
server holds the game state, checks every move, and sends the board to both
players over WebSockets.

## How the game works

The board is a set of red and blue edges standing on the ground. Players take
turns: Red cuts one red edge, Blue cuts one blue edge. Anything no longer
connected to the ground by some path of edges falls off. If it is your turn and
you have no edge of your color left, you lose.

## Requirements

Node.js 22 or later.

## Run locally

```sh
npm install
npm start
```

Open <http://localhost:3000> in two browser windows. Click **Create Game** in
one, then enter the code (or open the join link) in the other. Each tab holds
its own seat, so two windows of the same browser can play each other. Reloading
the tab or losing the connection keeps your seat for 60 seconds; closing the
tab gives it up.

## Updating the live beta

- **Server:** push to the branch Render tracks; Render redeploys it.
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
games, so Vercel preview URLs are refused, and a misconfigured origin shows up
in the lobby as "Cannot reach the server."

Limits and behavior to know:

- At most 500 games exist at once. Past that, Create Game reports that the
  server is full.
- All games live in memory. A restart, a redeploy, or a free-tier host going to
  sleep ends every game in progress; players see that the game no longer exists.
- Players need the code to join a game, but there are no accounts and no rate
  limiting. Anyone with a code can take a free seat.
