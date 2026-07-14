/* note-detail.js — the note PEEK drawer (2E §4.3). A right-hand `.detail` drawer for a
   note's metadata + light body edit, opened IN PLACE when a note link is clicked (from a
   task/event drawer, a [[wikilink]], or a mixed/search hit) so you don't lose your spot.
   `o` opens the note FULLY in the /notes editor (the rich vim editor, §6.1).

   Same surface + keyboard model as the task and event drawers: KbForm takeover (its own
   key listener; the app's onKey bails while store.noteDetailOpen). The body uses the shared
   <md-field> (render-when-not-editing / i-to-edit). Metadata (folder, labels, review date)
   is editable here without putting it in the note body. Saves via store.saveNote. */
window.NoteDetail = {
  props: ['store'],
  mixins: [window.KbForm],
  data() {
    return {
      f: { id: null, title: '', body: '', folderId: null, reviewAt: '', labels: [], readableId: null },
      _orig: '',
      loaded: false,
      kbAutofocus: false,   // editing an existing note → start in nav mode, not in the title
      linkList: [],         // links emitted up by <linked-items> ($refs isn't reactive) — n.13
    };
  },
  mounted() {
    this._unreg = this.store.registerDirty(() => this.kbDirty());
    this.load();
  },
  beforeUnmount() { if (this._unreg) this._unreg(); },
  // Re-load IN PLACE when pointed at a different note (a wikilink/mixed-row click, or a J/K list
  // swap — a.2). This replaces the :key that used to remount the component, which read as a
  // leave+enter to <Transition> and so broke the open/close slide.
  watch: {
    'store.selectedNoteId'(id) {
      if (!id) return;
      this.loaded = false;
      this.linkList = [];
      this.load().then(() => this.$nextTick(() => this.kbInit()));
    },
  },
  computed: {
    // which link chip the cursor is on → <linked-items :kb-focus> (the child renders the chips) — n.13
    linkFocus() { return this.kbCellOf('links'); },
  },
  methods: {
    async load() {
      const n = await this.store.getNote(this.store.selectedNoteId);
      if (!n) { this.$emit('close'); return; }
      this.f = {
        id: n.id, title: n.title, body: n.body,
        folderId: n.folderId || null, reviewAt: n.reviewAt || '',
        labels: [...(n.labels || [])], readableId: n.readableId,
      };
      this._orig = JSON.stringify(this.snap());
      this.loaded = true;
    },
    snap() { const f = this.f; return { title: f.title, body: f.body, folderId: f.folderId, reviewAt: f.reviewAt, labels: [...f.labels].sort() }; },
    // ---- KbForm wiring ----
    kbRows() {
      const labels = this.store.sortedLabels();
      return [
        { id: 'title', type: 'input', ref: 'title' },
        { id: 'folder', type: 'input', ref: 'folder', when: () => this.store.folders.length > 0 },
        { id: 'review', type: 'input', ref: 'review' },
        { id: 'labels', type: 'grid', items: labels, cols: 99,
          isOn: l => this.f.labels.includes(l.id), select: l => this.toggleLabel(l.id), when: () => labels.length > 0 },
        { id: 'notes', type: 'input', ref: 'notes' },   // ref → md-field.focus() (i edits)
        // links = a grid row, like labels: j/k skip it, h/l cross the chips, space opens (n.13)
        { id: 'links', type: 'grid', items: this.linkList, cols: 99,
          select: (l) => this.$refs.links && this.$refs.links.open(l), when: () => this.linkList.length > 0 },
        { id: 'openFull', type: 'button', activate: () => this.openFull() },
        { id: 'cancel', type: 'button', activate: () => this.kbAttemptClose() },
        { id: 'save', type: 'button', activate: () => this.save() },
      ];
    },
    kbSubmit() { this.save(); },
    kbDirty() { return this.loaded && JSON.stringify(this.snap()) !== this._orig; },
    // `o` = open the note fully (the rich /notes editor); J/K = walk the list underneath and swap
    // what this drawer shows, without closing it (a.2 — this drawer owns the keyboard, so the
    // app's onKey never sees J/K while it's open). Never hijack either while typing.
    kbDelegate(e) {
      if (e.key !== 'o' && e.key !== 'J' && e.key !== 'K') return false;
      const a = document.activeElement, tag = (a && a.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return false;
      e.preventDefault();
      if (e.key === 'o') this.openFull();
      else this.store.listSwap(e.key === 'J' ? 1 : -1);
      return true;
    },
    blurField() { const a = document.activeElement; if (a && a.blur) a.blur(); },
    toggleLabel(id) { const i = this.f.labels.indexOf(id); if (i >= 0) this.f.labels.splice(i, 1); else this.f.labels.push(id); },
    async save() {
      const t = this.f.title.trim(); if (!t) return;
      const ok = await this.store.saveNote({
        id: this.f.id, title: t, body: this.f.body,
        folderId: this.f.folderId || null, reviewAt: this.f.reviewAt || null, labels: [...this.f.labels],
      });
      if (ok) { this._orig = JSON.stringify(this.snap()); this.$emit('close'); }
    },
    openFull() { const id = this.f.id; this.store.noteDetailOpen = false; if (id) this.store.openNote(id); },
  },
  template: `
  <div class="detail">
    <div class="detail-head">
      <span class="mut">note</span>
      <span v-if="f.readableId" class="cy">{{ f.readableId }}</span>
      <span class="x" @click="kbAttemptClose" title="Close (esc)">✕</span>
    </div>

    <div v-if="loaded" class="detail-body">
      <input ref="title" class="d-title" :class="kbCls('title')" v-model="f.title" placeholder="note name" @focus="kbFocusRow('title')" @keydown.enter.prevent="save" @keydown.esc.stop.prevent="blurField">

      <div class="row2">
        <div v-if="store.folders.length" class="field">
          <label>folder</label>
          <select ref="folder" class="input" :class="kbCls('folder')" v-model="f.folderId" @focus="kbFocusRow('folder')" @keydown.esc.stop.prevent="blurField">
            <option :value="null">— none (root) —</option>
            <option v-for="fd in store.folders" :key="fd.id" :value="fd.id">{{ fd.glyph }} {{ fd.name }}</option>
          </select>
        </div>
        <div class="field" :class="kbCls('review')">
          <label>review date</label>
          <input ref="review" class="input" type="date" v-model="f.reviewAt" @focus="kbFocusRow('review')" @keydown.enter="save" @keydown.esc.stop.prevent="blurField">
        </div>
      </div>

      <div class="field">
        <label>labels</label>
        <div class="labelpick">
          <span v-for="(l,i) in store.sortedLabels()" :key="l.id" class="chip" :class="[{on: f.labels.includes(l.id)}, kbCls('labels', i)]" @click="kbPick('labels', i)">#{{ l.name }}</span>
        </div>
      </div>

      <div class="field">
        <label>notes</label>
        <md-field ref="notes" :class="kbCls('notes')" v-model="f.body" placeholder="note body…" @submit="save"></md-field>
      </div>

      <div class="field" v-if="f.id">
        <linked-items ref="links" :store="store" type="note" :id="f.id"
                      :kb-focus="linkFocus" @links="linkList = $event" @pick="kbPick('links', $event)"></linked-items>
      </div>
    </div>
    <div v-else class="detail-body"><span class="mut">loading…</span></div>

    <div class="d-actions">
      <button class="btn" :class="kbCls('openFull')" style="margin-right:auto;" @click="openFull" title="Open in the full editor (o)"><span><u>o</u>pen fully</span></button>
      <button class="btn" :class="kbCls('cancel')" @click="kbAttemptClose">cancel</button>
      <button class="btn primary" :class="kbCls('save')" @click="save">save ↵</button>
    </div>
  </div>`,
};
