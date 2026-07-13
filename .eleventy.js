const markdownIt = require("markdown-it");
const markdownItAnchor = require("markdown-it-anchor");
const markdownItAttrs = require("markdown-it-attrs");
const markdownItTaskLists = require("markdown-it-task-lists");
const syntaxHighlight = require("@11ty/eleventy-plugin-syntaxhighlight");
const eleventyNavigation = require("@11ty/eleventy-navigation");
const path = require("path");

module.exports = function (eleventyConfig) {
  eleventyConfig.addPlugin(syntaxHighlight);
  eleventyConfig.addPlugin(eleventyNavigation);

  // Passthrough static assets
  eleventyConfig.addPassthroughCopy({ "src/assets": "assets" });
  eleventyConfig.addPassthroughCopy({ "src/static": "/" });

  // Markdown
  const md = markdownIt({
    html: true,
    linkify: true,
    typographer: true,
    breaks: false,
  })
    .use(markdownItAttrs)
    .use(markdownItTaskLists, { enabled: true, label: false })
    .use(markdownItAnchor, {
      permalink: markdownItAnchor.permalink.headerLink({
        safariReaderFix: true,
      }),
      slugify: (s) =>
        String(s)
          .trim()
          .toLowerCase()
          .replace(/[^\w一-龥\s-]/g, "")
          .replace(/\s+/g, "-"),
    });

  // Wrap code fences with copy button + language label
  const defaultFence = md.renderer.rules.fence;
  md.renderer.rules.fence = function (tokens, idx, options, env, self) {
    const token = tokens[idx];
    const info = token.info ? md.utils.unescapeAll(token.info).trim() : "";
    const lang = info.split(/\s+/g)[0] || "text";

    // Mermaid handling: render as <pre class="mermaid"> for client-side rendering
    if (lang === "mermaid") {
      return `<div class="mermaid-wrapper"><pre class="mermaid">${md.utils.escapeHtml(
        token.content
      )}</pre></div>`;
    }

    const rendered = defaultFence(tokens, idx, options, env, self);
    // Add tabindex="0" to the pre so scrollable code blocks are keyboard-accessible (WCAG 2.1 SC 2.1.1)
    const renderedWithTabindex = rendered.replace(/<pre\b([^>]*)>/g, '<pre$1 tabindex="0">');
    return `<div class="codeblock" data-lang="${lang}">
  <div class="codeblock-header">
    <span class="codeblock-lang">${lang}</span>
    <button class="codeblock-copy" type="button" aria-label="Copy code to clipboard">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
      <span class="copy-label">Copy</span>
    </button>
  </div>
  ${renderedWithTabindex}
</div>`;
  };

  // Style tables responsively
  const defaultTableOpen = md.renderer.rules.table_open || function (tokens, idx, options, env, self) { return self.renderToken(tokens, idx, options); };
  md.renderer.rules.table_open = function (tokens, idx, options, env, self) {
    return `<div class="table-wrap">` + defaultTableOpen(tokens, idx, options, env, self);
  };
  const defaultTableClose = md.renderer.rules.table_close || function (tokens, idx, options, env, self) { return self.renderToken(tokens, idx, options); };
  md.renderer.rules.table_close = function (tokens, idx, options, env, self) {
    return defaultTableClose(tokens, idx, options, env, self) + `</div>`;
  };

  eleventyConfig.setLibrary("md", md);

  // Give markdown task-list checkboxes an accessible name (WCAG 4.1.2 / axe "label").
  // markdown-it-task-lists emits bare <input class="task-list-item-checkbox" ...> with no
  // label; add an aria-label so screen readers announce them and axe's label rule passes.
  eleventyConfig.addTransform("taskListCheckboxLabels", (content, outputPath) => {
    if (!outputPath || !outputPath.endsWith(".html")) return content;
    if (content.indexOf("task-list-item-checkbox") === -1) return content;
    return content.replace(
      /<input class="task-list-item-checkbox"(?![^>]*\baria-label=)/g,
      '<input class="task-list-item-checkbox" aria-label="Checklist item"'
    );
  });

  // Filters
  eleventyConfig.addFilter("readableDate", (dateObj) => {
    if (!dateObj) return "";
    return new Date(dateObj).toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  });

  const ACRONYMS = new Set([
    "gis", "etl", "iot", "api", "apis", "gps", "crs", "epsg", "ogc",
    "nims", "fema", "cap", "cad", "rms", "psap", "fastapi", "json",
    "geojson", "mqtt", "qos", "edxl", "niem", "pdf", "sql", "html",
    "css", "js", "qa", "ai", "ml", "cli", "csv", "xml", "url", "uri",
    "tcp", "ip", "tls", "ssl", "nga", "fips", "noaa", "usgs", "utm",
    "mgrs", "wkt", "wkb", "gpkg", "kml", "kmz", "lidar", "ugc",
    "cadrg", "wgs84", "rgb", "qgis", "ngfs", "psim", "scada", "vlan",
    "vpc", "vpn", "io", "lib", "lru", "lstm"
  ]);

  function smartTitleCase(slug) {
    return slug.split(/[-\s]+/).map((word) => {
      const lower = word.toLowerCase();
      if (ACRONYMS.has(lower)) return lower.toUpperCase();
      // mid-word digits like "wgs84" handled by ACRONYMS lookup
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    }).join(" ");
  }

  eleventyConfig.addFilter("breadcrumbs", (url, currentLabel) => {
    if (!url || url === "/") return [{ label: "Home", url: "/" }];
    const parts = url.replace(/^\/|\/$/g, "").split("/");
    const crumbs = [{ label: "Home", url: "/" }];
    let current = "";
    parts.forEach((p, i) => {
      current += "/" + p;
      const isLast = i === parts.length - 1;
      crumbs.push({
        label: isLast && currentLabel ? currentLabel : smartTitleCase(p),
        url: current + "/",
      });
    });
    return crumbs;
  });

  eleventyConfig.addFilter("titleFromSlug", (slug) => smartTitleCase(slug));

  return {
    dir: {
      input: "src",
      output: "_site",
      includes: "_includes",
      data: "_data",
    },
    markdownTemplateEngine: "njk",
    htmlTemplateEngine: "njk",
    dataTemplateEngine: "njk",
    templateFormats: ["md", "njk", "html", "11ty.js"],
  };
};
