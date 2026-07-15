/* help-modal.js — keyboard + syntax reference (opened with ?). Tabbed by window;
   h/l (or click) switch tabs, j/k move a cursor through the rows (the focused row
   brightens), and the body scrolls to keep the cursor in view. Uses the shared
   KbForm mixin: the body rows are read-only 'static' rows (j/k + highlight) and
   h/l switch tabs via the kbTab hook. See docs/KEYBOARD_FRAMEWORK.md. */
window.HelpModal = {
  emits: ['close'],
  mixins: [window.KbForm],
  data(){ return {
    activeTab: 0,
    kbAutofocus: false,
    tabs: [
      { name:'task list', code:'amber', items:[
        { k:'j  /  k',       d:'move down / up (through subtasks too)' },
        { k:'l  /  →',       d:'enter subtasks (expand, then step in)' },
        { k:'h  /  ←',       d:'up to parent · collapse · then the nav' },
        { k:'x  /  space',   d:'toggle done (spawns next occurrence if recurring)' },
        { k:'e  /  enter',   d:'open the task detail' },
        { k:'i',             d:'new task (focuses the quick-add box)' },
        { k:'s  /  ^',       d:'cycle sort field / flip direction (^ asc · v desc)' },
        { k:'S',             d:'sort config (reorder m · disable d · direction ^)' },
        { k:'c',             d:'show / hide completed tasks' },
        { k:'C',             d:'open / close the calendar' },
        { k:'!',             d:'cycle priority (none → very high → none)' },
        { k:'/',             d:'find across tasks · events · notes (title + body text)' },
        { k:'q',             d:'focus the query builder' },
        { k:'n',             d:'show / hide the nav' },
        { k:'@',             d:'account screen' },
        { k:'⌘K  /  ctrl+K', d:'command palette (jump anywhere, run actions)' },
        { k:'?  /  esc',     d:'this help · close' },
        { k:'detail: j / k', d:'move between fields (i edits · space toggles)' },
        { k:'detail: J / K', d:'swap to the previous / next task (drawer stays open)' },
        { k:'detail: enter', d:'save & close · u / d duplicate / delete' },
        { k:'detail: recur', d:'i enters the recurrence builder · esc exits' },
        { k:'drawers',       d:'tasks · events · notes all open in the right-hand drawer (from search / mixed results / links)' },
        { k:'drawer: i',     d:'edit a notes/body field (markdown renders; esc back to the rendered view)' },
        { k:'note drawer: o',d:'open the peeked note fully in the /notes editor' },
      ]},
      { name:'calendar', code:'amber', items:[
        { k:'h  /  l',   d:'previous / next day (flows across the month edge)' },
        { k:'j  /  k',   d:'next / previous week' },
        { k:'H  /  L',   d:'prev / next month — keeps the day-of-month (“every 13th”)' },
        { k:'J  /  K',   d:'next / prev month — keeps the grid cell (“every Monday”)' },
        { k:'i',         d:'the quick-add bar — creation language, same as tasks/notes ($friday · /calendar · #label · {notes}). It lands on the focused day unless you type a $date' },
        { k:'I',         d:'the FULL editor on the focused day — the only place a TIMED event is made (time · end · location · recurrence)' },
        { k:'e',         d:'open the focused day’s hour-by-hour agenda' },
        { k:'E',         d:'agenda + the day’s FIRST item in this view (all-day · tasks · then by time)' },
        { k:'today',     d:'jump back to today (button)' },
        { k:'mouse',     d:'click a day to add an event · click an event to edit it (right-hand drawer)' },
        { k:'C',         d:'open / close the calendar' },
      ]},
      { name:'day schedule', code:'amber', items:[
        { k:'j  /  k',   d:'step the day by hour-slot, stopping on events' },
        { k:'J  /  K',   d:'jump to the next / previous thing that’s actually there — skips the empty hours' },
        { k:'h  /  l',   d:'move across overlapping events in the same hour (and across the all-day / task chips)' },
        { k:'H  /  L',   d:'previous / next day — the agenda follows the calendar cursor' },
        { k:'e',         d:'open the focused event’s detail (drawer to the right)' },
        { k:'i',         d:'new event at the focused hour' },
        { k:'mouse',     d:'click an event to open it · click an empty hour to add one' },
        { k:'esc',       d:'close the day schedule' },
      ]},
      { name:'notes list', code:'amber', items:[
        { k:'j  /  k',   d:'move down / up the list' },
        { k:'o  /  ↵',   d:'open the focused note in the full editor' },
        { k:'e',         d:'peek the focused note in the right-hand drawer (o promotes it · J/K walk the list)' },
        { k:'i',         d:'name a new note in the quick-add bar (↵ creates it and opens it)' },
        { k:'f',         d:'find text in THIS view (the notes index — folder + query still apply; esc clears)' },
        { k:'d',         d:'delete the focused note (asks first)' },
        { k:'h',         d:'into the notes nav (folders · views)' },
      ]},
      { name:'nav', code:'amber', items:[
        { k:'h  /  ←',     d:'collapse project · walk up the tree · at the top → the app rail' },
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
      { name:'app rail', code:'amber', items:[
        { k:'N',           d:'open the app rail (tasks · events · notes) + put the cursor in it' },
        { k:'h (at top)',  d:'jump into the rail from the top of the app nav' },
        { k:'j  /  k',     d:'move between apps' },
        { k:'enter/space', d:'switch to the app under the cursor (lands at the top of its nav)' },
        { k:'l  /  →',     d:'enter the current app’s nav (rail stays open)' },
        { k:'esc',         d:'drop focus (rail stays); N again hides it' },
      ]},
      { name:'query', code:'amber', items:[
        { k:'q  /  Q',       d:'focus the query builder / collapse the panel' },
        { k:'h  /  l',       d:'move between groups (type·due·labels·category·flags)' },
        { k:'j  /  k',       d:'move between options in a group' },
        { k:'space  /  enter', d:'toggle the focused option' },
        { k:'i',             d:'edit the raw query text' },
        { k:'- (negate)',    d:'prefix any term with - to exclude it (type in the raw query, i) — e.g. -status:done, -label:quick' },
        { k:'s',             d:'save the query as a NEW smart view' },
        { k:'u',             d:'update the active saved view in place' },
        { k:'c',             d:'clear the query' },
        { k:'esc',           d:'back to the task list' },
      ]},
      // ONE grammar for every quick-add: a symbol means the same IDEA everywhere, and each
      // app maps it to its own field ($ = the date → a task's due date, a note's review date).
      // A symbol an app doesn't have isn't a dead key there — it's just text.
      { name:'creation language (quick-add)', code:'amber', items:[
        { k:'#label',       d:'add or create a label (forced lowercase) · tasks + notes' },
        { k:'$friday',      d:'THE DATE — a task’s due date, a note’s review date. today · tomorrow · friday · next friday · 2026-07-13 · 6/7/2026 (month first) · 13/7 (only one reading)' },
        { k:'/project',     d:'WHERE IT LIVES — a task’s project, a note’s folder. Matches like the query does, so /tdx finds tdx-app. An unknown one stays in the title' },
        { k:'{…}',          d:'the body — a task’s notes, a note’s text' },
        { k:'!3',           d:'priority 1–5 (!0 clears) · TASKS ONLY — on a note it’s just text' },
        { k:'tab  /  →',    d:'accept the grey completion of the token you’re typing' },
        { k:'not a token',  d:'anything that doesn’t parse stays in the title — “pay Bob $5” keeps its $5' },
        { k:'enter',        d:'create it' },
        { k:'esc',          d:'leave the box, back to the list' },
        { k:'in a view',    d:'you inherit the view’s query (labels · date · project/folder) — what you TYPE wins over what the view implies' },
      ]},
      { name:'query syntax', code:'amber', items:[
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
        { k:'- (negate)',       d:'prefix any term with - to exclude it — e.g. -status:done, -label:quick' },
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
        <div v-for="(r,i) in current.items" :key="i" class="help-row" :class="kbCls('r'+i)">
          <span class="help-bullet">•</span>
          <code :class="current.code">{{ r.k }}</code>
          <span class="help-desc">{{ r.d }}</span>
        </div>
      </div>
    </div>
  </div>
  `,
  methods: {
    kbRows(){ return this.current.items.map((_,i)=>({ id:'r'+i, type:'static' })); },
    kbTab(d){
      this.activeTab = (this.activeTab + d + this.tabs.length) % this.tabs.length;
      this.kbRow = 0; this.kbCell = 0; this.kbGoalCol = 0; this.kbScroll();
    },
    selectTab(i){ this.activeTab = i; this.kbRow = 0; this.kbCell = 0; this.kbGoalCol = 0; this.kbScroll(); }
  }
};
