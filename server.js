// HTTP (static files, POST /create-game) and WebSocket wiring.
// All game and room rules live in public/lib/game.js and server/rooms.js.

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { WebSocketServer } = require("ws");
const { createRegistry, RoomCapError } = require("./server/rooms");

const { BOARDS } = require("./public/lib/boards.js");

const PUBLIC_DIR = path.join(__dirname, "public");
const HEARTBEAT_MS = 30000;
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
};

function createApp(options = {}) {
  const allowedOrigin = options.allowedOrigin ?? process.env.ALLOWED_ORIGIN ?? "";
  const registry = createRegistry(options.registry);
  const heartbeatMs = options.heartbeatMs ?? HEARTBEAT_MS;
  const wss = new WebSocketServer({ noServer: true, maxPayload: 1024 });

  function parsePath(req) {
    try {
      return new URL(req.url, "http://localhost").pathname;
    } catch {
      return null;
    }
  }

  function originAllowed(req) {
    const origin = req.headers.origin;
    if (origin === undefined) return true;
    try {
      if (allowedOrigin) return origin === allowedOrigin;
      return new URL(origin).host === req.headers.host;
    } catch {
      return false;
    }
  }

  function corsHeaders(req) {
    if (allowedOrigin && req.headers.origin === allowedOrigin) {
      return {
        "Access-Control-Allow-Origin": allowedOrigin,
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        Vary: "Origin",
      };
    }
    return {};
  }

  function sendJson(res, status, body, headers = {}) {
    res.writeHead(status, { "Content-Type": "application/json", ...headers });
    res.end(JSON.stringify(body));
  }

  function sendStatus(res, status) {
    res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
    res.end(http.STATUS_CODES[status]);
  }

  async function serveStatic(req, res, pathname) {
    let decoded;
    try {
      decoded = decodeURIComponent(pathname);
    } catch {
      return sendStatus(res, 400);
    }
    if (decoded === "/") decoded = "/index.html";
    const file = path.join(PUBLIC_DIR, decoded);
    const type = MIME[path.extname(file)];
    if (!file.startsWith(PUBLIC_DIR + path.sep) || !type) return sendStatus(res, 404);
    let body;
    try {
      const stat = await fs.promises.stat(file);
      if (!stat.isFile()) return sendStatus(res, 404);
      body = await fs.promises.readFile(file);
    } catch {
      return sendStatus(res, 404);
    }
    res.writeHead(200, { "Content-Type": type, "Cache-Control": "no-cache" });
    res.end(req.method === "HEAD" ? undefined : body);
  }

  const server = http.createServer((req, res) => {
    const pathname = parsePath(req);
    if (pathname === null) return sendStatus(res, 400);

    if (pathname === "/create-game") {
      if (req.method === "OPTIONS") {
        res.writeHead(204, corsHeaders(req));
        return res.end();
      }
      if (req.method !== "POST") return sendStatus(res, 405);
      if (!originAllowed(req)) return sendJson(res, 403, { error: "origin" });
      try {
        return sendJson(res, 200, { code: registry.createRoom() }, corsHeaders(req));
      } catch (err) {
        if (err instanceof RoomCapError) return sendJson(res, 429, { error: "server_full" }, corsHeaders(req));
        throw err;
      }
    }

    if (req.method === "GET" || req.method === "HEAD") {
      serveStatic(req, res, pathname).catch(() => sendStatus(res, 500));
      return;
    }
    sendStatus(res, 405);
  });

  server.on("upgrade", (req, socket, head) => {
    socket.on("error", () => {});
    if (parsePath(req) !== "/ws" || !originAllowed(req)) {
      socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
  });

  wss.on("connection", (ws) => {
    // A message over maxPayload emits "error" before closing; without a
    // listener that error would crash the process.
    ws.on("error", () => {});
    ws.isAlive = true;
    ws.on("pong", () => {
      ws.isAlive = true;
    });

    const conn = {
      session: null,
      send(obj) {
        if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj));
      },
      close(code, reason) {
        ws.close(code, reason);
      },
    };
    const bad = () => conn.send({ type: "error", code: "bad_message", message: "Malformed message." });

    ws.on("message", (data) => {
      let msg;
      try {
        msg = JSON.parse(data);
      } catch {
        return bad();
      }
      if (msg === null || typeof msg !== "object" || Array.isArray(msg)) return bad();
      if (msg.type === "join") {
        const token = msg.token ?? undefined;
        if (typeof msg.code !== "string" || typeof msg.name !== "string" || (token !== undefined && typeof token !== "string")) return bad();
        return registry.join(conn, msg.code, msg.name, token);
      }
      if (msg.type === "settings") {
        const patch = {};
        const choices = { mode: ["redblue", "green"], board: [...BOARDS.map(b => b.id), "random"], redPlayer: ["host", "guest", "random"] };
        for (const [key, values] of Object.entries(choices)) {
          if (Object.hasOwn(msg, key)) {
            if (!values.includes(msg[key])) return bad();
            patch[key] = msg[key];
          }
        }
        return registry.updateSettings(conn, patch);
      }
      if (msg.type === "start") return registry.start(conn);
      if (msg.type === "leave") return registry.leave(conn);
      if (msg.type === "cut") {
        if (!Number.isInteger(msg.edgeId)) return bad();
        return registry.cut(conn, msg.edgeId);
      }
      bad();
    });

    ws.on("close", () => registry.disconnect(conn));
  });

  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.isAlive) {
        ws.terminate();
        continue;
      }
      ws.isAlive = false;
      ws.ping();
      // Browsers hide protocol pings from page code; this message lets the
      // client notice a connection that has silently died.
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type: "ping" }));
    }
  }, heartbeatMs);

  function close() {
    clearInterval(heartbeat);
    registry.shutdown();
    for (const ws of wss.clients) ws.terminate();
    return new Promise((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections();
    });
  }

  return { server, wss, registry, close };
}

module.exports = { createApp };

if (require.main === module) {
  const app = createApp();
  const port = Number(process.env.PORT) || 3000;
  app.server.listen(port, () => console.log(`Hackenbush server on http://localhost:${port}`));
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, async () => {
      await app.close();
      process.exit(0);
    });
  }
}
