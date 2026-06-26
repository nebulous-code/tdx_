/* notes.js — D2 2d /notes module. A list + FTS search; opening a note gives a
   vim-style editor: NORMAL mode renders the markdown (markdown-it), INSERT mode (i)
   is the raw textarea, Esc returns to normal. A mouse/touch toggle switches modes.
   No side-by-side. Rendered checkboxes are clickable — toggling rewrites the source
   line and saves. Notes are file-backed; [[…]] links materialize server-side on save. */

window.NotesView = {
  props: ['store'],
  data() {
    return { list: [], q: '', hits: null, sel: null, creating: false, mode: 'normal', draft: { title: '', body: '' }, saved: { title: '', body: '' }, listSel: 0, eventList: [], linkMenu: null };
  },
  computed: {
    rows() { return this.hits ?? this.list; },
    editing() { return !!this.sel || this.creating; },
    rendered() { return window.MdRender ? window.MdRender.html(this.draft.body) : this.draft.body; },
    dirty() { return this.editing && (this.draft.title !== this.saved.title || this.draft.body !== this.saved.body); },
  },
  watch: {
    // markdown renders synchronously; tdx-query blocks fetch async, so hydrate after paint
    rendered() { if (this.mode === 'normal') this.$nextTick(this.hydrateQueries); },
    mode(v) { if (v === 'normal') this.$nextTick(this.hydrateQueries); },
    // opened from a link chip on a task/event (store.openNote sets this)
    'store.pendingNoteId'(id) { if (id) { this.store.pendingNoteId = null; this.open(id); } },
  },
  mounted() {
    this.load();
    this.store.fetchEventList().then((e) => { this.eventList = e; }); // for the [[ picker
    this.store.dirtyCheck = () => this.dirty; // app-switch guard (store.setView) reads this
    if (this.store.pendingNoteId) { const id = this.store.pendingNoteId; this.store.pendingNoteId = null; this.open(id); }
  },
  beforeUnmount() { this.store.dirtyCheck = null; },
  methods: {
    async load() { this.list = await this.store.fetchNotes(); this.listSel = 0; },
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
      this.draft = { title: n.title, body: n.body };
      this.saved = { title: n.title, body: n.body };
    },
    // open a blank editor — NOTHING is written to the vault until the first save
    newNote() {
      this.sel = null;
      this.creating = true;
      this.draft = { title: '', body: '' };
      this.saved = { title: '', body: '' };
      this.mode = 'insert';        // a fresh note starts in edit mode
      this.$nextTick(() => { const el = this.$refs.titleInput; if (el) el.focus(); });
    },
    // ---- vim modes ----
    toInsert() {
      this.mode = 'insert';
      this.store.fetchEventList().then((e) => { this.eventList = e; }); // refresh [[ picker candidates
      this.$nextTick(() => { const el = this.$refs.bodyArea; if (el) el.focus(); });
    },
    // leaving insert (Esc or the toggle) WRITES the file, then renders — no manual save
    async commitAndNormal() {
      if (this.draft.title.trim() && this.dirty) { if (this.sel) await this.persist(); else await this.save(); }
      this.mode = 'normal';
    },
    toggleMode() { this.mode === 'insert' ? this.commitAndNormal() : this.toInsert(); },
    // keys routed from the app's global handler (so they inherit its modal/typing gate)
    onKey(e) {
      if (this.editing) {
        if (this.mode === 'normal') {
          if (e.key === 'i') { e.preventDefault(); this.toInsert(); return; }
          if (e.key === 'Enter') { e.preventDefault(); this.save(); return; }
          if (e.key === 'd') { e.preventDefault(); this.del(); return; }
          if (e.key === 'Escape') { e.preventDefault(); this.closeEditor(); return; }
        }
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
      const add = (type, id, title) => { if (out.length < 8 && (title || '').toLowerCase().includes(q)) out.push({ type, id, title }); };
      for (const t of this.store.tasks) { if (!t.archived) add('task', t.id, t.title); }
      for (const e of this.eventList) add('event', e.id, e.title);
      for (const n of this.list) { if (!this.sel || n.id !== this.sel.id) add('note', n.id, n.title); }
      return out;
    },
    pickLink(item) {
      const m = this.linkMenu;
      if (!m) return;
      const ta = this.$refs.bodyArea;
      const pos = ta ? ta.selectionStart : m.start + 2 + m.query.length;
      const insert = item.type === 'note' ? `[[${item.title}]]` : `[[${item.type}:${item.id}|${item.title}]]`;
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
      if (note) this.open(note.id);
      else this.store.toast('note not found');
    },
    // click in the rendered view — checkbox toggle · tdx-query item · wikilink
    onRenderClick(e) {
      const cb = e.target.closest && e.target.closest('.md-check');
      if (cb) {
        e.preventDefault();
        const line = parseInt(cb.getAttribute('data-line'), 10);
        this.draft.body = window.MdRender.toggleCheckbox(this.draft.body, line);
        if (this.sel) this.persist();   // existing note → quiet save
        else this.save();               // unsaved note → create it (toasts to name it first if untitled)
        return;
      }
      const wl = e.target.closest && e.target.closest('.wikilink');
      if (wl) { e.preventDefault(); this.openWikilink(wl); return; }
      const qi = e.target.closest && e.target.closest('.tdx-query-item');
      if (qi) { e.preventDefault(); this.openEntity(qi.getAttribute('data-type'), qi.getAttribute('data-id')); return; }
    },
    openEntity(type, id) {
      if (type === 'task') { this.store.selectedTaskId = id; this.store.detailOpen = true; }
      else if (type === 'event') { this.store.openEvent(id); }
      else if (type === 'note') { this.open(id); }
    },
    // ---- tdx-query embeds: fill each block with live results ----
    async hydrateQueries() {
      const root = this.$el && this.$el.querySelector('.md-body');
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
      const n = await this.store.saveNote({ id: this.sel.id, title: this.draft.title.trim() || this.sel.title, body: this.draft.body });
      if (n) { this.sel = n; this.draft = { title: n.title, body: n.body }; this.saved = { title: n.title, body: n.body }; }
    },
    async save() {
      const title = this.draft.title.trim();
      if (!title) { this.store.toast('name the note first'); return; }
      const n = await this.store.saveNote({ id: this.sel?.id, title, body: this.draft.body });
      if (n) {
        this.sel = n;
        this.creating = false;
        this.draft = { title: n.title, body: n.body };
        this.saved = { title: n.title, body: n.body };
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
      <input v-if="!editing" class="ti notes-search" v-model="q" @input="runSearch" placeholder="search…">
      <span class="grow"></span>
      <span v-if="!editing" class="qbtn" @click="newNote">＋ new</span>
      <span v-if="!editing" class="qbtn" @click="sync" title="reconcile external edits">sync</span>
      <span v-if="editing" class="qbtn note-mode" @click="toggleMode">{{ mode==='insert' ? 'render' : 'edit' }} <span class="mut">{{ mode==='insert' ? 'esc' : 'i' }}</span></span>
      <span v-if="editing" class="qbtn" @click="closeEditor">‹ back</span>
    </div>

    <div v-if="!editing" class="notes-list">
      <div v-if="!rows.length" class="mut notes-empty">no notes yet — ＋ new, or drop .md files in the vault and hit sync</div>
      <div v-for="(n, i) in rows" :key="n.id" class="notes-row" :class="{ on: i===listSel }" @click="listSel=i; open(n.id)">
        <span class="notes-row-title">{{ n.title }}</span>
        <span v-if="n.snippet" class="mut notes-row-snip">{{ n.snippet }}</span>
      </div>
    </div>

    <div v-else class="note-editor">
      <input ref="titleInput" class="ti note-title" v-model="draft.title" placeholder="note name (this is the filename)" @keydown.enter="save">
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
        <div v-else class="md-body" v-html="rendered" @click="onRenderClick"></div>
      </div>
      <linked-items v-if="sel" ref="links" :store="store" type="note" :id="sel.id"></linked-items>
      <div class="note-actions">
        <button class="btn" @click="closeEditor">close<span class="mut">esc</span></button>
        <button v-if="sel" class="btn danger" @click="del"><span><u>d</u>elete</span></button>
        <button class="btn primary" @click="save">save ↵</button>
      </div>
    </div>
  </div>`,
};
