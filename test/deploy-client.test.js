const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const ROOT = path.join(__dirname, "..");
const SCRIPT = path.join(ROOT, "scripts", "deploy-client.js");

function dryRun(env = {}) {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "hb-deploy-"));
  const log = execFileSync(process.execPath, [SCRIPT, "--dry-run", "--out", out], {
    env: { ...process.env, ...env },
    encoding: "utf8",
  });
  return { out, log };
}

test("dry run copies every client file and writes config.js with the server URL", () => {
  const { out } = dryRun({ SERVER_URL: "https://example.onrender.com" });
  const want = fs.readdirSync(path.join(ROOT, "public")).sort();
  assert.deepEqual(fs.readdirSync(out).sort(), want);
  assert.equal(fs.readFileSync(path.join(out, "config.js"), "utf8"), 'window.SERVER_URL = "https://example.onrender.com";\n');
});

test("dry run defaults to the beta Render server", () => {
  const { out } = dryRun({ SERVER_URL: "" });
  assert.match(fs.readFileSync(path.join(out, "config.js"), "utf8"), /hackenbush-server\.onrender\.com/);
});

test("dry run leaves the repository's public/config.js untouched", () => {
  const before = fs.readFileSync(path.join(ROOT, "public", "config.js"), "utf8");
  dryRun({ SERVER_URL: "https://example.onrender.com" });
  assert.equal(fs.readFileSync(path.join(ROOT, "public", "config.js"), "utf8"), before);
});

test("dry run does not call Vercel", () => {
  const { log } = dryRun();
  assert.match(log, /dry run/i);
  assert.doesNotMatch(log, /vercel deploy/);
});
