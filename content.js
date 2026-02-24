(() => {
  const LOG = (...a) => console.log("[MDReview]", ...a);
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  function isPRFilesChanged() {
    return /\/pull\/\d+\/files/.test(location.pathname);
  }

  // ---- DOM discovery tuned for GitHub's newer "Files changed" experience ----
  // GitHub uses a React/SPA layout; classnames change. Prefer stable attrs:
  // - data-testid
  // - aria-label
  // - role landmarks
  function findFileDiffContainers() {
    // Try multiple patterns; return unique elements.
    const sets = new Set();

    // Old-ish containers
    document.querySelectorAll('.file, .js-file').forEach(el => sets.add(el));

    // New experience tends to wrap each file in elements with data-testid or id starting with "diff-"
    document.querySelectorAll('[data-testid="file-diff"], [data-testid="diff-file"], [data-testid="pr-file-diff"]').forEach(el => sets.add(el));
    document.querySelectorAll('[id^="diff-"], [id^="file-diff-"]').forEach(el => {
      // avoid tiny anchors
      if (el.querySelector && (el.querySelector('table.diff-table') || el.querySelector('table'))) sets.add(el);
    });

    // Elements containing a header with a path link
    document.querySelectorAll('div').forEach(el => {
      if (el.querySelector && el.querySelector('a[data-hovercard-type="blob"], a[data-hovercard-type="pull_request_path"]')) {
        // ensure it also has a diff table or blob-code
        if (el.querySelector('td.blob-code, table.diff-table, [data-testid="diff-table"]')) sets.add(el);
      }
    });

    const arr = Array.from(sets);
    // Filter to things that look like a diff block
    return arr.filter(el =>
      el.querySelector?.('td.blob-code, table.diff-table, [data-testid="diff-table"], [data-testid="file-diff-table"]')
    );
  }

  function getFilePath(fileEl) {
    // Prefer explicit path attributes if present
    const explicit =
      fileEl.querySelector('[data-path]') ||
      fileEl.querySelector('a[data-hovercard-type="pull_request_path"]') ||
      fileEl.querySelector('a[data-hovercard-type="blob"]') ||
      fileEl.querySelector('a.Link--primary[title]') ||
      fileEl.querySelector('a.Link--primary');
    if (!explicit) return null;
    const dataPath = explicit.getAttribute?.('data-path');
    if (dataPath) return dataPath;
    const title = explicit.getAttribute?.('title');
    if (title && /\./.test(title)) return title;
    const txt = (explicit.textContent || "").trim();
    return txt || null;
  }

  function isMarkdownPath(path) {
    return !!path && /\.(md|mdx|markdown)$/i.test(path);
  }

  function nearestMarkdownFileEl() {
    const files = findFileDiffContainers();
    const md = files.filter(f => isMarkdownPath(getFilePath(f)));
    if (!md.length) return null;

    // Prefer element closest to the top of viewport (new UI often virtualizes, so this is safest).
    const scored = md.map(f => ({ f, top: f.getBoundingClientRect().top, h: f.getBoundingClientRect().height }))
      .sort((a,b) => Math.abs(a.top) - Math.abs(b.top));
    return scored[0].f;
  }

  function extractAddedLines(fileEl) {
    // Collect lines from diff table.
    // New UI sometimes uses td[data-line-number] for numbers.
    const codeCells = Array.from(fileEl.querySelectorAll('td.blob-code, [data-testid="diff-table"] td, [data-testid="file-diff-table"] td'));

    const rows = [];
    for (const td of codeCells) {
      if (!(td instanceof HTMLElement)) continue;

      // Find the closest row and line number cell. GitHub typically places data-line-number on td.blob-num.
      const tr = td.closest('tr');
      const num =
        tr?.querySelector('td.blob-num[data-line-number]') ||
        tr?.querySelector('[data-line-number]') ||
        td.closest('tr')?.querySelector('[data-line-number]');
      const lnRaw = num?.getAttribute?.('data-line-number');
      const lineNumber = lnRaw ? parseInt(lnRaw, 10) : null;

      // Detect addition. Old UI uses class blob-code-addition; new UI usually keeps it.
      const isAdd =
        td.classList.contains('blob-code-addition') ||
        td.classList.contains('diff-line-code--added') ||
        (td.getAttribute('data-testid') || "").includes('added');

      // Only keep actual code cells (avoid headers/metadata tds)
      const looksLikeCode = td.classList.contains('blob-code') || td.getAttribute('data-line-number') || td.closest('table');
      if (!looksLikeCode) continue;

      const text = (td.textContent || "").replace(/\u00a0/g, '');
      if (lineNumber !== null) rows.push({ lineNumber, isAdd, text: text.replace(/^\+/, '') });
    }

    // De-dupe by lineNumber, keeping the longest text (some cells repeated in selector sweep).
    const byLine = new Map();
    for (const r of rows) {
      const prev = byLine.get(r.lineNumber);
      if (!prev || (r.text.length > prev.text.length) || (r.isAdd && !prev.isAdd)) byLine.set(r.lineNumber, r);
    }
    const uniq = Array.from(byLine.values()).sort((a,b)=>a.lineNumber-b.lineNumber);

    const hasAdd = uniq.some(r => r.isAdd);
    return hasAdd ? uniq.filter(r => r.isAdd) : uniq;
  }

  function blockify(lines) {
    // Heuristic splitter:
    // - blank line splits
    // - fenced code blocks kept intact
    // - tables grouped
    // - headings start new blocks
    const blocks = [];
    let buf = [];
    let inFence = false;
    let fenceMarker = null;

    const flush = () => {
      if (!buf.length) return;
      blocks.push({
        startLine: buf[0].lineNumber,
        endLine: buf[buf.length - 1].lineNumber,
        text: buf.map(x => x.text).join("\n")
      });
      buf = [];
    };

    const fenceStart = (t) => {
      const m = t.match(/^(\s*)(```|~~~)/);
      return m ? m[2] : null;
    };
    const isTableSep = (t) => /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(t);

    for (let i = 0; i < lines.length; i++) {
      const { lineNumber, text } = lines[i];
      const t = text;

      const fence = fenceStart(t);
      if (!inFence && fence) {
        flush();
        inFence = true;
        fenceMarker = fence;
        buf.push({ lineNumber, text: t });
        continue;
      }
      if (inFence) {
        buf.push({ lineNumber, text: t });
        if (t.trim().startsWith(fenceMarker)) {
          flush();
          inFence = false;
          fenceMarker = null;
        }
        continue;
      }

      if (t.trim() === "") {
        flush();
        continue;
      }

      // Table grouping: header line with '|' followed by separator
      if (/\|/.test(t) && (i + 1 < lines.length) && isTableSep(lines[i + 1].text)) {
        flush();
        while (i < lines.length && lines[i].text.trim() !== "") {
          buf.push({ lineNumber: lines[i].lineNumber, text: lines[i].text });
          i++;
        }
        i--; // outer loop will i++
        flush();
        continue;
      }

      // Heading starts a new block (and captures adjacent lines until blank/next heading)
      if (/^\s{0,3}#{1,6}\s+/.test(t)) {
        flush();
        buf.push({ lineNumber, text: t });
        while (i + 1 < lines.length) {
          const nxt = lines[i + 1].text;
          if (nxt.trim() === "") break;
          if (/^\s{0,3}#{1,6}\s+/.test(nxt)) break;
          // stop before a table start
          if (/\|/.test(nxt) && (i + 2 < lines.length) && isTableSep(lines[i + 2].text)) break;
          i++;
          buf.push({ lineNumber: lines[i].lineNumber, text: lines[i].text });
        }
        flush();
        continue;
      }

      buf.push({ lineNumber, text: t });
    }
    flush();
    return blocks;
  }

  function renderMarkdown(text) {
    if (typeof window.markdownit === "function") {
      try {
        const md = window.markdownit({ html: false, linkify: true, breaks: false });
        return md.render(text);
      } catch {}
    }
    // minimal fallback
    const esc = (s) => s.replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;");
    return text.split("\n").map(l => {
      const hm = l.match(/^\s{0,3}(#{1,6})\s+(.*)$/);
      if (hm) return `<h${hm[1].length}>${esc(hm[2])}</h${hm[1].length}>`;
      const x = esc(l)
        .replace(/`([^`]+)`/g, "<code>$1</code>")
        .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
      return `<p>${x}</p>`;
    }).join("\n");
  }

  function ensureDrawer() {
    let d = document.getElementById("mdreview-drawer");
    if (d) return d;

    d = document.createElement("div");
    d.id = "mdreview-drawer";
    d.innerHTML = `
      <header>
        <div class="title">
          <div>MDReview</div>
          <small id="mdreview-subtitle">No file selected</small>
        </div>
        <div style="display:flex; gap:8px; align-items:center;">
          <button id="mdreview-refresh" class="mdreview-btn" title="Rebuild preview">Refresh</button>
          <button id="mdreview-close" class="mdreview-btn" title="Close">Close</button>
        </div>
      </header>
      <div class="body" id="mdreview-body"></div>
    `;
    document.body.appendChild(d);

    d.querySelector("#mdreview-close").addEventListener("click", () => d.remove());
    d.querySelector("#mdreview-refresh").addEventListener("click", () => buildPreview());

    return d;
  }

  function ensureFab() {
    let fab = document.getElementById("mdreview-fab");
    if (fab) return fab;
    fab = document.createElement("div");
    fab.id = "mdreview-fab";
    fab.innerHTML = `<button class="mdreview-btn" id="mdreview-back">← Back to preview</button>`;
    document.body.appendChild(fab);

    fab.querySelector("#mdreview-back").addEventListener("click", () => {
      const returnUrl = sessionStorage.getItem("mdreview:returnUrl");
      if (returnUrl) location.href = returnUrl;
    });
    return fab;
  }

  function showFab(show) {
    ensureFab().style.display = show ? "block" : "none";
  }

  function scrollToLine(lineNumber) {
    // Try to find by data-line-number (most stable)
    const numCell = document.querySelector(`td.blob-num[data-line-number="${lineNumber}"], [data-line-number="${lineNumber}"]`);
    if (numCell) {
      numCell.scrollIntoView({ behavior: "smooth", block: "center" });
      const tr = numCell.closest("tr");
      if (tr) {
        tr.classList.add("mdreview-highlight");
        setTimeout(() => tr.classList.remove("mdreview-highlight"), 1600);
      }
      return;
    }
    // Fallback to hash anchors
    location.hash = `L${lineNumber}`;
  }

  function tryOpenInlineComment(lineNumber) {
    // Best-effort; DOM varies.
    const numCell = document.querySelector(`td.blob-num[data-line-number="${lineNumber}"], [data-line-number="${lineNumber}"]`);
    const tr = numCell?.closest("tr");
    if (!tr) return;

    // Try known buttons.
    const btn =
      tr.querySelector('button[aria-label*="Add a review comment"]') ||
      tr.querySelector('button[aria-label*="Add a comment"]') ||
      tr.querySelector('button.js-add-line-comment') ||
      tr.querySelector('button[data-testid*="add-line-comment"]');
    if (btn) btn.click();
  }

  function setReturnHash(start, end) {
    // We control this hash so "Back to preview" can restore the block.
    const clean = location.href.split("#")[0];
    return `${clean}#mdreview-block-${start}-${end}`;
  }

  async function buildPreview() {
    const fileEl = nearestMarkdownFileEl();
    const drawer = ensureDrawer();
    const subtitle = drawer.querySelector("#mdreview-subtitle");
    const body = drawer.querySelector("#mdreview-body");

    if (!fileEl) {
      subtitle.textContent = "No Markdown file diff found (scroll to the file and try again)";
      body.innerHTML = "";
      return;
    }

    const path = getFilePath(fileEl);
    subtitle.textContent = path || "(unknown path)";

    const added = extractAddedLines(fileEl).filter(x => x.lineNumber != null);
    if (!added.length) {
      body.innerHTML = `<div class="pill">Couldn’t extract added lines. Expand the file and try again.</div>`;
      return;
    }

    const blocks = blockify(added);

    body.innerHTML = `
      <div class="pill">Blocks: ${blocks.length}. Click “Comment” to jump to the block’s first line in the diff.</div>
      ${blocks.map(b => {
        const html = renderMarkdown(b.text);
        const id = `mdreview-block-${b.startLine}-${b.endLine}`;
        return `
          <div class="block" id="${id}" data-start="${b.startLine}" data-end="${b.endLine}">
            <div class="actions">
              <button class="mdreview-btn mdreview-comment" data-start="${b.startLine}" data-end="${b.endLine}">Comment</button>
            </div>
            <div class="pill">Lines ${b.startLine}–${b.endLine}</div>
            <div class="markdown-body">${html}</div>
          </div>
        `;
      }).join("\n")}
    `;

    body.querySelectorAll(".mdreview-comment").forEach(btn => {
      btn.addEventListener("click", async () => {
        const start = parseInt(btn.getAttribute("data-start"), 10);
        const end = parseInt(btn.getAttribute("data-end"), 10);

        sessionStorage.setItem("mdreview:returnUrl", setReturnHash(start, end));

        // Close the drawer so the diff UI is reachable.
        drawer.remove();
        showFab(true);

        scrollToLine(start);
        await sleep(250);
        tryOpenInlineComment(start);
      });
    });

    // If arrived from "Back to preview", scroll to the block.
    if ((location.hash || "").startsWith("#mdreview-block-")) {
      const el = document.querySelector(location.hash);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
      showFab(false);
    }
  }

  function injectOpenButton() {
    if (document.getElementById("mdreview-open")) return;

    const btn = document.createElement("button");
    btn.id = "mdreview-open";
    btn.className = "mdreview-btn";
    btn.textContent = "MDReview";
    btn.title = "Preview-first Markdown review (POC)";
    btn.style.position = "fixed";
    btn.style.top = "12px";
    btn.style.right = "12px";
    btn.style.zIndex = "999999";

    btn.addEventListener("click", () => buildPreview());
    document.body.appendChild(btn);
  }

  function removeOpenButton() {
    document.getElementById("mdreview-open")?.remove();
  }

  function syncUiForRoute() {
    if (isPRFilesChanged()) {
      injectOpenButton();
      ensureFab();
      return;
    }

    removeOpenButton();
    document.getElementById("mdreview-drawer")?.remove();
  }

  async function boot() {
    syncUiForRoute();

    // SPA navigation watcher
    let last = location.href;
    const obs = new MutationObserver(() => {
      if (location.href !== last) {
        last = location.href;
        syncUiForRoute();
      }
    });
    obs.observe(document.documentElement, { childList: true, subtree: true });

    // Restore block scroll if hash indicates.
    if (isPRFilesChanged() && (location.hash || "").startsWith("#mdreview-block-")) {
      await sleep(250);
      buildPreview();
    }
  }

  boot().catch(e => console.error("[MDReview] boot error", e));
})();
