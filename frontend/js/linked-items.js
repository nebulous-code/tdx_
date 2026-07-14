/* linked-items.js — D2 2d slice 5: one shared cross-link UI for the task / event /
   note detail views. Shows every link touching the entity as a chip (type + title),
   click → opens the right entity type, and a "+ link" picker that links any allowed
   cross-type entity. App-asserted links carry an unlink ✕; links derived from a
   note's [[wikilink]] (source:'content') show a ↟ marker instead — edit the note to
   change those. Replaces the per-view minimal pickers. Props: store, type, id. */

window.LinkedItems = {
  // kbFocus = which chip the HOST's keyboard cursor is on (-1 = not on the links row). The links
  // row lives in the host's kbRows() (that's where KbForm is), but the chips render here — so the
  // host tells us which one is focused, and we tell the host what we've loaded (audit n.13).
  props: { store: Object, type: String, id: String, kbFocus: { type: Number, default: -1 } },
  // 'links' is NOT decoration: $refs is not reactive, so a host's kbRows() reading
  // $refs.links.links would run before we mount, see undefined, emit ZERO nav rows, and — having
  // registered no dependency — never recompute. Emitting into host state is what makes it work.
  emits: ['links', 'pick'],
  data() { return { links: [], query: '', events: [], notes: [] }; },
  computed: {
    pickTypes() { return ['task', 'event', 'note'].filter((t) => t !== this.type); },
    candidates() {
      const q = this.query.trim().toLowerCase();
      if (!q) return [];
      const linked = new Set(this.links.map((l) => l.other.id));
      const out = [];
      const add = (type, id, title) => {
        if (out.length < 8 && !linked.has(id) && (title || '').toLowerCase().includes(q)) out.push({ type, id, title });
      };
      if (this.type !== 'task') for (const t of this.store.tasks) { if (!t.archived) add('task', t.id, t.title); }
      if (this.type !== 'event') for (const e of this.events) add('event', e.id, e.title);
      if (this.type !== 'note') for (const n of this.notes) { if (n.id !== this.id) add('note', n.id, n.title); }
      return out;
    },
  },
  watch: { id() { this.load(); } },
  mounted() { this.load(); },
  methods: {
    async load() {
      this.links = this.type && this.id ? await this.store.fetchLinks(this.type, this.id) : [];
      this.$emit('links', this.links);   // → the host's reactive copy, which its kbRows() reads
    },
    // pull the picker's candidate lists when the user opens the picker (refreshed each
    // focus so newly-created events/notes show up without a reload)
    ensureSources() {
      if (this.type !== 'event') this.store.fetchEventList().then((e) => { this.events = e; });
      if (this.type !== 'note') this.store.fetchNotes().then((n) => { this.notes = n; });
    },
    open(l) {
      const o = l.other;
      if (o.type === 'task') { this.store.selectedTaskId = o.id; this.store.detailOpen = true; }
      else if (o.type === 'event') { this.store.openEvent(o.id); }
      else if (o.type === 'note') { this.store.openNoteDrawer(o.id); }   // peek in place (§4.3)
    },
    async pick(c) {
      if (await this.store.createLink({ type: this.type, id: this.id }, { type: c.type, id: c.id })) {
        this.query = '';
        await this.load();
      }
    },
    async unlink(l) { if (await this.store.deleteLink(l.id)) await this.load(); },
    // public — a host's KbForm `i`/space on its "links" row lands here (mirrors md-field.focus())
    focus() { const el = this.$refs.add; if (el && el.focus) el.focus(); },
    // Esc out of the picker → back to the host's ladder. Must live on the field: the app's global
    // onKey returns at its typing gate before routing to the host, so the key never reaches KbForm.
    blur() { this.query = ''; const el = this.$refs.add; if (el && el.blur) el.blur(); },
  },
  template: `
  <div class="linkbox">
    <div class="linkbox-h mut">links</div>
    <div class="link-chips">
      <span v-for="(l,i) in links" :key="l.id" class="link-chip" :class="{ kfocus: i === kbFocus }"
            @click="$emit('pick', i)" :title="l.other.type + ': ' + l.other.title">
        <span class="lc-type mut">{{ l.other.type }}</span>{{ l.other.title }}
        <span v-if="l.source==='app'" class="lc-x" @click.stop="unlink(l)" title="unlink">✕</span>
        <span v-else class="lc-src mut" title="from a note’s [[link]] — edit the note to change">↟</span>
      </span>
      <span v-if="!links.length" class="mut lc-empty">none yet</span>
    </div>
    <div class="link-add">
      <input ref="add" v-model="query" class="ti" @focus="ensureSources" @keydown.esc.stop.prevent="blur"
             :placeholder="'＋ link a ' + pickTypes.join(' / ') + '…'">
      <div v-if="candidates.length" class="ev-link-menu">
        <div v-for="c in candidates" :key="c.type + c.id" class="ev-link-opt" @click="pick(c)" :title="c.title"><span class="lc-type mut">{{ c.type }}</span>{{ c.title }}</div>
      </div>
    </div>
  </div>`,
};
