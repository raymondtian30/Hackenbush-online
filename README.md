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
a tab mid-game keeps your seat; closing it gives you 60 seconds to come back
before you forfeit.

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
2. **Client on Vercel, server elsewhere.** Deploy the repository to the
   long-lived host as above and set `ALLOWED_ORIGIN` to the Vercel site's
   `https://` origin. Set `window.SERVER_URL` in `public/config.js` to the
   server's `https://` URL, then deploy the `public/` folder to Vercel as a
   static site.

Use `https` URLs in both places; the client then connects with encrypted
`wss://` WebSockets.

Limits and behavior to know:

- At most 500 games exist at once. Past that, Create Game reports that the
  server is full.
- All games live in memory. A restart, a redeploy, or a free-tier host going to
  sleep ends every game in progress; players see that the game no longer exists.
- Players need the code to join a game, but there are no accounts and no rate
  limiting. Anyone with a code can take a free seat.
