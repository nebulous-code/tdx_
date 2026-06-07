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
      priority: o.priority || 0,
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
    sortField: 'due',        // due | created | title | project | priority | tag
    // per-field direction. 'asc' = ^, 'desc' = v.
    sortDirs: { due:'asc', created:'asc', title:'asc', project:'asc', priority:'desc', tag:'asc' },
    // sort configuration (Shift+S popup, persisted per-user as users.sort_prefs)
    sortOrder: ['due','created','title','project','priority','tag'],   // priority order for the `s` cycle
    sortEnabled: { due:true, created:true, title:true, project:true, priority:true, tag:true },
    builderOpen: false,
    sidebarOpen: false,      // mobile slide-in
    navCollapsed: false,     // desktop: hide the sidebar column (toggled with n)
    navSections: { query:false, project:false, label:false },  // collapsed sidebar sections (Tab)
    focusPane: 'list',       // 'list' | 'side' | 'filter' — which window the keyboard drives
    sideFocusId: null,       // id of the keyboard-focused sidebar item
    moveId: null,            // id of the sidebar item being reordered (m = move mode)
    pendingNotesFocus: false,// set by quick-add Shift+Enter → detail opens focused in notes
    toasts: [],
    currentUser: null,       // { id, username, email } once authenticated; null = logged out
  });

  // ---- derived helpers (plain functions; components call them) ----
  store.ctx = () => ({ projects: store.projects, tasks: store.tasks, labels: store.labels,
    weekStart: (store.currentUser && store.currentUser.week_start) ?? 1 });
  store.projectById = (id) => store.projects.find(p=>p.id===id);
  store.labelById = (id) => store.labels.find(l=>l.id===id);
  // priority 0 (none) … 5 (very high)
  store.priorityLabel = (p) => ['','very low','low','medium','high','very high'][p] || '';
  // labels rendered everywhere (nav, filter, task detail) sorted alphabetically by
  // slug (lowercase, no spaces); storage order is left untouched.
  store.sortedLabels = () => [...store.labels].sort((a,b)=> Q.slug(a.name).localeCompare(Q.slug(b.name)));
  store.childProjects = (pid) => store.projects.filter(p=>p.parentId===pid);
  // flat, depth-tagged list in tree order (parent then its children) — for ordered
  // project pickers (task detail select, project-modal parent select)
  store.projectTree = () => {
    const out = [];
    const walk = (p, depth) => { out.push({ p, depth }); store.childProjects(p.id).forEach(c=>walk(c, depth+1)); };
    store.projects.filter(p=>!p.parentId).forEach(r=>walk(r, 0));
    return out;
  };
  store.reparentProject = (p, parentId) => { p.parentId = parentId || null; };
  // ---- sort configuration (Shift+S popup; persisted as users.sort_prefs) ----
  const SORT_KEYS = ['due','created','title','project','priority','tag'];
  const DEFAULT_SORT_DIRS = { due:'asc', created:'asc', title:'asc', project:'asc', priority:'desc', tag:'asc' };
  // pure: turn a (possibly null/partial) stored prefs object into a clean {order,enabled,dirs}
  store.normalizeSortPrefs = (p) => {
    const order = (p && Array.isArray(p.order)) ? p.order.filter(k=>SORT_KEYS.includes(k)) : [];
    for(const k of SORT_KEYS) if(!order.includes(k)) order.push(k);   // backfill any missing
    const enabled = {}, dirs = {};
    for(const k of SORT_KEYS){
      enabled[k] = !(p && p.enabled && p.enabled[k]===false);
      dirs[k] = (p && p.dirs && (p.dirs[k]==='asc' || p.dirs[k]==='desc')) ? p.dirs[k] : DEFAULT_SORT_DIRS[k];
    }
    if(!SORT_KEYS.some(k=>enabled[k])) enabled[order[0]] = true;   // keep ≥1 on
    return { order, enabled, dirs };
  };
  // load stored prefs into the live session state (startup / after save)
  store.applySortPrefs = (p) => {
    const n = store.normalizeSortPrefs(p);
    store.sortOrder = n.order;
    for(const k of SORT_KEYS){ store.sortEnabled[k] = n.enabled[k]; store.sortDirs[k] = n.dirs[k]; }
    const first = store.sortOrder.find(k=>store.sortEnabled[k]);   // start on the top enabled sort
    if(first) store.sortField = first;
  };
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
    const by = store.sortField;
    const dir = (store.sortDirs && store.sortDirs[by]) === 'desc' ? -1 : 1;  // ^ = asc, v = desc
    // ascending comparator per field; direction flips it
    const tagKey = t => (t.labels||[]).map(id=>{ const l=store.labelById(id); return l?l.name:''; }).filter(Boolean).sort().join('');
    const cmp = (a,b) => {
      if(by==='due')      return (a.due||'9999').localeCompare(b.due||'9999');
      if(by==='created')  return (a.createdAt||'').localeCompare(b.createdAt||'');
      if(by==='title')    return a.title.localeCompare(b.title);
      if(by==='project'){ const ap=(store.projectById(a.projectId)||{}).name||''; const bp=(store.projectById(b.projectId)||{}).name||''; return ap.localeCompare(bp); }
      if(by==='priority') return (a.priority||0)-(b.priority||0);
      if(by==='tag')      return tagKey(a).localeCompare(tagKey(b));
      return 0;
    };
    list = [...list].sort((a,b)=> dir * cmp(a,b));
    return list;
  };

  // Flattened, ordered list of every on-screen task row (each visible root then,
  // unless collapsed, its subtasks depth-first) — matches what TaskList renders,
  // so j/k keyboard nav steps through subtasks too instead of skipping them.
  store.visibleRows = () => {
    const out = [];
    const walk = (t) => {
      out.push(t);
      if(!t.collapsed) store.subtasks(t.id).forEach(walk);
    };
    store.visibleRoots().forEach(walk);
    return out;
  };

  // When a task is created from within a view, seed it with the attributes the
  // view filters on, so it stays visible. We apply Status, Due, Labels and
  // Project deterministically; Flags (recurring/reminder/is/has) and free text
  // are ignored (see store.viewWarn). For dates we pick the day closest to today
  // that satisfies the view's due/status terms — reusing the query engine itself.
  const APPLIED_FIELDS = new Set(['project','label','status','due']);
  store.viewDefaults = () => {
    const out = { labels: [] };
    const terms = Q.parse(store.currentQuery()).terms;
    const ctx = store.ctx();

    // project: assign the first matching project (id or name slug)
    const pt = terms.find(t => t.field==='project' && !t.neg);
    if(pt){
      const p = store.projects.find(p => p.id===pt.value || Q.slug(p.name)===Q.slug(pt.value));
      if(p) out.projectId = p.id;
    }

    // labels: every non-negated label term, comma-lists expanded (OR -> apply all)
    terms.filter(t => t.field==='label' && !t.neg).forEach(t => {
      t.value.split(',').forEach(name => {
        const lab = store.labels.find(l => Q.slug(l.name)===Q.slug(name));
        if(lab && !out.labels.includes(lab.id)) out.labels.push(lab.id);
      });
    });

    // status:done -> create the task already done
    if(terms.some(t => t.field==='status' && t.value==='done' && !t.neg)) out.done = true;

    // due: closest-to-today date satisfying every due/status term. due:none means
    // "no due date", which an undated task already satisfies, so leave due unset.
    const dateTerms = terms.filter(t => t.field==='due' || t.field==='status');
    const hasDateConstraint = dateTerms.some(t =>
      t.field==='due' || t.value==='today' || t.value==='overdue');
    const wantsNoDue = terms.some(t => t.field==='due' && t.value==='none' && !t.neg);
    if(hasDateConstraint && !wantsNoDue){
      const base = Rec.startOfDay(new Date());
      // future-first: closest date that satisfies the due/status terms, preferring
      // today/upcoming over past (so a due:<weekdays> view lands a new task on the
      // next selected weekday). Regression-free for the other due filters.
      const offsets = [0];
      for(let i=1; i<=400; i++){ offsets.push(i); }
      for(let i=1; i<=400; i++){ offsets.push(-i); }
      for(const delta of offsets){
        const cand = { due: Rec.ymd(Rec.addDays(base, delta)), done: !!out.done,
          parentId:null, recurrence:null, labels:[], title:'', notes:'' };
        if(dateTerms.every(t => Q.evaluate(cand, { terms:[t], ok:true }, ctx))){
          out.due = cand.due; break;
        }
      }
    }
    return out;
  };

  // True when the current view filters on parameters we can't apply to a new task
  // (Flags or free text) — drives the quick-add warning indicator.
  store.viewWarn = () =>
    Q.parse(store.currentQuery()).terms.some(t => !APPLIED_FIELDS.has(t.field));

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
  store.openLabelView = (l) => {
    store.setView({ kind:'query', id:'label_'+l.id, title:'#'+l.name, query:'label:'+l.name+' status:open' });
  };

  // Flat, ordered list of every navigable sidebar row (views, then the project
  // tree respecting collapse, then labels) — used for keyboard navigation.
  store.sideItems = () => {
    const items = [];
    const ns = store.navSections || {};
    // section headers are always navigable (so a collapsed section can be re-expanded)
    items.push({ kind:'head', section:'query', id:'head_query' });
    if(!ns.query) store.savedQueries.forEach(sv => items.push({ kind:'query', id:sv.id, ref:sv }));
    items.push({ kind:'head', section:'project', id:'head_project' });
    if(!ns.project){
      const walk = (p) => {
        items.push({ kind:'project', id:p.id, ref:p });
        if(!p.collapsed) store.childProjects(p.id).forEach(walk);
      };
      store.projects.filter(p=>!p.parentId).forEach(walk);
    }
    items.push({ kind:'head', section:'label', id:'head_label' });
    if(!ns.label) store.sortedLabels().forEach(l => items.push({ kind:'label', id:l.id, ref:l }));
    return items;
  };
  // Reorder helpers (m = move mode). Array order persists through the snapshot
  // round-trip (writeState re-inserts in order, readState returns insertion order).
  store.moveView = (sv, dir) => {            // dir: -1 up, +1 down
    const arr = store.savedQueries;
    const i = arr.indexOf(sv), j = i + dir;
    if(i<0 || j<0 || j>=arr.length) return;
    arr.splice(i,1); arr.splice(j,0,sv);
  };
  store.moveProject = (p, dir) => {          // swap with the prev/next sibling (same parent)
    const arr = store.projects;
    const sibs = arr.filter(x=>x.parentId===p.parentId);
    const target = sibs[sibs.indexOf(p) + dir];
    if(!target) return;
    const ia = arr.indexOf(p), ib = arr.indexOf(target);
    const tmp = arr[ia]; arr[ia] = arr[ib]; arr[ib] = tmp;
  };
  store.openSideItem = (it) => {
    if(!it) return;
    if(it.kind==='query') store.openQueryView(it.ref);
    else if(it.kind==='project') store.openProjectView(it.ref);
    else if(it.kind==='label') store.openLabelView(it.ref);
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
          labels: [...t.labels], rec: t.recurrence, notes: t.notes, priority: t.priority,
        });
        store.tasks.push(clone);
        store.toast('↻ next: '+Rec.ymd(nxt));
      }
    }
  };
  function shiftReminder(t, nextDue){
    if(!t.reminder || !t.due) return null;
    // reminder is a 'YYYY-MM-DDTHH:MM' timestamp; preserve its time-of-day and
    // its day-offset from the due date across the recurrence.
    const remDate = t.reminder.slice(0,10);
    const time = t.reminder.length>10 ? t.reminder.slice(10) : ''; // 'THH:MM'
    const gap = Rec.daysBetween(Rec.parseYMD(t.due), Rec.parseYMD(remDate));
    return Rec.ymd(Rec.addDays(nextDue, gap)) + time;
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

  store.saveQuery = (name, query, glyph, color) => {
    const sv = { id: uid('sv'), name, glyph: glyph || '◆', color: color || COLORS[0], query, system:false };
    store.savedQueries.push(sv);
    store.openQueryView(sv);
    return sv;
  };
  store.deleteQuery = (sv) => {
    const i = store.savedQueries.findIndex(x=>x.id===sv.id);
    if(i>=0) store.savedQueries.splice(i,1);
  };

  store.addLabel = (name) => {
    const clean = String(name||'').replace(/^#/,'').trim().toLowerCase();
    let lab = store.labels.find(l=>Q.slug(l.name)===Q.slug(clean));
    if(lab) return lab;
    lab = { id: uid('l'), name: clean };
    store.labels.push(lab); return lab;
  };
  // fold one label into another: reassign every task's id (dedupe) then drop the source
  store.mergeLabels = (fromId, toId) => {
    if(fromId===toId) return;
    store.tasks.forEach(t => {
      if(t.labels && t.labels.includes(fromId))
        t.labels = [...new Set(t.labels.map(id => id===fromId ? toId : id))];
    });
    const i = store.labels.findIndex(l => l.id===fromId);
    if(i>=0) store.labels.splice(i,1);
  };

  // After loading state from the server, raise the id counter above every id
  // already present. uid() generates 'prefix_N' ids from a single shared counter
  // that resets to 100 on each page load; without this, the first task created
  // in a fresh session would reuse an id (e.g. t_101) that already exists in the
  // loaded data — causing two tasks to share an id and "swap" in the UI.
  // (Seed ids like 't1'/'p_inbox' have no trailing '_N' and are correctly ignored.)
  store.reserveIds = () => {
    let max = _id;
    const scan = (arr) => {
      for(const o of (arr||[])){
        const m = /_(\d+)$/.exec(o && o.id);
        if(m){ const n = +m[1]; if(n>max) max = n; }
      }
    };
    scan(store.tasks); scan(store.projects); scan(store.labels); scan(store.savedQueries);
    _id = max;
  };

  window.store = store;

  // Apply a color theme by toggling data-theme on <html>; themes.css cascades
  // the new token set across the whole UI. Falsy / unknown -> default 'amber'.
  window.THEMES = ['amber','matrix','ice','paper','plasma','magenta'];
  window.applyTheme = (key) => {
    const t = window.THEMES.includes(key) ? key : 'amber';
    document.documentElement.setAttribute('data-theme', t);
  };
})();
