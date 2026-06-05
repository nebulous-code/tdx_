/* ============================================================
   data.js  —  reactive store + sample data.  window.store
   ============================================================ */
(function () {
  const { reactive } = Vue;
  const T = Rec.ymd; // ymd formatter
  const todayD = Rec.startOfDay(new Date());
  const d = (off) => T(Rec.addDays(todayD, off));
  let _id = 100;
  const uid = (p) => (p||'id') + '_' + (++_id);

  // ---- category color palette (flat, single color) ----
  const COLORS = [
    '#ffb000', // amber
    '#46d369', // green
    '#3fd7d7', // cyan
    '#5b8cff', // blue
    '#c78bff', // violet
    '#ff6fae', // pink
    '#ff5c5c', // red
    '#ff9f43', // orange
    '#b6c948', // lime
    '#8a93a6', // slate
  ];
  // ASCII / unicode glyph icons (monospace-safe)
  const GLYPHS = ['❯','◆','▲','●','★','■','◈','⌘','⚙','§','¶','λ','Σ','∆','▒','☰','⎔','⊞','✦','⛁','♜','⌬','∴','▚','◇','✧','⊹','⌗','⟁','❖'];

  const labels = [
    { id:'l_urgent',  name:'urgent' },
    { id:'l_quick',   name:'quick' },
    { id:'l_blocked', name:'blocked' },
    { id:'l_deep',    name:'deep-work' },
    { id:'l_errand',  name:'errand' },
    { id:'l_bug',     name:'bug' },
    { id:'l_idea',    name:'idea' },
    { id:'l_waiting', name:'waiting' },
  ];

  const projects = [
    { id:'p_dev',    parentId:null,    name:'dev',          color:'#46d369', glyph:'λ',  collapsed:false },
    { id:'p_tdx',    parentId:'p_dev', name:'tdx-app',      color:'#3fd7d7', glyph:'◈',  collapsed:false },
    { id:'p_infra',  parentId:'p_dev', name:'infra',        color:'#5b8cff', glyph:'⊞',  collapsed:false },
    { id:'p_home',   parentId:null,    name:'home',         color:'#ff9f43', glyph:'⌂',  collapsed:false },
    { id:'p_house',  parentId:'p_home',name:'house-upkeep', color:'#ff6fae', glyph:'⚙',  collapsed:false },
    { id:'p_money',  parentId:'p_home',name:'finance',      color:'#b6c948', glyph:'§',  collapsed:false },
    { id:'p_health', parentId:null,    name:'health',       color:'#c78bff', glyph:'✦',  collapsed:false },
    { id:'p_read',   parentId:null,    name:'reading',      color:'#ffb000', glyph:'¶',  collapsed:false },
  ];

  const tasks = [
    // tdx-app
    mk('t1','p_tdx',null,'Ship recurrence builder UI', { due:d(0), labels:['l_deep'], notes:'Builder writes syntax; syntax editable by hand.', rec:'weekly on mon,wed,fri' }),
    mk('t1a','p_tdx','t1','Parse `every Nth weekday` form', { done:true }),
    mk('t1b','p_tdx','t1','Live next-3-occurrences preview', {}),
    mk('t1c','p_tdx','t1','Reuse syntax across tasks', { labels:['l_quick'] }),
    mk('t2','p_tdx',null,'Wire ⌘K command palette', { due:d(1), labels:['l_deep'] }),
    mk('t3','p_tdx',null,'Saved queries -> smart views', { due:d(-1), labels:['l_urgent'] }),
    mk('t3a','p_tdx','t3','Persist queries to localStorage', {}),
    mk('t4','p_tdx',null,'Fix scanline flicker on Safari', { labels:['l_bug'], due:d(3) }),
    mk('t5','p_tdx',null,'PWA manifest + service worker', { labels:['l_idea'], due:d(14) }),

    // infra
    mk('t6','p_infra',null,'Rotate API keys', { rec:'every 3 months on day 1', due:d(2), reminder:d(1), labels:['l_urgent'] }),
    mk('t7','p_infra',null,'Review backup integrity', { rec:'weekly on sun', due:d(3) }),
    mk('t8','p_infra',null,'Upgrade node 20 -> 22', { labels:['l_blocked','l_waiting'] }),

    // house-upkeep
    mk('h1','p_house',null,'Take out recycling', { rec:'weekly on tue', due:d(0), reminder:d(0) }),
    mk('h2','p_house',null,'Replace HVAC filter', { rec:'every 2 months on day 1', due:d(9) }),
    mk('h3','p_house',null,'Water the plants', { rec:'every 3 days', due:d(0), labels:['l_quick'] }),
    mk('h4','p_house',null,'Deep clean kitchen', { rec:'monthly on 1st sat', due:d(5) }),

    // finance
    mk('m1','p_money',null,'Pay rent', { rec:'monthly on day 1', due:d(-1), reminder:d(-3), labels:['l_urgent'] }),
    mk('m2','p_money',null,'Reconcile budget', { rec:'monthly on last fri', due:d(6) }),
    mk('m3','p_money',null,'Review subscriptions', { rec:'every 6 months on day 15', due:d(40) }),

    // health
    mk('he1','p_health',null,'Gym — push day', { rec:'weekly on mon,thu', due:d(0), labels:['l_deep'] }),
    mk('he2','p_health',null,'10k steps', { rec:'daily', due:d(0), labels:['l_quick'] }),
    mk('he3','p_health',null,'Dentist appointment', { due:d(12), reminder:d(11), labels:['l_errand'] }),
    mk('he4','p_health',null,'Refill prescription', { rec:'monthly on day 20', due:d(4), reminder:d(2) }),

    // reading
    mk('r1','p_read',null,'Finish "The Pragmatic Programmer"', { due:d(20), labels:['l_idea'] }),
    mk('r1a','p_read','r1','Ch. 7 — bend or break', {}),
    mk('r1b','p_read','r1','Ch. 8 — pragmatic projects', {}),
    mk('r2','p_read',null,'Weekly reading hour', { rec:'weekly on sat', due:d(2) }),
  ];

  function mk(id, projectId, parentId, title, o){
    o = o || {};
    return reactive({
      id, projectId, parentId, title,
      done: !!o.done,
      due: o.due || null,
      reminder: o.reminder || null,
      labels: o.labels || [],
      recurrence: o.rec || null,
      notes: o.notes || '',
      collapsed: false,
      createdAt: T(todayD),
      completedAt: o.done ? T(todayD) : null,
    });
  }

  const savedQueries = [
    { id:'sv_today',   name:'Today',     glyph:'☉', query:'status:open due:today',     system:true },
    { id:'sv_overdue', name:'Overdue',   glyph:'!', query:'status:overdue',            system:true },
    { id:'sv_week',    name:'This week', glyph:'☰', query:'status:open due:week',      system:true },
    { id:'sv_rec',     name:'Recurring', glyph:'↻', query:'recurring:true status:open',system:true },
    { id:'sv_nodate',  name:'No date',   glyph:'∅', query:'due:none status:open',      system:true },
    { id:'sv_urgent',  name:'Urgent',    glyph:'★', query:'label:urgent status:open',  system:false },
    { id:'sv_quick',   name:'Quick wins',glyph:'⚡', query:'label:quick status:open',   system:false },
  ];

  const store = reactive({
    labels, projects, tasks, savedQueries,
    COLORS, GLYPHS,
    // ui state
    view: { kind:'query', id:'sv_today', title:'Today', query:'status:open due:today' },
    selectedTaskId: null,
    detailOpen: false,
    showCompleted: false,
    sortBy: 'due',           // due | created | title | project
    builderOpen: false,
    sidebarOpen: false,      // mobile
    toasts: [],
  });

  // ---- derived helpers (plain functions; components call them) ----
  store.ctx = () => ({ projects: store.projects, tasks: store.tasks, labels: store.labels });
  store.projectById = (id) => store.projects.find(p=>p.id===id);
  store.labelById = (id) => store.labels.find(l=>l.id===id);
  store.childProjects = (pid) => store.projects.filter(p=>p.parentId===pid);
  store.subtasks = (tid) => store.tasks.filter(t=>t.parentId===tid);
  store.taskById = (id) => store.tasks.find(t=>t.id===id);

  // count open tasks for a project incl. subprojects
  store.projectCount = (pid) => {
    const ids = new Set();
    const walk = (p)=>{ ids.add(p); store.childProjects(p).forEach(c=>walk(c.id)); };
    walk(pid);
    return store.tasks.filter(t=>!t.done && !t.parentId && ids.has(t.projectId)).length;
  };
  store.queryCount = (q) => Q.run(q, store.ctx()).filter(t=>!t.parentId).length;

  // the visible, sorted root tasks for the current view (shared by list + keyboard nav)
  store.currentQuery = () => {
    const v = store.view;
    return v.kind==='project' ? 'project:'+v.id : (v.query||'');
  };
  store.visibleRoots = () => {
    const ctx = store.ctx();
    const q = store.currentQuery();
    let matched = Q.run(q, ctx);
    if(!store.showCompleted && !/status:done|is:done/.test(q)) matched = matched.filter(t=>!t.done);
    const matchedIds = new Set(matched.map(t=>t.id));
    const roots = []; const seen = new Set();
    for(const t of matched){
      let r=t; while(r.parentId){ const p=store.taskById(r.parentId); if(!p) break; r=p; }
      if(!seen.has(r.id)){ seen.add(r.id); roots.push(r); }
    }
    let list = store.showCompleted ? roots : roots.filter(r=>!r.done || matchedIds.has(r.id));
    const by=store.sortBy;
    list = [...list].sort((a,b)=>{
      if(by==='due'){ const av=a.due||'9999', bv=b.due||'9999'; return av<bv?-1:av>bv?1:0; }
      if(by==='title') return a.title.localeCompare(b.title);
      if(by==='project'){ const ap=(store.projectById(a.projectId)||{}).name||''; const bp=(store.projectById(b.projectId)||{}).name||''; return ap.localeCompare(bp); }
      return a.createdAt<b.createdAt?1:-1;
    });
    return list;
  };

  // ---- mutations ----
  store.toast = (msg) => {
    const id = uid('toast'); store.toasts.push({ id, msg });
    setTimeout(()=>{ const i = store.toasts.findIndex(t=>t.id===id); if(i>=0) store.toasts.splice(i,1); }, 2200);
  };

  store.setView = (v) => {
    store.view = v; store.selectedTaskId = null; store.sidebarOpen = false;
  };
  store.openQueryView = (sv) => {
    store.setView({ kind:'query', id:sv.id, title:sv.name, query:sv.query });
  };
  store.openProjectView = (p) => {
    store.setView({ kind:'project', id:p.id, title:p.name, query:'' });
  };

  store.addTask = (partial) => {
    const t = mk(uid('t'), partial.projectId || currentProjectId(), partial.parentId||null, partial.title||'untitled', partial);
    if(partial.rec) t.recurrence = partial.rec;
    store.tasks.push(t);
    return t;
  };
  function currentProjectId(){
    if(store.view.kind==='project') return store.view.id;
    return store.projects[0].id;
  }
  store.currentProjectId = currentProjectId;

  store.toggleDone = (t) => {
    t.done = !t.done;
    t.completedAt = t.done ? T(new Date()) : null;
    // recurring: spawn next occurrence when completed
    if(t.done && t.recurrence){
      const nxt = Rec.next(t.recurrence, t.due || Rec.ymd(new Date()), t.due);
      if(nxt){
        const clone = mk(uid('t'), t.projectId, t.parentId, t.title, {
          due: Rec.ymd(nxt),
          reminder: shiftReminder(t, nxt),
          labels: [...t.labels], rec: t.recurrence, notes: t.notes,
        });
        store.tasks.push(clone);
        store.toast('↻ next: '+Rec.ymd(nxt));
      }
    }
  };
  function shiftReminder(t, nextDue){
    if(!t.reminder || !t.due) return null;
    const gap = Rec.daysBetween(Rec.parseYMD(t.due), Rec.parseYMD(t.reminder));
    return Rec.ymd(Rec.addDays(nextDue, gap));
  }

  store.deleteTask = (t) => {
    // delete subtasks too
    const kids = store.subtasks(t.id);
    kids.forEach(k=>store.deleteTask(k));
    const i = store.tasks.findIndex(x=>x.id===t.id);
    if(i>=0) store.tasks.splice(i,1);
    if(store.selectedTaskId===t.id){ store.selectedTaskId=null; store.detailOpen=false; }
  };

  store.addProject = (partial) => {
    const p = reactive({
      id: uid('p'), parentId: partial.parentId||null,
      name: partial.name||'new-project',
      color: partial.color||COLORS[0], glyph: partial.glyph||'●', collapsed:false,
    });
    store.projects.push(p); return p;
  };
  store.deleteProject = (p) => {
    store.childProjects(p.id).forEach(c=>store.deleteProject(c));
    store.tasks.filter(t=>t.projectId===p.id).forEach(t=>store.deleteTask(t));
    const i = store.projects.findIndex(x=>x.id===p.id);
    if(i>=0) store.projects.splice(i,1);
  };

  store.saveQuery = (name, query) => {
    const sv = { id: uid('sv'), name, glyph:'◆', query, system:false };
    store.savedQueries.push(sv);
    store.openQueryView(sv);
    return sv;
  };
  store.deleteQuery = (sv) => {
    const i = store.savedQueries.findIndex(x=>x.id===sv.id);
    if(i>=0) store.savedQueries.splice(i,1);
  };

  store.addLabel = (name) => {
    let lab = store.labels.find(l=>Q.slug(l.name)===Q.slug(name));
    if(lab) return lab;
    lab = { id: uid('l'), name: name.replace(/^#/,'') };
    store.labels.push(lab); return lab;
  };

  window.store = store;
})();
