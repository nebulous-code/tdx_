/* kbform.js — window.KbForm: a reusable keyboard mixin for modal/forms.
   A component mixes it in and declares kbRows() (ordered rows); the mixin owns the
   cursor, key handling, the kfocus highlight, and the dirty-guard. See
   docs/KEYBOARD_FRAMEWORK.md.

   Row descriptors from kbRows():
     { id, type:'input',  ref, multiline? }          // text/select; i/click edits
     { id, type:'button', activate(), when?() }       // save/cancel/delete/logout
     { id, type:'grid',   items, cols, isOn, select } // color/glyph/theme
     { id, type:'static' }                            // read-only row: just cursor + highlight (e.g. help body)

   Everything is rows; a row has 1..N cells. j/k move rows, h/l move cells within a
   grid row (with a remembered goal column). Hooks a component may implement:
     kbRows()  (required) · kbSubmit() (Enter/save) · kbDirty() · kbOnClose() · kbAutofocus (data)
     kbTab(dir): if present, nav-mode h/l on a non-grid (1-cell) row switches tabs
       instead of moving cells. Only use where EVERY non-grid row should switch tabs.
     kbDelegate(e): if present, called first in kbKey; return true to consume the
       event (e.g. forward it to a nested KbForm sub-pane). See task-detail's recurrence.
*/
window.KbForm = {
  data(){ return { kbRow:0, kbCell:0, kbGoalCol:0 }; },
  computed: {
    // flattened navigable rows; grids expand into one nav-row per visual row
    kbNav(){
      const out = [];
      for(const r of (this.kbRows ? this.kbRows() : [])){
        if(r.when && !r.when()) continue;
        if(r.type==='grid'){
          const cols = r.cols || 1, n = r.items.length;
          for(let s=0; s<n; s+=cols){
            const cells = [];
            for(let c=0; c<cols && s+c<n; c++) cells.push(s+c);  // absolute item indices
            out.push({ id:r.id, type:'grid', grid:r, cells, cellCount:cells.length });
          }
        } else {
          out.push({ id:r.id, type:r.type, ref:r.ref, multiline:r.multiline, activate:r.activate, cellCount:1 });
        }
      }
      return out;
    }
  },
  mounted(){
    // kbAutoListen:false lets a host drive kbKey() from its own handler (e.g. the
    // always-mounted task-detail drawer, routed through the app's global onKey).
    if(this.kbAutoListen !== false) document.addEventListener('keydown', this.kbKey);
    this.$nextTick(this.kbInit);
  },
  beforeUnmount(){ document.removeEventListener('keydown', this.kbKey); },
  methods: {
    kbInit(){
      this.kbRow = 0; this.kbCell = 0; this.kbGoalCol = 0;
      if(this.kbAutofocus !== false){               // create-modal UX: jump into the first input
        const i = this.kbNav.findIndex(r => r.type==='input');
        if(i >= 0){ this.kbRow = i; this.kbEditCurrent(); }
      }
    },
    kbCur(){ return this.kbNav[this.kbRow] || null; },
    // template helpers: kbCls(id) for a single control, kbCls(id, cellAbs) for a grid cell
    kbCls(id, cellAbs){
      const r = this.kbCur(); if(!r || r.id!==id) return {};
      if(cellAbs===undefined) return { kfocus:true };
      return { kfocus: r.cells && r.cells[this.kbCell]===cellAbs };
    },
    kbMove(d){
      const next = Math.max(0, Math.min(this.kbNav.length-1, this.kbRow + d));
      if(next===this.kbRow) return;
      this.kbRow = next;
      const r = this.kbCur();
      this.kbCell = Math.min(this.kbGoalCol, r.cellCount-1);
      // a live-preview grid (radio-like, e.g. theme) lands on its current
      // selection rather than the magic column, so arriving doesn't change it
      if(r.type==='grid' && r.grid.previewOnFocus && r.grid.isOn){
        const sel = r.cells.findIndex(abs => r.grid.isOn(r.grid.items[abs]));
        if(sel>=0) this.kbCell = sel;
      }
      this.kbPreview(); this.kbScroll();
    },
    // h/l: switch tabs (if the component opts in via kbTab and we're not on a
    // multi-cell grid row), otherwise move between cells in the current grid row
    kbHL(d){
      const r = this.kbCur();
      if(this.kbTab && (!r || r.cellCount<=1)){ this.kbTab(d); return; }
      this.kbLR(d);
    },
    kbLR(d){
      const r = this.kbCur(); if(!r || r.cellCount<=1) return;
      this.kbCell = Math.max(0, Math.min(r.cellCount-1, this.kbCell + d));
      this.kbGoalCol = this.kbCell;
      this.kbPreview(); this.kbScroll();
    },
    // grids with previewOnFocus (e.g. the theme picker) apply as the cursor lands
    kbPreview(){
      const r = this.kbCur();
      if(r && r.type==='grid' && r.grid.previewOnFocus){ r.grid.select(r.grid.items[r.cells[this.kbCell]]); }
    },
    kbEditCurrent(){
      const r = this.kbCur(); if(!r || r.type!=='input') return;
      this.$nextTick(()=>{ const el=this.$refs[r.ref], node=Array.isArray(el)?el[0]:el; if(node && node.focus) node.focus(); });
    },
    kbActivate(){   // space
      const r = this.kbCur(); if(!r) return;
      if(r.type==='grid'){ r.grid.select(r.grid.items[r.cells[this.kbCell]]); }
      else if(r.type==='button'){ r.activate && r.activate(); }
      else if(r.type==='input'){ this.kbEditCurrent(); }
    },
    kbEnter(){      // nav Enter is reserved for save; space (kbActivate) presses buttons
      this.kbSubmit && this.kbSubmit();
    },
    kbAttemptClose(){
      if(this.kbDirty && this.kbDirty()){
        this.store.askConfirm('Discard changes?').then(ok=>{ if(ok) this.kbClose(); });
      } else { this.kbClose(); }
    },
    kbClose(){ if(this.kbOnClose) this.kbOnClose(); this.$emit('close'); },
    kbScroll(){ this.$nextTick(()=>{ const el=this.$el && this.$el.querySelector('.kfocus'); if(el) el.scrollIntoView({block:'nearest', inline:'nearest'}); }); },
    // ---- click wiring (keep mouse + keyboard cursor in sync) ----
    kbFocusRow(id){ const i=this.kbNav.findIndex(r=>r.id===id); if(i>=0){ this.kbRow=i; this.kbCell=0; this.kbGoalCol=0; } },
    kbPick(id, cellAbs){   // grid cell click: move cursor there + select it
      const i = this.kbNav.findIndex(r => r.id===id && r.cells && r.cells.includes(cellAbs));
      if(i>=0){ this.kbRow=i; this.kbCell=this.kbNav[i].cells.indexOf(cellAbs); this.kbGoalCol=this.kbCell; }
      const r=this.kbCur(); if(r && r.type==='grid') r.grid.select(r.grid.items[cellAbs]);
    },
    kbKey(e){
      if(this.store && (this.store.confirmState || this.store.promptState)) return;  // defer to root dialogs
      if(this.kbDelegate && this.kbDelegate(e)) return;   // host may handle/forward (e.g. a nested sub-pane)
      const tag = (e.target.tagName||'').toLowerCase();
      if(tag==='input' || tag==='textarea' || tag==='select'){
        const multiline = tag==='textarea';
        if(e.key==='Enter'){
          if(multiline){ if(e.ctrlKey||e.metaKey){ e.preventDefault(); this.kbSubmit && this.kbSubmit(); } }
          else { e.preventDefault(); this.kbSubmit && this.kbSubmit(); }
        } else if(e.key==='Escape'){ e.preventDefault(); e.target.blur(); }
        return;   // otherwise let the field handle the key
      }
      switch(e.key){
        case 'j': case 'ArrowDown':  e.preventDefault(); this.kbMove(1); break;
        case 'k': case 'ArrowUp':    e.preventDefault(); this.kbMove(-1); break;
        case 'l': case 'ArrowRight': e.preventDefault(); this.kbHL(1); break;
        case 'h': case 'ArrowLeft':  e.preventDefault(); this.kbHL(-1); break;
        case 'i': e.preventDefault(); this.kbEditCurrent(); break;
        case ' ': e.preventDefault(); this.kbActivate(); break;
        case 'Enter': e.preventDefault(); this.kbEnter(); break;
        case 'Escape': e.preventDefault(); this.kbAttemptClose(); break;
      }
    }
  }
};
