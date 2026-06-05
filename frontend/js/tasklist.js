/* tasklist.js — task rows with nested subtasks */
window.TaskRow = {
  name: 'task-row',
  props: ['store','task','depth'],
  template: `
  <div>
    <div class="task" :class="{ done: task.done, sel: store.selectedTaskId===task.id }"
         :style="{ paddingLeft: (12 + depth*22) + 'px' }"
         @click="select">
      <span v-if="subs.length" class="twist-sub" @click.stop="task.collapsed=!task.collapsed">{{ task.collapsed ? '▸' : '▾' }}</span>
      <span v-else-if="depth>0" class="twist-sub mut">└</span>
      <span class="checkbox" :class="{ on: task.done }" @click.stop="store.toggleDone(task)">{{ task.done ? '✓' : '' }}</span>
      <div class="tmain">
        <div class="ttitle">{{ task.title }}</div>
        <div class="tmeta">
          <span v-if="depth===0 && proj" class="m tproj">
            <span :style="{color: proj.color}">{{ proj.glyph }}</span>{{ proj.name }}
          </span>
          <span v-if="task.due" class="m" :class="dueClass">◷ {{ dueLabel }}</span>
          <span v-if="task.reminder" class="m">◔ rem {{ relLabel(task.reminder) }}</span>
          <span v-if="task.recurrence" class="m rec" :title="recFull">↻ {{ recShort }}</span>
          <span v-if="subs.length" class="m">⊟ {{ doneSubs }}/{{ subs.length }}</span>
          <span v-for="lid in task.labels" :key="lid" class="tag">#{{ labelName(lid) }}</span>
        </div>
      </div>
    </div>
    <template v-if="!task.collapsed">
      <task-row v-for="s in subs" :key="s.id" :store="store" :task="s" :depth="depth+1"></task-row>
    </template>
  </div>
  `,
  computed: {
    subs(){ return this.store.subtasks(this.task.id); },
    doneSubs(){ return this.subs.filter(s=>s.done).length; },
    proj(){ return this.store.projectById(this.task.projectId); },
    recShort(){ return Rec.compact(this.task.recurrence); },
    recFull(){ return Rec.summary(this.task.recurrence); },
    dueDelta(){ return this.task.due ? Rec.daysBetween(Rec.startOfDay(new Date()), Rec.parseYMD(this.task.due)) : null; },
    dueClass(){
      if(this.task.done) return '';
      const d = this.dueDelta;
      if(d===null) return '';
      if(d<0) return 'overdue';
      if(d===0) return 'today';
      return 'due';
    },
    dueLabel(){ return this.relLabel(this.task.due); }
  },
  methods: {
    select(){ this.store.selectedTaskId = this.task.id; this.store.detailOpen = true; },
    labelName(id){ const l=this.store.labelById(id); return l?l.name:'?'; },
    relLabel(ymd){
      const date = (ymd||'').slice(0,10); // accept 'YYYY-MM-DD' or 'YYYY-MM-DDTHH:MM'
      const time = ymd && ymd.length>10 ? ' '+ymd.slice(11,16) : ''; // ' HH:MM'
      const d = Rec.daysBetween(Rec.startOfDay(new Date()), Rec.parseYMD(date));
      if(d===0) return 'today'+time;
      if(d===1) return 'tomorrow'+time;
      if(d===-1) return 'yesterday'+time;
      if(d<0) return Math.abs(d)+'d ago';
      if(d<=7) return 'in '+d+'d'+time;
      return date.slice(5)+time; // MM-DD
    }
  }
};

