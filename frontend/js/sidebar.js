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
        <span class="count">{{ store.queryCount(sv.query) }}</span>
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
    catRoots(){ return this.store.catRoots(this.catKind); }
  },
  methods: {
    glyphColor(sv){ return sv.color ? this.store.resolveColor(sv.color) : (sv.system ? '' : 'var(--amber)'); },
    isLabelView(l){ return this.store.view.kind==='query' && this.store.view.query==='label:'+l.name+' status:open'; },
    labelCount(l){ return this.store.queryCount('label:'+l.name+' status:open'); },
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
