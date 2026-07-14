/* account-screen.js — a takeover popup (Quick-Reference style) for editing the
   account. NOT part of the h/l pane cycle: while open it owns j/k/i + Enter/Esc
   (the app's global handler early-returns when store-level accountOpen is set).
   Keyboard model is the shared KbForm mixin (see docs/KEYBOARD_FRAMEWORK.md): j/k
   move rows, i/click edits an input, the theme picker is a grid row (h/l + live
   preview), Enter saves, Esc exits with the shared dirty-guard. */
window.AccountScreen = {
  props: ['store'],
  emits: ['close', 'saved', 'logout', 'open-backups'],
  mixins: [window.KbForm],
  data(){
    const u = this.store.currentUser || {};
    const theme = u.theme || 'amber';
    const weekStart = u.week_start ?? 1;
    const fibSizing = !!u.fib_sizing;
    // the vault's base directory name (n.16) — '' means "hide it", which is a real choice, so
    // `??` and not `||`: a user who blanks it must not have 'Inbox' silently restored
    const baseDir = u.notes_root_name ?? 'Inbox';
    return {
      username: u.username || '',
      email: u.email || '',
      oldPassword: '', newPassword: '', confirmPassword: '',
      theme,
      weekStart,
      fibSizing,
      baseDir,
      weekDays: [
        {v:0,n:'Sunday'},{v:1,n:'Monday'},{v:2,n:'Tuesday'},{v:3,n:'Wednesday'},
        {v:4,n:'Thursday'},{v:5,n:'Friday'},{v:6,n:'Saturday'},
      ],
      init: { username: u.username || '', email: u.email || '', theme, weekStart, fibSizing, baseDir },
      kbAutofocus: false,   // start in nav, not in the username field
      themes: [
        { key:'amber',   name:'amber',   bg:'#0b0a07', accent:'#ffb000' },
        { key:'matrix',  name:'matrix',  bg:'#060807', accent:'#22ff66' },
        { key:'ice',     name:'ice',     bg:'#06090b', accent:'#3fe0e0' },
        { key:'paper',   name:'paper',   bg:'#0a0a0b', accent:'#e9e7df' },
        { key:'plasma',  name:'plasma',  bg:'#0b0807', accent:'#ff6a4d' },
        { key:'magenta', name:'magenta', bg:'#09070b', accent:'#ff5fb4' },
      ],
      error: '', busy: false,
    };
  },
  template: `
  <div class="overlay" @click.self="kbAttemptClose">
    <div class="modal account-modal" style="max-width:460px;width:92vw;display:flex;flex-direction:column;max-height:84vh;">
      <div class="modal-head" style="display:flex;align-items:center;flex:0 0 auto;">
        <span style="flex:1;">account</span>
        <span class="acct-x" @click="kbAttemptClose" title="close (esc)">✕</span>
      </div>
      <div class="modal-body" style="flex:1 1 auto;overflow-y:auto;">
        <div class="acct-row" :class="kbCls('username')" @click="$refs.username.focus()">
          <span class="acct-label">username</span>
          <input ref="username" v-model="username" spellcheck="false" autocapitalize="off" @focus="kbFocusRow('username')" />
        </div>
        <div class="acct-row" :class="kbCls('email')" @click="$refs.email.focus()">
          <span class="acct-label">email</span>
          <input ref="email" v-model="email" spellcheck="false" autocapitalize="off" @focus="kbFocusRow('email')" />
        </div>

        <div class="acct-sep">theme</div>
        <div class="acct-themes">
          <span v-for="(t,i) in themes" :key="t.key" class="theme-box" :class="[{on: theme===t.key}, kbCls('theme', i)]"
                :style="{background:t.bg}" :title="t.name" @click="kbPick('theme', i)">
            <span class="theme-accent" :style="{background:t.accent, boxShadow:'0 0 7px '+t.accent+', 0 0 2px '+t.accent}"></span>
          </span>
        </div>

        <div class="acct-sep">preferences</div>
        <div class="acct-row" :class="kbCls('weekStart')" @click="$refs.weekStart.focus()">
          <span class="acct-label">week starts</span>
          <select ref="weekStart" class="input" style="flex:1;" v-model.number="weekStart" @focus="kbFocusRow('weekStart')">
            <option v-for="d in weekDays" :key="d.v" :value="d.v">{{ d.n }}</option>
          </select>
        </div>
        <div class="acct-row" :class="kbCls('fibSizing')" @click="fibSizing=!fibSizing" style="cursor:pointer;">
          <span class="acct-label">sizing</span>
          <span style="flex:1;display:flex;align-items:center;gap:6px;">
            <span class="mut">enable size field on tasks</span>
            <span class="info-tip" data-tip="Provides Fibonacci sizing (1, 2, 3, 5, 8, 13) for estimating a task's effort." @click.stop>ⓘ</span>
          </span>
          <span class="pin-check" :class="{on:fibSizing}">{{ fibSizing ? '✓' : '' }}</span>
        </div>
        <div class="acct-row" :class="kbCls('baseDir')" @click="$refs.baseDir.focus()">
          <span class="acct-label">base directory</span>
          <input ref="baseDir" v-model="baseDir" spellcheck="false" autocapitalize="off"
                 placeholder="blank = hide vault root" @focus="kbFocusRow('baseDir')" />
          <span class="info-tip" data-tip="Notes at the top of your vault (not in any folder) show up under this name in the notes nav — and folder:&lt;name&gt; finds them. Leave it blank to hide that row entirely. It can't hold folders: every folder already lives inside it." @click.stop>ⓘ</span>
        </div>

        <div v-if="isAdmin" class="acct-sep">admin</div>
        <div v-if="isAdmin" class="acct-row" :class="kbCls('backups')" @click="openBackups" style="cursor:pointer;">
          <span class="acct-label">backups</span>
          <span style="flex:1;" class="mut">scheduled database backups</span>
          <span class="acct-chevron">›</span>
        </div>

        <div class="acct-sep">change password <span class="mut">(optional)</span></div>
        <div class="acct-row" :class="kbCls('oldPassword')" @click="$refs.oldPassword.focus()">
          <span class="acct-label">current</span>
          <input ref="oldPassword" type="password" v-model="oldPassword" autocomplete="current-password" @focus="kbFocusRow('oldPassword')" />
        </div>
        <div class="acct-row" :class="kbCls('newPassword')" @click="$refs.newPassword.focus()">
          <span class="acct-label">new</span>
          <input ref="newPassword" type="password" v-model="newPassword" autocomplete="new-password" @focus="kbFocusRow('newPassword')" />
        </div>
        <div class="acct-row" :class="kbCls('confirmPassword')" @click="$refs.confirmPassword.focus()">
          <span class="acct-label">confirm</span>
          <input ref="confirmPassword" type="password" v-model="confirmPassword" autocomplete="new-password" @focus="kbFocusRow('confirmPassword')" />
        </div>

        <div class="acct-error" v-if="error">{{ error }}</div>
      </div>
      <div class="modal-foot" style="flex:0 0 auto;justify-content:space-between;">
        <button class="btn" :class="kbCls('logout')" @click="logout">log out</button>
        <button class="btn primary" :class="kbCls('save')" :disabled="busy" @click="save">{{ busy ? '…' : 'save ↵' }}</button>
      </div>
    </div>
  </div>
  `,
  computed: {
    isAdmin(){ return !!(this.store.currentUser && this.store.currentUser.is_admin); },
    dirty(){
      return this.username !== this.init.username || this.email !== this.init.email ||
        this.theme !== this.init.theme || this.weekStart !== this.init.weekStart ||
        this.fibSizing !== this.init.fibSizing || this.baseDir !== this.init.baseDir ||
        !!this.oldPassword || !!this.newPassword || !!this.confirmPassword;
    }
  },
  methods: {
    kbRows(){ return [
      { id:'username',        type:'input',  ref:'username' },
      { id:'email',           type:'input',  ref:'email' },
      { id:'theme',           type:'grid',   items:this.themes, cols:6, previewOnFocus:true,
        isOn:t=>this.theme===t.key, select:t=>this.selectTheme(t.key) },
      { id:'weekStart',       type:'input',  ref:'weekStart' },
      { id:'fibSizing',       type:'button', activate:()=>{ this.fibSizing=!this.fibSizing; } },
      { id:'baseDir',         type:'input',  ref:'baseDir' },
      { id:'backups',         type:'button', when:()=>this.isAdmin, activate:()=>this.openBackups() },
      { id:'oldPassword',     type:'input',  ref:'oldPassword' },
      { id:'newPassword',     type:'input',  ref:'newPassword' },
      { id:'confirmPassword', type:'input',  ref:'confirmPassword' },
      { id:'save',            type:'button', activate:()=>this.save() },
      { id:'logout',          type:'button', activate:()=>this.logout() },
    ]; },
    kbSubmit(){ this.save(); },
    kbDirty(){ return this.dirty; },
    kbOnClose(){ this.revertTheme(); },   // discarding restores the pre-edit theme
    // open the admin backups screen; guard unsaved account edits first
    openBackups(){
      const go = () => this.$emit('open-backups');
      if(this.dirty){ this.store.askConfirm('Discard account changes?').then(ok=>{ if(ok){ this.revertTheme(); go(); } }); }
      else go();
    },
    // ---- theme picker (live preview) ----
    selectTheme(key){ this.theme = key; window.applyTheme(key); },
    revertTheme(){ window.applyTheme(this.init.theme); },
    // client-side password policy mirror (the server enforces it too)
    pwError(pw){
      if(pw.length < 8) return 'new password must be at least 8 characters';
      if(!/[A-Z]/.test(pw)) return 'new password needs an uppercase letter';
      if(!/[a-z]/.test(pw)) return 'new password needs a lowercase letter';
      if(!/[0-9]/.test(pw)) return 'new password needs a number';
      if(!/[^A-Za-z0-9]/.test(pw)) return 'new password needs a symbol';
      return '';
    },
    async save(){
      if(this.busy) return;
      this.error='';
      // notes_root_name: '' is meaningful (hide the base directory), so send it as typed. The
      // server rejects a name that collides with a real folder — that 400 lands in this.error.
      const payload = { theme: this.theme, week_start: this.weekStart, fib_sizing: this.fibSizing ? 1 : 0,
        notes_root_name: this.baseDir.trim() };
      const uname = this.username.trim();
      if(!uname || uname.length>32){ this.error='username must be 1–32 characters'; return; }
      payload.username = uname;
      const email = this.email.trim();
      if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){ this.error='enter a valid email address'; return; }
      payload.email = email;

      const changingPw = this.oldPassword || this.newPassword || this.confirmPassword;
      if(changingPw){
        if(!this.oldPassword){ this.error='enter your current password'; return; }
        const pe = this.pwError(this.newPassword);
        if(pe){ this.error=pe; return; }
        if(this.newPassword !== this.confirmPassword){ this.error='new passwords do not match'; return; }
        payload.oldPassword = this.oldPassword;
        payload.newPassword = this.newPassword;
      }

      this.busy=true;
      try{
        const res = await fetch('/api/auth/account', {
          method:'PUT', credentials:'include',
          headers:{ 'Content-Type':'application/json' },
          body: JSON.stringify(payload),
        });
        if(res.ok){
          const user = await res.json();
          this.$emit('saved', user);
          this.$emit('close');
          return;
        }
        if(res.status===401){ this.kbClose(); return; } // session gone; root shows login
        const body = await res.json().catch(()=>({}));
        this.error = body.error || ('save failed ('+res.status+')');
      }catch(e){
        this.error = "can't reach the server";
      }finally{
        this.busy=false;
      }
    },
    async logout(){
      try{ await fetch('/api/auth/logout', { method:'POST', credentials:'include' }); }
      catch(e){ /* even if it fails, drop the client session */ }
      this.$emit('logout');
    }
  }
};
