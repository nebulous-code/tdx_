/* help-modal.js — keyboard shortcuts + query syntax quick reference (opened with ?) */
window.HelpModal = {
  emits: ['close'],
  data(){ return {
    keys: [
      { k:'j  /  ↓',      d:'move down (through subtasks too)' },
      { k:'k  /  ↑',      d:'move up (through subtasks too)' },
      { k:'l  /  →',      d:'enter subtasks (expand, then step in)' },
      { k:'h  /  ←',      d:'up to parent · collapse · then the sidebar' },
      { k:'x  /  space',  d:'toggle done (spawns next occurrence if recurring)' },
      { k:'e  /  enter',  d:'open task detail / edit' },
      { k:'n',            d:'new task (esc returns you to the list)' },
      { k:'i',            d:'edit — add-task box (list) or query (filter)' },
      { k:'f  /  F',      d:'focus the filter builder / collapse it' },
      { k:'  in sidebar', d:'j/k move · enter/l open · esc/h back to list' },
      { k:'  in filter',  d:'h/l group · j/k option · space toggle · i query · s save · x clear · esc to list' },
      { k:'/',            d:'focus the query bar' },
      { k:'c',            d:'show / hide completed tasks' },
      { k:'⌘K  /  ctrl+K',d:'command palette (jump anywhere, run actions)' },
      { k:'?',            d:'this help' },
      { k:'esc',          d:'close palette · modal · detail · help' },
    ],
    syntax: [
      { k:'project:home',     d:'in a project (and its subprojects)' },
      { k:'label:urgent,bug', d:'has any of these labels (comma = OR)' },
      { k:'status:…',         d:'open · done · overdue · today' },
      { k:'due:…',            d:'today · tomorrow · week · month · overdue · set · none' },
      { k:'due:<7d  due:=0d', d:'compare days from today (< > <= >= =, e.g. <=3d, >0d)' },
      { k:'reminder:…',       d:'today · overdue · set · none (also <Nd comparisons)' },
      { k:'recurring:true',   d:'has a recurrence rule (or false)' },
      { k:'is:…',             d:'task · subtask · recurring · open · done' },
      { k:'has:…',            d:'subtasks · label · due' },
      { k:'-label:quick',     d:'negate any term with a leading -' },
      { k:'"exact phrase"',   d:'bare words / quotes match title + notes' },
    ],
  }; },
  template: `
  <div class="overlay" @click.self="$emit('close')">
    <div class="modal" style="max-width:640px;width:92vw;max-height:76vh;display:flex;flex-direction:column;">
      <div class="modal-head" style="flex:0 0 auto;display:flex;align-items:center;">
        <span style="flex:1;">quick reference</span>
        <span class="acct-x" @click="$emit('close')" title="close (esc)">✕</span>
      </div>
      <div class="modal-body" style="flex:1 1 auto;min-height:0;overflow-y:auto;display:grid;grid-template-columns:1fr 1fr;gap:18px;">
        <div>
          <div class="mut" style="font-size:11px;margin-bottom:8px;letter-spacing:.5px;">KEYBOARD</div>
          <div v-for="r in keys" :key="r.k" style="display:flex;gap:10px;align-items:baseline;margin-bottom:6px;">
            <code style="flex:0 0 92px;color:var(--amber,#ffb000);white-space:nowrap;">{{ r.k }}</code>
            <span style="font-size:12px;">{{ r.d }}</span>
          </div>
        </div>
        <div>
          <div class="mut" style="font-size:11px;margin-bottom:8px;letter-spacing:.5px;">QUERY SYNTAX</div>
          <div v-for="r in syntax" :key="r.k" style="display:flex;gap:10px;align-items:baseline;margin-bottom:6px;">
            <code style="flex:0 0 132px;color:var(--cyan,#3fd7d7);white-space:nowrap;">{{ r.k }}</code>
            <span style="font-size:12px;">{{ r.d }}</span>
          </div>
          <div class="mut" style="font-size:11px;margin-top:10px;">terms combine with AND · save a query as a smart view from ⌘K or the query bar.</div>
        </div>
      </div>
    </div>
  </div>
  `,
};
