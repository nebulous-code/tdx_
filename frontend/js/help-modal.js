/* help-modal.js — keyboard + syntax reference (opened with ?). Tabbed by window;
   h/l (or click) switch tabs, j/k move a cursor through the rows (the focused row
   brightens), and the body scrolls to keep the cursor in view. */
window.HelpModal = {
  emits: ['close'],
  data(){ return {
    activeTab: 0,
    cursor: 0,
    tabs: [
      { name:'task list', code:'amber', items:[
        { k:'j  /  k',       d:'move down / up (through subtasks too)' },
        { k:'l  /  →',       d:'enter subtasks (expand, then step in)' },
        { k:'h  /  ←',       d:'up to parent · collapse · then the nav' },
        { k:'x  /  space',   d:'toggle done (spawns next occurrence if recurring)' },
        { k:'e  /  enter',   d:'open the task detail' },
        { k:'i',             d:'new task (focuses the quick-add box)' },
        { k:'s  /  ^',       d:'cycle sort field / flip direction (^ asc · v desc)' },
        { k:'c',             d:'show / hide completed tasks' },
        { k:'/',             d:'focus the query bar' },
        { k:'f',             d:'focus the filter builder' },
        { k:'n',             d:'show / hide the nav' },
        { k:'@',             d:'account screen' },
        { k:'⌘K  /  ctrl+K', d:'command palette (jump anywhere, run actions)' },
        { k:'?  /  esc',     d:'this help · close' },
        { k:'detail: enter', d:'save & close the task detail' },
        { k:'detail: u / d', d:'duplicate / delete the task' },
      ]},
      { name:'nav', code:'amber', items:[
        { k:'h  /  ←',     d:'collapse project · walk up the tree · toggle section (never leaves the nav)' },
        { k:'j  /  k',     d:'move (headers · views · projects · labels)' },
        { k:'l  /  →',     d:'expand a collapsed project/section · else open' },
        { k:'enter/space', d:'open the focused item · toggle a section header' },
        { k:'e',           d:'edit the focused view / project / label' },
        { k:'a  /  A',     d:'add sub-project (under focus) / top-level project' },
        { k:'m',           d:'move mode — j/k reorder the view/project · esc to drop' },
        { k:'x',           d:'delete the focused view' },
        { k:'tab',         d:'collapse / expand the section' },
        { k:'esc',         d:'back to the task list' },
        { k:'mouse',       d:'› edit · ✕ delete view · + add' },
      ]},
      { name:'filter', code:'amber', items:[
        { k:'f  /  F',       d:'focus the filter builder / collapse the panel' },
        { k:'h  /  l',       d:'move between groups (status·due·labels·project·flags)' },
        { k:'j  /  k',       d:'move between options in a group' },
        { k:'space  /  enter', d:'toggle the focused option' },
        { k:'i',             d:'edit the raw query text' },
        { k:'s',             d:'save the query as a smart view' },
        { k:'x',             d:'clear the query' },
        { k:'esc',           d:'back to the task list' },
      ]},
      { name:'new task', code:'cyan', items:[
        { k:'#label',     d:'add or create a label on the task (forced lowercase)' },
        { k:'!3',         d:'set priority 1–5 (very low → very high); !0 clears · other values stay text' },
        { k:'enter',      d:'add the task' },
        { k:'esc',        d:'leave the box, back to the list' },
        { k:'in a view',  d:'new tasks inherit the view’s filters: status · due · labels · project' },
      ]},
      { name:'query syntax', code:'cyan', items:[
        { k:'project:home',     d:'in a project (and its subprojects)' },
        { k:'label:urgent,bug', d:'has any of these labels (comma = OR)' },
        { k:'status:…',         d:'open · done · overdue · today' },
        { k:'due:…',            d:'today · tomorrow · week · month · overdue · set · none' },
        { k:'due:<7d  due:=0d', d:'compare days from today (< > <= >= =, e.g. <=3d, >0d)' },
        { k:'due:su  due:mwf',  d:'next selected weekday(s); carries overdue until the window passes' },
        { k:'  note',           d:'due:w = Wednesday, but due:week = next 7 days' },
        { k:'reminder:…',       d:'today · overdue · set · none (also <Nd comparisons)' },
        { k:'recurring:true',   d:'has a recurrence rule (or false)' },
        { k:'is:…',             d:'task · subtask · recurring · open · done' },
        { k:'has:…',            d:'subtasks · label · due' },
        { k:'-label:quick',     d:'negate any term with a leading -' },
        { k:'"exact phrase"',   d:'bare words / quotes match title + notes' },
      ]},
    ],
  }; },
  computed: {
    current(){ return this.tabs[this.activeTab]; }
  },
  template: `
  <div class="overlay" @click.self="$emit('close')">
    <div class="modal" style="max-width:600px;width:92vw;max-height:76vh;display:flex;flex-direction:column;">
      <div class="modal-head" style="flex:0 0 auto;display:flex;align-items:center;">
        <span style="flex:1;">quick reference</span>
        <span class="acct-x" @click="$emit('close')" title="close (esc)">✕</span>
      </div>
      <div class="help-tabs">
        <span v-for="(t,i) in tabs" :key="t.name" class="help-tab" :class="{on:activeTab===i}" @click="selectTab(i)">{{ t.name }}</span>
        <span class="mut" style="margin-left:auto;font-size:10px;">h/l tabs · j/k scroll</span>
      </div>
      <div class="modal-body" style="flex:1 1 auto;min-height:0;overflow-y:auto;">
        <div v-for="(r,i) in current.items" :key="i" class="help-row" :class="{cur:i===cursor}">
          <span class="help-bullet">•</span>
          <code :class="current.code">{{ r.k }}</code>
          <span class="help-desc">{{ r.d }}</span>
        </div>
      </div>
    </div>
  </div>
  `,
  mounted(){ document.addEventListener('keydown', this.onKey); },
  beforeUnmount(){ document.removeEventListener('keydown', this.onKey); },
  methods: {
    selectTab(i){ this.activeTab = i; this.cursor = 0; this.scrollCur(); },
    onKey(e){
      switch(e.key){
        case 'l': case 'ArrowRight': e.preventDefault(); this.selectTab((this.activeTab+1)%this.tabs.length); break;
        case 'h': case 'ArrowLeft':  e.preventDefault(); this.selectTab((this.activeTab+this.tabs.length-1)%this.tabs.length); break;
        case 'j': case 'ArrowDown':  e.preventDefault(); this.cursor = Math.min(this.current.items.length-1, this.cursor+1); this.scrollCur(); break;
        case 'k': case 'ArrowUp':    e.preventDefault(); this.cursor = Math.max(0, this.cursor-1); this.scrollCur(); break;
      }
    },
    scrollCur(){ this.$nextTick(()=>{ const el=document.querySelector('.help-row.cur'); if(el) el.scrollIntoView({block:'nearest'}); }); }
  }
};
