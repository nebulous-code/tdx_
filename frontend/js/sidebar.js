/* sidebar.js — smart views + the per-app category tree (projects / calendars /
   folders) + labels. The middle section swaps by app (store.categoryKind). */
window.AppSidebar = {
  props: ['store'],
  template: `
  <aside class="sidebar" :class="{ open: store.sidebarOpen }">

    <!-- smart views (saved queries) -->
    <div class="side-section">
      <div class="side-head" :class="{ kfocus: store.focusPane==='side' && store.sideFocusId==='head_query' }">
        <span class="sec-toggle" @click="store.navSections.query=!store.navSections.query">{{ store.navSections.query?'▸':'▾' }} views</span>
        <span class="ln"></span>
        <span class="add" title="New query view" @click="$emit('new-query')">+</span>
      </div>
      <div v-show="!store.navSections.query" v-for="sv in store.appQueries()" :key="sv.id"
           class="nav-item"
           :class="{ active: store.view.id===sv.id, kfocus: store.focusPane==='side' && store.sideFocusId===sv.id, moving: store.moveId===sv.id }"
           @click="store.openQueryView(sv)"
           @contextmenu.prevent="$emit('edit-query', sv)">
        <span class="glyph" :style="{color: glyphColor(sv)}">{{ sv.glyph }}</span>
        <span class="label">{{ sv.name }}</span>
        <span v-if="sv.pinned" class="pin-mark" title="pinned to header">✦</span>
        <span class="add" title="Delete view (x)" @click.stop="$emit('delete-query', sv)">✕</span>
        <span class="add" title="Edit view (e)" @click.stop="$emit('edit-query', sv)">›</span>
        <span v-if="store.viewCountable(sv)" class="count">{{ store.queryCount(sv.query) }}</span>
      </div>
    </div>

    <!-- category tree (projects / calendars / folders, per app) -->
    <div class="side-section">
      <div class="side-head" :class="{ kfocus: store.focusPane==='side' && store.sideFocusId==='head_'+catKind }">
        <span class="sec-toggle" @click="store.navSections[catKind]=!store.navSections[catKind]">{{ store.navSections[catKind]?'▸':'▾' }} {{ catLabel }}</span>
        <span class="ln"></span>
        <span class="add" :title="'New '+catKind" @click="$emit('new-'+catKind, null)">+</span>
      </div>
      <div v-show="!store.navSections[catKind]">
        <!-- the vault's base directory (n.16): the top of the vault, shown as a folder. NOT a
             <tree-row> — that carries the twist/✕/›/+ affordances, and this row has none of them:
             it can't be renamed here (it's a preference), deleted (it's the vault), or nested
             (every folder already lives inside it). The info icon is where that gets explained. -->
        <div v-if="catKind==='folder' && baseFolder" class="tree-row">
          <div class="nav-item base-row"
               :class="{ active: store.catActive('folder', baseFolder), kfocus: store.focusPane==='side' && store.sideFocusId===baseFolder.id }"
               style="padding-left:12px;" @click="store.openBaseFolder()">
            <span class="twist"> </span>
            <span class="glyph" :style="{ color: store.resolveColor(baseFolder.color) }">{{ baseFolder.glyph }}</span>
            <span class="label">{{ baseFolder.name }}</span>
            <span class="info-tip" :data-tip="baseTip" @click.stop>ⓘ</span>
          </div>
        </div>
        <!-- "all calendars" (e.10): the same shape, one section up. It isn't a calendar — it's
             the ABSENCE of a calendar filter — so it has no verbs either, and clearing the
             filter from the keyboard was impossible before this row existed (the ✕ on the
             filter chip was the only way back). -->
        <div v-if="catKind==='calendar' && allCalendars" class="tree-row">
          <div class="nav-item base-row"
               :class="{ active: allCalActive, kfocus: store.focusPane==='side' && store.sideFocusId===allCalendars.id }"
               style="padding-left:12px;" @click="store.openCalendar()">
            <span class="twist"> </span>
            <span class="glyph" :style="{ color: store.resolveColor(allCalendars.color) }">{{ allCalendars.glyph }}</span>
            <span class="label">{{ allCalendars.name }}</span>
            <span class="info-tip" :data-tip="allCalTip" @click.stop>ⓘ</span>
          </div>
        </div>
        <template v-for="node in catRoots" :key="node.id">
          <tree-row :store="store" :node="node" :kind="catKind" :depth="0"
                    @new-sub="$emit('new-'+catKind, $event)"
                    @edit="$emit('edit-'+catKind, $event)"
                    @delete="$emit('delete-'+catKind, $event)"></tree-row>
        </template>
      </div>
    </div>

    <!-- labels -->
    <div class="side-section">
      <div class="side-head" :class="{ kfocus: store.focusPane==='side' && store.sideFocusId==='head_label' }">
        <span class="sec-toggle" @click="store.navSections.label=!store.navSections.label">{{ store.navSections.label?'▸':'▾' }} labels</span>
        <span class="ln"></span>
      </div>
      <div v-show="!store.navSections.label" v-for="l in store.sortedLabels()" :key="l.id"
           class="nav-item"
           :class="{ active: isLabelView(l), kfocus: store.focusPane==='side' && store.sideFocusId===l.id }"
           @click="openLabel(l)">
        <span class="glyph mut">#</span>
        <span class="label">{{ l.name }}</span>
        <span v-if="l.pinned" class="pin-mark" title="pinned to header">✦</span>
        <span class="add" title="Delete label (x)" @click.stop="$emit('delete-label', l)">✕</span>
        <span class="add" title="Edit label (e)" @click.stop="$emit('edit-label', l)">›</span>
        <span class="count">{{ labelCount(l) }}</span>
      </div>
    </div>
  </aside>
  `,
  computed: {
    catKind(){ return this.store.categoryKind(); },
    catLabel(){ return { project:'projects', calendar:'calendars', folder:'folders' }[this.catKind]; },
    catRoots(){ return this.store.catRoots(this.catKind); },
    baseFolder(){ return this.store.rootFolder(); },   // null when the preference is blank → hidden
    allCalendars(){ return this.store.allCalendars(); },  // ditto (e.10)
    // "all calendars" is active when the events view carries NO calendar filter — it can't use
    // store.catActive, which matches a row id against view.calendarId (null here, by definition)
    allCalActive(){ const v = this.store.view; return v.kind==='calendar' && !v.calendarId; },
    allCalTip(){
      return 'Every calendar at once — the events app with no filter. Rename it (or blank it out to hide it) in preferences (@). It isn’t a calendar, so it can’t be renamed, deleted or reordered here.';
    },
    baseTip(){
      const b = this.baseFolder;
      if(!b) return '';
      const tip = 'The top of your vault — notes that aren’t in any folder. Rename it (or blank it out to hide it) in preferences (@). It can’t hold folders: every folder already lives inside it.';
      return b.clash
        ? tip + ' A real folder shares this name, so folder:'+Q.slug(b.name.replace(/ \(base\)$/,''))+' finds THAT folder — rename one of them.'
        : tip;
    }
  },
  methods: {
    glyphColor(sv){ return sv.color ? this.store.resolveColor(sv.color) : (sv.system ? '' : 'var(--amber)'); },
    isLabelView(l){ return this.store.view.kind==='query' && this.store.view.query==='label:'+Q.slug(l.name)+' status:open'; },
    labelCount(l){ return this.store.queryCount('label:'+Q.slug(l.name)+' status:open'); },
    openLabel(l){ this.store.openLabelView(l); }
  }
};

