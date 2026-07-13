/* Mobile nav toggle */
(() => {
  const btn = document.querySelector(".nav-toggle");
  const nav = document.getElementById("primary-nav");
  if (!btn || !nav) return;
  btn.addEventListener("click", () => {
    const open = nav.classList.toggle("is-open");
    btn.setAttribute("aria-expanded", open ? "true" : "false");
  });
  // Close on link click (mobile)
  nav.addEventListener("click", (e) => {
    if (e.target.closest("a") && nav.classList.contains("is-open")) {
      nav.classList.remove("is-open");
      btn.setAttribute("aria-expanded", "false");
    }
  });
})();

/* Copy code button */
(() => {
  document.querySelectorAll(".codeblock").forEach((block) => {
    const btn = block.querySelector(".codeblock-copy");
    const pre = block.querySelector("pre");
    if (!btn || !pre) return;
    btn.addEventListener("click", async () => {
      const code = pre.innerText.replace(/\n$/, "");
      try {
        await navigator.clipboard.writeText(code);
      } catch (e) {
        const r = document.createRange();
        r.selectNodeContents(pre);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(r);
        try { document.execCommand("copy"); } catch (_) {}
        sel.removeAllRanges();
      }
      const label = btn.querySelector(".copy-label");
      const original = label ? label.textContent : "";
      btn.classList.add("is-copied");
      if (label) label.textContent = "Copied";
      setTimeout(() => {
        btn.classList.remove("is-copied");
        if (label) label.textContent = original || "Copy";
      }, 1500);
    });
  });
})();

/* FAQ accordions — rewrite plain <h2>FAQ</h2> + <p><strong>Q?</strong> answer</p>
   markup into <details>/<summary> disclosure widgets at runtime. */
(() => {
  function initFAQAccordions() {
    const headings = document.querySelectorAll("h2, h3");
    const faqRe = /frequently asked questions?|^faqs?$|^common questions$|^q ?& ?a$/i;
    const headText = (h) => {
      // Use the full heading text (the permalink anchor often WRAPS the heading text,
      // so excluding .header-anchor would drop the title entirely). Strip only the
      // leading/trailing permalink glyph (# / ¶) and trailing punctuation.
      return h.textContent
        .replace(/\s+/g, " ")
        .trim()
        .replace(/^[\s#¶]+/, "")
        .replace(/[\s#¶?:.]+$/, "");
    };

    headings.forEach((h) => {
      if (!faqRe.test(headText(h))) return;
      const stop = h.tagName;

      const list = document.createElement("div");
      list.className = "faq-list";
      const toRemove = [];
      let el = h.nextElementSibling;
      let made = 0;

      while (el && el.tagName !== "H2" && el.tagName !== stop && el.tagName !== "HR") {
        const next = el.nextElementSibling;
        // A FAQ item is a <p> that LEADS with a <strong> question ending in "?".
        if (
          el.tagName === "P" &&
          el.firstChild &&
          el.firstChild.nodeType === 1 &&
          el.firstChild.tagName === "STRONG" &&
          el.firstChild.textContent.replace(/\s+/g, " ").trim().replace(/[\s#¶]+$/, "").endsWith("?")
        ) {
          const strong = el.firstChild;

          const details = document.createElement("details");
          details.className = "faq-accordion";

          const summary = document.createElement("summary");
          // Wrap the whole question in ONE <span> so an inline <code>/<em> inside it
          // stays a single flex item (summary is display:flex; space-between).
          const qSpan = document.createElement("span");
          qSpan.className = "faq-accordion__q";
          while (strong.firstChild) qSpan.appendChild(strong.firstChild);
          summary.appendChild(qSpan);

          const body = document.createElement("div");
          body.className = "faq-accordion__body";
          const answer = document.createElement("p");
          // Everything after the <strong> question is the answer. MOVE (not clone)
          // the nodes; drop a leading whitespace-only text node so it starts cleanly.
          strong.remove();
          while (el.firstChild) {
            const child = el.firstChild;
            if (
              answer.childNodes.length === 0 &&
              child.nodeType === 3 &&
              !child.textContent.trim()
            ) {
              child.remove();
              continue;
            }
            answer.appendChild(child);
          }
          body.appendChild(answer);

          details.appendChild(summary);
          details.appendChild(body);
          list.appendChild(details);
          toRemove.push(el);
          made++;
        }
        el = next;
      }

      if (made > 0) {
        h.parentNode.insertBefore(list, toRemove[0]);
        toRemove.forEach((p) => p.remove());
      }
    });
  }
  initFAQAccordions();
})();

/* Task list interactivity (enable checkboxes that markdown-it renders as disabled) */
(() => {
  document.querySelectorAll("li.task-list-item input[type='checkbox']").forEach((cb) => {
    cb.disabled = false;
    if (cb.checked) cb.closest("li").classList.add("is-checked");
    cb.addEventListener("change", () => {
      cb.closest("li").classList.toggle("is-checked", cb.checked);
    });
  });
})();
