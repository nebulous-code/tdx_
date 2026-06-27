/* mixed-list.js — results for a query whose `type:` spans beyond tasks (events/notes
   inline). Used on the Tasks screen via store.isMixedView(); pure-task views keep the
   instant client-side task-list. Backed by the server unified query (store.runQuery).
   Each row shows its app's deep-nav type icon.

   Act-on uses EXISTING surfaces (the §4 per-type detail drawers don't exist yet):
     task  → task detail drawer
     event → the event editor popup (store.openEvent)
     note  → full nav to the Notes app (store.openNote)
   §4 will replace the event popup / note nav with per-type drawers. */
const MX_ICON = { task: 'tasks', event: 'events', note: 'notes' };

window.MixedList = {
  props: ['store'],
  data() { return { items: [], loading: false, sel: 0, _seq: 0 }; },
  computed: {
    query() { return this.store.currentQuery(); },
  },
  watch: {
    query() { this.load(); },
  },
  mounted() { this.load(); },
  methods: {
    async load() {
      const seq = ++this._seq;
      this.loading = true;
      const items = await this.store.runQuery(this.store.currentQuery());
      if (seq !== this._seq) return;           // a newer query superseded this one
      this.items = items || [];
      this.sel = 0;
      this.loading = false;
    },
    iconFor(type) { return (window.Icons && window.Icons[MX_ICON[type]]) || ''; },
    metaFor(it) {
      if (it.type === 'task') return it.due ? 'due ' + it.due : '';
      if (it.type === 'event') return (it.date || (it.startAt || '').slice(0, 10)) || '';
      if (it.type === 'note') return (it.updatedAt || '').slice(0, 10);
      return '';
    },
    openItem(it) {
      if (it.type === 'task') { this.store.selectedTaskId = it.id; this.store.detailOpen = true; }
      else if (it.type === 'event') { this.store.openEvent(it.id); }
      else if (it.type === 'note') { this.store.openNote(it.id); }
    },
    // ---- keyboard (driven from index.html mixedKey when isMixedView) ----
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
    <div v-if="loading" class="mut" style="padding:8px 12px;">loading…</div>
    <template v-else-if="items.length">
      <div v-for="(it,i) in items" :key="it.type+':'+it.id"
           class="mixed-row" :class="{ sel: i===sel }" @click="openItem(it)">
        <span class="mx-ico" v-html="iconFor(it.type)"></span>
        <span class="mx-title">{{ it.title || '(untitled)' }}</span>
        <span v-if="metaFor(it)" class="mx-meta mut">{{ metaFor(it) }}</span>
      </div>
    </template>
    <div v-else class="empty">
      <pre>  ┌─────────────┐
  │  no results  │
  └─────────────┘</pre>
      <div style="margin-top:10px;">query returned 0 rows.</div>
    </div>
  </div>
  `,
};