/* recursive category row — works for any kind (calendars are flat → no kids) */
window.TreeRow = {
  name: 'tree-row',
  props: ['store','node','kind','depth'],
  template: `
  <div class="tree-row">
    <div class="nav-item"
         :class="{ active: store.catActive(kind, node), kfocus: store.focusPane==='side' && store.sideFocusId===node.id, moving: store.moveId===node.id }"
         :style="{ paddingLeft: (12 + depth*14) + 'px' }"
         @click="store.openCatView(kind, node)"
         @contextmenu.prevent="$emit('edit', node)">
      <span v-if="kids.length" class="twist" @click.stop="node.collapsed=!node.collapsed">{{ node.collapsed ? '▸' : '▾' }}</span>
      <span v-else class="twist"> </span>
      <span class="glyph" :style="{ color: store.resolveColor(node.color) }">{{ node.glyph }}</span>
      <span class="label">{{ node.name }}</span>
      <span class="add" :title="'Delete (x)'" @click.stop="$emit('delete', node)">✕</span>
      <span class="add" title="Edit (e)" @click.stop="$emit('edit', node)">›</span>
      <span v-if="nestable" class="add" title="Add sub-item" @click.stop="$emit('new-sub', node.id)">+</span>
      <span v-if="count!==null" class="count">{{ count }}</span>
    </div>
    <div v-if="!node.collapsed" class="tree-children">
      <tree-row v-for="c in kids" :key="c.id" :store="store" :node="c" :kind="kind" :depth="depth+1"
                @new-sub="$emit('new-sub', $event)" @edit="$emit('edit', $event)"
                @delete="$emit('delete', $event)"></tree-row>
    </div>
  </div>
  `,
  computed: {
    kids(){ return this.store.catChildren(this.kind, this.node.id); },
    nestable(){ return this.kind!=='calendar'; },
    count(){ return this.store.catCount(this.kind, this.node.id); }
  }
};
