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
        <div class="field" :class="kbCls('parent')">
          <label>parent</label>
          <select ref="parent" class="input" v-model="parentId" @focus="kbFocusRow('parent')">
            <option value="">— none (top level) —</option>
            <option v-for="({p,depth}) in parentOptions" :key="p.id" :value="p.id">{{ depth ? '↳ ' : '' }}{{ p.name }}</option>
          </select>
        </div>
        <div class="field">
          <label>color</label>
          <div class="swatches">
            <span v-for="(c,i) in colorOptions" :key="c" class="swatch" :class="[{on: color===c, 'swatch-system': c==='system'}, kbCls('color', i)]"
                  :style="{ background:store.resolveColor(c), color:store.resolveColor(c) }" :title="c==='system' ? 'system — follows theme' : ''" @click="kbPick('color', i)"></span>
          </div>
        </div>
        <div class="field">
          <label>icon <span class="mut">— preview <span :style="{color:store.resolveColor(color)}">{{ glyph }}</span></span></label>
          <div class="glyphgrid">
            <span v-for="(g,i) in store.GLYPHS" :key="g" class="glyphpick" :class="[{on: glyph===g}, kbCls('glyph', i)]"
                  :style="glyph===g?{color:store.resolveColor(color)}:{}" @click="kbPick('glyph', i)">{{ g }}</span>
          </div>
        </div>
        <div class="field">
          <label>health checks <span class="mut">— gaps to flag for this project</span></label>
          <div class="health-opts">
            <span v-for="(s,i) in healthOptions" :key="s.key" class="hopt" :class="[{on: health.includes(s.key)}, kbCls('health', i)]" @click="toggleHealthOpt(s.key)">
              <span class="hopt-box">{{ health.includes(s.key) ? '✓' : '' }}</span><span class="hopt-icon">{{ s.icon }}</span>{{ s.name }}
            </span>
          </div>
        </div>
      </div>
      <div class="modal-foot">
        <button v-if="model.mode==='edit'" class="btn" :class="kbCls('duplicate')" @click="duplicate">duplicate</button>
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
    const color = p?p.color:'system';   // new projects follow the theme accent by default
    const glyph = p?p.glyph:this.store.GLYPHS[1];
    const parentId = p ? (p.parentId||'') : (this.model.parentId||'');
    const health = (p && Array.isArray(p.health)) ? [...p.health] : [];   // enabled check keys
    return { name, color, glyph, parentId, health, _orig:{ name, color, glyph, parentId, health:[...health] } };
  },
  computed: {
    colorOptions(){ return ['system', ...this.store.COLORS]; },
    healthOptions(){ return this.store.healthSignals(); },   // catalog (size auto-omitted when sizing off)
    // tree-ordered parents, excluding self + descendants (no cycles)
    parentOptions(){
      const self=this.model.project;
      const excluded=new Set();
      if(self){ const walk=(p)=>{ excluded.add(p); this.store.childProjects(p).forEach(c=>walk(c.id)); }; walk(self.id); }
      return this.store.projectTree().filter(({p})=>!excluded.has(p.id));
    }
  },
  methods: {
    kbRows(){ return [
      { id:'name',   type:'input',  ref:'name' },
      { id:'parent', type:'input',  ref:'parent' },
      { id:'color',  type:'grid',   items:this.colorOptions, cols:11, isOn:c=>c===this.color, select:c=>{ this.color=c; } },
      { id:'glyph',  type:'grid',   items:this.store.GLYPHS, cols:10, isOn:g=>g===this.glyph, select:g=>{ this.glyph=g; } },
      { id:'health', type:'grid',   items:this.healthOptions, cols:3, isOn:s=>this.health.includes(s.key), select:s=>this.toggleHealthOpt(s.key) },
      { id:'duplicate', type:'button', activate:()=>this.duplicate(), when:()=>this.model.mode==='edit' },
      { id:'delete', type:'button', activate:()=>this.remove(), when:()=>this.model.mode==='edit' },
      { id:'cancel', type:'button', activate:()=>this.$emit('close') },
      { id:'save',   type:'button', activate:()=>this.save() },
    ]; },
    kbSubmit(){ this.save(); },
    toggleHealthOpt(key){ const i=this.health.indexOf(key); if(i>=0) this.health.splice(i,1); else this.health.push(key); },
    kbDirty(){ return this.name!==this._orig.name || this.color!==this._orig.color || this.glyph!==this._orig.glyph || this.parentId!==this._orig.parentId || JSON.stringify(this.health)!==JSON.stringify(this._orig.health); },
    save(){
      const nm=this.name.trim()||'untitled';
      if(this.model.mode==='new'){
        const p=this.store.addProject({ name:nm, color:this.color, glyph:this.glyph, parentId:this.parentId||null, health:[...this.health] });
        this.store.openProjectView(p);
        this.store.toast('▣ project created');
      } else {
        const p=this.model.project; p.name=nm; p.color=this.color; p.glyph=this.glyph; p.health=[...this.health];
        this.store.reparentProject(p, this.parentId);
        this.store.toast('✓ project saved');
      }
      this.$emit('close');
    },
    async remove(){
      if(this.model.mode!=='edit') return;
      if(await this.store.askConfirm('Delete "'+this.model.project.name+'" and everything in it?')){
        const ok = await this.store.softDeleteProject(this.model.project.id);
        if(ok){
          if(this.store.view.kind==='project' && !this.store.projectById(this.store.view.id))
            this.store.setView({ kind:'query', id:'sv_today', title:'Today', query:'status:open due:today' });
          this.store.toast('✓ deleted');
        }
        this.$emit('close');
      }
    },
    async duplicate(){
      if(this.model.mode!=='edit') return;
      const dup = await this.store.duplicateProjectFlow(this.model.project);
      if(dup) this.$emit('close');   // leave the modal open if the user cancelled
    }
  }
};

