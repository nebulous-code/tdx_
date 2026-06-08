/* task-detail.js — detail / edit drawer. A captured keyboard pane (focusPane
   ==='detail'): the app's global onKey routes nav keys into the shared KbForm
   mixin (kbAutoListen:false — the drawer is always mounted, so the app drives it
   rather than KbForm attaching its own document listener). j/k walk the fields,
   i/click edits, space toggles, Enter saves; Shift+J/K swap to the prev/next
   task. Recurrence + existing subtasks stay mouse-driven for now. */
window.TaskDetail = {
  props: ['store'],
  mixins: [window.KbForm],
  template: `
  <div class="detail" :class="{ hidden: !store.detailOpen || !task }">
    <div v-if="task" class="detail-head">
      <span class="mut">task</span>
      <span class="cy">#{{ task.id }}</span>
      <span v-if="parentTask" class="mut">· sub of "{{ parentTask.title.slice(0,18) }}"</span>
      <span class="x" @click="close" title="Close (esc)">✕</span>
    </div>

    <div v-if="task" class="detail-body">
      <textarea ref="title" class="d-title" :class="kbCls('title')" v-model="task.title" rows="1" @input="autosize" @focus="kbFocusRow('title')" @keydown.enter.prevent="save" @keydown.esc.stop.prevent="blurField"></textarea>

      <!-- project + status -->
      <div class="row2">
        <div class="field" :class="kbCls('project')">
          <label>project</label>
          <select ref="project" class="input" v-model="task.projectId" @focus="kbFocusRow('project')" @keydown.esc.stop.prevent="blurField">
            <option v-for="({p,depth}) in projectOptions" :key="p.id" :value="p.id">{{ depth ? '↳ ' : '' }}{{ p.name }}</option>
          </select>
        </div>
        <div class="field">
          <label>status · priority</label>
          <div style="display:flex;gap:6px;">
            <button class="btn" style="flex:1;justify-content:center;" :class="[{primary: task.done}, kbCls('status')]" @click="store.toggleDone(task)">
              {{ task.done ? '✓ done' : '☐ open' }}
            </button>
            <select ref="priority" class="input" style="flex:1;" :class="kbCls('priority')" v-model.number="task.priority" @focus="kbFocusRow('priority')" @keydown.esc.stop.prevent="blurField">
              <option :value="5">5 v.high</option>
              <option :value="4">4 high</option>
              <option :value="3">3 med</option>
              <option :value="2">2 low</option>
              <option :value="1">1 v.low</option>
              <option :value="0">0 none</option>
            </select>
          </div>
        </div>
      </div>

      <!-- due + reminder -->
      <div class="row2">
        <div class="field" :class="kbCls('due')">
          <label>due date</label>
          <input ref="due" class="input" type="date" v-model="task.due" @focus="kbFocusRow('due')" @keydown.enter="save" @keydown.esc.stop.prevent="blurField" />
        </div>
        <div class="field" :class="kbCls('reminder')">
          <label>reminder</label>
          <input ref="reminder" class="input" type="datetime-local" v-model="task.reminder" @focus="kbFocusRow('reminder')" @keydown.enter="save" @keydown.esc.stop.prevent="blurField" />
        </div>
      </div>
      <div class="field" v-if="task.due" style="margin-top:-6px;">
        <span class="mut" style="font-size:11px;">{{ dueRel }}</span>
      </div>

      <!-- labels -->
      <div class="field">
        <label>labels</label>
        <div class="labelpick">
          <span v-for="(l,i) in store.sortedLabels()" :key="l.id" class="chip" :class="[{on: task.labels.includes(l.id)}, kbCls('labels', i)]" @click="kbPick('labels', i)">#{{ l.name }}</span>
          <span class="chip" :class="kbCls('addlabel')" @click="addLabel">+ new</span>
        </div>
      </div>

      <!-- recurrence -->
      <div class="field" :class="!recurActive ? kbCls('recur') : null">
        <label>recurrence
          <span class="mut" v-if="recurActive" style="font-size:11px;text-transform:none;">— editing · esc to exit</span>
          <span class="mut" v-else-if="kbCls('recur').kfocus" style="font-size:11px;text-transform:none;">— i to edit</span>
        </label>
        <recurrence-builder ref="recur" v-model="task.recurrence" :anchor="task.due" :active="recurActive"></recurrence-builder>
      </div>

      <!-- notes -->
      <div class="field">
        <label>notes</label>
        <textarea ref="notes" class="d-notes" :class="kbCls('notes')" v-model="task.notes" placeholder="# markdown-ish notes… (⌘+↵ saves)" @focus="kbFocusRow('notes')" @keydown.enter.ctrl.prevent="save" @keydown.enter.meta.prevent="save" @keydown.esc.stop.prevent="blurField"></textarea>
      </div>

      <!-- subtasks -->
      <div class="field">
        <label>subtasks <span class="mut">{{ doneSubs }}/{{ subs.length }}</span></label>
        <div v-for="s in subs" :key="s.id" class="task" style="padding:3px 0;border:none;cursor:default;">
          <span class="checkbox" :class="{on:s.done}" @click="store.toggleDone(s)">{{ s.done ? '✓' : '' }}</span>
          <input class="input" style="border:none;background:transparent;padding:2px 4px;" v-model="s.title" :class="{done:s.done}" :style="s.done?{textDecoration:'line-through',color:'var(--amber-mut)'}:{}" />
          <span class="twist-sub" @click="store.deleteTask(s)" title="Delete">✕</span>
        </div>
        <div class="quickadd" :class="kbCls('addsub')" style="border:1px solid var(--line-2);background:var(--bg-3);border-radius:2px;margin-top:4px;padding:4px 8px;">
          <span class="prompt">+</span>
          <input ref="addsub" v-model="subDraft" placeholder="add subtask…" @focus="kbFocusRow('addsub')" @keydown.enter="addSub" @keydown.esc.stop.prevent="blurField" />
        </div>
      </div>
    </div>

    <div v-if="task" class="d-actions">
      <button class="btn primary" :class="kbCls('save')" @click="save"><span>save ↵</span></button>
      <button class="btn" :class="kbCls('duplicate')" @click="duplicate"><span>d<u>u</u>plicate</span></button>
      <button class="btn danger" :class="kbCls('delete')" style="margin-left:auto;" @click="del"><span><u>d</u>elete</span></button>
    </div>
  </div>
  `,
  data(){ return { subDraft:'', kbAutoListen:false, kbAutofocus:false, recurActive:false }; },
  computed: {
    task(){ return this.store.taskById(this.store.selectedTaskId); },
    projectOptions(){ return this.store.projectTree(); },   // tree-ordered for the project select
    parentTask(){ return this.task && this.task.parentId ? this.store.taskById(this.task.parentId) : null; },
    subs(){ return this.task ? this.store.subtasks(this.task.id) : []; },
    doneSubs(){ return this.subs.filter(s=>s.done).length; },
    dueRel(){
      if(!this.task || !this.task.due) return '';
      const d = Rec.daysBetween(Rec.startOfDay(new Date()), Rec.parseYMD(this.task.due));
      if(d===0) return '◷ due today';
      if(d<0) return '◷ overdue by '+Math.abs(d)+' day(s)';
      return '◷ due in '+d+' day(s)';
    }
  },
  watch: {
    'store.selectedTaskId'(){ this.$nextTick(this.autosize); },
    'store.detailOpen'(v){ if(v) this.$nextTick(()=>{
      this.kbInit();
      if(this.store.pendingNotesFocus){   // quick-add Shift+Enter: land in the notes field
        this.store.pendingNotesFocus = false;
        this.kbFocusRow('notes');
        const el=this.$refs.notes; if(el) el.focus();
      }
    }); }
  },
  methods: {
    // ---- KbForm config (the app routes keys here via onKey; see header) ----
    kbRows(){
      const labels = this.store.sortedLabels();
      return [
        { id:'title',     type:'input',  ref:'title' },
        { id:'project',   type:'input',  ref:'project' },
        { id:'status',    type:'button', activate:()=>this.store.toggleDone(this.task) },
        { id:'priority',  type:'input',  ref:'priority' },
        { id:'due',       type:'input',  ref:'due' },
        { id:'reminder',  type:'input',  ref:'reminder' },
        { id:'labels',    type:'grid',   items:labels, cols:99,
          isOn:l=>this.task.labels.includes(l.id), select:l=>this.toggleLabel(l.id), when:()=>labels.length>0 },
        { id:'addlabel',  type:'button', activate:()=>this.addLabel() },
        { id:'recur',     type:'static' },   // l/space/enter descends into the recurrence builder
        { id:'notes',     type:'input',  ref:'notes' },
        { id:'addsub',    type:'input',  ref:'addsub' },
        { id:'save',      type:'button', activate:()=>this.save() },
        { id:'duplicate', type:'button', activate:()=>this.duplicate() },
        { id:'delete',    type:'button', activate:()=>this.del() },
      ];
    },
    kbSubmit(){ this.save(); },
    blurField(){ const a=document.activeElement; if(a && a.blur) a.blur(); },
    // ---- recurrence sub-pane (a nested KbForm we delegate keys into) ----
    enterRecur(){
      const b=this.$refs.recur; if(!b) return;
      this.recurActive=true;
      b.kbRow=0; b.kbCell=0; b.kbGoalCol=0;   // land on the frequency row
    },
    exitRecur(){
      this.recurActive=false;
      const a=document.activeElement; if(a && a.blur) a.blur();   // drop out of any builder input
    },
    // called first by KbForm.kbKey: when inside the builder, forward keys to it
    // (Esc — or h at the left edge — pops back out); otherwise l/space/enter descends in.
    kbDelegate(e){
      const b=this.$refs.recur;
      if(this.recurActive){
        if(e.key==='Escape'){ e.preventDefault(); this.exitRecur(); return true; }
        if(b){
          const r=b.kbCur && b.kbCur();
          // h at a row's left edge pops out; j/k off the top/bottom flow back into the parent form
          if((e.key==='h'||e.key==='ArrowLeft') && (!r || r.cellCount<=1 || b.kbCell===0)){ e.preventDefault(); this.exitRecur(); return true; }
          if((e.key==='k'||e.key==='ArrowUp') && b.kbRow===0){ e.preventDefault(); this.exitRecur(); this.kbMove(-1); return true; }
          if((e.key==='j'||e.key==='ArrowDown') && b.kbRow===b.kbNav.length-1){ e.preventDefault(); this.exitRecur(); this.kbMove(1); return true; }
          b.kbKey(e);
        }
        return true;
      }
      const cur=this.kbCur();
      if(cur && cur.id==='recur' && e.key==='i'){   // i = edit, like every other field
        e.preventDefault(); this.enterRecur(); return true;
      }
      return false;
    },
    close(){ this.store.detailOpen=false; },
    save(){
      const a=document.activeElement; if(a && a.blur) a.blur();   // release focus from any field (e.g. notes on ⌃/⌘+↵)
      if(this.store.saveNow) this.store.saveNow();   // flush the debounced write now
      this.store.toast('✓ saved');
      this.store.detailOpen=false;
    },
    indent(p){ return p.parentId ? '  ↳ ' : ''; },
    toggleLabel(id){
      const i=this.task.labels.indexOf(id);
      if(i>=0) this.task.labels.splice(i,1); else this.task.labels.push(id);
    },
    async addLabel(){
      const name = await this.store.askPrompt('new label');
      if(name){ const l=this.store.addLabel(name); if(!this.task.labels.includes(l.id)) this.task.labels.push(l.id); }
    },
    addSub(){
      const t=this.subDraft.trim(); if(!t) return;
      this.store.addTask({ title:t, projectId:this.task.projectId, parentId:this.task.id });
      this.subDraft='';
    },
    duplicate(){
      const t=this.task;
      const copy=this.store.addTask({ title:t.title+' (copy)', projectId:t.projectId, due:t.due, reminder:t.reminder, labels:[...t.labels], rec:t.recurrence, notes:t.notes, priority:t.priority });
      this.store.selectedTaskId=copy.id;
      this.store.toast('⧉ duplicated');
    },
    async del(){ if(await this.store.askConfirm('Delete this task'+(this.subs.length?' and its subtasks':'')+'?')) this.store.deleteTask(this.task); },
    autosize(){ const el=this.$refs.title; if(el){ el.style.height='auto'; el.style.height=el.scrollHeight+'px'; } }
  }
};