window.TaskList = {
  props: ['store'],
  template: `
  <div class="main-inner" style="display:flex;flex-direction:column;flex:1;min-height:0;">
    <!-- quick add -->
    <div class="quickadd">
      <span class="prompt" :class="{ warn }" :data-tip="warnTip">{{ warn ? '⚠' : '+' }}</span>
      <input ref="qa" v-model="draft" :placeholder="addPlaceholder" @keydown.enter="commitAdd" @keydown.esc="escAdd" />
      <span class="mut" style="font-size:11px;">↵ add</span>
    </div>

    <div class="list-head">
      <span class="grow">{{ rootTasks.length }} task{{ rootTasks.length===1?'':'s' }}<span v-if="doneCount"> · {{ doneCount }} done</span></span>
      <span class="qbtn" :class="{on: store.showCompleted}" @click="store.showCompleted=!store.showCompleted">{{ store.showCompleted ? '☑' : '☐' }} completed</span>
      <span class="qbtn" @click="cycleSort">sort: {{ store.sortBy }}</span>
    </div>

    <div class="list-wrap" ref="scroll">
      <template v-if="rootTasks.length">
        <task-row v-for="t in rootTasks" :key="t.id" :store="store" :task="t" :depth="0"></task-row>
      </template>
      <div v-else class="empty">
        <pre>  ┌─────────────┐
  │   no tasks   │
  └─────────────┘</pre>
        <div style="margin-top:10px;">query returned 0 rows.</div>
        <div class="mut" style="margin-top:4px;">press <span class="kbd">n</span> to add · <span class="kbd">/</span> to search</div>
      </div>
    </div>
  </div>
  `,
  computed: {
    addPlaceholder(){
      if(this.store.view.kind==='project'){
        const p = this.store.projectById(this.store.view.id);
        return 'add to '+(p?p.name:'project')+'…  (try: buy milk #errand)';
      }
      return 'add task…  (lands in '+ (this.store.projectById(this.store.currentProjectId())||{}).name +')';
    },
    matched(){
      const ctx = this.store.ctx();
      const q = this.store.currentQuery();
      let list = Q.run(q, ctx);
      if(!this.store.showCompleted && !/status:done|is:done/.test(q)) list = list.filter(t=>!t.done);
      return list;
    },
    // show matched root tasks; if a subtask matches but parent doesn't, surface parent too
    rootTasks(){ return this.store.visibleRoots(); },
    doneCount(){ return this.matched.filter(t=>t.done && !t.parentId).length; },
    // current view filters on params we can't apply to a new task (flags / free text)
    warn(){ return this.store.viewWarn(); }
  },
  methods: {
    sortList(list){
      const by = this.store.sortBy;
      const arr = [...list];
      arr.sort((a,b)=>{
        if(by==='due'){
          const av=a.due||'9999', bv=b.due||'9999';
          return av<bv?-1:av>bv?1:0;
        }
        if(by==='title') return a.title.localeCompare(b.title);
        if(by==='project'){
          const ap=(this.store.projectById(a.projectId)||{}).name||'';
          const bp=(this.store.projectById(b.projectId)||{}).name||'';
          return ap.localeCompare(bp);
        }
        return a.createdAt<b.createdAt?1:-1; // created desc
      });
      return arr;
    },
    cycleSort(){
      const order=['due','created','title','project'];
      const i=order.indexOf(this.store.sortBy);
      this.store.sortBy = order[(i+1)%order.length];
    },
    commitAdd(){
      const text = this.draft.trim();
      if(!text) return;
      const { title, labels } = this.parseQuickAdd(text);
      // inherit the current view's filters (status/due/labels/project) so the new
      // task stays visible; merge any #tags typed in the box with the view's labels
      const def = this.store.viewDefaults();
      const merged = [...new Set([...(def.labels||[]), ...labels])];
      const t = this.store.addTask({
        title, labels: merged,
        projectId: def.projectId, due: def.due, done: def.done,
      });
      this.draft = '';
      this.store.selectedTaskId = t.id;
      this.store.toast('+ task added');
    },
    parseQuickAdd(text){
      const labels=[];
      const title = text.replace(/#(\S+)/g, (_,n)=>{ const l=this.store.addLabel(n); labels.push(l.id); return ''; }).replace(/\s+/g,' ').trim();
      return { title: title||text, labels };
    },
    focusAdd(){ this.$refs.qa && this.$refs.qa.focus(); },
    // Esc out of the quick-add box: clear it, blur, and drop the keyboard into
    // the task list so j/k work immediately (selecting the first row if needed).
    escAdd(){
      this.draft = '';
      if(this.$refs.qa) this.$refs.qa.blur();
      this.store.focusPane = 'list';
      if(!this.store.selectedTaskId){
        const roots = this.store.visibleRoots();
        if(roots.length) this.store.selectedTaskId = roots[0].id;
      }
    }
  },
  data(){ return {
    draft:'',
    warnTip: "This filter has parameters that can't be applied to new tasks. New tasks may fall out of this query.",
  }; }
};
