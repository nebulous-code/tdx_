/* query-bar.js — text query + visual builder that writes the text.
   The builder is keyboard-navigable via the shared KbForm mixin: the groups are
   stacked full-width rows (j/k move between groups, h/l move within a group's chips,
   space toggles). It's always mounted, so it uses kbAutoListen:false and is driven
   from index.html's onKey (filterKey) like the task-detail drawer. See
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
      <span class="qbtn" :class="{on: store.builderOpen}" @click="store.builderOpen=!store.builderOpen" title="Filter builder (f · F to collapse)">⊞<span><u>f</u>ilter</span></span>
      <span v-if="store.focusPane==='filter'" class="qbtn" @click="save" title="Save as smart view (s)">★<span><u>s</u>ave</span></span>
      <span v-if="store.focusPane==='filter'" class="qbtn" @click="clearQuery" title="Clear (x)"><u>x</u></span>
    </div>

    <div v-if="store.builderOpen" class="builder">
      <div v-for="g in navGroups" :key="g.key" class="bgroup">
        <div class="bg-label">{{ g.label }}</div>
        <div class="chips">
          <template v-for="(c,idx) in g.chips" :key="idx">
            <span v-if="c.sepBefore" class="chip-sep"></span>
            <span class="chip" :class="[c.dueDay?'chip-day':'', {on: chipOn(c)}, store.focusPane==='filter' ? kbCls(g.key, idx) : null]"
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
      kbAutoListen:false,   // driven from index.html filterKey (always-mounted)
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
    // canonical group/chip structure — single source for both the template and
    // KbForm's kbRows(); each chip carries display + toggle metadata.
    navGroups(){
      return [
        { key:'status', label:'status', chips:['open','done','overdue','today'].map(v=>({field:'status',value:v,text:v,exclusive:true})) },
        { key:'due', label:'due', chips:[
            ...this.dueOpts.map(o=>({field:'due',value:o.v,text:o.t,exclusive:true})),
            ...this.dueDays.map((d,i)=>({field:'due',value:d.l,text:d.t,dueDay:true,sepBefore:i===0})),
          ] },
        { key:'label', label:'labels', chips:[
            ...this.store.sortedLabels().map(l=>({field:'label',value:l.name,text:'#'+l.name,exclusive:false})),
            {field:'has',value:'no-labels',text:'no tag',untag:true,sepBefore:true},
          ] },
        { key:'project', label:'project', chips:this.store.projects.map(p=>({field:'project',value:p.name,text:p.name,glyph:p.glyph,color:p.color,exclusive:true})) },
        { key:'flags', label:'flags', chips:[
            {field:'recurring',value:'true',text:'↻ recurring',exclusive:true},
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
        this.store.setView({ kind:'query', id:'custom', title:'custom query', query:val });
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
    chipOn(c){ return c.dueDay ? this.hasDueDay(c.value) : this.has(c.field,c.value); },
    chipToggle(c){
      if(c.dueDay) this.toggleDueWeekday(c.value);
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
        ((field==='project'||field==='label') ? Q.slug(t.value)===Q.slug(v) : t.value===v));
    },
    setTerms(terms){ this.queryString = Q.build(terms); },
    // project/label values are slugged (alphanumeric-only) so multi-word names
    // ("Move Apartments") stay a single token; other fields keep their literal
    // value (slug would break comparisons like due:<3d).
    normValue(field,value){
      return (field==='project'||field==='label') ? Q.slug(value) : String(value).toLowerCase();
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
    save(){ this.$emit('save-query', this.queryString); },
    run(){ this.$refs.q && this.$refs.q.blur(); },
    blur(){ this.$refs.q && this.$refs.q.blur(); },
    focus(){ this.$refs.q && (this.$refs.q.focus(), this.$refs.q.select()); },
  }
};
