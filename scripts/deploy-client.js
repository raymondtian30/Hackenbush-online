// Redeploys the web page to Vercel: copies public/ to a temporary folder,
// writes the game server's URL into the copy's config.js, and deploys the
// copy to production. The repository's own public/config.js is not changed.
//
// Usage: npm run deploy:client [-- --dry-run] [-- --out <dir>]
// Environment:
//   SERVER_URL      game server origin (default: the beta Render server)
//   VERCEL_PROJECT  Vercel project name (default: hackenbush-online)

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const DEFAULT_SERVER_URL = "https://hackenbush-server.onrender.com";
const DEFAULT_PROJECT = "hackenbush-online";

const ROOT = path.join(__dirname, "..");
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const outIndex = args.indexOf("--out");
const out = outIndex >= 0 ? path.resolve(args[outIndex + 1]) : fs.mkdtempSync(path.join(os.tmpdir(), "hackenbush-client-"));
const serverUrl = process.env.SERVER_URL || DEFAULT_SERVER_URL;
const project = process.env.VERCEL_PROJECT || DEFAULT_PROJECT;

fs.cpSync(path.join(ROOT, "public"), out, { recursive: true });
execFileSync(process.execPath, [path.join(__dirname, "write-config.js"), path.join(out, "config.js")], {
  env: { ...process.env, SERVER_URL: serverUrl },
  stdio: "inherit",
});

if (dryRun) {
  console.log(`Dry run: client built in ${out}; not deployed.`);
  process.exit(0);
}

const npx = process.platform === "win32" ? "npx.cmd" : "npx";
const run = (cmdArgs) => execFileSync(npx, cmdArgs, { cwd: out, stdio: "inherit" });

console.log(`Deploying ${out} to Vercel project "${project}"...`);
run(["--yes", "vercel@latest", "link", "--yes", "--project", project]);
run(["--yes", "vercel@latest", "deploy", "--prod", "--yes"]);
fs.rmSync(out, { recursive: true, force: true });
console.log("Done.");
