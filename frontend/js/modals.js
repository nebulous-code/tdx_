/* modals.js — project editor + save-query modal */
window.ProjectModal = {
  props: ['store','model'],   // model: {mode:'new'|'edit', parentId, project}
  emits: ['close'],
  mixins: [window.KbForm],
  template: `
  <div class="overlay" @click.self="kbAttemptClose">
    <div class="modal">
      <div class="modal-head" style="display:flex;align-items:center;">
        <span style="flex:1;">{{ model.mode==='new' ? (model.parentId ? 'new subproject' : 'new project') : 'edit project' }}</span>
        <span class="acct-x" @click="kbAttemptClose" title="close (esc)">✕</span>
      </div>
      <div class="modal-body">
        <div class="field" :class="kbCls('name')">
          <label>name</label>
          <input ref="name" class="input" v-model="name" placeholder="project-name" @focus="kbFocusRow('name')" />
        </div>
        <div v-if="model.parentId || (model.project && model.project.parentId)" class="field">
          <span class="mut" style="font-size:11px;">↳ under {{ parentName }}</span>
        </div>
        <div class="field">
          <label>color</label>
          <div class="swatches">
            <span v-for="(c,i) in store.COLORS" :key="c" class="swatch" :class="[{on: color===c}, kbCls('color', i)]"
                  :style="{ background:c, color:c }" @click="kbPick('color', i)"></span>
          </div>
        </div>
        <div class="field">
          <label>icon <span class="mut">— preview <span :style="{color:color}">{{ glyph }}</span></span></label>
          <div class="glyphgrid">
            <span v-for="(g,i) in store.GLYPHS" :key="g" class="glyphpick" :class="[{on: glyph===g}, kbCls('glyph', i)]"
                  :style="glyph===g?{color:color}:{}" @click="kbPick('glyph', i)">{{ g }}</span>
          </div>
        </div>
      </div>
      <div class="modal-foot">
        <button v-if="model.mode==='edit'" class="btn danger" :class="kbCls('delete')" style="margin-right:auto;" @click="remove">delete</button>
        <button class="btn" :class="kbCls('cancel')" @click="$emit('close')">cancel</button>
        <button class="btn primary" :class="kbCls('save')" @click="save">{{ model.mode==='new' ? 'create ↵' : 'save ↵' }}</button>
      </div>
    </div>
  </div>
  `,
  data(){
    const p=this.model.project;
    const name = p?p.name:'';
    const color = p?p.color:this.store.COLORS[0];
    const glyph = p?p.glyph:this.store.GLYPHS[1];
    return { name, color, glyph, _orig:{ name, color, glyph } };
  },
  computed: {
    parentName(){
      const pid=this.model.parentId || (this.model.project&&this.model.project.parentId);
      const p=this.store.projectById(pid); return p?p.name:'';
    }
  },
  methods: {
    kbRows(){ return [
      { id:'name',   type:'input',  ref:'name' },
      { id:'color',  type:'grid',   items:this.store.COLORS, cols:10, isOn:c=>c===this.color, select:c=>{ this.color=c; } },
      { id:'glyph',  type:'grid',   items:this.store.GLYPHS, cols:10, isOn:g=>g===this.glyph, select:g=>{ this.glyph=g; } },
      { id:'delete', type:'button', activate:()=>this.remove(), when:()=>this.model.mode==='edit' },
      { id:'cancel', type:'button', activate:()=>this.$emit('close') },
      { id:'save',   type:'button', activate:()=>this.save() },
    ]; },
    kbSubmit(){ this.save(); },
    kbDirty(){ return this.name!==this._orig.name || this.color!==this._orig.color || this.glyph!==this._orig.glyph; },
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
    async remove(){
      if(this.model.mode!=='edit') return;
      if(await this.store.askConfirm('Delete project "'+this.model.project.name+'", its subprojects and tasks?')){
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
  mixins: [window.KbForm],
  template: `
  <div class="overlay" @click.self="kbAttemptClose">
    <div class="modal" style="max-width:380px;">
      <div class="modal-head" style="display:flex;align-items:center;">
        <span style="flex:1;">edit label</span>
        <span class="acct-x" @click="kbAttemptClose" title="close (esc)">✕</span>
      </div>
      <div class="modal-body">
        <div class="field" :class="kbCls('name')">
          <label>name</label>
          <input ref="name" class="input" v-model="name" placeholder="label-name" spellcheck="false" autocapitalize="off" @focus="kbFocusRow('name')" />
        </div>
        <div class="field"><span class="mut" style="font-size:11px;">renaming updates this label on every task that uses it</span></div>
        <div class="acct-error" v-if="error">{{ error }}</div>
      </div>
      <div class="modal-foot">
        <button class="btn" :class="kbCls('cancel')" @click="$emit('close')">cancel</button>
        <button class="btn primary" :class="kbCls('save')" @click="save">save ↵</button>
      </div>
    </div>
  </div>
  `,
  data(){ return { name: this.model.label.name, error:'' }; },
  methods: {
    kbRows(){ return [
      { id:'name',   type:'input',  ref:'name' },
      { id:'save',   type:'button', activate:()=>this.save() },
      { id:'cancel', type:'button', activate:()=>this.$emit('close') },
    ]; },
    kbSubmit(){ this.save(); },
    kbDirty(){ return this.name.trim() !== this.model.label.name; },
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
  mixins: [window.KbForm],
  template: `
  <div class="overlay" @click.self="kbAttemptClose">
    <div class="modal">
      <div class="modal-head" style="display:flex;align-items:center;">
        <span style="flex:1;">{{ model.mode==='edit' ? 'edit view' : 'save query as smart view' }}</span>
        <span class="acct-x" @click="kbAttemptClose" title="close (esc)">✕</span>
      </div>
      <div class="modal-body">
        <div class="field" :class="kbCls('name')">
          <label>name</label>
          <input ref="name" class="input" v-model="name" placeholder="e.g. Urgent this week" @focus="kbFocusRow('name')" />
        </div>
        <div class="field" :class="kbCls('query')">
          <label>query</label>
          <input ref="query" class="input cy" v-model="q" @focus="kbFocusRow('query')" />
        </div>
        <div class="field">
          <label>color</label>
          <div class="swatches">
            <span v-for="(c,i) in store.COLORS" :key="c" class="swatch" :class="[{on: color===c}, kbCls('color', i)]"
                  :style="{ background:c, color:c }" @click="kbPick('color', i)"></span>
          </div>
        </div>
        <div class="field">
          <label>icon <span class="mut">— preview <span :style="{color:color}">{{ glyph }}</span></span></label>
          <div class="glyphgrid">
            <span v-for="(g,i) in store.GLYPHS" :key="g" class="glyphpick" :class="[{on: glyph===g}, kbCls('glyph', i)]"
                  :style="glyph===g?{color:color}:{}" @click="kbPick('glyph', i)">{{ g }}</span>
          </div>
        </div>
        <div class="field">
          <span class="mut" style="font-size:11px;">matches {{ count }} task(s) right now · pinned to sidebar views</span>
        </div>
      </div>
      <div class="modal-foot">
        <button v-if="model.mode==='edit'" class="btn danger" :class="kbCls('delete')" style="margin-right:auto;" @click="remove">delete</button>
        <button class="btn" :class="kbCls('cancel')" @click="$emit('close')">cancel</button>
        <button class="btn primary" :class="kbCls('save')" @click="save">{{ model.mode==='edit' ? 'save ↵' : '★ save view ↵' }}</button>
      </div>
    </div>
  </div>
  `,
  data(){
    const v=this.model.view;
    const name = v ? v.name : '';
    const q = v ? v.query : (this.model.query||'');
    const color = v ? (v.color || this.store.COLORS[0]) : this.store.COLORS[0];
    const glyph = v ? v.glyph : '◆';
    return { name, q, color, glyph, _orig:{ name, q, color, glyph } };
  },
  computed: { count(){ try { return this.store.queryCount(this.q); } catch(e){ return 0; } } },
  methods: {
    kbRows(){ return [
      { id:'name',   type:'input',  ref:'name' },
      { id:'query',  type:'input',  ref:'query' },
      { id:'color',  type:'grid',   items:this.store.COLORS, cols:10, isOn:c=>c===this.color, select:c=>{ this.color=c; } },
      { id:'glyph',  type:'grid',   items:this.store.GLYPHS, cols:10, isOn:g=>g===this.glyph, select:g=>{ this.glyph=g; } },
      { id:'delete', type:'button', activate:()=>this.remove(), when:()=>this.model.mode==='edit' },
      { id:'cancel', type:'button', activate:()=>this.$emit('close') },
      { id:'save',   type:'button', activate:()=>this.save() },
    ]; },
    kbSubmit(){ this.save(); },
    kbDirty(){ const o=this._orig; return this.name!==o.name || this.q!==o.q || this.color!==o.color || this.glyph!==o.glyph; },
    save(){
      const nm=this.name.trim(); if(!nm){ this.kbFocusRow('name'); this.$refs.name.focus(); return; }
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
    async remove(){
      const v=this.model.view; if(!v) return;
      if(await this.store.askConfirm('Delete saved view "'+v.name+'"?')){
        this.store.deleteQuery(v);
        if(this.store.view.kind==='query' && this.store.view.id===v.id)
          this.store.setView({ kind:'query', id:'sv_today', title:'Today', query:'status:open due:today' });
        this.$emit('close');
      }
    }
  }
};
