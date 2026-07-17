/* search-list.js — the '/' cross-type find results (2E §3.4). A throwaway, text-only
   live find across tasks + events + notes (NOT the query system). Mirrors mixed-list's
   presentation: each hit shows its app's deep-nav type icon; acting on a hit opens that
   type's existing surface (task detail drawer · event editor · full notes nav) until the
   §4 per-type drawers land. Driven by store.searchTerm → store.runSearch → searchResults. */
const SEARCH_ICON = { task: 'tasks', event: 'events', note: 'notes' };

window.SearchList = {
  props: ['store'],
  data() { return { sel: 0, _t: null }; },
  computed: {
    items() { return this.store.searchResults; },
    term() { return (this.store.searchTerm || '').trim(); },
  },
  watch: {
    // debounce the live find as the term changes (the footer input is v-model'd to it)
    'store.searchTerm'() {
      clearTimeout(this._t);
      this.sel = 0;
      this._t = setTimeout(() => this.store.runSearch(), 140);
    },
  },
  mounted() { this.store.runSearch(); },           // honor a term carried over from a prior '/'
  beforeUnmount() { clearTimeout(this._t); },
  methods: {
    iconFor(type) { return (window.Icons && window.Icons[SEARCH_ICON[type]]) || ''; },
    metaFor(it) {
      if (it.type === 'task') return it.due ? 'due ' + it.due : '';
      if (it.type === 'event') return (it.date || (it.startAt || '').slice(0, 10)) || '';
      if (it.type === 'note') return (it.updatedAt || '').slice(0, 10);
      return '';
    },
    openItem(it) {
      if (it.type === 'task') { this.store.selectTask(it.id); }
      else if (it.type === 'event') { this.store.openEvent(it.id); }
      else if (it.type === 'note') { this.store.openNoteDrawer(it.id); }   // peek drawer (§4.3)
    },
    // ---- keyboard (driven from index.html searchKey while searchActive) ----
    kbMove(d) {
      if (!this.items.length) return;
      this.sel = Math.max(0, Math.min(this.items.length - 1, this.sel + d));
      this.$nextTick(() => {
        const el = this.$el && this.$el.querySelector('.mixed-row.sel');
        if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' });
      });
    },
    kbActivate() { const it = this.items[this.sel]; if (it) this.openItem(it); },
  },
  template: `
  <div class="list-wrap mixed-list" ref="scroll">
    <template v-if="items.length">
      <div v-for="(it,i) in items" :key="it.type+':'+it.id"
           class="mixed-row" :class="{ sel: i===sel }" @click="openItem(it)">
        <span class="mx-ico" v-html="iconFor(it.type)"></span>
        <span class="mx-title">{{ it.title || '(untitled)' }}</span>
        <span v-if="metaFor(it)" class="mx-meta mut">{{ metaFor(it) }}</span>
      </div>
    </template>
    <div v-else class="empty">
      <pre>  ┌─────────────┐
  │  find        │
  └─────────────┘</pre>
      <div v-if="term" style="margin-top:10px;">no matches for "{{ term }}".</div>
      <div v-else style="margin-top:10px;">type to find across tasks · events · notes…</div>
    </div>
  </div>
  `,
};
