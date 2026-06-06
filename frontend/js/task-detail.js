/* task-detail.js — detail / edit drawer */
window.TaskDetail = {
  props: ['store'],
  template: `
  <div class="detail" :class="{ hidden: !store.detailOpen || !task }">
    <div v-if="task" class="detail-head">
      <span class="mut">task</span>
      <span class="cy">#{{ task.id }}</span>
      <span v-if="parentTask" class="mut">· sub of "{{ parentTask.title.slice(0,18) }}"</span>
      <span class="x" @click="close" title="Close (esc)">✕</span>
    </div>

    <div v-if="task" class="detail-body">
      <textarea ref="title" class="d-title" v-model="task.title" rows="1" @input="autosize" @keydown.enter.prevent="save" @keydown.esc.stop.prevent="escField('title')"></textarea>

      <!-- project + status -->
      <div class="row2">
        <div class="field">
          <label>project</label>
          <select class="input" v-model="task.projectId">
            <option v-for="p in store.projects" :key="p.id" :value="p.id">{{ indent(p) }}{{ p.name }}</option>
          </select>
        </div>
        <div class="field">
          <label>status · priority</label>
          <div style="display:flex;gap:6px;">
            <button class="btn" style="flex:1;justify-content:center;" :class="{primary: task.done}" @click="store.toggleDone(task)">
              {{ task.done ? '✓ done' : '○ open' }}
            </button>
            <select class="input" style="flex:1;" v-model.number="task.priority">
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
        <div class="field">
          <label>due date</label>
          <input class="input" type="date" v-model="task.due" @keydown.enter="save" />
        </div>
        <div class="field">
          <label>reminder</label>
          <input class="input" type="datetime-local" v-model="task.reminder" @keydown.enter="save" />
        </div>
      </div>
      <div class="field" v-if="task.due" style="margin-top:-6px;">
        <span class="mut" style="font-size:11px;">{{ dueRel }}</span>
      </div>

      <!-- labels -->
      <div class="field">
        <label>labels</label>
        <div class="labelpick">
          <span v-for="l in store.sortedLabels()" :key="l.id" class="chip" :class="{on: task.labels.includes(l.id)}" @click="toggleLabel(l.id)">#{{ l.name }}</span>
          <span class="chip" @click="addLabel">+ new</span>
        </div>
      </div>

      <!-- recurrence -->
      <div class="field">
        <label>recurrence</label>
        <recurrence-builder v-model="task.recurrence" :anchor="task.due"></recurrence-builder>
      </div>

      <!-- notes -->
      <div class="field">
        <label>notes</label>
        <textarea ref="notes" class="d-notes" v-model="task.notes" placeholder="# markdown-ish notes…" @keydown.esc.stop.prevent="escField('notes')"></textarea>
      </div>

      <!-- subtasks -->
      <div class="field">
        <label>subtasks <span class="mut">{{ doneSubs }}/{{ subs.length }}</span></label>
        <div v-for="s in subs" :key="s.id" class="task" style="padding:3px 0;border:none;cursor:default;">
          <span class="checkbox" :class="{on:s.done}" @click="store.toggleDone(s)">{{ s.done ? '✓' : '' }}</span>
          <input class="input" style="border:none;background:transparent;padding:2px 4px;" v-model="s.title" :class="{done:s.done}" :style="s.done?{textDecoration:'line-through',color:'var(--amber-mut)'}:{}" />
          <span class="twist-sub" @click="store.deleteTask(s)" title="Delete">✕</span>
        </div>
        <div class="quickadd" style="border:1px solid var(--line-2);background:var(--bg-3);border-radius:2px;margin-top:4px;padding:4px 8px;">
          <span class="prompt">+</span>
          <input v-model="subDraft" placeholder="add subtask…" @keydown.enter="addSub" />
        </div>
      </div>
    </div>

    <div v-if="task" class="d-actions">
      <button class="btn primary" @click="save"><span>save ↵</span></button>
      <button class="btn" @click="duplicate"><span>d<u>u</u>plicate</span></button>
      <button class="btn danger" style="margin-left:auto;" @click="del"><span><u>d</u>elete</span></button>
    </div>
  </div>
  `,
  computed: {
    task(){ return this.store.taskById(this.store.selectedTaskId); },
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
    'store.selectedTaskId'(){ this.$nextTick(()=>{ this.autosize(); this.snapshotBaseline(); }); },
    'store.detailOpen'(v){ if(v) this.$nextTick(this.snapshotBaseline); }
  },
  methods: {
    close(){ this.store.detailOpen=false; },
    // signature of the editable fields, to detect unsaved edits since the drawer opened
    taskSig(){ const t=this.task; return t ? JSON.stringify([t.title,t.notes,t.due,t.reminder,t.projectId,t.recurrence,t.priority,(t.labels||[]).slice().sort()]) : ''; },
    snapshotBaseline(){ this._baseline = this.taskSig(); },
    isDirty(){ return !!this.task && this.taskSig() !== this._baseline; },
    // Escape out of a detail text field: release the cursor, and if there are
    // unsaved edits confirm before closing (No keeps you in the field).
    async escField(refName){
      const el=this.$refs[refName]; if(el) el.blur();
      if(!this.isDirty()){ this.store.detailOpen=false; return; }
      const ok = await this.store.askConfirm('Save changes and close?  ·  No = keep editing');
      if(ok){ this.save(); }
      else { this.$nextTick(()=>{ const e2=this.$refs[refName]; if(e2) e2.focus(); }); }
    },
    save(){
      if(this.$refs.title) this.$refs.title.blur();
      if(this.store.saveNow) this.store.saveNow();   // flush the debounced write now
      this.store.toast('✓ saved');
      this.snapshotBaseline();
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
  },
  data(){ return { subDraft:'' }; }
};
