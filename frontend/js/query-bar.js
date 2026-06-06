/* query-bar.js — text query + visual builder that writes the text */
window.QueryBar = {
  props: ['store'],
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
      <div class="bgroup">
        <div class="bg-label">status</div>
        <div class="chips">
          <span v-for="s in ['open','done','overdue','today']" :key="s" class="chip"
                :class="{on: has('status',s), kfocus: isFocused('status',s)}" @click="toggleExclusive('status',s)">{{ s }}</span>
        </div>
      </div>
      <div class="bgroup">
        <div class="bg-label">due</div>
        <div class="chips">
          <span v-for="dd in dueOpts" :key="dd.v" class="chip"
                :class="{on: has('due',dd.v), kfocus: isFocused('due',dd.v)}" @click="toggleExclusive('due',dd.v)">{{ dd.t }}</span>
          <span class="chip-sep"></span>
          <span v-for="d in dueDays" :key="d.l" class="chip chip-day"
                :class="{on: hasDueDay(d.l), kfocus: isFocused('due',d.l)}" @click="toggleDueWeekday(d.l)">{{ d.t }}</span>
        </div>
      </div>
      <div class="bgroup">
        <div class="bg-label">labels</div>
        <div class="chips">
          <span v-for="l in store.sortedLabels()" :key="l.id" class="chip"
                :class="{on: has('label',l.name), kfocus: isFocused('label',l.name)}" @click="toggle('label',l.name)">#{{ l.name }}</span>
        </div>
      </div>
      <div class="bgroup">
        <div class="bg-label">project</div>
        <div class="chips">
          <span v-for="p in store.projects" :key="p.id" class="chip"
                :class="{on: has('project',p.name), kfocus: isFocused('project',p.name)}" @click="toggleExclusive('project',p.name)">
            <span :style="{color:p.color}">{{ p.glyph }}</span> {{ p.name }}
          </span>
        </div>
      </div>
      <div class="bgroup">
        <div class="bg-label">flags</div>
        <div class="chips">
          <span class="chip" :class="{on: has('recurring','true'), kfocus: isFocused('flags','true')}" @click="toggleExclusive('recurring','true')">↻ recurring</span>
          <span class="chip" :class="{on: has('reminder','set'), kfocus: isFocused('flags','set')}" @click="toggle('reminder','set')">◔ has reminder</span>
          <span class="chip" :class="{on: has('has','subtasks'), kfocus: isFocused('flags','subtasks')}" @click="toggle('has','subtasks')">⊟ has subtasks</span>
          <span class="chip" :class="{on: has('is','subtask'), kfocus: isFocused('flags','subtask')}" @click="toggle('is','subtask')">└ is subtask</span>
        </div>
      </div>
    </div>
  </div>
  `,
  data(){
    return {
      dueOpts:[
        {v:'today',t:'today'},{v:'tomorrow',t:'tomorrow'},{v:'overdue',t:'overdue'},
        {v:'week',t:'≤7d'},{v:'<3d',t:'<3d'},{v:'none',t:'no date'},{v:'set',t:'has date'}
      ],
      // weekday window toggles (build one due:<letters> value, e.g. due:su)
      dueDays:[
        {l:'m',t:'M'},{l:'t',t:'T'},{l:'w',t:'W'},{l:'r',t:'R'},{l:'f',t:'F'},{l:'s',t:'S'},{l:'u',t:'U'}
      ],
      focusGroup:null,   // keyboard-focused builder group key
      focusValue:null,   // keyboard-focused chip value within that group
    };
  },
  computed: {
    isCustom(){ return this.store.view.kind==='query' && this.store.view.id==='custom'; },
    // structured groups (matching the rendered chips) for keyboard navigation;
    // each chip carries its field + value + whether it's exclusive (one-per-field)
    navGroups(){
      return [
        { key:'status',  chips:['open','done','overdue','today'].map(v=>({field:'status',value:v,exclusive:true})) },
        { key:'due',     chips:[ ...this.dueOpts.map(o=>({field:'due',value:o.v,exclusive:true})),
                                 ...this.dueDays.map(d=>({field:'due',value:d.l,dueDay:true})) ] },
        { key:'label',   chips:this.store.sortedLabels().map(l=>({field:'label',value:l.name,exclusive:false})) },
        { key:'project', chips:this.store.projects.map(p=>({field:'project',value:p.name,exclusive:true})) },
        { key:'flags',   chips:[
          {field:'recurring',value:'true',exclusive:true},
          {field:'reminder',value:'set',exclusive:false},
          {field:'has',value:'subtasks',exclusive:false},
          {field:'is',value:'subtask',exclusive:false},
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
    // ---- keyboard navigation of the builder (driven from index.html onKey) ----
    isFocused(group,value){
      return this.store.focusPane==='filter' && this.focusGroup===group && this.focusValue===value;
    },
    nonEmptyGroups(){ return this.navGroups.filter(g=>g.chips.length); },
    currentChip(){
      const g=this.navGroups.find(g=>g.key===this.focusGroup);
      return g ? (g.chips.find(c=>c.value===this.focusValue)||null) : null;
    },
    finit(){   // place focus on the first available chip
      const groups=this.nonEmptyGroups();
      if(!groups.length){ this.focusGroup=null; this.focusValue=null; return; }
      this.focusGroup=groups[0].key; this.focusValue=groups[0].chips[0].value;
      this.scrollChipIntoView();
    },
    fmove(key){   // h/l switch group, j/k move within the group
      const groups=this.nonEmptyGroups();
      if(!groups.length) return;
      let gi=groups.findIndex(g=>g.key===this.focusGroup); if(gi<0) gi=0;
      let ci=groups[gi].chips.findIndex(c=>c.value===this.focusValue); if(ci<0) ci=0;
      if(key==='h'||key==='ArrowLeft'){ gi=Math.max(0,gi-1); ci=0; }
      else if(key==='l'||key==='ArrowRight'){ gi=Math.min(groups.length-1,gi+1); ci=0; }
      else if(key==='k'||key==='ArrowUp'){ ci=Math.max(0,ci-1); }
      else if(key==='j'||key==='ArrowDown'){ ci=Math.min(groups[gi].chips.length-1,ci+1); }
      this.focusGroup=groups[gi].key; this.focusValue=groups[gi].chips[ci].value;
      this.scrollChipIntoView();
    },
    ftoggleFocused(){
      const c=this.currentChip(); if(!c) return;
      if(c.dueDay) this.toggleDueWeekday(c.value);
      else if(c.exclusive) this.toggleExclusive(c.field,c.value);
      else this.toggle(c.field,c.value);
    },
    scrollChipIntoView(){
      this.$nextTick(()=>{ const el=document.querySelector('.builder .chip.kfocus'); if(el) el.scrollIntoView({block:'nearest',inline:'nearest'}); });
    }
  }
};
