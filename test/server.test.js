const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const { once } = require("node:events");
const WebSocket = require("ws");
const { createApp } = require("../server.js");

async function startApp(t, options = {}) {
  const app = createApp({ allowedOrigin: "", ...options });
  app.server.listen(0, "127.0.0.1");
  await once(app.server, "listening");
  t.after(() => app.close());
  return { app, port: app.server.address().port };
}

// Raw HTTP request; does not normalize the path.
function request(port, { method = "GET", path = "/", headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, method, path, headers }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on("error", reject);
    req.end();
  });
}

async function createGame(port, headers = {}) {
  const res = await request(port, { method: "POST", path: "/create-game", headers });
  return { ...res, json: res.body ? JSON.parse(res.body) : null };
}

// Opens a socket. Resolves {ws, msgs, next} or rejects with the HTTP status.
function openSocket(port, headers = {}) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers });
    const msgs = [];
    const waiters = [];
    ws.on("message", (data) => {
      const msg = JSON.parse(data);
      msgs.push(msg);
      for (const w of [...waiters]) {
        if (w.pred(msg)) {
          waiters.splice(waiters.indexOf(w), 1);
          w.resolve(msg);
        }
      }
    });
    const next = (pred) =>
      new Promise((res) => {
        const found = msgs.find(pred);
        if (found) return res(found);
        waiters.push({ pred, resolve: res });
      });
    ws.on("open", () => resolve({ ws, msgs, next }));
    ws.on("unexpected-response", (req, res) => reject(Object.assign(new Error("refused"), { status: res.statusCode })));
    ws.on("error", reject);
  });
}

const sameOrigin = (port) => ({ Origin: `http://127.0.0.1:${port}` });

test("POST /create-game returns a 5-character code", async (t) => {
  const { port } = await startApp(t);
  const res = await createGame(port);
  assert.equal(res.status, 200);
  assert.match(res.headers["content-type"], /application\/json/);
  assert.match(res.json.code, /^[A-HJ-NP-Z2-9]{5}$/);
});

test("two sockets play R0, B4, R9 and both see Red win", async (t) => {
  const { port } = await startApp(t);
  const { code } = (await createGame(port)).json;
  const red = await openSocket(port);
  red.ws.send(JSON.stringify({ type: "join", code }));
  assert.equal((await red.next((m) => m.type === "joined")).role, "red");
  const blue = await openSocket(port);
  blue.ws.send(JSON.stringify({ type: "join", code, token: null }));
  assert.equal((await blue.next((m) => m.type === "joined")).role, "blue");

  const moves = [[red, 0], [blue, 4], [red, 9]];
  for (const [p, edgeId] of moves) {
    p.ws.send(JSON.stringify({ type: "cut", edgeId }));
    await red.next((m) => m.type === "state" && m.lastMove?.edgeId === edgeId);
  }
  for (const p of [red, blue]) {
    const s = await p.next((m) => m.type === "state" && m.game.status === "finished");
    assert.equal(s.game.winner, "red");
  }
  red.ws.close();
  blue.ws.close();
});

test("a message over 1 KB closes the socket with 1009 and the server keeps serving", async (t) => {
  const { port } = await startApp(t);
  const { ws } = await openSocket(port);
  ws.send("x".repeat(1500));
  const [code] = await once(ws, "close");
  assert.equal(code, 1009);
  assert.equal((await createGame(port)).status, 200);
});

test("malformed messages get bad_message", async (t) => {
  const { port } = await startApp(t);
  const s = await openSocket(port);
  for (const raw of ["not json", "null", "[]", '{"type":"dance"}', '{"type":"join"}', '{"type":"cut","edgeId":"1"}', '{"type":"join","code":"ABCDE","token":5}']) {
    s.msgs.length = 0;
    s.ws.send(raw);
    const m = await s.next((x) => x.type === "error");
    assert.equal(m.code, "bad_message", raw);
  }
  s.ws.close();
});

test("POST /create-game returns 429 when the room cap is reached", async (t) => {
  const { port } = await startApp(t, { registry: { maxRooms: 0 } });
  const res = await createGame(port);
  assert.equal(res.status, 429);
  assert.deepEqual(res.json, { error: "server_full" });
});

test("GET /create-game returns 405", async (t) => {
  const { port } = await startApp(t);
  assert.equal((await request(port, { path: "/create-game" })).status, 405);
});

test("same origin: matching host is accepted, others are refused", async (t) => {
  const { port } = await startApp(t);
  assert.equal((await createGame(port, sameOrigin(port))).status, 200);
  const ok = await openSocket(port, sameOrigin(port));
  ok.ws.close();
  for (const Origin of ["http://evil.example", "null"]) {
    assert.equal((await createGame(port, { Origin })).status, 403, Origin);
    await assert.rejects(openSocket(port, { Origin }), { status: 403 });
  }
});

test("allowed origin: CORS headers and accepted upgrade; other origins refused", async (t) => {
  const origin = "https://a.example";
  const { port } = await startApp(t, { allowedOrigin: origin });
  const pre = await request(port, { method: "OPTIONS", path: "/create-game", headers: { Origin: origin } });
  assert.equal(pre.status, 204);
  assert.equal(pre.headers["access-control-allow-origin"], origin);
  assert.equal(pre.headers["access-control-allow-methods"], "POST, OPTIONS");
  assert.equal(pre.headers.vary, "Origin");
  const post = await createGame(port, { Origin: origin });
  assert.equal(post.status, 200);
  assert.equal(post.headers["access-control-allow-origin"], origin);
  const ok = await openSocket(port, { Origin: origin });
  ok.ws.close();
  const bad = "https://b.example";
  assert.equal((await createGame(port, { Origin: bad })).status, 403);
  await assert.rejects(openSocket(port, { Origin: bad }), { status: 403 });
});

test("GET / serves the lobby page, including with a query string", async (t) => {
  const { port } = await startApp(t);
  for (const path of ["/", "/?code=ABCDE"]) {
    const res = await request(port, { path });
    assert.equal(res.status, 200, path);
    assert.match(res.headers["content-type"], /^text\/html/);
    assert.match(res.body, /id="lobby"/);
  }
});

test("HEAD / returns 200 with no body", async (t) => {
  const { port } = await startApp(t);
  const res = await request(port, { method: "HEAD", path: "/" });
  assert.equal(res.status, 200);
  assert.equal(res.body, "");
});

test("client scripts are served as JavaScript", async (t) => {
  const { port } = await startApp(t);
  for (const path of ["/config.js", "/render.js", "/app.js"]) {
    const res = await request(port, { path });
    assert.equal(res.status, 200, path);
    assert.match(res.headers["content-type"], /^text\/javascript/);
  }
});

test("paths outside public/ return 404", async (t) => {
  const { port } = await startApp(t);
  for (const path of ["/..%2fpackage.json", "/%2e%2e%2fpackage.json", "/%00", "/server.js", "/nope.html"]) {
    assert.equal((await request(port, { path })).status, 404, path);
  }
});

test("DELETE / returns 405", async (t) => {
  const { port } = await startApp(t);
  assert.equal((await request(port, { method: "DELETE", path: "/" })).status, 405);
});
