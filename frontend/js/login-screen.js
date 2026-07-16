/* login-screen.js — the auth gate shown when there's no current user.
   Self-contained: handles its own inputs (Enter submits, Tab moves between
   fields). The app's global keyboard handler is NOT attached while this is up,
   so app shortcuts stay off on the login screen. */
window.LoginScreen = {
  emits: ['authed'],
  data(){ return { username:'', password:'', error:'', busy:false }; },
  template: `
  <div class="login-wrap">
    <div class="login-box">
      <div class="login-brand">tdx<b>_</b></div>
      <div class="login-sub">terminal todo · sign in</div>
      <form @submit.prevent="submit">
        <label class="login-field">
          <span class="login-label">user</span>
          <input ref="user" data-testid="login-username" v-model="username" autocomplete="username" autocapitalize="off"
                 spellcheck="false" :disabled="busy" />
        </label>
        <label class="login-field">
          <span class="login-label">pass</span>
          <input type="password" data-testid="login-password" v-model="password" autocomplete="current-password"
                 :disabled="busy" />
        </label>
        <div class="login-error" v-if="error">{{ error }}</div>
        <button class="btn primary login-go" data-testid="login-submit" type="submit" :disabled="busy">
          {{ busy ? '…' : 'sign in ↵' }}
        </button>
      </form>
    </div>
  </div>
  `,
  mounted(){ this.$nextTick(()=>{ this.$refs.user && this.$refs.user.focus(); }); },
  methods: {
    async submit(){
      if(this.busy) return;
      this.error='';
      if(!this.username || !this.password){ this.error='enter your username and password'; return; }
      this.busy=true;
      try{
        const res = await fetch('/api/auth/login', {
          method:'POST', credentials:'include',
          headers:{ 'Content-Type':'application/json' },
          body: JSON.stringify({ username:this.username, password:this.password }),
        });
        if(res.ok){
          const user = await res.json();
          this.password='';
          this.$emit('authed', user);
          return;
        }
        if(res.status===429){ this.error='too many attempts — wait a moment and try again'; }
        else { this.error='invalid username or password'; }
      }catch(e){
        this.error = "can't reach the server";
      }finally{
        this.busy=false;
      }
    }
  }
};
