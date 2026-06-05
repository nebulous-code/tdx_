/* sidebar.js — smart views + project/subproject tree */
window.AppSidebar = {
  props: ['store'],
  template: `
  <aside class="sidebar" :class="{ open: store.sidebarOpen }">

    <!-- smart views (saved queries) -->
    <div class="side-section">
      <div class="side-head">
        <span>views</span><span class="ln"></span>
        <span class="add" title="New query view" @click="$emit('new-query')">+</span>
      </div>
      <div v-for="sv in store.savedQueries" :key="sv.id"
           class="nav-item"
           :class="{ active: store.view.kind==='query' && store.view.id===sv.id }"
           @click="store.openQueryView(sv)"
           @contextmenu.prevent="maybeDelete(sv)">
        <span class="glyph" :style="{color: glyphColor(sv)}">{{ sv.glyph }}</span>
        <span class="label">{{ sv.name }}</span>
        <span class="count">{{ store.queryCount(sv.query) }}</span>
      </div>
    </div>

    <!-- project tree -->
    <div class="side-section">
      <div class="side-head">
        <span>projects</span><span class="ln"></span>
        <span class="add" title="New project" @click="$emit('new-project', null)">+</span>
      </div>
      <template v-for="p in roots" :key="p.id">
        <tree-row :store="store" :project="p" :depth="0"
                  @new-sub="$emit('new-project', $event)"
                  @edit="$emit('edit-project', $event)"></tree-row>
      </template>
    </div>

    <!-- labels -->
    <div class="side-section">
      <div class="side-head"><span>labels</span><span class="ln"></span></div>
      <div v-for="l in store.labels" :key="l.id"
           class="nav-item"
           :class="{ active: isLabelView(l) }"
           @click="openLabel(l)">
        <span class="glyph mut">#</span>
        <span class="label">{{ l.name }}</span>
        <span class="count">{{ labelCount(l) }}</span>
      </div>
    </div>
  </aside>
  `,
  computed: {
    roots(){ return this.store.projects.filter(p=>!p.parentId); }
  },
  methods: {
    glyphColor(sv){ return sv.system ? '' : 'var(--amber)'; },
    isLabelView(l){ return this.store.view.kind==='query' && this.store.view.query==='label:'+l.name+' status:open'; },
    labelCount(l){ return this.store.queryCount('label:'+l.name+' status:open'); },
    openLabel(l){
      this.store.setView({ kind:'query', id:'label_'+l.id, title:'#'+l.name, query:'label:'+l.name+' status:open' });
    },
    maybeDelete(sv){
      if(sv.system) return;
      if(confirm('Delete saved view "'+sv.name+'"?')) this.store.deleteQuery(sv);
    }
  }
};

/* recursive project row */
window.TreeRow = {
  name: 'tree-row',
  props: ['store','project','depth'],
  template: `
  <div class="tree-row">
    <div class="nav-item"
         :class="{ active: store.view.kind==='project' && store.view.id===project.id }"
         :style="{ paddingLeft: (12 + depth*14) + 'px' }"
         @click="store.openProjectView(project)"
         @contextmenu.prevent="$emit('edit', project)">
      <span v-if="kids.length" class="twist" @click.stop="project.collapsed=!project.collapsed">{{ project.collapsed ? '▸' : '▾' }}</span>
      <span v-else class="twist"> </span>
      <span class="glyph" :style="{ color: project.color }">{{ project.glyph }}</span>
      <span class="label">{{ project.name }}</span>
      <span class="add" title="Add subproject" @click.stop="$emit('new-sub', project.id)">+</span>
      <span class="count">{{ store.projectCount(project.id) }}</span>
    </div>
    <div v-if="!project.collapsed" class="tree-children">
      <tree-row v-for="c in kids" :key="c.id" :store="store" :project="c" :depth="depth+1"
                @new-sub="$emit('new-sub', $event)" @edit="$emit('edit', $event)"></tree-row>
    </div>
  </div>
  `,
  computed: {
    kids(){ return this.store.childProjects(this.project.id); }
  }
};
