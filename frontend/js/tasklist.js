/* tasklist.js — task rows with nested subtasks */
// sort fields cycled by the list-head button / the `s` shortcut; `^` toggles the
// direction (^ = ascending, v = descending), remembered per field for the session.
const SORTS = [
  { key:'due',      label:'due' },
  { key:'created',  label:'created' },
  { key:'title',    label:'title' },
  { key:'project',  label:'project' },
  { key:'priority', label:'priority' },
  { key:'size',     label:'size' },         // Fibonacci estimate (only when sizing is enabled)
  { key:'tag',      label:'tag' },          // group by concatenated label names
  { key:'modified', label:'modified' },     // last edited (task.updatedAt); desc = most-recent first
];
window.TaskRow = {
  name: 'task-row',
  props: ['store','task','depth'],
  template: `
  <div>
    <div class="task" data-testid="task-row" :class="{ done: task.done, sel: store.selectedTaskId===task.id, moving: store.taskMoveId===task.id }"
         :style="rowStyle"
         @click="select">
      <span v-if="subs.length" class="twist-sub" @click.stop="task.collapsed=!task.collapsed">{{ task.collapsed ? '▸' : '▾' }}</span>
      <span v-else-if="depth>0" class="twist-sub mut">└</span>
      <span class="checkbox" :class="{ on: task.done }" @click.stop="store.toggleDone(task)">{{ task.done ? '✓' : '' }}</span>
      <div class="tmain">
        <div class="ttitle" data-testid="task-title">{{ task.title }}</div>
        <div class="tmeta">
          <span v-if="task.readableId" class="m rid mut" title="readable id">{{ task.readableId }}</span>
          <span v-if="depth===0 && proj" class="m tproj">
            <span :style="{color: store.resolveColor(proj.color)}">{{ proj.glyph }}</span>{{ proj.name }}
          </span>
          <span v-if="task.priority" class="m prio" :class="'prio'+task.priority" :title="'priority: '+prioName">⚑ {{ prioName }}</span>
          <span v-if="task.size && store.currentUser && store.currentUser.fib_sizing" class="m size" :class="{ 'size-max': task.size===13 }" :title="'size '+task.size">Σ {{ task.size }}</span>
          <span v-if="task.due" class="m" :class="dueClass">◷ {{ dueLabel }}</span>
          <span v-if="task.reminder" class="m">◔ rem {{ relLabel(task.reminder) }}</span>
          <span v-if="task.recurrence" class="m rec" :title="recFull">↻ {{ recShort }}</span>
          <span v-if="subs.length" class="m">⊟ {{ doneSubs }}/{{ subs.length }}</span>
          <span v-for="lid in task.labels" :key="lid" class="tag">#{{ labelName(lid) }}</span>
        </div>
      </div>
      <span v-if="depth===0 && proj" class="tcat-icon" :style="{ color: store.resolveColor(proj.color) }" :title="proj.name">{{ proj.glyph }}</span>
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
    // indent + a faint wash in the project color (root rows only) per §2.1
    rowStyle(){
      const s = { paddingLeft: (12 + this.depth*22) + 'px' };
      if(this.depth===0 && this.proj){
        const c = this.store.resolveColor(this.proj.color);
        s.background = 'color-mix(in srgb, '+c+' 7%, transparent)';
      }
      return s;
    },
    prioName(){ return this.store.priorityLabel(this.task.priority); },
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
    select(){ this.store.selectTask(this.task.id); },
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
      <span class="qa-caret">❯</span>
      <span class="qa-input-wrap">
        <input ref="qa" data-testid="task-quickadd" v-model="draft" :placeholder="addPlaceholder" @keydown.enter.exact.prevent="commitAdd" @keydown.enter.shift.prevent="commitAddToNotes" @keydown.esc="escAdd" @keydown.tab="acceptTag" @keydown.right="acceptTag" />
        <span v-if="tagGhost" class="qa-ghost" aria-hidden="true"><span class="qa-ghost-pre">{{ draft }}</span>{{ tagGhost }}<span class="qa-ghost-hint"> →</span></span>
      </span>
      <span class="mut" style="font-size:11px;">↵ add</span>
    </div>

    <div class="list-head">
      <span class="grow">{{ rootTasks.length }} task{{ rootTasks.length===1?'':'s' }}<span v-if="doneCount"> · {{ doneCount }} done</span></span>
      <span v-if="store.view.kind==='project' || String(store.view.id).startsWith('label_')" class="qbtn" :class="{on: store.completion.done}" @click="store.toggleCompletion('done')" title="show / hide completed (c)">{{ store.completion.done ? '☑' : '☐' }} <u>c</u>ompleted</span>
      <span class="qbtn" @click="cycleSort" title="cycle sort field (s)"><u>s</u>ort: {{ sortFieldLabel }}</span>
      <span class="qbtn" @click="toggleSortDir" title="toggle direction (^)">{{ sortDirSymbol }}</span>
    </div>

    <div class="list-wrap" ref="scroll">
      <template v-if="rootTasks.length">
        <task-row v-for="t in rootTasks" :key="t.id" :store="store" :task="t" :depth="0"></task-row>
      </template>
      <div v-else class="empty">
        <pre>  ┌─────────────┐
  │   no tasks   │
  └─────────────┘</pre>
        <div v-if="store.searchActive && store.searchTerm" style="margin-top:10px;">no matches for "{{ store.searchTerm }}".</div>
        <div v-else-if="store.searchActive" style="margin-top:10px;">type to search…</div>
        <div v-else style="margin-top:10px;">query returned 0 rows.</div>
        <div class="mut" style="margin-top:4px;">press <span class="kbd">i</span> to add · <span class="kbd">/</span> to search</div>
      </div>
    </div>
  </div>
  `,
  computed: {
    addPlaceholder(){
      if(this.store.view.kind==='project'){
        const p = this.store.projectById(this.store.view.id);
        return 'add to '+(p?p.name:'project')+'…  (try: Call Mom #fun !5)';
      }
      return 'add task…  (try: Call Mom #fun !5)';
    },
    matched(){
      const ctx = this.store.ctx();
      const q = this.store.taskQuery();   // type: stripped — client Q has no 'type' field
      let list = Q.run(q, ctx);
      if(!/status:done|is:done/.test(q)) list = list.filter(this.store.completionPass);
      return list;
    },
    // show matched root tasks; if a subtask matches but parent doesn't, surface parent too
    rootTasks(){ return this.store.visibleRoots(); },
    doneCount(){ return this.matched.filter(t=>t.done && !t.parentId).length; },
    // current view filters on params we can't apply to a new task (flags / free text),
    // plus a draft-aware case: "no tag" is selected but the user typed a #tag — the
    // task is still created (tag respected), it just won't show in this view.
    hasNoTagFilter(){ return Q.parse(this.store.currentQuery()).terms.some(t => t.field==='has' && t.value==='no-labels' && !t.neg); },
    noTagConflict(){ return this.hasNoTagFilter && /#\S/.test(this.draft); },
    warn(){ return this.store.viewWarn() || this.noTagConflict; },
    warnTip(){
      return this.noTagConflict
        ? "\"no tag\" is selected, but this task has a #tag — it'll be created and kept, just hidden from this view."
        : "This filter has parameters that can't be applied to new tasks. New tasks may fall out of this query.";
    },
    sortFieldLabel(){ const o=SORTS.find(o=>o.key===this.store.sortField); return o ? o.label : this.store.sortField; },
    sortDirSymbol(){ return this.store.sortDirs[this.store.sortField]==='desc' ? 'v' : '^'; },
    // autofill: the grey completion of the trailing token being typed — now ANY sigil the
    // type accepts (`#tag`, `/project`, `$friday`), not just `#`. Without completion half
    // the grammar is invisible.
    tagGhost(){ return this.store.clGhost(this.draft, 'task'); }
  },
  methods: {
    cycleSort(){
      // advance through enabled sorts in the user's configured order (Shift+S);
      // 'size' only participates when Fibonacci sizing is enabled
      const fib = this.store.currentUser && this.store.currentUser.fib_sizing;
      const enabled = this.store.sortOrder.filter(k=>this.store.sortEnabled[k] && (k!=='size' || fib));
      if(!enabled.length) return;
      const i = enabled.indexOf(this.store.sortField);
      this.store.sortField = enabled[(i+1) % enabled.length];   // i<0 → first enabled
    },
    toggleSortDir(){
      const f=this.store.sortField;
      this.store.sortDirs[f] = this.store.sortDirs[f]==='desc' ? 'asc' : 'desc';
    },
    // parse the draft, create the task (inheriting the view's filters), clear the
    // box, select it. Returns the task (or null if the box was empty).
    addFromDraft(){
      const text = this.draft.trim();
      if(!text) return null;
      // The creation language (docs/CREATION_LANGUAGE.md): parse is pure and type-aware,
      // apply resolves names → ids (creating labels) and merges the view's implied fields.
      // TYPED BEATS IMPLIED — `$today` in a due:friday view means today; the view only
      // fills what you left blank.
      const parsed = CL.parse(text, { type:'task', known: this.store.clKnown });
      const t = this.store.addTask(CL.apply('task', parsed, this.store.clCtx('task')));
      this.draft = '';
      this.store.selectedTaskId = t.id;
      return t;
    },
    commitAdd(){
      if(this.addFromDraft()) this.store.toast('+ task added');
    },
    // Shift+Enter: create the task and jump into its detail, focused in notes
    commitAddToNotes(){
      const t = this.addFromDraft();
      if(!t) return;
      this.store.pendingNotesFocus = true;
      this.store.detailOpen = true;
    },
    // Tab / → completes the trailing token with the grey ghost suggestion (#tag · /project · $date).
    // For → only when the caret is at the very end (don't hijack cursor movement);
    // when there's no ghost, fall through so Tab/→ keep their normal behavior.
    acceptTag(e){
      if(!this.tagGhost) return;
      if(e.key==='ArrowRight'){ const el=this.$refs.qa; if(el && el.selectionStart!==el.value.length) return; }
      e.preventDefault();
      this.draft += this.tagGhost;
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
  }; },
  // The task list's half of the shared list cursor (a.2). Same interface the mixed list
  // registers, so store.listSwap() — and therefore J/K in the open drawer — is ONE
  // implementation rather than a task-shaped copy and a mixed-shaped copy.
  mounted(){
    this._unregCursor = this.store.registerListCursor({
      rows: () => this.store.visibleRows(),
      index: () => this.store.visibleRows().findIndex(t => t.id === this.store.selectedTaskId),
      go: (i) => {
        const t = this.store.visibleRows()[i];
        if(!t) return;
        this.store.selectedTaskId = t.id;
        this.store.detailOpen = true;
        this.$nextTick(() => {
          const el = document.querySelector('.list-wrap .task.sel');
          if(el && el.scrollIntoView) el.scrollIntoView({ block:'nearest' });
        });
      },
    });
  },
  beforeUnmount(){ if(this._unregCursor) this._unregCursor(); }
};