window.CalendarModal = {
  props: ['store','model'],   // model: {mode:'new'|'edit', calendar}
  emits: ['close'],
  mixins: [window.KbForm],
  template: `
  <div class="overlay" @click.self="kbAttemptClose">
    <div class="modal" style="max-width:420px;">
      <div class="modal-head" style="display:flex;align-items:center;">
        <span style="flex:1;">{{ model.mode==='new' ? 'new calendar' : 'edit calendar' }}</span>
        <span class="acct-x" @click="kbAttemptClose" title="close (esc)">✕</span>
      </div>
      <div class="modal-body">
        <div class="field" :class="kbCls('name')">
          <label>name</label>
          <input ref="name" class="input" v-model="name" placeholder="calendar-name" @focus="kbFocusRow('name')" />
        </div>
        <div class="field">
          <label>color</label>
          <div class="swatches">
            <span v-for="(c,i) in colorOptions" :key="c" class="swatch" :class="[{on: color===c, 'swatch-system': c==='system'}, kbCls('color', i)]"
                  :style="{ background:store.resolveColor(c), color:store.resolveColor(c) }" :title="c==='system' ? 'system — follows theme' : ''" @click="kbPick('color', i)"></span>
          </div>
        </div>
        <div class="field">
          <label>icon <span class="mut">— preview <span :style="{color:store.resolveColor(color)}">{{ glyph }}</span></span></label>
          <div class="glyphgrid">
            <span v-for="(g,i) in store.GLYPHS" :key="g" class="glyphpick" :class="[{on: glyph===g}, kbCls('glyph', i)]"
                  :style="glyph===g?{color:store.resolveColor(color)}:{}" @click="kbPick('glyph', i)">{{ g }}</span>
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
    const c=this.model.calendar;
    const name = c?c.name:'';
    const color = c?c.color:'system';
    const glyph = c?c.glyph:this.store.GLYPHS[1];
    return { name, color, glyph, _orig:{ name, color, glyph } };
  },
  computed: { colorOptions(){ return ['system', ...this.store.COLORS]; } },
  methods: {
    kbRows(){ return [
      { id:'name',   type:'input',  ref:'name' },
      { id:'color',  type:'grid',   items:this.colorOptions, cols:11, isOn:c=>c===this.color, select:c=>{ this.color=c; } },
      { id:'glyph',  type:'grid',   items:this.store.GLYPHS, cols:10, isOn:g=>g===this.glyph, select:g=>{ this.glyph=g; } },
      { id:'delete', type:'button', activate:()=>this.remove(), when:()=>this.model.mode==='edit' },
      { id:'cancel', type:'button', activate:()=>this.$emit('close') },
      { id:'save',   type:'button', activate:()=>this.save() },
    ]; },
    kbSubmit(){ this.save(); },
    kbDirty(){ const o=this._orig; return this.name!==o.name || this.color!==o.color || this.glyph!==o.glyph; },
    save(){
      const nm=this.name.trim()||'untitled';
      if(this.model.mode==='new'){
        const c=this.store.addCalendar({ name:nm, color:this.color, glyph:this.glyph });
        this.store.openCalendarView(c);
        this.store.toast('▣ calendar created');
      } else {
        const c=this.model.calendar; c.name=nm; c.color=this.color; c.glyph=this.glyph;
        this.store.toast('✓ calendar saved');
      }
      this.$emit('close');
    },
    async remove(){
      if(this.model.mode!=='edit') return;
      if(await this.store.askConfirm('Delete calendar "'+this.model.calendar.name+'"? Its events will be archived.')){
        const ok = await this.store.softDeleteCalendar(this.model.calendar.id);
        if(ok){
          if(this.store.view.kind==='calendar' && this.store.view.calendarId===this.model.calendar.id) this.store.openCalendar();
          this.store.toast('✓ deleted');
        }
        this.$emit('close');
      }
    }
  }
};

window.FolderModal = {
  props: ['store','model'],   // model: {mode:'new'|'edit', parentId, folder}
  emits: ['close'],
  mixins: [window.KbForm],
  template: `
  <div class="overlay" @click.self="kbAttemptClose">
    <div class="modal" style="max-width:420px;">
      <div class="modal-head" style="display:flex;align-items:center;">
        <span style="flex:1;">{{ model.mode==='new' ? (model.parentId ? 'new subfolder' : 'new folder') : 'edit folder' }}</span>
        <span class="acct-x" @click="kbAttemptClose" title="close (esc)">✕</span>
      </div>
      <div class="modal-body">
        <div class="field" :class="kbCls('name')">
          <label>name</label>
          <input ref="name" class="input" v-model="name" placeholder="folder-name" @focus="kbFocusRow('name')" />
        </div>
        <div class="field" :class="kbCls('parent')">
          <label>parent</label>
          <select ref="parent" class="input" v-model="parentId" @focus="kbFocusRow('parent')">
            <option value="">— none (top level) —</option>
            <option v-for="({f,depth}) in parentOptions" :key="f.id" :value="f.id">{{ depth ? '↳ ' : '' }}{{ f.name }}</option>
          </select>
        </div>
        <div class="field">
          <label>color</label>
          <div class="swatches">
            <span v-for="(c,i) in colorOptions" :key="c" class="swatch" :class="[{on: color===c, 'swatch-system': c==='system'}, kbCls('color', i)]"
                  :style="{ background:store.resolveColor(c), color:store.resolveColor(c) }" :title="c==='system' ? 'system — follows theme' : ''" @click="kbPick('color', i)"></span>
          </div>
        </div>
        <div class="field">
          <label>icon <span class="mut">— preview <span :style="{color:store.resolveColor(color)}">{{ glyph }}</span></span></label>
          <div class="glyphgrid">
            <span v-for="(g,i) in store.GLYPHS" :key="g" class="glyphpick" :class="[{on: glyph===g}, kbCls('glyph', i)]"
                  :style="glyph===g?{color:store.resolveColor(color)}:{}" @click="kbPick('glyph', i)">{{ g }}</span>
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
    const f=this.model.folder;
    const name = f?f.name:'';
    const color = f?f.color:'system';
    const glyph = f?f.glyph:this.store.GLYPHS[1];
    const parentId = f ? (f.parentId||'') : (this.model.parentId||'');
    return { name, color, glyph, parentId, _orig:{ name, color, glyph, parentId } };
  },
  computed: {
    colorOptions(){ return ['system', ...this.store.COLORS]; },
    // tree-ordered folders, excluding self + descendants (no cycles)
    parentOptions(){
      const self=this.model.folder;
      const excluded=new Set();
      if(self){ const walk=(id)=>{ excluded.add(id); this.store.childFolders(id).forEach(c=>walk(c.id)); }; walk(self.id); }
      return this.store.folderTree().filter(({f})=>!excluded.has(f.id));
    }
  },
  methods: {
    kbRows(){ return [
      { id:'name',   type:'input',  ref:'name' },
      { id:'parent', type:'input',  ref:'parent' },
      { id:'color',  type:'grid',   items:this.colorOptions, cols:11, isOn:c=>c===this.color, select:c=>{ this.color=c; } },
      { id:'glyph',  type:'grid',   items:this.store.GLYPHS, cols:10, isOn:g=>g===this.glyph, select:g=>{ this.glyph=g; } },
      { id:'delete', type:'button', activate:()=>this.remove(), when:()=>this.model.mode==='edit' },
      { id:'cancel', type:'button', activate:()=>this.$emit('close') },
      { id:'save',   type:'button', activate:()=>this.save() },
    ]; },
    kbSubmit(){ this.save(); },
    kbDirty(){ const o=this._orig; return this.name!==o.name || this.color!==o.color || this.glyph!==o.glyph || this.parentId!==o.parentId; },
    save(){
      const nm=this.name.trim()||'untitled';
      if(this.model.mode==='new'){
        const f=this.store.addFolder({ name:nm, color:this.color, glyph:this.glyph, parentId:this.parentId||null });
        this.store.openFolderView(f);
        this.store.toast('▣ folder created');
      } else {
        const f=this.model.folder; f.name=nm; f.color=this.color; f.glyph=this.glyph;
        this.store.reparentFolder(f, this.parentId);
        this.store.toast('✓ folder saved');
      }
      this.$emit('close');
    },
    async remove(){
      if(this.model.mode!=='edit') return;
      if(await this.store.askConfirm('Delete folder "'+this.model.folder.name+'"? (only works when it\'s empty)')){
        const ok = await this.store.softDeleteFolder(this.model.folder.id);
        if(ok){
          if(this.store.view.kind==='notes' && this.store.view.folderId===this.model.folder.id) this.store.openNotes();
          this.store.toast('✓ deleted');
        }
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

        <div class="field" :class="kbCls('pin')" @click="pinned=!pinned" style="cursor:pointer;display:flex;align-items:center;gap:8px;">
          <label style="margin:0;">pin to header</label>
          <span class="pin-check" :class="{on:pinned}">{{ pinned ? '✓' : '' }}</span>
        </div>

        <div v-if="hasOtherLabels" class="field" :class="kbCls('mergeInto')" style="border-top:1px solid var(--line);padding-top:10px;">
          <label>merge into</label>
          <div style="display:flex;gap:6px;">
            <select ref="mergeInto" class="input" style="flex:1;" v-model="mergeInto" @focus="kbFocusRow('mergeInto')">
              <option value="">— choose a label —</option>
              <option v-for="l in otherLabels" :key="l.id" :value="l.id">#{{ l.name }}</option>
            </select>
            <button class="btn" :class="kbCls('merge')" :disabled="!mergeInto" @click="merge">merge</button>
          </div>
          <span class="mut" style="font-size:11px;">moves every task onto the chosen label, then deletes this one</span>
        </div>

        <div class="acct-error" v-if="error">{{ error }}</div>
      </div>
      <div class="modal-foot">
        <button class="btn danger" :class="kbCls('delete')" style="margin-right:auto;" @click="del">delete</button>
        <button class="btn" :class="kbCls('cancel')" @click="$emit('close')">cancel</button>
        <button class="btn primary" :class="kbCls('save')" @click="save">save ↵</button>
      </div>
    </div>
  </div>
  `,
  data(){ return { name: this.model.label.name, pinned: !!this.model.label.pinned, mergeInto:'', error:'' }; },
  computed: {
    otherLabels(){ return this.store.sortedLabels().filter(l=>l.id!==this.model.label.id); },
    hasOtherLabels(){ return this.otherLabels.length>0; }
  },
  methods: {
    kbRows(){ return [
      { id:'name',      type:'input',  ref:'name' },
      { id:'pin',       type:'button', activate:()=>{ this.pinned=!this.pinned; } },
      { id:'mergeInto', type:'input',  ref:'mergeInto', when:()=>this.hasOtherLabels },
      { id:'merge',     type:'button', activate:()=>this.merge(), when:()=>this.hasOtherLabels },
      { id:'delete',    type:'button', activate:()=>this.del() },
      { id:'cancel',    type:'button', activate:()=>this.$emit('close') },
      { id:'save',      type:'button', activate:()=>this.save() },
    ]; },
    kbSubmit(){ this.save(); },
    kbDirty(){ return this.name.trim() !== this.model.label.name || this.pinned !== !!this.model.label.pinned; },
    save(){
      const nm = this.name.replace(/^#/,'').trim().toLowerCase();
      if(!nm){ this.error='enter a name'; return; }
      const clash = this.store.labels.find(l=>l.id!==this.model.label.id && Q.slug(l.name)===Q.slug(nm));
      if(clash){ this.error='a label "'+clash.name+'" already exists'; return; }
      this.model.label.name = nm;       // referenced by id, so this updates every task
      this.model.label.pinned = this.pinned;
      this.store.toast('✓ label saved');
      this.$emit('close');
    },
    async merge(){
      const to = this.store.labelById(this.mergeInto);
      if(!to) return;
      if(await this.store.askConfirm('Merge #'+this.model.label.name+' into #'+to.name+'? This can\'t be undone.')){
        this.store.mergeLabels(this.model.label.id, to.id);
        // if we were viewing the now-deleted label, fall back to the top view
        if(this.store.view.id==='label_'+this.model.label.id) this.store.openQueryView(this.store.savedQueries[0]);
        this.store.toast('✓ merged into #'+to.name);
        this.$emit('close');
      }
    },
    async del(){
      const id = this.model.label.id;
      const n = this.store.tasks.filter(t => (t.labels||[]).includes(id)).length;
      const msg = n
        ? 'Delete #'+this.model.label.name+'? It will be removed from '+n+' task'+(n===1?'':'s')+' (the tasks stay). This can\'t be undone.'
        : 'Delete #'+this.model.label.name+'?';
      if(await this.store.askConfirm(msg)){
        // if we were viewing this label, fall back to the top view before it's gone
        if(this.store.view.id==='label_'+id) this.store.openQueryView(this.store.savedQueries[0]);
        this.store.deleteLabel(id);
        this.store.toast('✓ label deleted');
        this.$emit('close');
      }
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
            <span v-for="(c,i) in colorOptions" :key="c" class="swatch" :class="[{on: color===c, 'swatch-system': c==='system'}, kbCls('color', i)]"
                  :style="{ background:store.resolveColor(c), color:store.resolveColor(c) }" :title="c==='system' ? 'system — follows theme' : ''" @click="kbPick('color', i)"></span>
          </div>
        </div>
        <div class="field">
          <label>icon <span class="mut">— preview <span :style="{color:store.resolveColor(color)}">{{ glyph }}</span></span></label>
          <div class="glyphgrid">
            <span v-for="(g,i) in store.GLYPHS" :key="g" class="glyphpick" :class="[{on: glyph===g}, kbCls('glyph', i)]"
                  :style="glyph===g?{color:store.resolveColor(color)}:{}" @click="kbPick('glyph', i)">{{ g }}</span>
          </div>
        </div>
        <div class="field" :class="kbCls('pin')" @click="pinned=!pinned" style="cursor:pointer;display:flex;align-items:center;gap:8px;">
          <label style="margin:0;">pin to header</label>
          <span class="pin-check" :class="{on:pinned}">{{ pinned ? '✓' : '' }}</span>
        </div>
        <div class="field">
          <span class="mut" style="font-size:11px;">matches {{ count }} task(s) right now</span>
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
    const color = v ? (v.color || 'system') : 'system';   // new views follow the theme accent by default
    const glyph = v ? v.glyph : '◆';
    const pinned = v ? !!v.pinned : false;
    return { name, q, color, glyph, pinned, _orig:{ name, q, color, glyph, pinned } };
  },
  computed: {
    colorOptions(){ return ['system', ...this.store.COLORS]; },
    count(){ try { return this.store.queryCount(this.q); } catch(e){ return 0; } }
  },
  methods: {
    kbRows(){ return [
      { id:'name',   type:'input',  ref:'name' },
      { id:'query',  type:'input',  ref:'query' },
      { id:'color',  type:'grid',   items:this.colorOptions, cols:11, isOn:c=>c===this.color, select:c=>{ this.color=c; } },
      { id:'glyph',  type:'grid',   items:this.store.GLYPHS, cols:10, isOn:g=>g===this.glyph, select:g=>{ this.glyph=g; } },
      { id:'pin',    type:'button', activate:()=>{ this.pinned=!this.pinned; } },
      { id:'delete', type:'button', activate:()=>this.remove(), when:()=>this.model.mode==='edit' },
      { id:'cancel', type:'button', activate:()=>this.$emit('close') },
      { id:'save',   type:'button', activate:()=>this.save() },
    ]; },
    kbSubmit(){ this.save(); },
    kbDirty(){ const o=this._orig; return this.name!==o.name || this.q!==o.q || this.color!==o.color || this.glyph!==o.glyph || this.pinned!==o.pinned; },
    save(){
      const nm=this.name.trim(); if(!nm){ this.kbFocusRow('name'); this.$refs.name.focus(); return; }
      const qq=this.q.trim();
      if(this.model.mode==='edit'){
        const v=this.model.view;
        v.name=nm; v.query=qq; v.glyph=this.glyph; v.color=this.color; v.pinned=this.pinned;
        // refresh the active view's title if we just edited it
        if(this.store.view.kind==='query' && this.store.view.id===v.id) this.store.openQueryView(v);
        this.store.toast('✓ view saved');
      } else {
        this.store.saveQuery(nm, qq, this.glyph, this.color, this.pinned);
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
