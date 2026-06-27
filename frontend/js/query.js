/* ============================================================
   query.js  —  parse a query string + evaluate against a task.
   Attached to window.Q.
   ------------------------------------------------------------
   Grammar (space-separated terms, implicit AND):
     project:work            (matches that project only, not its subprojects)
     label:urgent            (comma list = OR -> label:urgent,bug)
     status:open|done|overdue|today
     due:today|tomorrow|overdue|week|none|set|<7d|>7d|=0d|<=3d
     reminder:today|none|set|overdue
     recurring:true|false
     is:subtask|task|recurring
     has:subtasks
     -term                   (negate any term)
     "free text"  or bareword -> title contains
   Helpers also build the string from a structured object (builder).
   ============================================================ */
(function () {
  const today = () => Rec.startOfDay(new Date());

  // tokenize respecting quotes
  function tokenize(str){
    const out = []; const re = /"([^"]*)"|(\S+)/g; let m;
    while((m = re.exec(str))) out.push(m[1] !== undefined ? '"'+m[1]+'"' : m[2]);
    return out;
  }

  function parse(str){
    const terms = [];
    if(!str || !str.trim()) return { terms, ok:true };
    for(let tok of tokenize(str)){
      let neg = false;
      if(tok.startsWith('-') && tok.length>1 && tok.indexOf(':')>0){ neg = true; tok = tok.slice(1); }
      const qi = tok.indexOf(':');
      if(qi>0 && !tok.startsWith('"')){
        const field = tok.slice(0,qi).toLowerCase();
        const value = tok.slice(qi+1).toLowerCase();
        terms.push({ field, value, neg });
      } else {
        terms.push({ field:'text', value: tok.replace(/^"|"$/g,'').toLowerCase(), neg });
      }
    }
    return { terms, ok:true };
  }

  // resolve a project token (id or slug of name) -> set of matching project ids only
  // (exact: subprojects are NOT included, so a parent's view/count shows just its own tasks)
  function resolveProjects(value, ctx){
    const projects = ctx.projects || [];
    const match = projects.filter(p =>
      p.id === value ||
      slug(p.name) === slug(value) ||
      slug(p.name).includes(slug(value))
    );
    return new Set(match.map(p => p.id));
  }
  function slug(s){ return String(s||'').toLowerCase().replace(/[^a-z0-9]+/g,''); }
  // match a categorizer NAME against a query value (exact slug, or substring) — the
  // cross-app category:/calendar:/folder: join key (mirrors resolveProjects' name arm)
  function catNameMatch(name, value){ const have=slug(name), want=slug(value); return have===want || (want.length>0 && have.includes(want)); }

  function dueDelta(task){ // days from today to due (negative = overdue). null if no due.
    if(!task.due) return null;
    return Rec.daysBetween(today(), Rec.parseYMD(task.due));
  }
  function remDelta(task){
    if(!task.reminder) return null;
    // reminder may be a 'YYYY-MM-DDTHH:MM' timestamp; query filters are day-grained.
    return Rec.daysBetween(today(), Rec.parseYMD(task.reminder.slice(0,10)));
  }
  // created/edited are full timestamps (often UTC) — resolve their LOCAL calendar day so a
  // non-UTC zone near midnight doesn't read them off by one. (due/reminder are date-only.)
  function createdDelta(task){
    if(!task.createdAt) return null;
    return Rec.daysBetween(today(), Rec.startOfDay(new Date(task.createdAt)));
  }
  function editedDelta(task){
    if(!task.updatedAt) return null;
    return Rec.daysBetween(today(), Rec.startOfDay(new Date(task.updatedAt)));
  }
  // true calendar-aligned ranges (this/last/next week|month) — distinct from the
  // day-window due:week/due:month. Returns true|false when `value` is a calendar
  // keyword (matched against `dateStr`), or null when it isn't one.
  function calMatch(dateStr, value, weekStart){
    const t = today();
    const y = t.getFullYear(), m = t.getMonth();
    let range = null;
    if(value==='this-month') range = [new Date(y, m, 1), new Date(y, m+1, 0)];
    else if(value==='next-month') range = [new Date(y, m+1, 1), new Date(y, m+2, 0)];
    else if(value==='last-month') range = [new Date(y, m-1, 1), new Date(y, m, 0)];
    else if(value==='this-week' || value==='last-week' || value==='next-week'){
      const ws = weekStart==null ? 1 : weekStart;
      const back = (t.getDay() - ws + 7) % 7;
      const start = Rec.addDays(t, -back);
      const off = value==='last-week' ? -7 : value==='next-week' ? 7 : 0;
      const s = Rec.addDays(start, off);
      range = [s, Rec.addDays(s, 6)];
    }
    if(!range) return null;
    if(!dateStr) return false;
    const ymd = dateStr.length > 10 ? Rec.ymd(new Date(dateStr)) : dateStr.slice(0,10);
    return ymd >= Rec.ymd(range[0]) && ymd <= Rec.ymd(range[1]);
  }

  function cmpDate(delta, op){ // op like "<7d", "<=3d", ">0d", "=0d"
    const mm = op.match(/^(<=|>=|<|>|=)(-?\d+)d$/);
    if(!mm || delta===null) return false;
    const o = mm[1], n = +mm[2];
    switch(o){ case '<': return delta<n; case '>': return delta>n;
      case '<=': return delta<=n; case '>=': return delta>=n; case '=': return delta===n; }
    return false;
  }

  // ---- weekday window (due:su, due:mwf, …) ----------------------------------
  // letter -> JS getDay() (0=Sun … 6=Sat)
  const DOW = { u:0, m:1, t:2, w:3, r:4, f:5, s:6 };
  function weekdaySet(v){ const s=new Set(); for(const c of String(v||'')){ if(c in DOW) s.add(DOW[c]); } return s; }
  // The active cycle's dates for the selected weekdays. weekStart: 0=Sun..6=Sat (default Mon).
  // Window = this week's selected days, rolling to next week once we're past the last one.
  function dueWindow(daySet, weekStart){
    weekStart = (weekStart == null) ? 1 : weekStart;
    if(!daySet.size) return [];
    const now = today();                                   // Rec.startOfDay(new Date())
    const back = (now.getDay() - weekStart + 7) % 7;       // days since the week start
    const start = Rec.addDays(now, -back);
    let dates = [...daySet].map(d => Rec.addDays(start, (d - weekStart + 7) % 7));
    const last = dates.reduce((a,b) => a > b ? a : b);
    if(now > last) dates = dates.map(d => Rec.addDays(d, 7));  // past the window -> next week
    return dates.map(Rec.ymd);
  }

  function evalTerm(task, t, ctx){
    const labelsOf = (task.labels||[]);
    let res = false;
    switch(t.field){
      case 'text':
        res = (task.title||'').toLowerCase().includes(t.value) ||
              (task.notes||'').toLowerCase().includes(t.value);
        break;
      case 'project': {
        const ids = resolveProjects(t.value, ctx);
        res = ids.has(task.projectId);
        break;
      }
      case 'category': {
        // generic cross-app categorizer: project (task) / calendar (event) / folder (note),
        // matched by NAME so one token (category:gym) spans all three apps. Events/notes
        // carry their category name; a plain task falls back to resolving its project.
        if(task.category != null) res = catNameMatch(task.category, t.value);
        else { const ids = resolveProjects(t.value, ctx); res = ids.has(task.projectId); }
        break;
      }
      case 'calendar':
        res = task.kind==='event' && catNameMatch(task.category, t.value);   // events only
        break;
      case 'folder':
        res = task.kind==='note' && catNameMatch(task.category, t.value);    // notes only
        break;
      case 'label': {
        const wants = t.value.split(',').map(slug);
        res = labelsOf.some(lid => {
          const lab = (ctx.labels||[]).find(l=>l.id===lid);
          return lab && wants.includes(slug(lab.name));
        });
        break;
      }
      case 'status': {
        const d = dueDelta(task);
        if(t.value==='done') res = !!task.done;
        else if(t.value==='open') res = !task.done;
        else if(t.value==='overdue') res = !task.done && d!==null && d<0;
        else if(t.value==='today') res = !task.done && d===0;
        break;
      }
      case 'due': {
        const d = dueDelta(task);
        if(t.value==='none') res = d===null;
        else if(t.value==='set') res = d!==null;
        else if(t.value==='today') res = d===0;
        else if(t.value==='tomorrow') res = d===1;
        else if(t.value==='overdue') res = d!==null && d<0;
        else if(t.value==='week') res = d!==null && d>=0 && d<=7;
        else if(t.value==='month') res = d!==null && d>=0 && d<=31;
        else if(/^[mtwrfsu]+$/.test(t.value)) res = !!task.due && dueWindow(weekdaySet(t.value), ctx.weekStart).includes(task.due.slice(0,10));
        else { const cm = calMatch(task.due, t.value, ctx.weekStart); res = cm!==null ? cm : cmpDate(d, t.value); }
        break;
      }
      case 'created': {
        const d = createdDelta(task);
        if(t.value==='none') res = d===null;
        else if(t.value==='set') res = d!==null;
        else if(t.value==='today') res = d===0;
        else { const cm = calMatch(task.createdAt, t.value, ctx.weekStart); res = cm!==null ? cm : cmpDate(d, t.value); }
        break;
      }
      case 'edited': {
        const d = editedDelta(task);
        if(t.value==='none') res = d===null;
        else if(t.value==='set') res = d!==null;
        else if(t.value==='today') res = d===0;
        else { const cm = calMatch(task.updatedAt, t.value, ctx.weekStart); res = cm!==null ? cm : cmpDate(d, t.value); }
        break;
      }
      case 'reminder': {
        const d = remDelta(task);
        if(t.value==='none') res = d===null;
        else if(t.value==='set') res = d!==null;
        else if(t.value==='today') res = d===0;
        else if(t.value==='overdue') res = d!==null && d<0;
        else res = cmpDate(d, t.value);
        break;
      }
      case 'recurring':
        res = t.value==='true' ? !!task.recurrence : !task.recurrence;
        break;
      case 'is':
        if(t.value==='subtask') res = !!task.parentId;
        else if(t.value==='task') res = !task.parentId;
        else if(t.value==='recurring') res = !!task.recurrence;
        else if(t.value==='done') res = !!task.done;
        else if(t.value==='open') res = !task.done;
        break;
      case 'has':
        if(t.value==='subtasks') res = (ctx.tasks||[]).some(x=>x.parentId===task.id);
        else if(t.value==='label') res = labelsOf.length>0;
        else if(t.value==='no-labels') res = labelsOf.length===0;
        else if(t.value==='due') res = !!task.due;
        break;
      default:
        // unknown field -> treat as text match on "field:value"
        res = (task.title||'').toLowerCase().includes(t.field+':'+t.value);
    }
    return t.neg ? !res : res;
  }

  function evaluate(task, query, ctx){
    const q = typeof query==='string' ? parse(query) : query;
    if(!q.terms.length) return true;
    return q.terms.every(t => evalTerm(task, t, ctx));
  }

  // run query over the task list -> matching tasks (flat)
  function run(query, ctx){
    return (ctx.tasks||[]).filter(t => evaluate(t, query, ctx));
  }

  // ---- builder helpers: structured <-> string ---------------
  // We keep builder state as an array of {field,value,neg}; string is the join.
  function termToString(t){
    const body = t.field==='text'
      ? (/\s/.test(t.value) ? '"'+t.value+'"' : t.value)
      : t.field+':'+t.value;
    return (t.neg?'-':'')+body;
  }
  function build(terms){ return terms.map(termToString).join(' '); }

  window.Q = { parse, evaluate, run, build, termToString, tokenize, slug, dueDelta };
})();
