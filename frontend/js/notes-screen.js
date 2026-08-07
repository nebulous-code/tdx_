/* notes-screen.js — the notes vault settings overlay (docs/VAULT_VERSION_CONTROL.md),
   opened from the account screen's "notes" row. Two sections: an ARCHIVE review (soft-deleted
   notes — Restore, or Delete permanently with a type-the-name confirm) and configurable backup
   IGNORE RULES (extra globs + a size threshold, with a dry-run Preview). Same KbForm keyboard
   model as backup-screen.js: j/k move rows, Enter/space activates, i edits an input, Esc closes.
   On an archive row, Enter restores and `x` permanently deletes. */
window.NotesScreen = {
  props: ['store'],
  emits: ['close'],
  mixins: [window.KbForm],
  data() {
    return {
      ready: false,
      archived: [],
      globsText: '',           // newline-separated globs, edited as text
      maxKb: '',               // size threshold in KB ('' = none)
      init: { globsText: '', maxKb: '' },
      preview: null,           // { paths, truncated } or null
      previewing: false,
      busy: false,
      kbAutofocus: false,
    };
  },
  async created() { await this.load(); },
  computed: {
    dirty() { return this.ready && (this.globsText !== this.init.globsText || String(this.maxKb) !== String(this.init.maxKb)); },
    rulesPayload() {
      const globs = this.globsText.split('\n').map((g) => g.trim()).filter(Boolean);
      const kb = Number(this.maxKb);
      return { globs, maxBytes: this.maxKb !== '' && kb > 0 ? Math.round(kb * 1024) : null };
    },
  },
  template: `
  <div class="overlay" @click.self="kbAttemptClose">
    <div class="modal account-modal" style="max-width:560px;width:92vw;display:flex;flex-direction:column;max-height:84vh;">
      <div class="modal-head" style="display:flex;align-items:center;flex:0 0 auto;">
        <span style="flex:1;">notes vault</span>
        <span class="acct-x" @click="kbAttemptClose" title="close (esc)">✕</span>
      </div>
      <div class="modal-body" style="flex:1 1 auto;overflow-y:auto;">

        <div class="acct-sep">archive <span class="mut">({{ archived.length }})</span></div>
        <div class="acct-hint mut">deleted notes are recoverable from history. Restore brings one back; delete permanently scrubs every version — irreversible.</div>
        <div v-if="!ready" class="mut" style="padding:4px 0;">loading…</div>
        <div v-else-if="!archived.length" class="mut" style="padding:4px 0;">nothing archived.</div>
        <div class="notes-settings-list">
          <div v-for="a in archived" :key="a.id" class="arch-row" :class="kbCls('arch:'+a.id)">
            <span class="arch-title">{{ a.title || '(untitled)' }}</span>
            <span v-if="a.readableId" class="arch-rid">{{ a.readableId }}</span>
            <button class="btn" @click="restore(a)">restore</button>
            <button class="btn danger" @click="permanentDelete(a)">delete permanently</button>
          </div>
        </div>

        <div class="acct-sep">backup ignore rules</div>
        <div class="acct-hint mut">extra patterns the vault backup skips (on top of OS/editor cruft), plus a size cap. Keeps history lean.</div>
        <div class="acct-row" :class="kbCls('globs')" @click="$refs.globs.focus()" style="align-items:flex-start;">
          <span class="acct-label">ignore globs</span>
          <textarea ref="globs" v-model="globsText" rows="3" spellcheck="false" autocapitalize="off"
                    placeholder="one per line — e.g.  *.pdf  ·  scratch/" style="flex:1;resize:vertical;"
                    @focus="kbFocusRow('globs')"></textarea>
        </div>
        <div class="acct-row" :class="kbCls('maxBytes')" @click="$refs.maxBytes.focus()">
          <span class="acct-label">max size (KB)</span>
          <input ref="maxBytes" type="number" min="0" class="input" style="flex:1;" v-model="maxKb"
                 placeholder="blank = no cap" @focus="kbFocusRow('maxBytes')" />
        </div>
        <div class="acct-row" :class="kbCls('preview')">
          <span class="acct-label"></span>
          <button class="btn" :class="kbCls('preview')" :disabled="previewing" @click="doPreview">{{ previewing ? '…' : 'preview what these drop' }}</button>
        </div>
        <div v-if="preview" class="ignore-preview">
          <div v-if="!preview.paths.length" class="mut">nothing in the vault matches these rules.</div>
          <div v-for="p in preview.paths" :key="p">{{ p }}</div>
          <div v-if="preview.truncated" class="mut">… more (showing first 500)</div>
        </div>
      </div>
      <div class="modal-foot" style="flex:0 0 auto;justify-content:flex-end;">
        <button class="btn primary" :class="kbCls('save')" :disabled="busy" @click="saveRules">{{ busy ? '…' : 'save rules ↵' }}</button>
      </div>
    </div>
  </div>
  `,
  methods: {
    kbRows() {
      const rows = this.archived.map((a) => ({ id: 'arch:' + a.id, type: 'button', activate: () => this.restore(a) }));
      rows.push({ id: 'globs', type: 'input', ref: 'globs' });
      rows.push({ id: 'maxBytes', type: 'input', ref: 'maxBytes' });
      rows.push({ id: 'preview', type: 'button', activate: () => this.doPreview() });
      rows.push({ id: 'save', type: 'button', activate: () => this.saveRules() });
      return rows;
    },
    kbSubmit() { this.saveRules(); },
    kbDirty() { return this.dirty; },
    // `x` on an archive row = permanently delete it (Enter = restore, from kbRows.activate)
    kbDelegate(e) {
      if (e.key !== 'x' && e.key !== 'X') return false;
      const cur = this.kbCur && this.kbCur();
      if (cur && typeof cur.id === 'string' && cur.id.indexOf('arch:') === 0) {
        const a = this.archived.find((x) => 'arch:' + x.id === cur.id);
        if (a) { e.preventDefault(); this.permanentDelete(a); return true; }
      }
      return false;
    },
    async load() {
      this.archived = await this.store.fetchArchived();
      const r = await this.store.getIgnoreRules();
      this.globsText = (r.globs || []).join('\n');
      this.maxKb = r.maxBytes ? String(Math.round(r.maxBytes / 1024)) : '';
      this.init = { globsText: this.globsText, maxKb: this.maxKb };
      this.ready = true;
    },
    async reloadArchive() { this.archived = await this.store.fetchArchived(); this.$nextTick(() => this.kbInit()); },
    async restore(a) {
      const note = await this.store.unarchiveNote(a.id);
      if (note) { this.store.toast('↩ restored "' + (a.title || 'note') + '"'); await this.reloadArchive(); }
    },
    async permanentDelete(a) {
      if (!(await this.store.askConfirmTyped(a.title || ''))) return;
      const ok = await this.store.permanentDeleteNote(a.id);
      if (ok) { this.store.toast('deleted "' + (a.title || 'note') + '" permanently'); await this.reloadArchive(); }
    },
    async doPreview() {
      if (this.previewing) return;
      this.previewing = true;
      try { this.preview = await this.store.previewIgnoreRules(this.rulesPayload); }
      finally { this.previewing = false; }
    },
    async saveRules() {
      if (this.busy) return;
      this.busy = true;
      try {
        const saved = await this.store.saveIgnoreRules(this.rulesPayload);
        if (saved) {
          this.globsText = (saved.globs || []).join('\n');
          this.maxKb = saved.maxBytes ? String(Math.round(saved.maxBytes / 1024)) : '';
          this.init = { globsText: this.globsText, maxKb: this.maxKb };
          this.store.toast('✓ ignore rules saved');
        }
      } finally { this.busy = false; }
    },
  },
};
