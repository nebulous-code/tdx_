/* notes.js — D2 2c minimal notes screen (bolted into the current SPA; rebuilt as
   the proper /notes module in the app-shell phase). A list + FTS search on the
   left/top, a plain title+textarea editor when a note is open. Notes are file-
   backed: the body is the .md on disk; [[task:ID]] / [[event:ID]] / [[Note Name]]
   in the body become links (materialized server-side on save). "sync" reconciles
   external nvim/Obsidian edits. Mouse-driven for now. */

window.NotesView = {
  props: ['store'],
  data() {
    return { list: [], q: '', hits: null, sel: null, creating: false, draft: { title: '', body: '' }, linked: [] };
  },
  computed: {
    // search results when querying, else the full list
    rows() { return this.hits ?? this.list; },
    // the editor is up either for an existing note (sel) or a brand-new draft (creating)
    editing() { return !!this.sel || this.creating; },
  },
  mounted() { this.load(); },
  methods: {
    async load() { this.list = await this.store.fetchNotes(); },
    async runSearch() {
      const q = this.q.trim();
      this.hits = q ? await this.store.searchNotes(q) : null;
    },
    async open(id) {
      const n = await this.store.getNote(id);
      if (!n) return;
      this.sel = n;
      this.draft = { title: n.title, body: n.body };
      this.loadLinks();
    },
    // open a blank editor — NOTHING is written to the vault until the first save
    newNote() {
      this.sel = null;
      this.creating = true;
      this.draft = { title: '', body: '' };
      this.linked = [];
      this.$nextTick(() => { const el = this.$refs.titleInput; if (el) el.focus(); });
    },
    async save() {
      const title = this.draft.title.trim();
      if (!title) { this.store.toast('name the note first'); return; } // no untitled files
      const n = await this.store.saveNote({ id: this.sel?.id, title, body: this.draft.body });
      if (n) {
        this.sel = n;            // a new note becomes the open one; a rename may have adjusted the name
        this.creating = false;
        this.draft = { title: n.title, body: n.body };
        await this.load();
        this.loadLinks();
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
    back() { this.sel = null; this.creating = false; this.draft = { title: '', body: '' }; this.linked = []; this.load(); },
    async sync() {
      const s = await this.store.syncNotes();
      if (s) {
        await this.load();
        this.store.toast(`synced · ${s.updated} updated · ${s.tombstoned} removed`);
      }
    },
    async loadLinks() { this.linked = this.sel ? await this.store.fetchLinks('note', this.sel.id) : []; },
    openLinked(l) {
      if (l.other.type === 'task') { this.store.selectedTaskId = l.other.id; this.store.detailOpen = true; }
      else if (l.other.type === 'event') { this.store.openEvent(l.other.id); }
      else if (l.other.type === 'note') { this.open(l.other.id); }
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
      <span v-if="editing" class="qbtn" @click="back">‹ back</span>
    </div>

    <div v-if="!editing" class="notes-list">
      <div v-if="!rows.length" class="mut notes-empty">no notes yet — ＋ new, or drop .md files in the vault and hit sync</div>
      <div v-for="n in rows" :key="n.id" class="notes-row" @click="open(n.id)">
        <span class="notes-row-title">{{ n.title }}</span>
        <span v-if="n.snippet" class="mut notes-row-snip">{{ n.snippet }}</span>
      </div>
    </div>

    <div v-else class="note-editor">
      <input ref="titleInput" class="ti note-title" v-model="draft.title" placeholder="note name (this is the filename)" @keydown.enter="save">
      <textarea class="ti note-body" v-model="draft.body" placeholder="# markdown… link with [[task:ID]], [[event:ID]] or [[Note Name]]"></textarea>
      <div v-if="sel && linked.length" class="note-links">
        <div class="mut notes-sub">linked</div>
        <div v-for="l in linked" :key="l.id" class="note-link" @click="openLinked(l)">
          <span class="note-link-type mut">{{ l.other.type }}</span>
          <span class="qbtn note-link-title">{{ l.other.title }}</span>
        </div>
      </div>
      <div class="note-actions">
        <button class="btn" @click="back">close</button>
        <button v-if="sel" class="btn danger" @click="del">delete</button>
        <button class="btn primary" @click="save">save</button>
      </div>
    </div>
  </div>`,
};
