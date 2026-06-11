/* sidebar.js — smart views + project/subproject tree */
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
      <div v-show="!store.navSections.query" v-for="sv in store.savedQueries" :key="sv.id"
           class="nav-item"
           :class="{ active: store.view.kind==='query' && store.view.id===sv.id, kfocus: store.focusPane==='side' && store.sideFocusId===sv.id, moving: store.moveId===sv.id }"
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

    <!-- project tree -->
    <div class="side-section">
      <div class="side-head" :class="{ kfocus: store.focusPane==='side' && store.sideFocusId==='head_project' }">
        <span class="sec-toggle" @click="store.navSections.project=!store.navSections.project">{{ store.navSections.project?'▸':'▾' }} projects</span>
        <span class="ln"></span>
        <span class="add" title="New project" @click="$emit('new-project', null)">+</span>
      </div>
      <div v-show="!store.navSections.project">
        <template v-for="p in roots" :key="p.id">
          <tree-row :store="store" :project="p" :depth="0"
                    @new-sub="$emit('new-project', $event)"
                    @edit="$emit('edit-project', $event)"
                    @delete="$emit('delete-project', $event)"></tree-row>
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
    roots(){ return this.store.projects.filter(p=>!p.parentId); }
  },
  methods: {
    glyphColor(sv){ return sv.color ? this.store.resolveColor(sv.color) : (sv.system ? '' : 'var(--amber)'); },
    isLabelView(l){ return this.store.view.kind==='query' && this.store.view.query==='label:'+l.name+' status:open'; },
    labelCount(l){ return this.store.queryCount('label:'+l.name+' status:open'); },
    openLabel(l){ this.store.openLabelView(l); }
  }
};

/* recursive project row */
window.TreeRow = {
  name: 'tree-row',
  props: ['store','project','depth'],
  template: `
  <div class="tree-row">
    <div class="nav-item"
         :class="{ active: store.view.kind==='project' && store.view.id===project.id, kfocus: store.focusPane==='side' && store.sideFocusId===project.id, moving: store.moveId===project.id }"
         :style="{ paddingLeft: (12 + depth*14) + 'px' }"
         @click="store.openProjectView(project)"
         @contextmenu.prevent="$emit('edit', project)">
      <span v-if="kids.length" class="twist" @click.stop="project.collapsed=!project.collapsed">{{ project.collapsed ? '▸' : '▾' }}</span>
      <span v-else class="twist"> </span>
      <span class="glyph" :style="{ color: store.resolveColor(project.color) }">{{ project.glyph }}</span>
      <span class="label">{{ project.name }}</span>
      <span class="add" title="Delete project (x)" @click.stop="$emit('delete', project)">✕</span>
      <span class="add" title="Edit project (e)" @click.stop="$emit('edit', project)">›</span>
      <span class="add" title="Add subproject" @click.stop="$emit('new-sub', project.id)">+</span>
      <span class="count">{{ store.projectCount(project.id) }}</span>
    </div>
    <div v-if="!project.collapsed" class="tree-children">
      <tree-row v-for="c in kids" :key="c.id" :store="store" :project="c" :depth="depth+1"
                @new-sub="$emit('new-sub', $event)" @edit="$emit('edit', $event)"
                @delete="$emit('delete', $event)"></tree-row>
    </div>
  </div>
  `,
  computed: {
    kids(){ return this.store.childProjects(this.project.id); }
  }
};
