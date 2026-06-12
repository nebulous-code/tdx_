/* sort-modal.js — Shift+S sort-config popup. A settings page (not CRUD): the six
   sorts are fixed; you reorder them (m → j/k move-mode, like the sidebar),
   disable/enable (d), and flip each one's direction (^). It edits a LOCAL copy
   seeded from the STORED config (users.sort_prefs) — so it always shows what's
   saved, not the live session sort — and only applies to the list on Save.
   Keyboard via the shared KbForm mixin + kbDelegate (m/d/^ + move-mode). */
window.SortModal = {
  props: ['store'],
  emits: ['close'],
  mixins: [window.KbForm],
  template: `
  <div class="overlay" @click.self="kbAttemptClose">
    <div class="modal account-modal" style="max-width:420px;width:92vw;display:flex;flex-direction:column;max-height:84vh;">
      <div class="modal-head" style="display:flex;align-items:center;flex:0 0 auto;">
        <span style="flex:1;">sort config</span>
        <span class="acct-x" @click="kbAttemptClose" title="close (esc)">✕</span>
      </div>
      <div class="modal-body" style="flex:1 1 auto;overflow-y:auto;">
        <div class="mut" style="font-size:11px;text-transform:none;margin-bottom:8px;">
          j/k move · m reorder · d disable · ^ direction
        </div>
        <div v-for="k in cfg.order" :key="k" class="acct-row sort-row"
             :class="[kbCls('s_'+k), { 'sort-off': !cfg.enabled[k], moving: moveKey===k }]">
          <span class="sort-check">{{ cfg.enabled[k] ? '◉' : '○' }}</span>
          <span class="sort-name">{{ labels[k] }}</span>
          <span class="sort-dir">{{ cfg.dirs[k]==='desc' ? 'v  high→low' : '^  low→high' }}</span>
          <span class="sort-move" v-if="moveKey===k">⇅ moving</span>
        </div>
        <div class="acct-error" v-if="error">{{ error }}</div>
      </div>
      <div class="modal-foot" style="flex:0 0 auto;justify-content:flex-end;gap:8px;">
        <button class="btn" :class="kbCls('cancel')" @click="kbAttemptClose">cancel</button>
        <button class="btn primary" :class="kbCls('save')" :disabled="busy" @click="save">{{ busy ? '…' : 'save ↵' }}</button>
      </div>
    </div>
  </div>
  `,
  data(){
    // seed from the STORED config (not the live session sort), so the popup always
    // reflects what's actually saved in the db
    const cfg = this.store.normalizeSortPrefs((this.store.currentUser||{}).sort_prefs);
    // hide 'size' from the working copy when Fibonacci sizing is off — keeps every
    // reorder index in sync (it's backfilled to the end again on the next load)
    if(!(this.store.currentUser && this.store.currentUser.fib_sizing)) cfg.order = cfg.order.filter(k=>k!=='size');
    return {
      kbAutofocus: false,
      moveKey: null,           // the sort key currently in move-mode (m)
      busy: false, error: '',
      labels: { due:'due', created:'created', title:'title', project:'project', priority:'priority', size:'size', tag:'tag' },
      cfg,
      _orig: JSON.parse(JSON.stringify(cfg)),   // for dirty detection
    };
  },
  methods: {
    kbRows(){
      const rows = this.cfg.order.map(k => ({ id:'s_'+k, type:'static' }));
      rows.push({ id:'save',   type:'button', activate:()=>this.save() });
      rows.push({ id:'cancel', type:'button', activate:()=>this.kbAttemptClose() });
      return rows;
    },
    kbDirty(){ return JSON.stringify(this.cfg) !== JSON.stringify(this._orig); },
    // no kbOnClose: we edit a local copy and never touch the live store until Save,
    // so discarding needs no revert.
    kbDelegate(e){
      const r = this.kbCur();
      const key = (r && r.id && r.id.indexOf('s_')===0) ? r.id.slice(2) : null;
      if(this.moveKey){
        if(e.key==='j' || e.key==='ArrowDown'){ e.preventDefault(); this.moveBy(1); return true; }
        if(e.key==='k' || e.key==='ArrowUp'){   e.preventDefault(); this.moveBy(-1); return true; }
        if(e.key==='Escape' || e.key==='m' || e.key==='Enter'){ e.preventDefault(); this.moveKey=null; return true; }
        return true;   // swallow other keys while moving
      }
      if(key){
        if(e.key==='m'){ e.preventDefault(); this.moveKey=key; return true; }
        if(e.key==='d'){ e.preventDefault(); this.toggleEnabled(key); return true; }
        if(e.key==='^'){ e.preventDefault(); this.toggleDir(key); return true; }
      }
      return false;   // j/k cursor, space/enter on buttons, esc close → KbForm
    },
    moveBy(d){
      const arr = this.cfg.order;
      const i = arr.indexOf(this.moveKey), j = i + d;
      if(i<0 || j<0 || j>=arr.length) return;
      arr.splice(i,1); arr.splice(j,0,this.moveKey);
      this.kbRow = j;   // sort rows are first in kbNav, so row index === order index
      this.kbScroll();
    },
    toggleEnabled(key){
      const en = this.cfg.enabled;
      if(en[key]){
        if(this.cfg.order.filter(k=>en[k]).length <= 1){ this.error='keep at least one sort enabled'; return; }
        en[key] = false;
      } else { en[key] = true; }
      this.error = '';
    },
    toggleDir(key){ this.cfg.dirs[key] = this.cfg.dirs[key]==='desc' ? 'asc' : 'desc'; },
    kbSubmit(){ this.save(); },
    async save(){
      if(this.busy) return;
      this.busy = true; this.error='';
      try{
        const res = await fetch('/api/auth/account', {
          method:'PUT', credentials:'include',
          headers:{ 'Content-Type':'application/json' },
          body: JSON.stringify({ sort_prefs: this.cfg }),
        });
        if(res.ok){
          const user = await res.json();
          this.store.currentUser = user;
          this.store.applySortPrefs(user.sort_prefs);   // apply to the live list + active sort
          this.store.toast('✓ sort config saved');
          this.$emit('close');
          return;
        }
        if(res.status===401){ this.$emit('close'); return; }
        this.error = 'save failed ('+res.status+')';
      }catch(e){
        this.error = "can't reach the server";
      }finally{
        this.busy = false;
      }
    }
  }
};
