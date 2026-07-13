/* notes.js — D2 2d /notes module. A list + FTS search; opening a note gives a
   vim-style editor: NORMAL mode renders the markdown (markdown-it), INSERT mode (i)
   is the raw textarea, Esc returns to normal. A mouse/touch toggle switches modes.
   No side-by-side. Rendered checkboxes are clickable — toggling rewrites the source
   line and saves. Notes are file-backed; [[…]] links materialize server-side on save. */

window.NotesView = {
  props: ['store'],
  data() {
    return { list: [], q: '', hits: null, sel: null, creating: false, mode: 'normal', draft: { title: '', body: '' }, saved: { title: '', body: '' }, listSel: 0, eventList: [], linkMenu: null, matchIds: null, _fseq: 0,
      // §6.1 normal-mode block cursor: position in the body source + a remembered goal column
      curLine: 0, curCol: 0, goalCol: 0, pendingG: false };
  },
  computed: {
    // the body as source lines + the top-level block segments (current-block-raw model, §6.1)
    bodyLines() { return this.draft.body.split('\n'); },
    segs() { return window.MdRender ? window.MdRender.blocks(this.draft.body) : [{ start: 0, end: this.bodyLines.length }]; },
    // when a folder is selected in the nav, narrow the (non-search) list to it
    folderFilter() { return this.store.view.folderId || null; },
    activeFolder() { return this.folderFilter ? this.store.folderById(this.folderFilter) : null; },
    // the active query (type:note by default); a real predicate beyond type: narrows the list
    activeQuery() { return this.store.currentQuery(); },
    hasPredicate() { return Q.parse(this.activeQuery()).terms.some((t) => t.field !== 'type'); },
    rows() {
      if (this.hits) return this.hits;   // search results ignore the folder + query filter
      let r = this.folderFilter ? this.list.filter((n) => n.folderId === this.folderFilter) : this.list;
      if (this.matchIds) r = r.filter((n) => this.matchIds.has(n.id));
      return r;
    },
    editing() { return !!this.sel || this.creating; },
    dirty() { return this.editing && (this.draft.title !== this.saved.title || this.draft.body !== this.saved.body || this.draft.folderId !== this.saved.folderId); },
  },
  watch: {
    // markdown renders synchronously; tdx-query blocks fetch async, so hydrate after paint
    'draft.body'() { if (this.mode === 'normal') this.$nextTick(this.hydrateQueries); },
    mode(v) { if (v === 'normal') this.$nextTick(this.hydrateQueries); },
    // opened from a link chip on a task/event (store.openNote sets this)
    'store.pendingNoteId'(id) { if (id) { this.store.pendingNoteId = null; this.open(id); } },
    // re-run the query-bar filter when the active query changes
    activeQuery() { this.refilter(); },
  },
  mounted() {
    this.load();
    this.refilter();
    this.store.fetchEventList().then((e) => { this.eventList = e; }); // for the [[ picker
    this.store.dirtyCheck = () => this.dirty; // app-switch guard (store.setView) reads this
    if (this.store.pendingNoteId) { const id = this.store.pendingNoteId; this.store.pendingNoteId = null; this.open(id); }
  },
  beforeUnmount() { this.store.dirtyCheck = null; },
  methods: {
    async load() { this.list = await this.store.fetchNotes(); this.listSel = 0; },
    // run the query through the unified engine and keep the set of matching note ids;
    // a query with only type: (no real predicate) clears the filter (show every note)
    async refilter() {
      if (!this.hasPredicate) { this.matchIds = null; return; }
      const seq = ++this._fseq;
      const items = await this.store.runQuery(this.activeQuery());
      if (seq !== this._fseq) return;
      this.matchIds = new Set((items || []).filter((i) => i.type === 'note').map((i) => i.id));
    },
    async runSearch() {
      const q = this.q.trim();
      this.hits = q ? await this.store.searchNotes(q) : null;
      this.listSel = 0;
    },
    async open(id) {
      const n = await this.store.getNote(id);
      if (!n) return;
      this.sel = n;
      this.creating = false;
      this.mode = 'normal';        // open into the rendered view
      this.draft = { title: n.title, body: n.body, folderId: n.folderId ?? null };
      this.saved = { title: n.title, body: n.body, folderId: n.folderId ?? null };
      this.curLine = 0; this.curCol = 0; this.goalCol = 0; this.pendingG = false;
    },
    // open a blank editor — NOTHING is written to the vault until the first save
    newNote() {
      this.sel = null;
      this.creating = true;
      // a note created while viewing a folder is filed there
      this.draft = { title: '', body: '', folderId: this.folderFilter || null };
      this.saved = { title: '', body: '', folderId: this.folderFilter || null };
      this.curLine = 0; this.curCol = 0; this.goalCol = 0; this.pendingG = false;
      this.mode = 'insert';        // a fresh note starts in edit mode
      this.$nextTick(() => { const el = this.$refs.titleInput; if (el) el.focus(); });
    },
    // ---- vim modes ----
    toInsert() {
      this.mode = 'insert';
      this.store.fetchEventList().then((e) => { this.eventList = e; }); // refresh [[ picker candidates
      this.$nextTick(() => { const el = this.$refs.bodyArea; if (el) el.focus(); });
    },
    // leaving insert (Esc or the toggle) WRITES the file, then renders — no manual save.
    // Carry the textarea caret back to the block cursor so normal mode lands where you left off.
    async commitAndNormal() {
      const ta = this.$refs.bodyArea;
      const caret = ta ? ta.selectionStart : null;
      if (this.draft.title.trim() && this.dirty) { if (this.sel) await this.persist(); else await this.save(); }
      if (caret != null) this.setCursorFromOffset(caret);
      this.mode = 'normal';
    },
    toggleMode() { this.mode === 'insert' ? this.commitAndNormal() : this.toInsert(); },
    // keys routed from the app's global handler (so they inherit its modal/typing gate)
    // ---- §6.1 normal-mode block cursor: vim motions + insert entry ----
    normalKey(e) {
      const lines = this.bodyLines, maxLine = lines.length - 1;
      const lineLen = () => (lines[this.curLine] || '').length;
      const setCol = (c) => { this.curCol = Math.max(0, Math.min(lineLen(), c)); this.goalCol = this.curCol; };
      const setLine = (n) => { this.curLine = Math.max(0, Math.min(maxLine, n)); this.curCol = Math.min(this.goalCol, lineLen()); };
      if (this.pendingG) {                       // gg → first line
        this.pendingG = false;
        if (e.key === 'g') { e.preventDefault(); setLine(0); this.scrollCursor(); return; }
      }
      switch (e.key) {
        case 'h': case 'ArrowLeft':  e.preventDefault(); setCol(this.curCol - 1); break;
        case 'l': case 'ArrowRight': e.preventDefault(); setCol(this.curCol + 1); break;
        case 'j': case 'ArrowDown':  e.preventDefault(); setLine(this.curLine + 1); break;
        case 'k': case 'ArrowUp':    e.preventDefault(); setLine(this.curLine - 1); break;
        case '0': e.preventDefault(); setCol(0); break;
        case '$': e.preventDefault(); setCol(lineLen()); break;
        case 'w': e.preventDefault(); this.wordFwd(); break;
        case 'b': e.preventDefault(); this.wordBack(); break;
        case 'g': e.preventDefault(); this.pendingG = true; return;   // await a second g
        case 'G': e.preventDefault(); setLine(maxLine); break;
        case 'i': case 'a': case 'I': case 'A': e.preventDefault(); this.enterInsert(e.key); return;
        case 'Enter': e.preventDefault(); this.save(); return;
        case 'd': e.preventDefault(); this.del(); return;
        case 'Escape': e.preventDefault(); this.closeEditor(); return;
        default: return;
      }
      this.scrollCursor();
    },
    // word motions (scan \b\w across lines)
    wordFwd() {
      const lines = this.bodyLines;
      for (let li = this.curLine, co = this.curCol; li < lines.length; li++, co = -1) {
        const re = /\b\w/g; let m;
        while ((m = re.exec(lines[li])) ) { if (m.index > co) { this.curLine = li; this.curCol = m.index; this.goalCol = m.index; this.scrollCursor(); return; } }
      }
      this.curLine = lines.length - 1; this.curCol = (lines[this.curLine] || '').length; this.goalCol = this.curCol; this.scrollCursor();
    },
    wordBack() {
      const lines = this.bodyLines;
      for (let li = this.curLine, co = this.curCol; li >= 0; li--, co = Infinity) {
        const re = /\b\w/g; let m, prev = null;
        while ((m = re.exec(lines[li])) ) { if (m.index < co) prev = m.index; else break; }
        if (prev !== null) { this.curLine = li; this.curCol = prev; this.goalCol = prev; this.scrollCursor(); return; }
      }
      this.curLine = 0; this.curCol = 0; this.goalCol = 0; this.scrollCursor();
    },
    // absolute char offset of (line,col) within draft.body
    offsetOf(line, col) { let off = 0; for (let i = 0; i < line; i++) off += (this.bodyLines[i] || '').length + 1; return off + col; },
    // (line,col) from an absolute offset (caret → block cursor)
    setCursorFromOffset(off) {
      const lines = this.bodyLines; let acc = 0;
      for (let i = 0; i < lines.length; i++) {
        if (off <= acc + lines[i].length) { this.curLine = i; this.curCol = off - acc; this.goalCol = this.curCol; return; }
        acc += lines[i].length + 1;
      }
      this.curLine = lines.length - 1; this.curCol = (lines[this.curLine] || '').length; this.goalCol = this.curCol;
    },
    // i/a/I/A → drop into the (existing) full-body textarea at the mapped caret
    enterInsert(kind) {
      const line = this.bodyLines[this.curLine] || '';
      let col = this.curCol;
      if (kind === 'a') col = Math.min(line.length, col + 1);
      else if (kind === 'A') col = line.length;
      else if (kind === 'I') { const f = line.search(/\S/); col = f < 0 ? 0 : f; }
      this.curCol = col;
      const off = this.offsetOf(this.curLine, col);
      this.toInsert();   // sets mode + focuses bodyArea
      this.$nextTick(() => { const ta = this.$refs.bodyArea; if (ta) { ta.focus(); ta.setSelectionRange(off, off); } });
    },
    // ---- normal-mode block rendering (current block raw, rest rendered) ----
    isActive(seg) { return seg.start <= this.curLine && this.curLine < seg.end; },
    segSource(seg) { return this.bodyLines.slice(seg.start, seg.end).join('\n'); },
    segHtml(seg) { return window.MdRender ? window.MdRender.html(this.segSource(seg)) : this.segSource(seg); },
    // raw source of the active block with a terminal block cursor over (curLine,curCol)
    activeHtml(seg) {
      const esc = (s) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
      const out = [];
      for (let ln = seg.start; ln < seg.end; ln++) {
        const text = this.bodyLines[ln] || '';
        if (ln === this.curLine) {
          const col = Math.min(this.curCol, text.length);
          const at = text[col] !== undefined ? esc(text[col]) : ' ';
          out.push(esc(text.slice(0, col)) + '<span class="nb-cursor">' + at + '</span>' + esc(text.slice(col + 1)));
        } else {
          out.push(esc(text) || ' ');
        }
      }
      return out.join('\n');
    },
    scrollCursor() { this.$nextTick(() => { const el = this.$el && this.$el.querySelector('.nb-cursor'); if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' }); }); },
    // keys routed from the app's global handler (so they inherit its modal/typing gate)
    onKey(e) {
      if (this.editing) {
        if (this.mode === 'normal') this.normalKey(e);
        return; // insert mode types into the textarea (global handler already returned on typing)
      }
      // list mode
      const rows = this.rows;
      if (!rows.length) return;
      if (e.key === 'j' || e.key === 'ArrowDown') { e.preventDefault(); this.listSel = Math.min(rows.length - 1, this.listSel + 1); this.scrollListSel(); }
      else if (e.key === 'k' || e.key === 'ArrowUp') { e.preventDefault(); this.listSel = Math.max(0, this.listSel - 1); this.scrollListSel(); }
      else if (e.key === 'Enter' || e.key === 'o') { e.preventDefault(); const n = rows[this.listSel]; if (n) this.open(n.id); }
    },
    scrollListSel() { this.$nextTick(() => { const el = this.$el && this.$el.querySelector('.notes-row.on'); if (el) el.scrollIntoView({ block: 'nearest' }); }); },
    labelName(id) { const l = this.store.labelById(id); return l ? l.name : '?'; },
    fmtDate(ts) { return (ts || '').slice(0, 10); },   // YYYY-MM-DD (created/edited in the list row)
    // ---- [[ link picker (insert mode) ----
    detectLink() {
      const ta = this.$refs.bodyArea;
      if (!ta) return;
      const pos = ta.selectionStart;
      const m = this.draft.body.slice(0, pos).match(/\[\[([^\]\[\n]*)$/);
      if (!m) { this.closeLinkMenu(); return; }
      this.linkMenu = { query: m[1], start: pos - m[0].length, index: 0, items: this.linkCandidates(m[1]) };
    },
    linkCandidates(query) {
      const q = query.trim().toLowerCase();
      const out = [];
      const add = (type, id, title, readableId) => { if (out.length < 8 && (title || '').toLowerCase().includes(q)) out.push({ type, id, title, readableId }); };
      for (const t of this.store.tasks) { if (!t.archived) add('task', t.id, t.title, t.readableId); }
      for (const e of this.eventList) add('event', e.id, e.title, e.readableId);
      for (const n of this.list) { if (!this.sel || n.id !== this.sel.id) add('note', n.id, n.title, n.readableId); }
      return out;
    },
    pickLink(item) {
      const m = this.linkMenu;
      if (!m) return;
      const ta = this.$refs.bodyArea;
      const pos = ta ? ta.selectionStart : m.start + 2 + m.query.length;
      // prefer the readable id ([[t_0001]]) — the scanner resolves it back to the
      // target; fall back to a note's name, or the legacy type:uuid form.
      const insert = item.readableId ? `[[${item.readableId}]]`
        : item.type === 'note' ? `[[${item.title}]]`
        : `[[${item.type}:${item.id}|${item.title}]]`;
      this.draft.body = this.draft.body.slice(0, m.start) + insert + this.draft.body.slice(pos);
      this.closeLinkMenu();
      this.$nextTick(() => { if (ta) { ta.focus(); const c = m.start + insert.length; ta.setSelectionRange(c, c); } });
    },
    closeLinkMenu() { this.linkMenu = null; },
    onBodyKey(e) {
      if (this.linkMenu) {
        if (e.key === 'ArrowDown') { e.preventDefault(); this.linkMenu.index = Math.min(this.linkMenu.items.length - 1, this.linkMenu.index + 1); return; }
        if (e.key === 'ArrowUp') { e.preventDefault(); this.linkMenu.index = Math.max(0, this.linkMenu.index - 1); return; }
        if ((e.key === 'Tab' || e.key === 'Enter') && this.linkMenu.items.length) { e.preventDefault(); this.pickLink(this.linkMenu.items[this.linkMenu.index]); return; }
        if (e.key === 'Escape') { e.preventDefault(); this.closeLinkMenu(); return; }
        return; // keep typing — @input re-detects
      }
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.commitAndNormal(); } // esc writes + renders
    },
    openWikilink(el) {
      const type = el.getAttribute('data-type');
      if (type) { this.openEntity(type, el.getAttribute('data-id')); return; }
      const name = (el.getAttribute('data-note') || '').toLowerCase();
      const note = this.list.find((n) => (n.title || '').toLowerCase() === name);
      if (note) this.store.openNoteDrawer(note.id);   // peek in place (§4.3)
      else this.store.toast('note not found');
    },
    // click in the rendered view — checkbox toggle · tdx-query item · wikilink · else move cursor
    // (each rendered segment carries data-seg; checkbox data-line is segment-relative, so offset it)
    onRenderClick(e) {
      const segEl = e.target.closest && e.target.closest('[data-seg]');
      const segBase = segEl ? (this.segs[+segEl.getAttribute('data-seg')] || {}).start || 0 : 0;
      const cb = e.target.closest && e.target.closest('.md-check');
      if (cb) {
        e.preventDefault();
        const line = segBase + parseInt(cb.getAttribute('data-line'), 10);
        this.draft.body = window.MdRender.toggleCheckbox(this.draft.body, line);
        if (this.sel) this.persist();   // existing note → quiet save
        else this.save();               // unsaved note → create it (toasts to name it first if untitled)
        return;
      }
      const wl = e.target.closest && e.target.closest('.wikilink');
      if (wl) { e.preventDefault(); this.openWikilink(wl); return; }
      const qi = e.target.closest && e.target.closest('.tdx-query-item');
      if (qi) { e.preventDefault(); this.openEntity(qi.getAttribute('data-type'), qi.getAttribute('data-id')); return; }
      // plain click on a rendered block → move the cursor into it
      if (segEl) { this.curLine = segBase; this.curCol = 0; this.goalCol = 0; }
    },
    openEntity(type, id) {
      if (type === 'task') { this.store.selectedTaskId = id; this.store.detailOpen = true; }
      else if (type === 'event') { this.store.openEvent(id); }
      else if (type === 'note') { this.store.openNoteDrawer(id); }   // peek in place (§4.3); `o` in the drawer opens it fully
    },
    // ---- tdx-query embeds: fill each block with live results ----
    async hydrateQueries() {
      const root = this.$el && this.$el.querySelector('.note-render');
      if (!root) return;
      for (const el of root.querySelectorAll('.tdx-query[data-query]')) {
        if (el._hydrated) continue;
        el._hydrated = true;
        const q = el.getAttribute('data-query');
        const items = await this.store.runQuery(q);
        el.innerHTML = this.renderQueryList(q, items);
      }
    },
    renderQueryList(q, items) {
      const esc = (s) => (s || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
      const head = `<div class="tdx-query-q mut">⌗ ${esc(q)}</div>`;
      if (!items.length) return `${head}<div class="tdx-query-empty mut">no matches</div>`;
      const rows = items.map((it) =>
        `<div class="tdx-query-item" data-type="${it.type}" data-id="${esc(it.id)}"><span class="tq-type mut">${it.type}</span> ${esc(it.title || '')}</div>`,
      ).join('');
      return head + rows;
    },
    // ---- save / delete ----
    async persist() {           // quiet save (checkbox toggles); needs an existing note
      if (!this.sel) return;
      const n = await this.store.saveNote({ id: this.sel.id, title: this.draft.title.trim() || this.sel.title, body: this.draft.body, folderId: this.draft.folderId });
      if (n) { this.sel = n; this.draft = { title: n.title, body: n.body, folderId: n.folderId ?? null }; this.saved = { title: n.title, body: n.body, folderId: n.folderId ?? null }; }
    },
    async save() {
      const title = this.draft.title.trim();
      if (!title) { this.store.toast('name the note first'); return; }
      const n = await this.store.saveNote({ id: this.sel?.id, title, body: this.draft.body, folderId: this.draft.folderId });
      if (n) {
        this.sel = n;
        this.creating = false;
        this.draft = { title: n.title, body: n.body, folderId: n.folderId ?? null };
        this.saved = { title: n.title, body: n.body, folderId: n.folderId ?? null };
        await this.load();
        this.$nextTick(() => { if (this.$refs.links) this.$refs.links.load(); }); // saving can change content links
        this.store.toast('✓ saved');
      }
    },
    async del() {
      if (!this.sel) return;
      if (await this.store.askConfirm('Delete this note?')) {
        await this.store.deleteNote(this.sel.id);
        this.back();
      }
    },
    // close back to the list, confirming if there are unsaved edits
    async closeEditor() {
      if (this.dirty) { const ok = await this.store.askConfirm('Discard unsaved changes?'); if (!ok) return; }
      this.back();
    },
    back() { this.sel = null; this.creating = false; this.mode = 'normal'; this.draft = { title: '', body: '' }; this.saved = { title: '', body: '' }; this.load(); },
    async sync() {
      const s = await this.store.syncNotes();
      if (s) { await this.load(); this.store.toast(`synced · ${s.updated} updated · ${s.tombstoned} removed`); }
    },
  },
  template: `
  <div class="notes">
    <div class="notes-head">
      <span class="hi notes-title">notes</span>
      <span v-if="!editing && activeFolder" class="notes-folder" :style="{ color: store.resolveColor(activeFolder.color) }" title="filtered to this folder">{{ activeFolder.glyph }} {{ activeFolder.name }} <span class="notes-folder-x" @click="store.openNotes()" title="show all notes">✕</span></span>
      <input v-if="!editing" class="ti notes-search" v-model="q" @input="runSearch" placeholder="search…">
      <span class="grow"></span>
      <span v-if="!editing" class="qbtn" @click="newNote">＋ new</span>
      <span v-if="!editing" class="qbtn" @click="sync" title="reconcile external edits">sync</span>
      <span v-if="editing" class="qbtn note-mode" @click="toggleMode">{{ mode==='insert' ? 'render' : 'edit' }} <span class="mut">{{ mode==='insert' ? '⎋' : 'i' }}</span></span>
      <span v-if="editing" class="qbtn" @click="closeEditor">‹ back</span>
    </div>

    <div v-if="!editing" class="notes-list">
      <div v-if="!rows.length" class="mut notes-empty">no notes yet — ＋ new, or drop .md files in the vault and hit sync</div>
      <div v-for="(n, i) in rows" :key="n.id" class="notes-row" :class="{ on: i===listSel }" @click="listSel=i; open(n.id)">
        <div class="nr-main">
          <div class="nr-title-line">
            <span v-if="n.readableId" class="mut notes-row-rid">{{ n.readableId }}</span>
            <span class="notes-row-title">{{ n.title }}</span>
          </div>
          <div v-if="n.snippet" class="mut notes-row-snip">{{ n.snippet }}</div>
          <div v-if="n.labels && n.labels.length" class="nr-labels">
            <span v-for="lid in n.labels" :key="lid" class="tag">#{{ labelName(lid) }}</span>
          </div>
        </div>
        <div v-if="n.updatedAt || n.createdAt" class="nr-dates mut">
          <div v-if="n.updatedAt">edited {{ fmtDate(n.updatedAt) }}</div>
          <div v-if="n.createdAt">created {{ fmtDate(n.createdAt) }}</div>
        </div>
      </div>
    </div>

    <div v-else class="note-editor">
      <input ref="titleInput" class="ti note-title" v-model="draft.title" placeholder="note name (this is the filename)" @keydown.enter="save">
      <div v-if="store.folders.length" class="note-folder-row">
        <span class="ev-rl">folder</span>
        <select class="ti" v-model="draft.folderId">
          <option :value="null">— none (root) —</option>
          <option v-for="f in store.folders" :key="f.id" :value="f.id">{{ f.glyph }} {{ f.name }}</option>
        </select>
      </div>
      <div class="note-body-wrap">
        <template v-if="mode==='insert'">
          <textarea ref="bodyArea" class="ti note-body" v-model="draft.body"
            placeholder="# markdown…  ==highlight==  · - [ ] task  · [[ to link  · esc to render"
            @input="detectLink" @keydown="onBodyKey"></textarea>
          <div v-if="linkMenu && linkMenu.items.length" class="link-menu">
            <div v-for="(it,i) in linkMenu.items" :key="it.type+it.id" class="link-opt" :class="{ on: i===linkMenu.index }" @mousedown.prevent="pickLink(it)">
              <span class="link-opt-type mut">{{ it.type }}</span> {{ it.title }}
            </div>
          </div>
        </template>
        <div v-else class="note-render" @click="onRenderClick">
          <template v-for="(seg, si) in segs" :key="si">
            <pre v-if="isActive(seg)" class="nb-raw" v-html="activeHtml(seg)"></pre>
            <div v-else class="md-body nb-seg" :data-seg="si" v-html="segHtml(seg)"></div>
          </template>
        </div>
      </div>
      <linked-items v-if="sel" ref="links" :store="store" type="note" :id="sel.id"></linked-items>
      <div class="note-actions">
        <button class="btn" @click="closeEditor">close <span class="mut">⎋</span></button>
        <button v-if="sel" class="btn danger" @click="del"><span><u>d</u>elete</span></button>
        <button class="btn primary" @click="save">save ↵</button>
      </div>
    </div>
  </div>`,
};
