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
      <textarea ref="title" class="d-title" v-model="task.title" rows="1" @input="autosize" @keydown.enter.prevent="blurTitle"></textarea>

      <!-- project + status -->
      <div class="row2">
        <div class="field">
          <label>project</label>
          <select class="input" v-model="task.projectId">
            <option v-for="p in store.projects" :key="p.id" :value="p.id">{{ indent(p) }}{{ p.name }}</option>
          </select>
        </div>
        <div class="field">
          <label>status</label>
          <button class="btn" style="width:100%;justify-content:center;" :class="{primary: task.done}" @click="store.toggleDone(task)">
            {{ task.done ? '✓ done' : '○ open' }}
          </button>
        </div>
      </div>

      <!-- due + reminder -->
      <div class="row2">
        <div class="field">
          <label>due date</label>
          <input class="input" type="date" v-model="task.due" />
        </div>
        <div class="field">
          <label>reminder</label>
          <input class="input" type="datetime-local" v-model="task.reminder" />
        </div>
      </div>
      <div class="field" v-if="task.due" style="margin-top:-6px;">
        <span class="mut" style="font-size:11px;">{{ dueRel }}</span>
      </div>

      <!-- labels -->
      <div class="field">
        <label>labels</label>
        <div class="labelpick">
          <span v-for="l in store.labels" :key="l.id" class="chip" :class="{on: task.labels.includes(l.id)}" @click="toggleLabel(l.id)">#{{ l.name }}</span>
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
        <textarea class="d-notes" v-model="task.notes" placeholder="# markdown-ish notes…"></textarea>
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
      <button class="btn" @click="duplicate">⧉ duplicate</button>
      <button class="btn danger" style="margin-left:auto;" @click="del">🗑 delete</button>
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
    'store.selectedTaskId'(){ this.$nextTick(this.autosize); }
  },
  methods: {
    close(){ this.store.detailOpen=false; },
    indent(p){ return p.parentId ? '  ↳ ' : ''; },
    toggleLabel(id){
      const i=this.task.labels.indexOf(id);
      if(i>=0) this.task.labels.splice(i,1); else this.task.labels.push(id);
    },
    addLabel(){
      const name = prompt('New label name:');
      if(name){ const l=this.store.addLabel(name); if(!this.task.labels.includes(l.id)) this.task.labels.push(l.id); }
    },
    addSub(){
      const t=this.subDraft.trim(); if(!t) return;
      this.store.addTask({ title:t, projectId:this.task.projectId, parentId:this.task.id });
      this.subDraft='';
    },
    duplicate(){
      const t=this.task;
      const copy=this.store.addTask({ title:t.title+' (copy)', projectId:t.projectId, due:t.due, reminder:t.reminder, labels:[...t.labels], rec:t.recurrence, notes:t.notes });
      this.store.selectedTaskId=copy.id;
      this.store.toast('⧉ duplicated');
    },
    del(){ if(confirm('Delete this task'+(this.subs.length?' and its subtasks':'')+'?')) this.store.deleteTask(this.task); },
    autosize(){ const el=this.$refs.title; if(el){ el.style.height='auto'; el.style.height=el.scrollHeight+'px'; } },
    blurTitle(){ this.$refs.title && this.$refs.title.blur(); }
  },
  data(){ return { subDraft:'' }; }
};
