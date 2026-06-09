/* backup-screen.js — admin-only scheduled-backup settings, opened from the account
   screen (the '@' takeover). Same KbForm keyboard model as account-screen.js: j/k
   move rows, i/click edits an input, space toggles a button row, Enter saves, Esc
   exits with the shared dirty-guard. Talks to /api/backups/* (see routes/backup.js). */
window.BackupScreen = {
  props: ['store'],
  emits: ['close'],
  mixins: [window.KbForm],
  data(){
    return {
      ready: false, busy: false, running: false, error: '',
      enabled: false, dir: '/backups', time: '02:00', retention: 7,
      status: null,           // last server status payload (dirOk, last_run_at, …)
      files: [],
      init: { enabled: false, dir: '/backups', time: '02:00', retention: 7 },
      kbAutofocus: false,     // start in nav, not in the dir field
      // file explorer
      browsing: false, browseBusy: false, browseErr: '',
      browsePath: '', browseParent: null, browseWritable: false, browseTruncated: false, browseEntries: [],
    };
  },
  async created(){ await this.load(); },
  computed: {
    dirty(){
      if(!this.ready) return false;
      return this.enabled !== this.init.enabled || this.dir !== this.init.dir ||
        this.time !== this.init.time || Number(this.retention) !== Number(this.init.retention);
    }
  },
  template: `
  <div class="overlay" @click.self="kbAttemptClose">
    <div class="modal account-modal" style="max-width:520px;width:92vw;display:flex;flex-direction:column;max-height:84vh;">
      <div class="modal-head" style="display:flex;align-items:center;flex:0 0 auto;">
        <span style="flex:1;">backups</span>
        <span class="acct-x" @click="kbAttemptClose" title="close (esc)">✕</span>
      </div>
      <div class="modal-body" style="flex:1 1 auto;overflow-y:auto;">

        <div class="acct-row" :class="kbCls('enabled')" @click="toggleEnabled" style="cursor:pointer;">
          <span class="acct-label">scheduled</span>
          <span style="flex:1;">{{ enabled ? 'on — daily backup' : 'off' }}</span>
          <span class="bk-toggle" :class="{on:enabled}">{{ enabled ? '✓' : '' }}</span>
        </div>

        <div class="acct-row" :class="kbCls('dir')" @click="$refs.dir.focus()">
          <span class="acct-label">directory</span>
          <input ref="dir" v-model="dir" spellcheck="false" autocapitalize="off" placeholder="/backups" @focus="kbFocusRow('dir')" />
          <button class="bk-browse" :class="kbCls('browse')" @click.stop="openBrowser">browse</button>
        </div>
        <div class="acct-hint mut">a path inside the container — must be a writable bind mount (see compose.yaml). Save to re-check.</div>

        <div v-if="browsing" class="bk-browser">
          <div class="bk-browser-head">
            <span class="bk-browser-path">{{ browsePath || '…' }}</span>
            <span v-if="browsePath" :class="browseWritable ? 'bk-ok' : 'bk-err'">{{ browseWritable ? '✓ writable' : '✗ read-only' }}</span>
          </div>
          <div class="bk-browser-list">
            <div v-if="browseErr" class="bk-err" style="padding:4px 6px;">{{ browseErr }}</div>
            <div v-else-if="browseParent !== null" class="bk-entry bk-dir" @click="browse(browseParent)">../</div>
            <div v-for="e in browseEntries" :key="e.name" class="bk-entry" :class="e.type==='dir' ? 'bk-dir' : 'bk-file'"
                 @click="e.type==='dir' && browse(joinp(e.name))">
              <span class="bk-entry-name">{{ e.name }}{{ e.type==='dir' ? '/' : '' }}</span>
              <span v-if="e.type==='file'" class="mut bk-entry-size">{{ fmtBytes(e.size) }}</span>
            </div>
            <div v-if="!browseErr && !browseEntries.length && browseParent !== null" class="mut" style="padding:4px 6px;">(empty)</div>
            <div v-if="browseTruncated" class="mut" style="padding:4px 6px;">… more (showing first 500)</div>
          </div>
          <div class="bk-browser-foot">
            <button class="btn" @click="browsing=false">close</button>
            <button class="btn primary" :disabled="!browsePath || browseBusy" @click="useBrowseDir">use this directory</button>
          </div>
        </div>

        <div class="acct-row" :class="kbCls('time')" @click="$refs.time.focus()">
          <span class="acct-label">run at</span>
          <input ref="time" type="time" class="input" style="flex:1;" v-model="time" @focus="kbFocusRow('time')" />
        </div>
        <div class="acct-row" :class="kbCls('retention')" @click="$refs.retention.focus()">
          <span class="acct-label">keep newest</span>
          <input ref="retention" type="number" min="1" max="365" class="input" style="flex:1;" v-model="retention" @focus="kbFocusRow('retention')" />
        </div>

        <div class="acct-sep">status</div>
        <div class="bk-status" v-if="status">
          <div :class="status.dirOk ? 'bk-ok' : 'bk-err'">
            {{ status.dirOk ? '✓ writable — ' + status.backupCount + ' backup(s)' : '✗ ' + (status.dirError || 'not writable') }}
          </div>
          <div class="mut">last run: {{ status.last_run_at ? fmtTime(status.last_run_at) + ' (' + status.last_status + ')' : 'never' }}</div>
          <div class="mut">next run: {{ enabled && status.next_run_at ? fmtTime(status.next_run_at) : '—' }}</div>
          <div class="bk-err" v-if="status.last_status === 'error' && status.last_error">last error: {{ status.last_error }}</div>
        </div>

        <div class="acct-sep">files <span class="mut">({{ files.length }})</span></div>
        <div class="mut" v-if="!files.length" style="padding:2px 0;">none yet</div>
        <div v-for="f in files" :key="f.name" class="acct-row" style="gap:8px;">
          <span style="flex:1;font-family:var(--mono,monospace);font-size:12px;">{{ f.name }}</span>
          <span class="mut" style="font-size:11px;">{{ fmtBytes(f.size) }}</span>
          <a class="bk-dl" :href="'/api/backups/' + f.name + '/download'">download</a>
        </div>
        <div class="acct-hint mut">restore is a CLI step (server stopped) — see RESTORE.md.</div>

        <div class="acct-error" v-if="error">{{ error }}</div>
      </div>
      <div class="modal-foot" style="flex:0 0 auto;justify-content:space-between;">
        <button class="btn" :class="kbCls('runNow')" :disabled="running" @click="runNow">{{ running ? '…' : 'back up now' }}</button>
        <button class="btn primary" :class="kbCls('save')" :disabled="busy" @click="save">{{ busy ? '…' : 'save ↵' }}</button>
      </div>
    </div>
  </div>
  `,
  methods: {
    kbRows(){ return [
      { id:'enabled',   type:'button', activate:()=>this.toggleEnabled() },
      { id:'dir',       type:'input',  ref:'dir' },
      { id:'browse',    type:'button', activate:()=>this.openBrowser() },
      { id:'time',      type:'input',  ref:'time' },
      { id:'retention', type:'input',  ref:'retention' },
      { id:'runNow',    type:'button', activate:()=>this.runNow() },
      { id:'save',      type:'button', activate:()=>this.save() },
    ]; },
    kbSubmit(){ this.save(); },
    kbDirty(){ return this.dirty; },

    applyStatus(s){
      this.status = s;
      this.enabled = s.enabled; this.dir = s.dir; this.time = s.time_of_day; this.retention = s.retention;
    },
    async load(){
      try{
        const res = await fetch('/api/backups/config', { credentials:'include' });
        if(res.ok){
          this.applyStatus(await res.json());
          this.init = { enabled:this.enabled, dir:this.dir, time:this.time, retention:this.retention };
          await this.loadFiles();
        } else if(res.status === 403){ this.error = 'admin only'; }
        else if(res.status === 401){ this.$emit('close'); }
        else { this.error = 'failed to load (' + res.status + ')'; }
      }catch(e){ this.error = "can't reach the server"; }
      this.ready = true;
    },
    async loadFiles(){
      try{ const r = await fetch('/api/backups', { credentials:'include' }); if(r.ok) this.files = (await r.json()).files || []; }
      catch(e){ /* leave list as-is */ }
    },
    toggleEnabled(){ this.enabled = !this.enabled; },

    // ---- file explorer ----
    openBrowser(){ this.browsing = true; this.browse((this.dir || '').trim() || null); },
    joinp(name){ return (this.browsePath || '').replace(/\/+$/, '') + '/' + name; },
    async browse(p){
      this.browseErr = '';
      this.browseBusy = true;
      try{
        const qs = p != null ? ('?path=' + encodeURIComponent(p)) : '';
        const res = await fetch('/api/backups/browse' + qs, { credentials:'include' });
        const body = await res.json().catch(()=>({}));
        if(res.ok){
          this.browsePath = body.path; this.browseParent = body.parent;
          this.browseWritable = body.writable; this.browseTruncated = body.truncated;
          this.browseEntries = body.entries || [];
        } else if(res.status === 401){ this.$emit('close'); }
        else {
          this.browseErr = body.error || ('failed (' + res.status + ')');
          if(body.path) this.browsePath = body.path;
          this.browseEntries = [];
        }
      }catch(e){ this.browseErr = "can't reach the server"; }
      finally{ this.browseBusy = false; }
    },
    useBrowseDir(){ if(this.browsePath){ this.dir = this.browsePath; this.browsing = false; } },
    async save(){
      if(this.busy) return;
      this.error = '';
      this.busy = true;
      try{
        const res = await fetch('/api/backups/config', {
          method:'PUT', credentials:'include', headers:{ 'Content-Type':'application/json' },
          body: JSON.stringify({ enabled:this.enabled, dir:(this.dir||'').trim(), time_of_day:(this.time||'').trim(), retention:Number(this.retention) }),
        });
        const body = await res.json().catch(()=>({}));
        if(res.ok){
          this.applyStatus(body);
          this.init = { enabled:this.enabled, dir:this.dir, time:this.time, retention:this.retention };
          await this.loadFiles();
        } else if(res.status === 401){ this.$emit('close'); }
        else { this.error = body.error || ('save failed (' + res.status + ')'); }
      }catch(e){ this.error = "can't reach the server"; }
      finally{ this.busy = false; }
    },
    async runNow(){
      if(this.running) return;
      this.error = '';
      this.running = true;
      try{
        const res = await fetch('/api/backups/run', { method:'POST', credentials:'include' });
        const body = await res.json().catch(()=>({}));
        if(body && body.dir != null) this.applyStatus(body);   // success or error both carry status
        if(res.ok){ await this.loadFiles(); }
        else { this.error = body.error || ('backup failed (' + res.status + ')'); }
      }catch(e){ this.error = "can't reach the server"; }
      finally{ this.running = false; }
    },
    fmtBytes(n){
      if(n < 1024) return n + ' B';
      if(n < 1024*1024) return (n/1024).toFixed(0) + ' KB';
      return (n/1024/1024).toFixed(1) + ' MB';
    },
    fmtTime(iso){
      try{ return new Date(iso).toLocaleString('en-US',{month:'short',day:'2-digit',hour:'2-digit',minute:'2-digit'}); }
      catch(e){ return iso; }
    },
  }
};
