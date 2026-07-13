const fs = require("fs");
const path = require("path");

const CONTENT_DIR = path.resolve(__dirname, "../../content");

function titleFromSlug(slug) {
  return slug
    .replace(/-/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function readH1(indexPath) {
  try {
    const text = fs.readFileSync(indexPath, "utf8");
    const m = text.match(/^#\s+(.+?)\s*$/m);
    if (m) return m[1].trim();
  } catch (e) {}
  return null;
}

function walk(dir, urlBase = "/") {
  if (!fs.existsSync(dir)) return [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const nodes = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const slug = entry.name;
    const childDir = path.join(dir, slug);
    const indexFile = path.join(childDir, "index.md");
    if (!fs.existsSync(indexFile)) continue;
    const url = `${urlBase}${slug}/`;
    nodes.push({
      slug,
      url,
      title: readH1(indexFile) || titleFromSlug(slug),
      children: walk(childDir, url),
    });
  }
  return nodes;
}

module.exports = function () {
  return walk(CONTENT_DIR, "/");
};
