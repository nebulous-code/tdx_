/* ============================================================
   recurrence.js  —  parse a recurrence syntax string + compute
   the next occurrences.  Pure functions, attached to window.Rec
   ------------------------------------------------------------
   Supported syntax (case-insensitive):
     daily
     every N days
     weekly on mon,wed,fri          (one or more weekdays)
     every N weeks on mon,wed
     monthly on day 15              (Nth calendar day)
     monthly on 2nd fri            (Nth weekday: 1st..4th | last)
     every N months on day 15
     every N months on 1st mon
   ============================================================ */
(function () {
  const WD = ['sun','mon','tue','wed','thu','fri','sat'];
  const WD_FULL = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const ORD = { '1st':1,'2nd':2,'3rd':3,'4th':4,'5th':5,'last':-1 };
  const ORD_NAME = { 1:'1st',2:'2nd',3:'3rd',4:'4th',5:'5th','-1':'last' };

  function pad(n){ return String(n).padStart(2,'0'); }
  function ymd(d){ return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate()); }
  function parseYMD(s){ if(!s) return null; const [y,m,d]=s.split('-').map(Number); return new Date(y,m-1,d); }
  function startOfDay(d){ return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
  function addDays(d,n){ const x=new Date(d); x.setDate(x.getDate()+n); return x; }
  function daysBetween(a,b){ return Math.round((startOfDay(b)-startOfDay(a))/86400000); }
  function sameDay(a,b){ return ymd(a)===ymd(b); }

  // ---- parse -------------------------------------------------
  function parse(str){
    if(!str) return null;
    const s = str.trim().toLowerCase().replace(/\s+/g,' ');
    let m;

    if(s === 'daily' || s === 'every day')
      return { type:'daily', interval:1 };

    if((m = s.match(/^every (\d+) days?$/)))
      return { type:'daily', interval:+m[1] };

    // weekly on days / every N weeks on days
    if((m = s.match(/^weekly on (.+)$/)))
      return mkWeekly(1, m[1]);
    if((m = s.match(/^every (\d+) weeks? on (.+)$/)))
      return mkWeekly(+m[1], m[2]);
    if((m = s.match(/^every (\d+) weeks?$/)))
      return { type:'weekly', interval:+m[1], days:null };

    // monthly on day D
    if((m = s.match(/^monthly on day (\d+)$/)))
      return { type:'monthly-day', interval:1, day: clampDay(+m[1]) };
    if((m = s.match(/^every (\d+) months? on day (\d+)$/)))
      return { type:'monthly-day', interval:+m[1], day: clampDay(+m[2]) };

    // monthly on Nth weekday
    if((m = s.match(/^monthly on (1st|2nd|3rd|4th|5th|last) (mon|tue|wed|thu|fri|sat|sun)$/)))
      return { type:'monthly-weekday', interval:1, ord:ORD[m[1]], weekday:WD.indexOf(m[2]) };
    if((m = s.match(/^every (\d+) months? on (1st|2nd|3rd|4th|5th|last) (mon|tue|wed|thu|fri|sat|sun)$/)))
      return { type:'monthly-weekday', interval:+m[1], ord:ORD[m[2]], weekday:WD.indexOf(m[3]) };

    if((m = s.match(/^every (\d+) months?$/)))
      return { type:'monthly-day', interval:+m[1], day:null };

    return { type:'invalid', raw:str };
  }

  function clampDay(d){ return Math.min(31, Math.max(1, d)); }

  function mkWeekly(interval, daysStr){
    const days = daysStr.split(/[ ,]+/).map(x=>WD.indexOf(x.trim())).filter(i=>i>=0).sort((a,b)=>a-b);
    if(!days.length) return { type:'invalid', raw:'weekly on '+daysStr };
    return { type:'weekly', interval, days };
  }

  // ---- stringify (canonical) --------------------------------
  function stringify(r){
    if(!r || r.type==='invalid') return '';
    switch(r.type){
      case 'daily':
        return r.interval===1 ? 'daily' : `every ${r.interval} days`;
      case 'weekly': {
        const dd = (r.days&&r.days.length) ? r.days.map(i=>WD[i]).join(',') : null;
        if(r.interval===1) return dd ? `weekly on ${dd}` : 'weekly on mon';
        return dd ? `every ${r.interval} weeks on ${dd}` : `every ${r.interval} weeks`;
      }
      case 'monthly-day': {
        const d = r.day || 1;
        return r.interval===1 ? `monthly on day ${d}` : `every ${r.interval} months on day ${d}`;
      }
      case 'monthly-weekday': {
        const o = ORD_NAME[r.ord], w = WD[r.weekday];
        return r.interval===1 ? `monthly on ${o} ${w}` : `every ${r.interval} months on ${o} ${w}`;
      }
    }
    return '';
  }

  // ---- human summary ----------------------------------------
  function summary(strOrObj){
    const r = typeof strOrObj==='string' ? parse(strOrObj) : strOrObj;
    if(!r) return '';
    if(r.type==='invalid') return 'invalid pattern';
    switch(r.type){
      case 'daily':
        return r.interval===1 ? 'Every day' : `Every ${r.interval} days`;
      case 'weekly': {
        const names = (r.days&&r.days.length) ? r.days.map(i=>WD_FULL[i]).join(', ') : '—';
        if(r.interval===1) return `Weekly on ${names}`;
        return r.days&&r.days.length ? `Every ${r.interval} weeks on ${names}` : `Every ${r.interval} weeks`;
      }
      case 'monthly-day': {
        const d = r.day;
        if(!d) return `Every ${r.interval} months`;
        const suf = ordSuffix(d);
        return r.interval===1 ? `Monthly on the ${d}${suf}` : `Every ${r.interval} months on the ${d}${suf}`;
      }
      case 'monthly-weekday': {
        const o = r.ord===-1 ? 'last' : (r.ord+ordSuffix(r.ord));
        const w = WD_FULL[r.weekday];
        return r.interval===1 ? `Monthly on the ${o} ${w}` : `Every ${r.interval} months on the ${o} ${w}`;
      }
    }
    return '';
  }
  function ordSuffix(n){ const s=['th','st','nd','rd'], v=n%100; return s[(v-20)%10]||s[v]||s[0]; }

  // compact one-line label for dense rows
  function compact(strOrObj){
    const r = typeof strOrObj==='string' ? parse(strOrObj) : strOrObj;
    if(!r || r.type==='invalid') return '';
    const A = ['Su','Mo','Tu','We','Th','Fr','Sa'];
    switch(r.type){
      case 'daily': return r.interval===1 ? 'daily' : `${r.interval}d`;
      case 'weekly': {
        const dd = (r.days&&r.days.length) ? r.days.map(i=>A[i]).join('·') : '—';
        return r.interval===1 ? dd : `${dd}/${r.interval}w`;
      }
      case 'monthly-day':
        if(!r.day) return `${r.interval}mo`;
        return r.interval===1 ? `day ${r.day}` : `day ${r.day}/${r.interval}mo`;
      case 'monthly-weekday': {
        const o = r.ord===-1?'last':r.ord+ordSuffix(r.ord);
        const w = A[r.weekday];
        return r.interval===1 ? `${o} ${w}` : `${o} ${w}/${r.interval}mo`;
      }
    }
    return '';
  }

  // ---- occurrence matching ----------------------------------
  function nthWeekdayOfMonth(year, month, weekday, ord){
    if(ord===-1){
      const last = new Date(year, month+1, 0);
      const back = (last.getDay()-weekday+7)%7;
      return new Date(year, month, last.getDate()-back);
    }
    const first = new Date(year, month, 1);
    const offset = (weekday-first.getDay()+7)%7;
    const day = 1+offset+(ord-1)*7;
    const dim = new Date(year, month+1, 0).getDate();
    if(day>dim) return null;
    return new Date(year, month, day);
  }

  function matches(date, r, anchor){
    date = startOfDay(date);
    anchor = anchor ? startOfDay(anchor) : date;
    if(date < anchor) return false;
    switch(r.type){
      case 'daily': {
        const n = r.interval||1;
        return daysBetween(anchor, date) % n === 0;
      }
      case 'weekly': {
        const n = r.interval||1;
        const days = (r.days&&r.days.length) ? r.days : [anchor.getDay()];
        if(!days.includes(date.getDay())) return false;
        // week phase: weeks since anchor's Sunday
        const aWeek = weekIndex(anchor), dWeek = weekIndex(date);
        return (dWeek-aWeek) % n === 0;
      }
      case 'monthly-day': {
        const n = r.interval||1;
        if(monthsBetween(anchor,date) % n !== 0) return false;
        const dim = new Date(date.getFullYear(), date.getMonth()+1, 0).getDate();
        const target = r.day ? Math.min(r.day, dim) : Math.min(anchor.getDate(), dim);
        return date.getDate()===target;
      }
      case 'monthly-weekday': {
        const n = r.interval||1;
        if(monthsBetween(anchor,date) % n !== 0) return false;
        const occ = nthWeekdayOfMonth(date.getFullYear(), date.getMonth(), r.weekday, r.ord);
        return occ && sameDay(occ, date);
      }
    }
    return false;
  }
  function weekIndex(d){ return Math.floor(daysBetween(new Date(1970,0,4), d)/7); } // 1970-01-04 = Sunday
  function monthsBetween(a,b){ return (b.getFullYear()-a.getFullYear())*12 + (b.getMonth()-a.getMonth()); }

  // ---- next N occurrences from a date (exclusive of `from` by default)
  function nextOccurrences(strOrObj, opts){
    opts = opts || {};
    const r = typeof strOrObj==='string' ? parse(strOrObj) : strOrObj;
    if(!r || r.type==='invalid') return [];
    const anchorD = opts.anchor ? (typeof opts.anchor==='string'?parseYMD(opts.anchor):opts.anchor) : new Date();
    const fromD = opts.from ? (typeof opts.from==='string'?parseYMD(opts.from):opts.from) : new Date();
    const count = opts.count || 3;
    const inclusive = !!opts.inclusive;
    const out = [];
    let cur = startOfDay(fromD);
    if(!inclusive) cur = addDays(cur, 1);
    let guard = 0, cap = 366*6;
    while(out.length < count && guard < cap){
      if(matches(cur, r, anchorD)) out.push(new Date(cur));
      cur = addDays(cur, 1); guard++;
    }
    return out;
  }

  // next single occurrence strictly after `from`
  function next(strOrObj, from, anchor){
    const r = nextOccurrences(strOrObj, { from, anchor: anchor||from, count:1 });
    return r[0] || null;
  }

  window.Rec = {
    parse, stringify, summary, compact, matches, nextOccurrences, next,
    ymd, parseYMD, addDays, startOfDay, daysBetween, ordSuffix,
    WD, WD_FULL, ORD_NAME
  };
})();
