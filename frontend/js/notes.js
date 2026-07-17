/* notes.js — D2 2d /notes module. A list + FTS search; opening a note gives a
   vim-style editor: NORMAL mode renders the markdown (markdown-it), INSERT mode (i)
   is the raw textarea, Esc returns to normal. A mouse/touch toggle switches modes.
   No side-by-side. Rendered checkboxes are clickable — toggling rewrites the source
   line and saves. Notes are file-backed; [[…]] links materialize server-side on save. */

// a note's editable state — labels/reviewAt included, so the full editor can set them too (n.3)
function newDraft(over) {
  return Object.assign({ title: '', body: '', folderId: null, reviewAt: '', labels: [] }, over || {});
}
const labelKey = (ls) => [...(ls || [])].sort().join(',');   // order-insensitive dirty compare

window.NotesView = {
  props: ['store'],
  mixins: [window.KbForm],
  emits: ['enter-nav'],
  data() {
    // NOTE `draft` is the note EDITOR's object (bodyLines/dirty/payload all read it). The
    // quick-add's title field is `qaDraft` — reusing `draft` would break the editor outright.
    return { list: [], q: '', hits: null, sel: null, mode: 'normal', qaDraft: '',
      draft: newDraft(), saved: newDraft(), listSel: 0, eventList: [], linkMenu: null, matchIds: null, _fseq: 0,
      // §6.1 block cursor: the LINE lives in KbForm's kbRow (the body's lines are ladder rows —
      // see kbRows/curLine); we own only the character column + a remembered goal column.
      curCol: 0, goalCol: 0,
      pending: null,          // multi-key operator prefix: 'g' (gg) · 'd' (dd/dw) · 'r' (replace)
      linkList: [],           // links emitted up by <linked-items> ($refs isn't reactive) — n.13
      kbAutoListen: false,    // the app routes keys here (index.html) → onKey drives kbKey
      kbAutofocus: false };   // opening a note lands on the body, not in the title
  },
  computed: {
    // the body as source lines + the top-level block segments (current-block-raw model, §6.1)
    bodyLines() { return this.draft.body.split('\n'); },
    segs() { return window.MdRender ? window.MdRender.blocks(this.draft.body) : [{ start: 0, end: this.bodyLines.length }]; },
    // t_0493: word / char count for the full note view. Words = whitespace-separated tokens
    // (the standard "nothing fancy" count; markdown markers count with their word).
    wordCount() { return (this.draft.body.trim().match(/\S+/g) || []).length; },
    charCount() { return this.draft.body.length; },
    // ---- the unified ladder (audit n.3) ------------------------------------------------
    // Every body line is a KbForm row, so j/k walk fields AND text as one list: the cursor's
    // LINE is just kbRow offset by however many field rows precede the body.
    bodyStart() { return Math.max(0, this.kbNav.findIndex((r) => r.id.startsWith('body_'))); },
    onBody() { const r = this.kbCur(); return !!r && r.id.startsWith('body_'); },
    curLine: {
      get() { return Math.max(0, Math.min(this.bodyLines.length - 1, this.kbRow - this.bodyStart)); },
      set(v) { this.kbRow = this.bodyStart + Math.max(0, Math.min(this.bodyLines.length - 1, v)); },
    },
    // when a folder is selected in the nav, narrow the (non-search) list to it. The vault's BASE
    // directory is a folder too (n.16) — it just carries a sentinel id, because folderId:null is
    // already taken by "all notes" (store.openNotes).
    folderFilter() { return this.store.view.folderId || null; },
    onBase() { return this.folderFilter === this.store.BASE_FID; },
    // the "no folder" option's label: the base directory's name when it has one, else the old copy
    baseName() { const r = this.store.rootFolder(); return r ? r.glyph + ' ' + r.name : '— none (root) —'; },
    activeFolder() {
      if (this.onBase) return this.store.rootFolder();
      return this.folderFilter ? this.store.folderById(this.folderFilter) : null;
    },
    // the active query (type:note by default); a real predicate beyond type: narrows the list
    activeQuery() { return this.store.currentQuery(); },
    hasPredicate() { return Q.parse(this.activeQuery).terms.some((t) => t.field !== 'type'); },
    // find (n.15) is scoped to WHAT YOU'RE LOOKING AT: the FTS hits are intersected with the
    // folder + the active query, not returned raw. Vault-wide text search is the global `/`
    // (a different engine — literal words across tasks/events/notes); this box is the notes
    // FTS index narrowed to the current view, which is the one thing `/` can't do.
    rows() {
      let r = this.onBase ? this.list.filter((n) => !n.folderId)              // the vault's top level
        : this.folderFilter ? this.list.filter((n) => n.folderId === this.folderFilter)
        : this.list;
      if (this.matchIds) r = r.filter((n) => this.matchIds.has(n.id));
      if (this.hits) { const hit = new Set(this.hits.map((n) => n.id)); r = r.filter((n) => hit.has(n.id)); }
      return r;
    },
    // which link chip the cursor is on; -1 while insert mode owns the keyboard (the navCls rule)
    linkFocus() { return this.mode === 'insert' ? -1 : this.kbCellOf('links'); },
    addLinkFocus() { return this.mode !== 'insert' && !!this.kbCls('addlink').kfocus; },
    editing() { return !!this.sel; },   // the editor only ever opens on a note that EXISTS (n.14)
    // mirrors the task quick-add's placeholder (tasklist.js): names the destination when you're
    // standing in a folder, and shows an example of the creation language
    addPlaceholder() {
      const f = this.activeFolder;
      return (f ? 'add to ' + f.name : 'add note') + '…  (try: Thank You Letter #family $friday)';
    },
    // the grey completion of the trailing token being typed (#tag · /folder · $date)
    tagGhost() { return this.store.clGhost(this.qaDraft, 'note'); },
    // ⚠ on the quick-add prompt when the active view filters on something a brand-new note
    // won't have — it'll still be created, just hidden from this list. store.viewWarn() can't
    // be reused: it's task-shaped (type:→'task', project/label/status/due).
    warn() {
      // The set GREW when the creation language landed: a new note now INHERITS the view's
      // `label:` and `due:` (→ its review date) via store.defaultsFor('note'), so those fields
      // are satisfied and warning about them would be a lie. What's left is what can't be
      // inherited: free text (parsed as field 'text'), and flags like is:/recurring:.
      const ok = new Set(['type', 'folder', 'category', 'label', 'due', 'has', 'created', 'edited']);
      return Q.parse(this.activeQuery).terms.some((t) => !ok.has(t.field));
    },
    warnTip() {
      return this.warn ? 'This view filters on things a new note won’t have — it’ll be created, just hidden from this list.' : '';
    },
    dirty() {
      if (!this.editing) return false;
      const d = this.draft, s = this.saved;
      return d.title !== s.title || d.body !== s.body || d.folderId !== s.folderId
        || d.reviewAt !== s.reviewAt || labelKey(d.labels) !== labelKey(s.labels);
    },
  },
  watch: {
    // t_0501: j/k move the block cursor via KbForm's ladder (kbRow), which never calls
    // scrollCursor — so the pane didn't follow the cursor down. Watch the derived line and
    // scroll on ANY line change (j/k, w/b, gg/G), so the cursor stays in view no matter how it moved.
    curLine() { this.scrollCursor(); },
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
    // the shared list cursor (a.2): with this registered, J/K inside the open peek drawer walks
    // THIS list and swaps what the drawer shows. Without it the drawer's J/K are dead keys.
    this._unregCursor = this.store.registerListCursor({
      rows: () => this.rows,
      index: () => this.listSel,
      go: (i) => { this.listSel = i; this.scrollListSel(); this.peek(this.rows[i]); },
    });
  },
  beforeUnmount() {
    this.store.dirtyCheck = null;
    if (this._unregCursor) this._unregCursor();
  },
  methods: {
    async load() { this.list = await this.store.fetchNotes(); this.listSel = 0; },
    // run the query through the unified engine and keep the set of matching note ids;
    // a query with only type: (no real predicate) clears the filter (show every note)
    async refilter() {
      if (!this.hasPredicate) { this.matchIds = null; return; }
      const seq = ++this._fseq;
      const items = await this.store.runQuery(this.activeQuery);
      if (seq !== this._fseq) return;
      this.matchIds = new Set((items || []).filter((i) => i.type === 'note').map((i) => i.id));
    },
    async runSearch() {
      const q = this.q.trim();
      this.hits = q ? await this.store.searchNotes(q) : null;
      this.listSel = 0;
    },
    // the note's editable fields, straight off the API shape
    seed(n) {
      return newDraft({ title: n.title, body: n.body, folderId: n.folderId ?? null,
        reviewAt: n.reviewAt || '', labels: [...(n.labels || [])] });
    },
    async open(id) {
      const n = await this.store.getNote(id);
      if (!n) return;
      this.sel = n;
      this.mode = 'normal';        // open into the rendered view
      this.draft = this.seed(n);
      this.saved = this.seed(n);
      this.resetCursor();
      // Enter from the list lands on body line 1 — the common case is reading/editing the
      // text; k walks up into review date / labels / folder / title (n.3).
      this.$nextTick(() => { this.kbRow = this.bodyStart; this.kbCell = 0; this.kbGoalCol = 0; });
    },
    // peek in the right-hand drawer (§4.3) — the same surface a note link opens. `o` in the
    // drawer promotes it to the full editor, J/K walk this list (the cursor registered above).
    peek(n) { if (n) this.store.openNoteDrawer(n.id); },
    // ---- quick-add: name it, then it exists (n.14) --------------------------------------
    // The editor now only ever opens on a note the server has. `i` lands you here, not in a
    // blank editor: a title is required, and Enter CREATES the note before opening it.
    focusAdd() { const el = this.$refs.qa; if (el) el.focus(); },
    // Tab / → accepts the ghost. → only at the very end of the line, so it doesn't hijack
    // cursor movement; with no ghost, both keys fall through to their normal behavior.
    acceptTag(e) {
      if (!this.tagGhost) return;
      if (e.key === 'ArrowRight') { const el = this.$refs.qa; if (el && el.selectionStart !== el.value.length) return; }
      e.preventDefault();
      this.qaDraft += this.tagGhost;
    },
    async commitAdd() {
      const text = this.qaDraft.trim();
      if (!text) return;
      // The creation language (docs/CREATION_LANGUAGE.md) — the SAME engine tasks use.
      // `$` is the note's review date, `/` its folder, `{…}` its body; `!` is not a symbol
      // here at all (a note has no priority), so "Ship v2 !2" keeps its title intact.
      const parsed = CL.parse(text, { type: 'note', known: this.store.clKnown });
      const payload = CL.apply('note', parsed, this.store.clCtx('note'));
      // a note created while viewing a folder is filed there (same rule as tasks) — unless
      // you typed one. The base directory's sentinel must NOT go over the wire: null IS the
      // vault root to the server (n.16).
      if (payload.folderId === undefined) payload.folderId = this.onBase ? null : (this.folderFilter || null);
      if (payload.folderId === this.store.BASE_FID) payload.folderId = null;
      const n = await this.store.saveNote({ body: '', reviewAt: null, ...payload });
      if (!n) return;              // save failed → keep the text, don't strand the user
      this.qaDraft = '';
      // load() refreshes the note LIST; refilter() refreshes the query's match set (rows is the
      // intersection of the two). Skip the refilter and the new note is invisible until the
      // active query changes — which is why switching views and back "fixed" it.
      await Promise.all([this.load(), this.refilter()]);
      this.open(n.id);             // land exactly as if you'd opened it off the list
    },
    // Esc must be bound on the input: the app's global onKey bails at its typing gate, so the
    // key would never reach us otherwise. Leaves the cursor on the list so j/k work at once.
    escAdd() {
      this.qaDraft = '';
      const el = this.$refs.qa; if (el) el.blur();
    },
    // ---- find: text search inside the current view (n.15) --------------------------------
    // Two-step Esc, mirroring the global `/` find (commitSearch → clearSearch in index.html):
    //   1st Esc (in the box) → COMMIT: blur, keep the term and the filtered list, so j/k can
    //      walk the hits. `f` comes back to the box with the term still in it.
    //   2nd Esc (on the list) → CLEAR: forget the term and restore the underlying view.
    // The old one-step Esc threw the results away the moment you tried to look at them.
    focusFind() { const el = this.$refs.find; if (el) el.focus(); },
    commitFind() {             // Esc/Enter in the box → hand the (still filtered) list to j/k
      const el = this.$refs.find; if (el) el.blur();
      this.listSel = 0;
    },
    async clearFind() {        // Esc on the list → drop the find entirely
      this.q = '';
      await this.runSearch();  // clears this.hits, so rows goes back to the unfiltered view
      const el = this.$refs.find; if (el) el.blur();
    },
    resetCursor() { this.curCol = 0; this.goalCol = 0; this.pending = null; this.kbCell = 0; this.kbGoalCol = 0; },
    // Esc out of a focused field → back to the ladder. This MUST be wired on the field itself:
    // the app's global onKey returns at its typing gate (index.html) before it routes here, so a
    // focused input never reaches KbForm's Escape-to-blur. Same hatch note-detail/task-detail use.
    blurField() { const a = document.activeElement; if (a && a.blur) a.blur(); },
    // The ladder's kfocus highlight is only meaningful while the ladder is driving. In insert
    // mode the keyboard belongs to the textarea, so a highlight left on whatever row you came
    // from (the edit button, a field) is stale paint — hide it until Esc hands the ladder back.
    navCls(id, cell) { return this.mode === 'insert' ? null : this.kbCls(id, cell); },
    toggleLabel(id) {
      const i = this.draft.labels.indexOf(id);
      if (i >= 0) this.draft.labels.splice(i, 1); else this.draft.labels.push(id);
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
      if (this.draft.title.trim() && this.dirty) await this.persist();
      if (caret != null) this.setCursorFromOffset(caret);
      this.mode = 'normal';
    },
    toggleMode() { this.mode === 'insert' ? this.commitAndNormal() : this.toInsert(); },
    // ---- KbForm: the unified ladder (n.3) ----------------------------------------------
    // title · folder · labels · review · EVERY BODY LINE · links · save · delete.
    // j/k walk the whole thing, so stepping off the review field lands on body line 1 and
    // stepping off the last body line lands on links — no boundary special-casing.
    kbRows() {
      if (!this.editing) return [];
      const labels = this.store.sortedLabels();
      return [
        { id: 'title',  type: 'input', ref: 'titleInput' },
        // must track the row's v-if exactly, or the ladder points at a row that isn't there
        { id: 'folder', type: 'input', ref: 'folderSel', when: () => this.store.folders.length > 0 || !!this.store.rootFolder() },
        { id: 'labels', type: 'grid', items: labels, cols: 99,
          isOn: (l) => this.draft.labels.includes(l.id), select: (l) => this.toggleLabel(l.id),
          when: () => labels.length > 0 },
        { id: 'review', type: 'input', ref: 'reviewInput' },
        // the body: one row per source line — this is what makes the ladder continuous
        ...this.bodyLines.map((_, i) => ({ id: 'body_' + i, type: 'static' })),
        // links = a grid row, like labels: h/l cross the chips, space opens (n.13). The
        // `+ link` picker stays mouse/click-driven (space on a chip is 'open', not 'add').
        { id: 'links', type: 'grid', items: this.linkList, cols: 99,
          select: (l) => this.$refs.links && this.$refs.links.open(l),
          when: () => this.linkList.length > 0 },
        // always available (the grid row disappears when there are no links)
        { id: 'addlink', type: 'input', ref: 'links' },   // i/space → linked-items.focus()
        // the action row, in the order it renders left→right (§6.2): back · edit/render · delete · save
        { id: 'back',   type: 'button', activate: () => this.closeEditor() },
        { id: 'mode',   type: 'button', activate: () => this.toggleMode() },
        { id: 'delete', type: 'button', activate: () => this.del() },
        { id: 'save',   type: 'button', activate: () => this.save() },
      ];
    },
    kbSubmit() { this.save(); },       // Enter anywhere in nav = save
    kbDirty() { return this.dirty; },  // → KbForm's "Discard changes?" guard on Escape
    kbOnClose() { this.back(); },      // Escape in nav = back to the notes list
    // Body rows own their keys (the precedent is task-detail's recurrence sub-pane): we consume
    // the vim verbs here and let j/k fall through to KbForm's kbMove, which is what keeps the
    // fields and the text on ONE ladder. `d` splits by row: operator in the body, delete-note
    // on a field row (mirrors tasks, where d fires while nav-ing the detail).
    kbDelegate(e) {
      if (!this.editing || this.mode === 'insert') return false;
      const el = document.activeElement, tag = (el && el.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return false;  // typing in a field
      if (!this.onBody) {
        if (e.key === 'd') { e.preventDefault(); this.del(); return true; }
        return false;                                   // fields: plain KbForm
      }
      // an armed operator (r/g/d) claims the NEXT key — even j/k — so `rj` replaces with 'j'
      // instead of navigating (t_0502). Only fall through to the ladder when nothing's pending.
      if (!this.pending && (e.key === 'j' || e.key === 'k' || e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
        return false;                                   // let the ladder move
      }
      return this.bodyKey(e);
    },
    // t_0502: while a `r` replace is armed, the note claims EVERY next key (except Esc) — even
    // global bare-key shortcuts like `@` — so the char lands on the note instead of firing the
    // shortcut. The global handler (index.html onKey) checks this and routes the key here first.
    capturingKey() { return this.editing && this.mode === 'normal' && this.pending === 'r'; },
    // ---- §6.1 block cursor: motions, insert entry, and the operators (n.2/n.5/n.12) ----
    bodyKey(e) {
      const lines = this.bodyLines;
      const lineLen = () => (lines[this.curLine] || '').length;
      const setCol = (c) => { this.curCol = Math.max(0, Math.min(lineLen(), c)); this.goalCol = this.curCol; };
      // a pending operator swallows the next key
      if (this.pending) {
        // a bare modifier keydown (Shift for @ / $, or Ctrl/Alt/Meta) fires BEFORE the real char,
        // so it must not consume/abort the operator — ignore it and keep waiting (t_0502).
        if (e.key === 'Shift' || e.key === 'Control' || e.key === 'Alt' || e.key === 'Meta') return true;
        const p = this.pending;
        this.pending = null;
        e.preventDefault();
        if (p === 'g' && e.key === 'g') { this.curLine = 0; setCol(Math.min(this.goalCol, 0)); this.scrollCursor(); return true; }
        if (p === 'd' && e.key === 'd') { this.deleteLine(); return true; }
        if (p === 'd' && e.key === 'w') { this.deleteWord(); return true; }
        if (p === 'r' && e.key.length === 1) { this.replaceChar(e.key); return true; }
        return true;                                    // any other follow-up: operator aborts
      }
      switch (e.key) {
        case 'h': case 'ArrowLeft':  e.preventDefault(); setCol(this.curCol - 1); break;
        case 'l': case 'ArrowRight': e.preventDefault(); setCol(this.curCol + 1); break;
        case '0': e.preventDefault(); setCol(0); break;
        case '$': e.preventDefault(); setCol(lineLen()); break;
        case 'w': e.preventDefault(); this.wordFwd(); break;
        case 'b': e.preventDefault(); this.wordBack(); break;
        case 'g': e.preventDefault(); this.pending = 'g'; return true;          // await gg
        case 'd': e.preventDefault(); this.pending = 'd'; return true;          // await dd / dw
        case 'r': e.preventDefault(); this.pending = 'r'; return true;          // await the replacement char
        case 'G': e.preventDefault(); this.curLine = lines.length - 1; setCol(Math.min(this.goalCol, lineLen())); break;
        case 'i': case 'a': case 'I': case 'A': e.preventDefault(); this.enterInsert(e.key); return true;
        case 'o': case 'O': e.preventDefault(); this.openLine(e.key === 'o'); return true;
        case 'D': e.preventDefault(); this.deleteToEol(); return true;
        default: return false;   // unhandled → KbForm (Enter=save · Escape=close · space)
      }
      this.scrollCursor();
      return true;
    },
    // ---- body edits (operate on the source, then re-render) ----
    setLines(lines) { this.draft.body = lines.join('\n'); },
    deleteLine() {                                     // dd
      const lines = this.bodyLines.slice();
      const at = this.curLine;
      lines.splice(at, 1);
      if (!lines.length) lines.push('');               // never leave a bodyless note (no rows to stand on)
      this.setLines(lines);
      this.$nextTick(() => { this.curLine = Math.min(at, this.bodyLines.length - 1); this.curCol = Math.min(this.goalCol, (this.bodyLines[this.curLine] || '').length); });
    },
    deleteToEol() {                                    // D
      const lines = this.bodyLines.slice();
      lines[this.curLine] = (lines[this.curLine] || '').slice(0, this.curCol);
      this.setLines(lines);
    },
    deleteWord() {                                     // dw — cursor → next word start (or EOL)
      const lines = this.bodyLines.slice();
      const text = lines[this.curLine] || '';
      const rest = text.slice(this.curCol);
      const m = rest.match(/^\s*\S+\s*/);              // this word + trailing space
      const cut = m ? m[0].length : rest.length;
      lines[this.curLine] = text.slice(0, this.curCol) + rest.slice(cut);
      this.setLines(lines);
    },
    replaceChar(ch) {                                  // r<char>
      const lines = this.bodyLines.slice();
      const text = lines[this.curLine] || '';
      if (!text.length) return;
      const col = Math.min(this.curCol, text.length - 1);
      lines[this.curLine] = text.slice(0, col) + ch + text.slice(col + 1);
      this.setLines(lines);
    },
    openLine(below) {                                  // o / O — new line, then insert on it
      const lines = this.bodyLines.slice();
      const at = this.curLine + (below ? 1 : 0);
      lines.splice(at, 0, '');
      this.setLines(lines);
      this.$nextTick(() => { this.curLine = at; this.curCol = 0; this.goalCol = 0; this.enterInsert('i'); });
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
    // the block cursor only exists while the ladder is IN the body — on a field row the
    // whole note renders as markdown and the kfocus highlight marks the field instead
    isActive(seg) { return this.onBody && seg.start <= this.curLine && this.curLine < seg.end; },
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
    scrollCursor() {
      this.$nextTick(() => {
        const cur = this.$el && this.$el.querySelector('.nb-cursor');
        if (!cur) return;
        // t_0501: scrollIntoView({block:'nearest'}) didn't move the nested .note-render pane
        // (the cursor rode down inside one tall raw block while scrollTop stayed 0). So walk up
        // to the actual scroll container and drive its scrollTop, keeping the cursor `pad` px
        // clear of the top/bottom edges.
        let box = cur.parentElement;
        while (box) {
          const oy = getComputedStyle(box).overflowY;
          if ((oy === 'auto' || oy === 'scroll') && box.scrollHeight > box.clientHeight) break;
          box = box.parentElement;
        }
        if (!box) return;
        const c = cur.getBoundingClientRect(), b = box.getBoundingClientRect(), pad = 40;
        if (c.top < b.top + pad) box.scrollTop -= (b.top + pad) - c.top;
        else if (c.bottom > b.bottom - pad) box.scrollTop += c.bottom - (b.bottom - pad);
      });
    },
    // keys routed from the app's global handler (so they inherit its modal/typing gate)
    onKey(e) {
      if (this.editing) {
        // insert mode types into the textarea (the global handler already returned on typing);
        // Esc out of it is onBodyKey's job, so it can write the file + carry the caret back
        if (this.mode === 'insert') return;
        this.kbKey(e);            // nav: KbForm drives the ladder, kbDelegate owns the body rows
        return;
      }
      // ---- list mode ----
      // h leaves left into the notes nav, like the task list does (audit n.9)
      if (e.key === 'h' || e.key === 'ArrowLeft') { e.preventDefault(); this.$emit('enter-nav'); return; }
      // i drops into the quick-add bar, like i does on the tasks list (audit n.14). ABOVE the
      // empty-list guard — you must be able to make the FIRST note in an empty list.
      if (e.key === 'i') { e.preventDefault(); this.focusAdd(); return; }
      // f = find text in THIS view (n.15); coming back to it keeps the last term. Both of these
      // sit above the empty-list guard: a find that matched nothing is exactly when you need to
      // get back into the box or clear it.
      if (e.key === 'f') { e.preventDefault(); this.focusFind(); return; }
      // the second Esc — the first one (in the box) only committed the find so j/k could walk
      // the hits. This is the global find's clearSearch, scoped to the notes list.
      if (e.key === 'Escape' && this.q) { e.preventDefault(); this.clearFind(); return; }
      const rows = this.rows;
      if (!rows.length) return;
      if (e.key === 'j' || e.key === 'ArrowDown') { e.preventDefault(); this.listSel = Math.min(rows.length - 1, this.listSel + 1); this.scrollListSel(); }
      else if (e.key === 'k' || e.key === 'ArrowUp') { e.preventDefault(); this.listSel = Math.max(0, this.listSel - 1); this.scrollListSel(); }
      // ↵ / o = go IN (the full editor) · e = PEEK (the right-hand drawer, §4.3) — the same
      // split the task list uses, and the drawer's own `o` promotes a peek to the full editor.
      else if (e.key === 'Enter' || e.key === 'o') { e.preventDefault(); const n = rows[this.listSel]; if (n) this.open(n.id); }
      else if (e.key === 'e') { e.preventDefault(); this.peek(rows[this.listSel]); }
      // d deletes the highlighted note — the same one-key delete tasks get from their list
      else if (e.key === 'd') { e.preventDefault(); this.delRow(rows[this.listSel]); }
    },
    async delRow(n) {
      if (!n) return;
      if (await this.store.askConfirm('Delete "' + (n.title || 'this note') + '"?')) {
        await this.store.deleteNote(n.id);
        await this.load();
        this.listSel = Math.max(0, Math.min(this.listSel, this.rows.length - 1));
      }
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
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.commitAndNormal(); return; } // esc writes + renders
      if (e.key === 'Enter' && !e.shiftKey) this.continueList(e);   // bullets/numbers/checkboxes (n.4)
    },
    // Enter on a list line carries the leader down: same indent, same bullet (checkbox → a fresh
    // UNCHECKED one), ordered → n+1. On an EMPTY leader, Enter strips it instead — that's how you
    // end a list. Headings are NOT continued (`## ` on the next line is never what you want).
    continueList(e) {
      const ta = this.$refs.bodyArea;
      if (!ta || ta.selectionStart !== ta.selectionEnd) return;
      const pos = ta.selectionStart;
      const body = this.draft.body;
      const lineStart = body.lastIndexOf('\n', pos - 1) + 1;
      const line = body.slice(lineStart, pos);
      const m = line.match(/^(\s*)(?:([-*+])|(\d+)\.)\s+(\[[ xX]\]\s+)?/);
      if (!m) return;
      const [lead, indent, bullet, num, box] = [m[0], m[1], m[2], m[3], m[4]];
      e.preventDefault();
      // nothing after the leader → the user is ending the list: drop the leader
      if (line.length === lead.length) {
        this.draft.body = body.slice(0, lineStart) + body.slice(pos);
        this.$nextTick(() => { ta.focus(); ta.setSelectionRange(lineStart, lineStart); });
        return;
      }
      const next = '\n' + indent + (bullet ? bullet : String(Number(num) + 1) + '.') + ' ' + (box ? '[ ] ' : '');
      this.draft.body = body.slice(0, pos) + next + body.slice(pos);
      this.$nextTick(() => { ta.focus(); const c = pos + next.length; ta.setSelectionRange(c, c); this.detectLink(); });
    },
    openWikilink(el) {
      const type = el.getAttribute('data-type');
      if (type) { this.openEntity(type, el.getAttribute('data-id')); return; }
      // a readable id the renderer couldn't resolve: deleted, or someone else's item
      const rid = el.getAttribute('data-rid');
      if (rid) { this.store.toast(rid + ' not found'); return; }
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
        this.persist();                 // quiet save — the note always exists by now
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
    // the wire payload — labels + reviewAt included, or a save from here would look like a
    // patch that leaves them behind (the drawer sets them; the full editor must too)
    payload(title) {
      return { id: this.sel?.id, title, body: this.draft.body, folderId: this.draft.folderId,
        reviewAt: this.draft.reviewAt || null, labels: [...this.draft.labels] };
    },
    async persist() {           // quiet save (checkbox toggles); needs an existing note
      if (!this.sel) return;
      const n = await this.store.saveNote(this.payload(this.draft.title.trim() || this.sel.title));
      if (n) { this.sel = n; this.draft = this.seed(n); this.saved = this.seed(n); }
    },
    async save() {
      const title = this.draft.title.trim();
      // not a create guard any more (the quick-add takes the name up front) — this catches a
      // rename to blank, which would otherwise hand the vault an empty filename
      if (!title) { this.store.toast('a note needs a name'); return; }
      const n = await this.store.saveNote(this.payload(title));
      if (n) {
        this.sel = n;
        this.draft = this.seed(n);
        this.saved = this.seed(n);
        // an edit can change whether the note still matches the view (labels, review date,
        // folder, title text) — refresh the match set, not just the list
        await Promise.all([this.load(), this.refilter()]);
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
    back() {
      this.sel = null; this.mode = 'normal';
      this.draft = newDraft(); this.saved = newDraft();   // (the old reset dropped folderId — it lied about being clean)
      this.resetCursor();
      this.kbRow = 0;
      this.load();
    },
    async sync() {
      const s = await this.store.syncNotes();
      if (s) { await this.load(); this.store.toast(`synced · ${s.updated} updated · ${s.tombstoned} removed`); }
    },
  },
  template: `
  <div class="notes">
    <!-- The header is the LIST's chrome: the tasks quick-add bar, inline (n.14). A note is
         CREATED here — title first — so the editor only ever opens on a note that exists. The
         old "＋ new" opened the editor on a phantom note, which is what made Esc a dead key.
         §6.2: the editor's own controls all live in its bottom action row, so it needs no head. -->
    <div v-if="!editing" class="notes-head">
      <span class="qbtn" @click="sync" title="reconcile external edits">sync</span>
      <div class="quickadd qa-inline">
        <span class="prompt" :class="{ warn }" :data-tip="warnTip">{{ warn ? '⚠' : '+' }}</span>
        <span class="qa-caret">❯</span>
        <span class="qa-input-wrap">
          <input ref="qa" data-testid="note-quickadd" v-model="qaDraft" :placeholder="addPlaceholder"
                 @keydown.enter.prevent="commitAdd" @keydown.esc.stop.prevent="escAdd"
                 @keydown.tab="acceptTag" @keydown.right="acceptTag" />
          <!-- ghost-completion for the trailing token (#tag · /folder · $date) — the same
               overlay tasks use: a transparent copy of the draft pushes the grey suffix to
               the caret, so no measurement code is needed (both layers are mono). -->
          <span v-if="tagGhost" class="qa-ghost" aria-hidden="true"><span class="qa-ghost-pre">{{ qaDraft }}</span>{{ tagGhost }}<span class="qa-ghost-hint"> →</span></span>
        </span>
        <span class="mut" style="font-size:11px;">↵ add</span>
      </div>
      <!-- find (n.15): scoped to the current folder/view. The "f" hint has to be an overlay —
           a placeholder attribute can't carry markup, so it can't underline anything. Same
           trick as the quick-add's tag ghost: a span painted over an empty, unfocused input. -->
      <div class="notes-find">
        <input ref="find" class="ti notes-search" v-model="q" @input="runSearch"
               @keydown.enter.stop.prevent="commitFind" @keydown.esc.stop.prevent="commitFind">
        <span v-if="!q" class="notes-find-ph"><u>f</u>ind text…</span>
      </div>
    </div>

    <div v-if="!editing" class="notes-list">
      <div v-if="!rows.length" class="mut notes-empty">no notes yet — press <span class="kbd">i</span> to name one, or drop .md files in the vault and hit sync</div>
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

    <div v-else class="note-editor" data-testid="note-editor">
      <input ref="titleInput" class="ti note-title" data-testid="note-title" :class="navCls('title')" v-model="draft.title"
             placeholder="note name (this is the filename)" @focus="kbFocusRow('title')"
             @keydown.enter="save" @keydown.esc.stop.prevent="blurField">
      <div v-if="store.folders.length || store.rootFolder()" class="note-folder-row" :class="navCls('folder')">
        <span class="ev-rl">folder</span>
        <select ref="folderSel" class="ti" v-model="draft.folderId"
                @focus="kbFocusRow('folder')" @keydown.esc.stop.prevent="blurField">
          <!-- null IS the vault root on the wire; the base directory just gives it a name (n.16) -->
          <option :value="null">{{ baseName }}</option>
          <option v-for="f in store.folders" :key="f.id" :value="f.id">{{ f.glyph }} {{ f.name }}</option>
        </select>
      </div>
      <div v-if="store.sortedLabels().length" class="note-meta-row">
        <span class="ev-rl">labels</span>
        <div class="labelpick">
          <span v-for="(l,i) in store.sortedLabels()" :key="l.id" class="chip"
                :class="[{ on: draft.labels.includes(l.id) }, navCls('labels', i)]" @click="kbPick('labels', i)">#{{ l.name }}</span>
        </div>
      </div>
      <div class="note-meta-row" :class="navCls('review')">
        <span class="ev-rl">review date</span>
        <input ref="reviewInput" class="ti note-date" type="date" v-model="draft.reviewAt"
               @focus="kbFocusRow('review')" @keydown.enter="save" @keydown.esc.stop.prevent="blurField">
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
      <div v-if="sel" :class="navCls('links')" class="note-links-row">
        <linked-items ref="links" :store="store" type="note" :id="sel.id"
                      :kb-focus="linkFocus" :add-focus="addLinkFocus" @links="linkList = $event" @pick="kbPick('links', $event)"></linked-items>
      </div>
      <div class="note-actions">
        <div class="na-left">
          <!-- the hint counts the ESCAPES it takes to get back from where you are: from insert,
               the first Esc commits + hands back the ladder, the second leaves the note -->
          <button class="btn" :class="navCls('back')" @click="closeEditor" title="Back to the notes list (esc)">back <span class="mut">{{ mode==='insert' ? '⎋⎋' : '⎋' }}</span></button>
          <button class="btn" :class="navCls('mode')" @click="toggleMode">{{ mode==='insert' ? 'render' : 'edit' }} <span class="mut">{{ mode==='insert' ? '⎋' : 'i' }}</span></button>
        </div>
        <span class="note-wordcount mut" :title="charCount + ' characters'">{{ wordCount }} word{{ wordCount === 1 ? '' : 's' }}</span>
        <button v-if="sel" class="btn danger" :class="navCls('delete')" @click="del"><span><u>d</u>elete</span></button>
        <button class="btn primary" :class="navCls('save')" @click="save">save ↵</button>
      </div>
    </div>
  </div>`,
};
