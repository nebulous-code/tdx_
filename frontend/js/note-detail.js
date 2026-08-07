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
  mixins: [window.KbForm, window.LabelPickable],
  data() {
    return {
      f: { id: null, title: '', body: '', folderId: null, reviewAt: '', labels: [], readableId: null },
      _orig: '',
      loaded: false,
      kbAutofocus: false,   // editing an existing note → start in nav mode, not in the title
      linkList: [],         // links emitted up by <linked-items> ($refs isn't reactive) — n.13
      // version history sub-panel (vault version control)
      historyOpen: false,
      versions: [],
      histSel: 0,
      diffRows: [],
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
      this.labelsExpanded = false;   // labels collapse by default when the drawer swaps notes (J/K, wikilink)
      this.linkList = [];
      this.load().then(() => this.$nextTick(() => this.kbInit()));
    },
  },
  computed: {
    // which link chip the cursor is on → <linked-items :kb-focus> (the child renders the chips) — n.13
    linkFocus() { return this.kbCellOf('links'); },
    addLinkFocus() { return !!this.kbCls('addlink').kfocus; },
    // the "no folder" option's label: the base directory's name when it has one (n.16)
    baseName() { const r = this.store.rootFolder(); return r ? r.glyph + ' ' + r.name : '— none (root) —'; },
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
      return [
        { id: 'title', type: 'input', ref: 'title' },
        // must track the row's v-if exactly, or the ladder points at a row that isn't there
        { id: 'folder', type: 'input', ref: 'folder', when: () => this.store.folders.length > 0 || !!this.store.rootFolder() },
        { id: 'review', type: 'input', ref: 'review' },
        ...this.labelRows(),
        { id: 'notes', type: 'input', ref: 'notes' },   // ref → md-field.focus() (i edits)
        // links = a grid row, like labels: j/k skip it, h/l cross the chips, space opens (n.13)
        { id: 'links', type: 'grid', items: this.linkList, cols: 99,
          select: (l) => this.$refs.links && this.$refs.links.open(l), when: () => this.linkList.length > 0 },
        // always available (the grid row disappears when there are no links) — n.13 follow-up
        { id: 'addlink', type: 'input', ref: 'links', when: () => !!this.f.id },   // i/space → linked-items.focus()
        { id: 'history', type: 'button', activate: () => this.openHistory(), when: () => !!this.f.id },
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
      // while the history sub-panel owns the drawer: j/k walk versions, r/Enter restore, esc closes it
      if (this.historyOpen) {
        if (e.key === 'Escape') { e.preventDefault(); this.closeHistory(); return true; }
        if (e.key === 'j' || e.key === 'ArrowDown') { e.preventDefault(); this.selectVersion(this.histSel + 1); return true; }
        if (e.key === 'k' || e.key === 'ArrowUp') { e.preventDefault(); this.selectVersion(this.histSel - 1); return true; }
        if (e.key === 'r' || e.key === 'Enter') { e.preventDefault(); this.doRestore(); return true; }
        return true; // swallow everything else while the panel is up
      }
      if (e.key !== 'o' && e.key !== 'J' && e.key !== 'K') return false;
      const a = document.activeElement, tag = (a && a.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return false;
      e.preventDefault();
      if (e.key === 'o') this.openFull();
      else this.store.listSwap(e.key === 'J' ? 1 : -1);
      return true;
    },
    blurField() { const a = document.activeElement; if (a && a.blur) a.blur(); },
    labelIds() { return this.f.labels; },   // LabelPickable binds the picker to this array
    async save() {
      const t = this.f.title.trim(); if (!t) return;
      const ok = await this.store.saveNote({
        id: this.f.id, title: t, body: this.f.body,
        folderId: this.f.folderId || null, reviewAt: this.f.reviewAt || null, labels: [...this.f.labels],
      });
      if (ok) { this._orig = JSON.stringify(this.snap()); this.$emit('close'); }
    },
    openFull() { const id = this.f.id; this.store.noteDetailOpen = false; if (id) this.store.openNote(id); },
    // ---- version history (vault version control) ----
    async openHistory() {
      if (!this.f.id) return;
      this.versions = (await this.store.getNoteHistory(this.f.id)) || [];
      this.historyOpen = true;
      this.histSel = 0;
      if (this.versions.length) this.selectVersion(0); else this.diffRows = [];
    },
    closeHistory() { this.historyOpen = false; },
    async selectVersion(i) {
      if (!this.versions.length) return;
      this.histSel = Math.max(0, Math.min(this.versions.length - 1, i));
      const res = await this.store.getNoteVersion(this.f.id, this.versions[this.histSel].ref);
      const oldBody = this.stripFrontmatter((res && res.text) || '');
      this.diffRows = window.LineDiff ? window.LineDiff.diff(oldBody, this.f.body) : [];
    },
    async doRestore() {
      const v = this.versions[this.histSel]; if (!v) return;
      if (!(await this.store.askConfirm('Restore this version? A new version is saved on top (reversible).'))) return;
      const note = await this.store.restoreNoteVersion(this.f.id, v.ref);
      if (note) { this.closeHistory(); await this.load(); this.$nextTick(() => this.kbInit()); this.store.toast('↩ restored version'); }
    },
    stripFrontmatter(raw) { const m = (raw || '').match(/^---\n[\s\S]*?\n---\n?/); return m ? raw.slice(m[0].length).replace(/^\n/, '') : (raw || ''); },
    fmtTime(iso) { try { return new Date(iso).toLocaleString(); } catch (e) { return iso; } },
  },
  template: `
  <div class="detail">
    <div class="detail-head">
      <span class="mut">note</span>
      <span v-if="f.readableId" class="cy">{{ f.readableId }}</span>
      <span class="x" @click="kbAttemptClose" title="Close (esc)">✕</span>
    </div>

    <div v-if="loaded && !historyOpen" class="detail-body">
      <input ref="title" class="d-title" :class="kbCls('title')" v-model="f.title" placeholder="note name" @focus="kbFocusRow('title')" @keydown.enter.stop.prevent="save" @keydown.esc.stop.prevent="blurField">

      <div class="row2">
        <div v-if="store.folders.length || store.rootFolder()" class="field">
          <label>folder</label>
          <select ref="folder" class="input" :class="kbCls('folder')" v-model="f.folderId" @focus="kbFocusRow('folder')" @keydown.esc.stop.prevent="blurField">
            <!-- null IS the vault root on the wire; the base directory just gives it a name (n.16) -->
            <option :value="null">{{ baseName }}</option>
            <option v-for="fd in store.folders" :key="fd.id" :value="fd.id">{{ fd.glyph }} {{ fd.name }}</option>
          </select>
        </div>
        <div class="field" :class="kbCls('review')">
          <label>review date</label>
          <input ref="review" class="input" type="date" v-model="f.reviewAt" @focus="kbFocusRow('review')" @keydown.enter.stop.prevent="save" @keydown.esc.stop.prevent="blurField">
        </div>
      </div>

      <div class="field">
        <label>labels</label>
        <label-picker :store="store" :selected="f.labels" :expanded="labelsExpanded"
          :kb-focus="kbCellOf('labels')" :add-focus="addLabelFocus()" :toggle-focus="labelToggleFocus()"
          @pick="kbPick('labels', $event)" @add="addLabel" @toggle="toggleLabels" @remove="toggleLabel"></label-picker>
      </div>

      <div class="field">
        <label>notes</label>
        <md-field ref="notes" :class="kbCls('notes')" v-model="f.body" placeholder="note body…" @submit="save"></md-field>
      </div>

      <div class="field" v-if="f.id">
        <linked-items ref="links" :store="store" type="note" :id="f.id"
                      :kb-focus="linkFocus" :add-focus="addLinkFocus" @links="linkList = $event" @pick="kbPick('links', $event)"></linked-items>
      </div>
    </div>
    <div v-if="!loaded" class="detail-body"><span class="mut">loading…</span></div>

    <div v-if="loaded && historyOpen" class="detail-body hist-panel">
      <div class="hist-head"><span class="mut">version history</span><span class="x" @click="closeHistory" title="Close (esc)">✕</span></div>
      <div v-if="!versions.length" class="mut" style="padding:8px 0;">no saved versions yet — history appears once the vault backup has run.</div>
      <template v-else>
        <div class="hist-versions">
          <div v-for="(v,i) in versions" :key="v.ref" class="hist-row" :class="{on:i===histSel}" @click="selectVersion(i)">
            <span class="hist-time">{{ fmtTime(v.timestamp) }}</span>
            <span class="mut hist-msg">{{ v.message }}</span>
          </div>
        </div>
        <div class="hist-diff">
          <div v-if="!diffRows.length" class="mut">no differences from the current note.</div>
          <div v-for="(d,i) in diffRows" :key="i" class="hd" :class="'hd-'+d.op">{{ d.op==='add' ? '+' : d.op==='del' ? '−' : ' ' }} {{ d.line }}</div>
        </div>
        <div class="mut hist-hint">j/k version · r restore · esc close</div>
      </template>
    </div>

    <div class="d-actions">
      <button v-if="f.id" class="btn" :class="kbCls('history')" @click="openHistory" title="Version history">history</button>
      <button class="btn" :class="kbCls('openFull')" style="margin-right:auto;" @click="openFull" title="Open in the full editor (o)"><span><u>o</u>pen fully</span></button>
      <button class="btn" :class="kbCls('cancel')" @click="kbAttemptClose">cancel</button>
      <button class="btn primary" :class="kbCls('save')" @click="save">save ↵</button>
    </div>
  </div>`,
};
