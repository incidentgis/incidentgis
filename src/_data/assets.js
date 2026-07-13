// Content-hash first-party CSS/JS so the service worker + browsers bust stale
// caches on every deploy. Each key holds a 10-char sha1 of the source file
// (including any local @import partials), used as `?v=<hash>` in templates.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ASSET_DIR = path.join(__dirname, "..", "assets");

// Resolve local `@import "..."` / `@import url(...)` partials and fold their
// contents into the hash input so editing a partial rebusts the parent.
function readWithImports(file, seen) {
  seen = seen || new Set();
  const abs = path.resolve(file);
  if (seen.has(abs) || !fs.existsSync(abs)) return "";
  seen.add(abs);
  let src = fs.readFileSync(abs, "utf8");
  const importRe = /@import\s+(?:url\(\s*)?["']([^"')]+)["']/g;
  let m;
  while ((m = importRe.exec(src)) !== null) {
    const ref = m[1];
    if (/^https?:\/\//i.test(ref) || ref.startsWith("//")) continue; // remote
    const imp = path.resolve(path.dirname(abs), ref);
    src += readWithImports(imp, seen);
  }
  return src;
}

function hash(file) {
  return crypto
    .createHash("sha1")
    .update(readWithImports(file))
    .digest("hex")
    .slice(0, 10);
}

function collect(dir, exts, out, prefix) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collect(full, exts, out, prefix + entry.name + "/");
    } else if (exts.includes(path.extname(entry.name).toLowerCase())) {
      const base = entry.name.replace(/\.[^.]+$/, "");
      const key = (prefix + base).replace(/[^a-zA-Z0-9]+/g, "_");
      out[key] = hash(full);
    }
  }
}

const assets = {};
collect(path.join(ASSET_DIR, "css"), [".css"], assets, "");
collect(path.join(ASSET_DIR, "js"), [".js"], assets, "");

module.exports = assets;
