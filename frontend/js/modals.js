/* modals.js — project editor + save-query modal */
window.ProjectModal = {
  props: ['store','model'],   // model: {mode:'new'|'edit', parentId, project}
  emits: ['close'],
  template: `
  <div class="overlay" @click.self="$emit('close')">
    <div class="modal">
      <div class="modal-head">{{ model.mode==='new' ? (model.parentId ? 'new subproject' : 'new project') : 'edit project' }}</div>
      <div class="modal-body">
        <div class="field">
          <label>name</label>
          <input ref="name" class="input" v-model="name" placeholder="project-name" @keydown.enter="save" />
        </div>
        <div v-if="model.parentId || (model.project && model.project.parentId)" class="field">
          <span class="mut" style="font-size:11px;">↳ under {{ parentName }}</span>
        </div>
        <div class="field">
          <label>color</label>
          <div class="swatches">
            <span v-for="c in store.COLORS" :key="c" class="swatch" :class="{on: color===c}"
                  :style="{ background:c, color:c }" @click="color=c"></span>
          </div>
        </div>
        <div class="field">
          <label>icon <span class="mut">— preview <span :style="{color:color}">{{ glyph }}</span></span></label>
          <div class="glyphgrid">
            <span v-for="g in store.GLYPHS" :key="g" class="glyphpick" :class="{on: glyph===g}"
                  :style="glyph===g?{color:color}:{}" @click="glyph=g">{{ g }}</span>
          </div>
        </div>
      </div>
      <div class="modal-foot">
        <button v-if="model.mode==='edit'" class="btn danger" style="margin-right:auto;" @click="remove">delete</button>
        <button class="btn" @click="$emit('close')">cancel</button>
        <button class="btn primary" @click="save">{{ model.mode==='new' ? 'create' : 'save' }}</button>
      </div>
    </div>
  </div>
  `,
  data(){
    const p=this.model.project;
    return {
      name: p?p.name:'',
      color: p?p.color:this.store.COLORS[0],
      glyph: p?p.glyph:this.store.GLYPHS[1],
    };
  },
  computed: {
    parentName(){
      const pid=this.model.parentId || (this.model.project&&this.model.project.parentId);
      const p=this.store.projectById(pid); return p?p.name:'';
    }
  },
  mounted(){ this.$nextTick(()=>this.$refs.name&&this.$refs.name.focus()); },
  methods: {
    save(){
      const nm=this.name.trim()||'untitled';
      if(this.model.mode==='new'){
        const p=this.store.addProject({ name:nm, color:this.color, glyph:this.glyph, parentId:this.model.parentId });
        this.store.openProjectView(p);
        this.store.toast('▣ project created');
      } else {
        const p=this.model.project; p.name=nm; p.color=this.color; p.glyph=this.glyph;
        this.store.toast('✓ project saved');
      }
      this.$emit('close');
    },
    remove(){
      if(this.model.mode!=='edit') return;
      if(confirm('Delete project "'+this.model.project.name+'", its subprojects and tasks?')){
        this.store.deleteProject(this.model.project);
        this.store.setView({ kind:'query', id:'sv_today', title:'Today', query:'status:open due:today' });
        this.$emit('close');
      }
    }
  }
};

window.SaveQueryModal = {
  props: ['store','query'],
  emits: ['close'],
  template: `
  <div class="overlay" @click.self="$emit('close')">
    <div class="modal">
      <div class="modal-head">save query as smart view</div>
      <div class="modal-body">
        <div class="field">
          <label>name</label>
          <input ref="name" class="input" v-model="name" placeholder="e.g. Urgent this week" @keydown.enter="save" />
        </div>
        <div class="field">
          <label>query</label>
          <input class="input cy" v-model="q" />
        </div>
        <div class="field">
          <span class="mut" style="font-size:11px;">matches {{ count }} task(s) right now · pinned to sidebar views</span>
        </div>
      </div>
      <div class="modal-foot">
        <button class="btn" @click="$emit('close')">cancel</button>
        <button class="btn primary" @click="save">★ save view</button>
      </div>
    </div>
  </div>
  `,
  data(){ return { name:'', q:this.query||'' }; },
  computed: { count(){ try { return this.store.queryCount(this.q); } catch(e){ return 0; } } },
  mounted(){ this.$nextTick(()=>this.$refs.name&&this.$refs.name.focus()); },
  methods: {
    save(){
      const nm=this.name.trim(); if(!nm){ this.$refs.name.focus(); return; }
      this.store.saveQuery(nm, this.q.trim());
      this.store.toast('★ saved view "'+nm+'"');
      this.$emit('close');
    }
  }
};
