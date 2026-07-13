/* markdown-render.js — configured markdown-it for the notes module (D2 2d slice 4).
   Vendored markdown-it (+ markdown-it-mark for ==highlight==). Adds: line-mapped,
   clickable task-list checkboxes (toggle rewrites the source line) and a tdx-query
   fence hook (rendered as a live list in sub-step 4b). html:false keeps user markdown
   safe; our injected checkbox HTML is emitted via html_inline tokens, which render raw
   regardless of that option. Exposes window.MdRender. */

(function () {
  if (!window.markdownit) { window.MdRender = { html: (s) => s || '', toggleCheckbox: (b) => b, blocks: (b) => [{ start: 0, end: Math.max(1, (b || '').split('\n').length) }] }; return; }

  const md = window.markdownit({ html: false, linkify: true, breaks: false, typographer: false });
  if (window.markdownitMark) md.use(window.markdownitMark);

  // A readable id ([[t_0001]], or a cross-user [[alice_t_0001]]) — mirrors the server's
  // READABLE_LINK in services/markdown.ts, which is what turns these into note_links edges.
  const READABLE = /^(?:.+_)?[ten]_\d+$/i;
  // Link targets are resolved through the store (titles stay live — a renamed task re-renders
  // with its new title, since the store caches are reactive). Renderer stays usable without a
  // store (tests, a bare page): no resolver → no title, and we still never print a raw id.
  const resolve = (type, id) => {
    try {
      return window.store && window.store.resolveLink ? window.store.resolveLink(type, id) : null;
    } catch (e) { return null; }
  };

  // ---- clickable task-list checkboxes, line-mapped for write-back ----
  md.core.ruler.after('inline', 'tdx-tasklists', (state) => {
    const t = state.tokens;
    for (let i = 0; i < t.length; i++) {
      if (t[i].type !== 'inline') continue;
      const para = t[i - 1];
      const li = t[i - 2];
      if (!para || para.type !== 'paragraph_open') continue;
      if (!li || li.type !== 'list_item_open') continue;
      const child = t[i].children && t[i].children[0];
      if (!child || child.type !== 'text') continue;
      const m = child.content.match(/^\[([ xX])\]\s+/);
      if (!m) continue;
      const checked = m[1].toLowerCase() === 'x';
      const line = li.map ? li.map[0] : -1; // source line of the "- [ ] …"
      child.content = child.content.slice(m[0].length);
      const cb = new state.Token('html_inline', '', 0);
      cb.content = `<input class="md-check" type="checkbox" data-line="${line}"${checked ? ' checked' : ''}>`;
      t[i].children.unshift(cb);
      li.attrJoin('class', 'md-task');
    }
  });

  // ---- tdx-query fences: a live list in 4b; for now a labelled block ----
  const defaultFence =
    md.renderer.rules.fence ||
    ((tokens, idx, opts, env, self) => self.renderToken(tokens, idx, opts));
  md.renderer.rules.fence = (tokens, idx, opts, env, self) => {
    const tok = tokens[idx];
    if ((tok.info || '').trim() === 'tdx-query') {
      const q = tok.content.trim();
      return `<div class="tdx-query" data-query="${md.utils.escapeHtml(q)}"><span class="tdx-query-q mut">tdx-query: ${md.utils.escapeHtml(q)}</span></div>`;
    }
    return defaultFence(tokens, idx, opts, env, self);
  };

  // ---- [[wikilinks]] → clickable spans (typed by id, or note by name) ----
  md.inline.ruler.before('link', 'wikilink', (state, silent) => {
    const src = state.src;
    const start = state.pos;
    if (src.charCodeAt(start) !== 0x5b || src.charCodeAt(start + 1) !== 0x5b) return false; // '[['
    const end = src.indexOf(']]', start + 2);
    if (end < 0) return false;
    const inner = src.slice(start + 2, end);
    if (inner.indexOf('\n') >= 0 || inner.indexOf('[') >= 0) return false;
    if (!silent) {
      const esc = md.utils.escapeHtml;
      const typed = inner.match(/^(task|event):([\w-]+)(?:\|([^\]]*))?$/);
      const tok = state.push('html_inline', '', 0);
      if (typed) {
        // legacy typed link. Show the target's TITLE — never the raw uuid (§5: no UUID
        // reaches the UI). Unresolvable (deleted, or the cache hasn't landed) → the type word.
        const hit = resolve(typed[1], typed[2]);
        const display = (typed[3] || '').trim() || (hit && hit.title) || typed[1];
        tok.content = `<span class="wikilink" data-type="${typed[1]}" data-id="${esc(typed[2])}">${esc(display)}</span>`;
      } else {
        const parts = inner.split('|');
        const name = parts[0].trim();
        const alias = (parts[1] || '').trim();
        // readable-id link ([[t_0001]], the form the `[[` picker writes) — resolve it to the
        // live title so the body never goes stale, and hand the click handler the uuid.
        // Mirrors the server's READABLE_LINK (services/markdown.ts); the optional `alice_`
        // prefix is a cross-user ref the client can't resolve → falls through as plain text.
        const hit = READABLE.test(name) ? resolve(null, name) : null;
        if (hit) {
          const display = alias || hit.title || name;
          tok.content = `<span class="wikilink" data-type="${hit.type}" data-id="${esc(hit.id)}">${esc(display)}</span>`;
        } else if (READABLE.test(name)) {
          tok.content = `<span class="wikilink dangling" data-rid="${esc(name)}">${esc(alias || name)}</span>`;
        } else {
          tok.content = `<span class="wikilink" data-note="${esc(name)}">${esc(alias || name)}</span>`;
        }
      }
    }
    state.pos = end + 2;
    return true;
  });

  // ---- block segmentation (notes editor current-block-raw cursor, §6.1) ----
  // Split a body into ordered line-range segments that COVER every line: each top-level
  // markdown block (paragraph/heading/list/table/blockquote/fence/hr/html) is one segment
  // (so a whole list/table/fence goes raw as a unit), and blank-line gaps between blocks
  // become singleton segments. Returns [{start, end}] with end EXCLUSIVE, in line order.
  function blocks(body) {
    const lines = (body || '').split('\n');
    const n = lines.length;
    let toks = [];
    try { toks = md.parse(body || '', {}); } catch { toks = []; }
    // collect top-level block ranges from token .map (level 0 opens + self-contained blocks)
    const ranges = [];
    for (const t of toks) {
      if (t.level !== 0 || !t.map) continue;
      const [s, e] = t.map;
      if (e > s) ranges.push([s, e]);
    }
    ranges.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    // merge/skip nested or overlapping ranges (keep the outermost), then fill gaps
    const segs = [];
    let line = 0;
    for (const [s, e] of ranges) {
      if (s < line) continue;                 // already covered by an outer block
      while (line < s) { segs.push({ start: line, end: line + 1 }); line++; }  // blank-line gap
      segs.push({ start: s, end: e });
      line = e;
    }
    while (line < n) { segs.push({ start: line, end: line + 1 }); line++; }    // trailing blanks
    if (!segs.length) segs.push({ start: 0, end: Math.max(1, n) });
    return segs;
  }

  window.MdRender = {
    html: (body) => md.render(body || ''),
    blocks,
    // flip the checkbox on source line `n` of `body`; returns the new body
    toggleCheckbox: (body, n) => {
      const lines = (body || '').split('\n');
      if (n < 0 || n >= lines.length) return body;
      lines[n] = lines[n].replace(
        /^(\s*[-*+]\s+)\[([ xX])\]/,
        (_mm, p, c) => `${p}[${c.toLowerCase() === 'x' ? ' ' : 'x'}]`,
      );
      return lines.join('\n');
    },
  };
})();
