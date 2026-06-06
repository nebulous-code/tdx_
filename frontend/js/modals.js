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

window.LabelModal = {
  props: ['store','model'],   // model: {label}
  emits: ['close'],
  template: `
  <div class="overlay" @click.self="$emit('close')">
    <div class="modal" style="max-width:380px;">
      <div class="modal-head">edit label</div>
      <div class="modal-body">
        <div class="field">
          <label>name</label>
          <input ref="name" class="input" v-model="name" placeholder="label-name" spellcheck="false" autocapitalize="off" @keydown.enter="save" />
        </div>
        <div class="field"><span class="mut" style="font-size:11px;">renaming updates this label on every task that uses it</span></div>
        <div class="acct-error" v-if="error">{{ error }}</div>
      </div>
      <div class="modal-foot">
        <button class="btn" @click="$emit('close')">cancel</button>
        <button class="btn primary" @click="save">save</button>
      </div>
    </div>
  </div>
  `,
  data(){ return { name: this.model.label.name, error:'' }; },
  mounted(){ this.$nextTick(()=>this.$refs.name&&this.$refs.name.focus()); },
  methods: {
    save(){
      const nm = this.name.replace(/^#/,'').trim().toLowerCase();
      if(!nm){ this.error='enter a name'; return; }
      const clash = this.store.labels.find(l=>l.id!==this.model.label.id && Q.slug(l.name)===Q.slug(nm));
      if(clash){ this.error='a label "'+clash.name+'" already exists'; return; }
      this.model.label.name = nm;   // referenced by id, so this updates every task
      this.store.toast('✓ label renamed');
      this.$emit('close');
    }
  }
};

window.SaveQueryModal = {
  props: ['store','model'],   // model: {mode:'new'|'edit', query, view}
  emits: ['close'],
  template: `
  <div class="overlay" @click.self="$emit('close')">
    <div class="modal">
      <div class="modal-head">{{ model.mode==='edit' ? 'edit view' : 'save query as smart view' }}</div>
      <div class="modal-body">
        <div class="field">
          <label>name</label>
          <input ref="name" class="input" v-model="name" placeholder="e.g. Urgent this week" @keydown.enter="save" />
        </div>
        <div class="field">
          <label>query</label>
          <input class="input cy" v-model="q" @keydown.enter="save" />
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
        <div class="field">
          <span class="mut" style="font-size:11px;">matches {{ count }} task(s) right now · pinned to sidebar views</span>
        </div>
      </div>
      <div class="modal-foot">
        <button v-if="model.mode==='edit'" class="btn danger" style="margin-right:auto;" @click="remove">delete</button>
        <button class="btn" @click="$emit('close')">cancel</button>
        <button class="btn primary" @click="save">{{ model.mode==='edit' ? 'save' : '★ save view' }}</button>
      </div>
    </div>
  </div>
  `,
  data(){
    const v=this.model.view;
    return {
      name: v ? v.name : '',
      q: v ? v.query : (this.model.query||''),
      color: v ? (v.color || this.store.COLORS[0]) : this.store.COLORS[0],
      glyph: v ? v.glyph : '◆',
    };
  },
  computed: { count(){ try { return this.store.queryCount(this.q); } catch(e){ return 0; } } },
  mounted(){ this.$nextTick(()=>this.$refs.name&&this.$refs.name.focus()); },
  methods: {
    save(){
      const nm=this.name.trim(); if(!nm){ this.$refs.name.focus(); return; }
      const qq=this.q.trim();
      if(this.model.mode==='edit'){
        const v=this.model.view;
        v.name=nm; v.query=qq; v.glyph=this.glyph; v.color=this.color;
        // refresh the active view's title if we just edited it
        if(this.store.view.kind==='query' && this.store.view.id===v.id) this.store.openQueryView(v);
        this.store.toast('✓ view saved');
      } else {
        this.store.saveQuery(nm, qq, this.glyph, this.color);
        this.store.toast('★ saved view "'+nm+'"');
      }
      this.$emit('close');
    },
    remove(){
      const v=this.model.view; if(!v) return;
      if(confirm('Delete saved view "'+v.name+'"?')){
        this.store.deleteQuery(v);
        if(this.store.view.kind==='query' && this.store.view.id===v.id)
          this.store.setView({ kind:'query', id:'sv_today', title:'Today', query:'status:open due:today' });
        this.$emit('close');
      }
    }
  }
};
