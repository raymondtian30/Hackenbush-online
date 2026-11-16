// Writes public/config.js for a deployment whose client is hosted apart from
// the game server (for example on Vercel). Reads the server's https URL from
// the SERVER_URL environment variable. Usage: node scripts/write-config.js [outfile]
const fs = require("node:fs");
const path = require("node:path");

const url = (process.env.SERVER_URL || "").trim().replace(/\/+$/, "");
if (!/^https:\/\/[^/\s]+$/.test(url)) {
  console.error('SERVER_URL must be the game server\'s https origin, e.g. "https://my-game.onrender.com".');
  process.exit(1);
}

const out = process.argv[2] || path.join(__dirname, "..", "public", "config.js");
fs.writeFileSync(out, `window.SERVER_URL = ${JSON.stringify(url)};\n`);
console.log(`Wrote ${out} with SERVER_URL ${url}`);
