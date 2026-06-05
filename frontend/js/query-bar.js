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
      <span class="qbtn" :class="{on: store.builderOpen}" @click="store.builderOpen=!store.builderOpen" title="Visual builder">⊞ build</span>
      <span class="qbtn" @click="$emit('save-query', queryString)" title="Save as smart view">★ save</span>
      <span v-if="isCustom" class="qbtn" @click="clearQuery" title="Clear">✕</span>
    </div>

    <div v-if="store.builderOpen" class="builder">
      <div class="bgroup">
        <div class="bg-label">status</div>
        <div class="chips">
          <span v-for="s in ['open','done','overdue','today']" :key="s" class="chip"
                :class="{on: has('status',s)}" @click="toggleExclusive('status',s)">{{ s }}</span>
        </div>
      </div>
      <div class="bgroup">
        <div class="bg-label">due</div>
        <div class="chips">
          <span v-for="dd in dueOpts" :key="dd.v" class="chip"
                :class="{on: has('due',dd.v)}" @click="toggleExclusive('due',dd.v)">{{ dd.t }}</span>
        </div>
      </div>
      <div class="bgroup">
        <div class="bg-label">labels</div>
        <div class="chips">
          <span v-for="l in store.labels" :key="l.id" class="chip"
                :class="{on: has('label',l.name)}" @click="toggle('label',l.name)">#{{ l.name }}</span>
        </div>
      </div>
      <div class="bgroup">
        <div class="bg-label">project</div>
        <div class="chips">
          <span v-for="p in store.projects" :key="p.id" class="chip"
                :class="{on: has('project',p.name)}" @click="toggleExclusive('project',p.name)">
            <span :style="{color:p.color}">{{ p.glyph }}</span> {{ p.name }}
          </span>
        </div>
      </div>
      <div class="bgroup">
        <div class="bg-label">flags</div>
        <div class="chips">
          <span class="chip" :class="{on: has('recurring','true')}" @click="toggleExclusive('recurring','true')">↻ recurring</span>
          <span class="chip" :class="{on: has('reminder','set')}" @click="toggle('reminder','set')">◔ has reminder</span>
          <span class="chip" :class="{on: has('has','subtasks')}" @click="toggle('has','subtasks')">⊟ has subtasks</span>
          <span class="chip" :class="{on: has('is','subtask')}" @click="toggle('is','subtask')">└ is subtask</span>
        </div>
      </div>
      <div class="bgroup" style="margin-left:auto;justify-content:flex-end;">
        <div class="bg-label">&nbsp;</div>
        <div class="chips"><span class="chip" @click="clearQuery">⌫ clear all</span></div>
      </div>
    </div>
  </div>
  `,
  data(){
    return {
      dueOpts:[
        {v:'today',t:'today'},{v:'tomorrow',t:'tomorrow'},{v:'overdue',t:'overdue'},
        {v:'week',t:'≤7d'},{v:'<3d',t:'<3d'},{v:'none',t:'no date'},{v:'set',t:'has date'}
      ]
    };
  },
  computed: {
    isCustom(){ return this.store.view.kind==='query' && this.store.view.id==='custom'; },
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
    has(field,value){ return this.terms.some(t=>t.field===field && t.value===String(value).toLowerCase() && !t.neg); },
    setTerms(terms){ this.queryString = Q.build(terms); },
    toggle(field,value){
      value=String(value).toLowerCase();
      const terms=[...this.terms];
      const i=terms.findIndex(t=>t.field===field && t.value===value);
      if(i>=0) terms.splice(i,1); else terms.push({field,value,neg:false});
      this.setTerms(terms);
    },
    // only one value allowed per field (status, due, project, recurring)
    toggleExclusive(field,value){
      value=String(value).toLowerCase();
      const on=this.has(field,value);
      let terms=this.terms.filter(t=>t.field!==field);
      if(!on) terms.push({field,value,neg:false});
      this.setTerms(terms);
    },
    clearQuery(){ this.queryString=''; },
    run(){ this.$refs.q && this.$refs.q.blur(); },
    blur(){ this.$refs.q && this.$refs.q.blur(); },
    focus(){ this.$refs.q && (this.$refs.q.focus(), this.$refs.q.select()); }
  }
};
