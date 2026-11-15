const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const SCRIPT = path.join(__dirname, "..", "scripts", "write-config.js");

function run(env) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hb-config-"));
  const out = path.join(dir, "config.js");
  execFileSync(process.execPath, [SCRIPT, out], { env: { ...process.env, ...env } });
  return fs.readFileSync(out, "utf8");
}

test("write-config writes SERVER_URL into config.js", () => {
  assert.equal(run({ SERVER_URL: "https://hb.onrender.com" }), 'window.SERVER_URL = "https://hb.onrender.com";\n');
});

test("write-config strips a trailing slash", () => {
  assert.equal(run({ SERVER_URL: "https://hb.onrender.com/" }), 'window.SERVER_URL = "https://hb.onrender.com";\n');
});

test("write-config refuses a non-https SERVER_URL", () => {
  assert.throws(() => run({ SERVER_URL: "http://hb.onrender.com" }));
});

test("write-config refuses to run without SERVER_URL", () => {
  assert.throws(() => run({ SERVER_URL: "" }));
});
