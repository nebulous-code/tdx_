/* account-screen.js — a takeover popup (Quick-Reference style) for editing the
   account. NOT part of the h/l pane cycle: while open it owns j/k/i + Enter/Esc
   (the app's global handler early-returns when store-level accountOpen is set).
   Fields are navigated with j/k, edited with i/click, saved with Enter, and Esc
   exits with an unsaved-changes guard. */
window.AccountScreen = {
  props: ['store'],
  emits: ['close', 'saved', 'logout'],
  // row order drives j/k navigation and the kfocus highlight
  data(){
    const u = this.store.currentUser || {};
    return {
      username: u.username || '',
      email: u.email || '',
      oldPassword: '', newPassword: '', confirmPassword: '',
      init: { username: u.username || '', email: u.email || '' },
      focusIdx: 0,
      rows: ['username','email','oldPassword','newPassword','confirmPassword','save','logout'],
      error: '', busy: false, confirmOpen: false,
    };
  },
  template: `
  <div class="overlay" @click.self="attemptClose">
    <div class="modal account-modal" style="max-width:460px;width:92vw;display:flex;flex-direction:column;max-height:84vh;">
      <div class="modal-head" style="display:flex;align-items:center;flex:0 0 auto;">
        <span style="flex:1;">account</span>
        <span class="acct-x" @click="attemptClose" title="close (esc)">✕</span>
      </div>
      <div class="modal-body" style="flex:1 1 auto;overflow-y:auto;">
        <div class="acct-row" :class="{kfocus:focusIdx===0}" @click="edit('username',0)">
          <span class="acct-label">username</span>
          <input ref="username" v-model="username" spellcheck="false" autocapitalize="off" />
        </div>
        <div class="acct-row" :class="{kfocus:focusIdx===1}" @click="edit('email',1)">
          <span class="acct-label">email</span>
          <input ref="email" v-model="email" spellcheck="false" autocapitalize="off" />
        </div>

        <div class="acct-sep">change password <span class="mut">(optional)</span></div>
        <div class="acct-row" :class="{kfocus:focusIdx===2}" @click="edit('oldPassword',2)">
          <span class="acct-label">current</span>
          <input ref="oldPassword" type="password" v-model="oldPassword" autocomplete="current-password" />
        </div>
        <div class="acct-row" :class="{kfocus:focusIdx===3}" @click="edit('newPassword',3)">
          <span class="acct-label">new</span>
          <input ref="newPassword" type="password" v-model="newPassword" autocomplete="new-password" />
        </div>
        <div class="acct-row" :class="{kfocus:focusIdx===4}" @click="edit('confirmPassword',4)">
          <span class="acct-label">confirm</span>
          <input ref="confirmPassword" type="password" v-model="confirmPassword" autocomplete="new-password" />
        </div>

        <div class="acct-error" v-if="error">{{ error }}</div>
      </div>
      <div class="modal-foot" style="flex:0 0 auto;justify-content:space-between;">
        <button class="btn" :class="{kfocus:focusIdx===6}" @click="logout">log out</button>
        <button class="btn primary" :class="{kfocus:focusIdx===5}" :disabled="busy" @click="save">{{ busy ? '…' : 'save ↵' }}</button>
      </div>
    </div>

    <div class="overlay" v-if="confirmOpen" @click.self="confirmOpen=false" style="z-index:10003;background:rgba(5,4,2,.5);">
      <div class="modal" style="max-width:340px;">
        <div class="modal-body" style="text-align:center;line-height:1.6;">
          Changes will be lost. Continue?
        </div>
        <div class="modal-foot" style="justify-content:center;gap:10px;">
          <button class="btn" @click="confirmOpen=false">No (esc)</button>
          <button class="btn primary" @click="$emit('close')">Yes (enter)</button>
        </div>
      </div>
    </div>
  </div>
  `,
  mounted(){
    document.addEventListener('keydown', this.onKey);
    this.$nextTick(()=>{ this.move(0); });
  },
  beforeUnmount(){ document.removeEventListener('keydown', this.onKey); },
  computed: {
    dirty(){
      return this.username !== this.init.username || this.email !== this.init.email ||
        !!this.oldPassword || !!this.newPassword || !!this.confirmPassword;
    }
  },
  methods: {
    onKey(e){
      if(this.confirmOpen){
        if(e.key==='Enter'){ e.preventDefault(); this.$emit('close'); }
        else if(e.key==='Escape'){ e.preventDefault(); this.confirmOpen=false; }
        return;
      }
      const inInput = (e.target.tagName||'').toLowerCase()==='input';
      if(inInput){
        if(e.key==='Enter'){ e.preventDefault(); this.save(); }
        else if(e.key==='Escape'){ e.preventDefault(); e.target.blur(); } // back to nav
        return; // otherwise let it type
      }
      switch(e.key){
        case 'j': case 'ArrowDown': e.preventDefault(); this.move(1); break;
        case 'k': case 'ArrowUp':   e.preventDefault(); this.move(-1); break;
        case 'i': e.preventDefault(); this.activate(true); break;
        case 'Enter': e.preventDefault(); this.save(); break;
        case ' ': e.preventDefault(); this.activate(false); break;
        case 'Escape': e.preventDefault(); this.attemptClose(); break;
      }
    },
    move(d){ this.focusIdx = Math.max(0, Math.min(this.rows.length-1, this.focusIdx + d)); },
    // i = edit-only (inputs); space = activate (edit input OR trigger an action)
    activate(editOnly){
      const row = this.rows[this.focusIdx];
      if(row==='save'){ if(!editOnly) this.save(); return; }
      if(row==='logout'){ if(!editOnly) this.logout(); return; }
      this.edit(row, this.focusIdx);
    },
    edit(key, idx){ this.focusIdx = idx; this.$nextTick(()=>{ const el=this.$refs[key]; if(el) el.focus(); }); },
    attemptClose(){ if(this.dirty) this.confirmOpen = true; else this.$emit('close'); },
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
      const payload = {};
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
        if(res.status===401){ this.$emit('close'); return; } // session gone; root shows login
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
