module.exports = {
  layout: "layouts/content.njk",
  pageType: "content",
  tags: ["content"],
  eleventyComputed: {
    // Strip the leading /content/ from default URL so links inside markdown
    // (which use the public path) resolve correctly.
    permalink: (data) => {
      // For index.md files, filePathStem ends with "/index"
      const stem = data.page.filePathStem.replace(/^\/content/, "");
      // index.md → /<path>/
      if (stem.endsWith("/index")) return stem.replace(/\/index$/, "/");
      return stem + "/";
    },
    title: (data) => {
      const raw = data.page.rawInput || "";
      const m = raw.match(/^#\s+(.+?)\s*$/m);
      return m ? m[1].trim() : data.title;
    },
    pageTitle: (data) => {
      const raw = data.page.rawInput || "";
      const m = raw.match(/^#\s+(.+?)\s*$/m);
      const h1 = m ? m[1].trim() : data.pageTitle;
      if (!h1) return h1;
      // _fullTitle = pageTitle + " · " + site.name  ("Incident GIS" = 13 + " · " = 3 → 16 chars)
      // Max total <title> length = 65 chars (as measured in raw HTML with entities).
      // Nunjucks HTML-escapes & → &amp; (+4 chars each) and other special chars.
      // Count entity-expanded length to stay safely under 65.
      const SUFFIX = " · Incident GIS"; // · Incident GIS = 15 chars (no entities)
      const SUFFIX_LEN = 15;
      const MAX_TOTAL = 65;
      // Compute how many raw HTML chars the h1 would produce after escaping
      const entityLen = h1.length + (h1.match(/&/g) || []).length * 4
                                  + (h1.match(/</g) || []).length * 3
                                  + (h1.match(/>/g) || []).length * 3
                                  + (h1.match(/"/g) || []).length * 5;
      const totalLen = entityLen + SUFFIX_LEN;
      if (totalLen <= MAX_TOTAL) return h1;
      // Need to shorten: budget = MAX_TOTAL - SUFFIX_LEN - 1 (for ellipsis char, counts as 1)
      const budget = MAX_TOTAL - SUFFIX_LEN - 1;
      // Shorten character by character accounting for entity expansion
      let out = "";
      let outLen = 0;
      for (const ch of h1) {
        const chLen = ch === "&" ? 5 : (ch === "<" || ch === ">") ? 4 : ch === '"' ? 6 : 1;
        if (outLen + chLen > budget) break;
        out += ch;
        outLen += chLen;
      }
      return out.trimEnd() + "…";
    },
    pageDescription: (data) => {
      const raw = data.page.rawInput || "";
      // First non-heading paragraph that is long enough (≥50 chars after cleanup), capped at 155 chars
      const lines = raw.split(/\n+/);
      for (const line of lines) {
        const t = line.trim();
        if (!t || t.startsWith("#") || t.startsWith("```") || t.startsWith("|")) continue;
        // Strip markdown links, bold/italic/code markers
        const plain = t
          .replace(/\*\*([^*]+)\*\*/g, "$1")
          .replace(/\*([^*]+)\*/g, "$1")
          .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
          .replace(/[`_]/g, "")
          .trim();
        // Skip short standalone decorative lines (bold section headings, etc.)
        if (plain.length < 50) continue;
        return plain.length > 155 ? plain.slice(0, 152).trimEnd() + "…" : plain;
      }
      return data.pageDescription;
    },
  },
};
