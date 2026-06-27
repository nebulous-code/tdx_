/* query-bar.js — text query + visual builder that writes the text.
   The builder is keyboard-navigable via the shared KbForm mixin: the groups are
   stacked full-width rows (j/k move between groups, h/l move within a group's chips,
   space toggles). It's always mounted, so it uses kbAutoListen:false and is driven
   from index.html's onKey (queryKey) like the task-detail drawer. See
   docs/KEYBOARD_FRAMEWORK.md. */
window.QueryBar = {
  props: ['store'],
  mixins: [window.KbForm],
  template: `
  <div class="qbar">
    <div class="qbar-row">
      <span class="prompt">?</span>
      <input class="qinput" ref="q" v-model="queryString" spellcheck="false"
             placeholder="query… e.g.  label:urgent due:<7d status:open"
             @keydown.enter="run" @keydown.esc="blur" />
      <span class="qbtn" :class="{on: store.builderOpen}" @click="store.builderOpen=!store.builderOpen" title="Query builder (f · F to collapse)">⊞<span>query</span></span>
      <span v-if="store.focusPane==='query' && updatable" class="qbtn" @click="update" title="Update this saved view in place (u)">⟳<span><u>u</u>pdate</span></span>
      <span v-if="store.focusPane==='query'" class="qbtn" @click="save" title="Save as a new smart view (s)">★<span><u>s</u>ave</span></span>
      <span v-if="store.focusPane==='query'" class="qbtn" @click="clearQuery" title="Clear (x)"><u>x</u></span>
    </div>

    <div v-if="store.builderOpen" class="builder">
      <div v-for="g in navGroups" :key="g.key" class="bgroup">
        <div class="bg-label">{{ g.label }}</div>
        <div class="chips">
          <template v-for="(c,idx) in g.chips" :key="idx">
            <span v-if="c.sepBefore" class="chip-sep"></span>
            <span class="chip" :class="[c.dueDay?'chip-day':'', {on: chipOn(c)}, store.focusPane==='query' ? kbCls(g.key, idx) : null]"
                  @click="kbPick(g.key, idx)">
              <span v-if="c.glyph" :style="{color:c.color}">{{ c.glyph }}</span>{{ c.glyph ? ' ' : '' }}{{ c.text }}
            </span>
          </template>
        </div>
      </div>
    </div>
  </div>
  `,
  data(){
    return {
      kbAutoListen:false,   // driven from index.html queryKey (always-mounted)
      kbAutofocus:false,    // never steal focus into the query input on load
      dueOpts:[
        {v:'today',t:'today'},{v:'tomorrow',t:'tomorrow'},{v:'overdue',t:'overdue'},
        {v:'week',t:'≤7d'},{v:'<3d',t:'<3d'},{v:'none',t:'no date'},{v:'set',t:'has date'}
      ],
      // weekday window toggles (build one due:<letters> value, e.g. due:su)
      dueDays:[
        {l:'m',t:'M'},{l:'t',t:'T'},{l:'w',t:'W'},{l:'r',t:'R'},{l:'f',t:'F'},{l:'s',t:'S'},{l:'u',t:'U'}
      ],
    };
  },
  computed: {
    isCustom(){ return this.store.view.kind==='query' && this.store.view.id==='custom'; },
    // the per-app category dimension (Tasks→projects, Events→calendars, Notes→folders)
    catKind(){ return this.store.categoryKind(); },
    catLabel(){ return { project:'projects', calendar:'calendars', folder:'folders' }[this.catKind]; },
    catItems(){ return this.catKind==='calendar' ? this.store.calendars : this.catKind==='folder' ? this.store.folders : this.store.projects; },
    // the editable saved view this query belongs to (null on system/seed views or a fresh query)
    updatable(){ return !!this.store.activeSavedQuery(); },
    // canonical group/chip structure — single source for both the template and
    // KbForm's kbRows(); each chip carries display + toggle metadata.
    navGroups(){
      return [
        { key:'type', label:'type', chips:[
            {field:'type',value:'task', text:'☑ tasks',  isType:true},
            {field:'type',value:'event',text:'◷ events', isType:true},
            {field:'type',value:'note', text:'✎ notes',  isType:true},
          ] },
        { key:'due', label:'due', chips:[
            ...this.dueOpts.map(o=>({field:'due',value:o.v,text:o.t,exclusive:true})),
            ...this.dueDays.map((d,i)=>({field:'due',value:d.l,text:d.t,dueDay:true,sepBefore:i===0})),
          ] },
        { key:'label', label:'labels', chips:[
            ...this.store.sortedLabels().map(l=>({field:'label',value:l.name,text:'#'+l.name,exclusive:false})),
            {field:'has',value:'no-labels',text:'no tag',untag:true,sepBefore:true},
          ] },
        // the category group swaps by app (projects / calendars / folders) but writes the
        // GENERIC cross-app `category:` field, so one chip (e.g. "gym") spans all three apps.
        { key:'category', label:this.catLabel, chips:this.catItems.map(c=>({field:'category',value:c.name,text:c.name,glyph:c.glyph,color:this.store.resolveColor(c.color),exclusive:true})) },
        { key:'flags', label:'flags', chips:[
            { compl:'open', text:'open' }, { compl:'done', text:'completed' },
            {field:'recurring',value:'true',text:'↻ recurring',exclusive:true,sepBefore:true},
            {field:'reminder',value:'set',text:'◔ has reminder',exclusive:false},
            {field:'has',value:'subtasks',text:'⊟ has subtasks',exclusive:false},
            {field:'is',value:'subtask',text:'└ is subtask',exclusive:false},
          ] },
      ];
    },
    queryString: {
      get(){
        const v=this.store.view;
        if(v.kind==='project'){ const p=this.store.projectById(v.id); return p ? 'project:'+Q.slug(p.name) : ''; }
        return v.query || '';
      },
      set(val){
        // editing the query must keep the current APP: in Events/Notes we update the
        // calendar/notes view in place (preserving its category filter); only Tasks
        // spins up a 'custom' query view.
        const v=this.store.view, app=this.store.currentApp();
        if(app==='events') this.store.setView({ kind:'calendar', id:v.id, title:v.title, query:val, calendarId:v.calendarId??null, originId:v.originId });
        else if(app==='notes') this.store.setView({ kind:'notes', id:v.id, title:v.title, query:val, folderId:v.folderId??null, originId:v.originId });
        else {
          // remember which saved view this custom draft derived from, so Update can save in place
          const origin = this.store.savedQueries.some(s=>s.id===v.id) ? v.id : (v.originId||null);
          this.store.setView({ kind:'query', id:'custom', title:'custom query', query:val, originId:origin });
        }
      }
    },
    terms(){ return Q.parse(this.queryString).terms; }
  },
  methods: {
    // ---- KbForm config (j/k between groups, h/l within a group, space toggles) ----
    kbRows(){
      const rows=[{ id:'q', type:'input', ref:'q' }];
      for(const g of this.navGroups){
        if(!g.chips.length) continue;
        rows.push({ id:g.key, type:'grid', items:g.chips, cols:99, isOn:c=>this.chipOn(c), select:c=>this.chipToggle(c) });
      }
      return rows;
    },
    chipOn(c){ return c.compl ? this.store.completion[c.compl] : c.isType ? this.hasType(c.value) : c.dueDay ? this.hasDueDay(c.value) : this.has(c.field,c.value); },
    chipToggle(c){
      if(c.compl) this.store.toggleCompletion(c.compl);
      else if(c.isType) this.toggleType(c.value);
      else if(c.dueDay) this.toggleDueWeekday(c.value);
      else if(c.untag) this.toggleUntagged();
      else if(c.exclusive) this.toggleExclusive(c.field,c.value);
      else if(c.field==='label'){
        // selecting a #label clears the mutually-exclusive "no tag" filter, in one update
        const v = this.normValue(c.field,c.value);
        let terms = this.terms.filter(t => !(t.field==='has'&&t.value==='no-labels'));
        const i = terms.findIndex(t=>t.field==='label' && t.value===v);
        if(i>=0) terms.splice(i,1); else terms.push({field:'label',value:v,neg:false});
        this.setTerms(terms);
      }
      else this.toggle(c.field,c.value);
    },
    // "no tag": show only untagged tasks. Mutually exclusive with every #label chip.
    toggleUntagged(){
      const on = this.has('has','no-labels');
      let terms = this.terms.filter(t => t.field!=='label' && !(t.field==='has'&&t.value==='no-labels'));
      if(!on) terms.push({field:'has',value:'no-labels',neg:false});
      this.setTerms(terms);
    },
    // ---- query mutation ----
    has(field,value){
      const v = String(value).toLowerCase();
      // project/label terms are stored as slugs (alphanumeric-only), so compare by
      // slug — otherwise multi-word names ("Move Apartments") never match the chip.
      return this.terms.some(t => t.field===field && !t.neg &&
        ((field==='project'||field==='label'||field==='category') ? Q.slug(t.value)===Q.slug(v) : t.value===v));
    },
    setTerms(terms){ this.queryString = Q.build(terms); },
    // project/label values are slugged (alphanumeric-only) so multi-word names
    // ("Move Apartments") stay a single token; other fields keep their literal
    // value (slug would break comparisons like due:<3d).
    normValue(field,value){
      return (field==='project'||field==='label'||field==='category') ? Q.slug(value) : String(value).toLowerCase();
    },
    toggle(field,value){
      value=this.normValue(field,value);
      const terms=[...this.terms];
      const i=terms.findIndex(t=>t.field===field && t.value===value);
      if(i>=0) terms.splice(i,1); else terms.push({field,value,neg:false});
      this.setTerms(terms);
    },
    // only one value allowed per field (status, due, project, recurring)
    toggleExclusive(field,value){
      value=this.normValue(field,value);
      const on=this.has(field,value);
      let terms=this.terms.filter(t=>t.field!==field);
      if(!on) terms.push({field,value,neg:false});
      this.setTerms(terms);
    },
    // ---- app-type selector (one comma-joined type: term) ----
    typeValues(){
      const t=this.terms.find(t=>t.field==='type' && !t.neg);
      return t ? t.value.split(',').map(s=>s.trim()).filter(Boolean) : [];
    },
    hasType(v){ return this.typeValues().includes(v); },
    toggleType(v){
      const ORDER=['task','event','note'];
      const set=new Set(this.typeValues());
      set.has(v) ? set.delete(v) : set.add(v);
      const val=ORDER.filter(x=>set.has(x)).join(',');
      const terms=this.terms.filter(t=>t.field!=='type');   // collapse to a single type: term
      if(val) terms.push({field:'type', value:val, neg:false}); // none selected → drop type: entirely
      this.setTerms(terms);
    },
    // ---- weekday window (due:<letters>) ----
    dueValue(){ const t=this.terms.find(t=>t.field==='due' && !t.neg); return t ? t.value : ''; },
    hasDueDay(l){ const v=this.dueValue(); return /^[mtwrfsu]+$/.test(v) && v.includes(l); },
    toggleDueWeekday(l){
      const ORDER='mtwrfsu';
      const v=this.dueValue();
      const set=new Set(/^[mtwrfsu]+$/.test(v) ? v.split('') : []);  // start fresh if due was a keyword/comparison
      set.has(l) ? set.delete(l) : set.add(l);
      const val=ORDER.split('').filter(c=>set.has(c)).join('');
      const terms=this.terms.filter(t=>t.field!=='due');             // due is single-value
      if(val) terms.push({field:'due', value:val, neg:false});
      this.setTerms(terms);
    },
    clearQuery(){ this.queryString=''; },
    save(){ this.$emit('save-query', this.queryString); },   // save AS NEW (opens the modal)
    // overwrite the active saved view's query in place (keeps its name/glyph/color), then
    // re-open it so the view stops being a 'custom' draft. No-op on system/seed views.
    update(){
      const sv=this.store.activeSavedQuery();
      if(!sv) return;
      sv.query=(this.queryString||'').trim();
      this.store.openQueryView(sv);
      this.store.toast('✓ updated "'+sv.name+'"');
    },
    run(){ this.$refs.q && this.$refs.q.blur(); },
    blur(){ this.$refs.q && this.$refs.q.blur(); },
    focus(){ this.$refs.q && (this.$refs.q.focus(), this.$refs.q.select()); },
  }
};
