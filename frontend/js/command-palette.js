/* command-palette.js — ⌘K hub */
window.CommandPalette = {
  props: ['store','open'],
  emits: ['close','new-task','new-project','save-query'],
  template: `
  <div v-if="open" class="overlay" @click.self="$emit('close')">
    <div class="palette">
      <div class="palette-input">
        <span class="prompt">⌘</span>
        <input ref="input" v-model="q" placeholder="type a command or jump to…"
               @keydown.down.prevent="move(1)" @keydown.up.prevent="move(-1)"
               @keydown.enter.prevent="exec" @keydown.esc.prevent="$emit('close')" />
        <span class="mut" style="font-size:11px;">⎋</span>
      </div>
      <div class="palette-list" ref="list">
        <template v-for="(grp,gi) in grouped" :key="gi">
          <div class="palette-cat">{{ grp.cat }}</div>
          <div v-for="opt in grp.items" :key="opt.key"
               class="palette-opt" :class="{ active: flat[active] && flat[active].key===opt.key }"
               @click="choose(opt)" @mouseenter="active=indexOf(opt)">
            <span class="glyph" :style="opt.color?{color:opt.color}:{}">{{ opt.glyph }}</span>
            <span>{{ opt.label }}</span>
            <span class="desc">{{ opt.desc }}</span>
          </div>
        </template>
        <div v-if="!flat.length" class="palette-opt mut" style="cursor:default;">no matches</div>
      </div>
    </div>
  </div>
  `,
  data(){ return { q:'', active:0 }; },
  computed: {
    commands(){
      const s=this.store; const out=[];
      out.push({ key:'new-task', cat:'actions', glyph:'+', label:'New task', desc:'n', run:()=>this.$emit('new-task') });
      out.push({ key:'new-proj', cat:'actions', glyph:'▣', label:'New project', desc:'', run:()=>this.$emit('new-project', null) });
      if(s.view.kind==='project') out.push({ key:'new-sub', cat:'actions', glyph:'▸', label:'New subproject in '+s.view.title, desc:'', run:()=>this.$emit('new-project', s.view.id) });
      out.push({ key:'save-q', cat:'actions', glyph:'★', label:'Save current query as view', desc:'', run:()=>this.$emit('save-query', s.view.query||'') });
      out.push({ key:'toggle-done', cat:'actions', glyph:'☑', label:(s.completion.done?'Hide':'Show')+' completed', desc:'', run:()=>s.toggleCompletion('done') });
      ['due','created','title','project'].forEach(by=>out.push({ key:'sort-'+by, cat:'sort', glyph:'⇅', label:'Sort by '+by, desc:'', run:()=>s.sortBy=by }));
      s.savedQueries.forEach(sv=>out.push({ key:'view-'+sv.id, cat:'views', glyph:sv.glyph, label:sv.name, desc:sv.query, run:()=>s.openQueryView(sv) }));
      const walk=(p,pre)=>{ out.push({ key:'proj-'+p.id, cat:'projects', glyph:p.glyph, color:s.resolveColor(p.color), label:pre+p.name, desc:s.projectCount(p.id)+' open', run:()=>s.openProjectView(p) }); s.childProjects(p.id).forEach(c=>walk(c,pre+'↳ ')); };
      s.projects.filter(p=>!p.parentId).forEach(p=>walk(p,''));
      return out;
    },
    flat(){
      const term=this.q.trim().toLowerCase();
      if(!term) return this.commands;
      return this.commands.filter(c=>fuzzy(c.label.toLowerCase()+' '+c.cat, term));
    },
    grouped(){
      const order=['actions','views','projects','sort'];
      const map={};
      this.flat.forEach(c=>{ (map[c.cat]=map[c.cat]||[]).push(c); });
      return order.filter(c=>map[c]).map(c=>({cat:c, items:map[c]}));
    }
  },
  watch: {
    open(v){ if(v){ this.q=''; this.active=0; this.$nextTick(()=>this.$refs.input&&this.$refs.input.focus()); } },
    q(){ this.active=0; }
  },
  methods: {
    indexOf(opt){ return this.flat.findIndex(c=>c.key===opt.key); },
    move(d){ const n=this.flat.length; if(!n) return; this.active=(this.active+d+n)%n; this.scroll(); },
    exec(){ const opt=this.flat[this.active]; if(opt) this.choose(opt); },
    choose(opt){ this.$emit('close'); this.$nextTick(()=>opt.run()); },
    scroll(){ this.$nextTick(()=>{ const el=this.$refs.list&&this.$refs.list.querySelector('.palette-opt.active'); const box=this.$refs.list; if(!el||!box) return; const et=el.offsetTop, eb=et+el.offsetHeight; if(et<box.scrollTop) box.scrollTop=et-4; else if(eb>box.scrollTop+box.clientHeight) box.scrollTop=eb-box.clientHeight+4; }); }
  }
};
function fuzzy(hay, needle){
  let i=0; for(const ch of needle){ i=hay.indexOf(ch,i); if(i<0) return false; i++; } return true;
}
