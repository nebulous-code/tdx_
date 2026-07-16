/* ============================================================
   create.js  —  the CREATION LANGUAGE engine.  window.CL
   ------------------------------------------------------------
   The sibling of query.js: ONE grammar, parsed once, applied to
   every entity type.  A symbol means one IDEA everywhere —

     #label    a tag
     !N        priority          (0-5)
     $date     THE DATE          (human: friday · tomorrow · 6/7/2026)
     /category WHERE IT LIVES
     {…}       the body

   …and each type maps that abstract idea onto its own column —
   exactly as the query engine already does (`due:` is a task's due
   date AND a note's review date; `category:` unifies project /
   calendar / folder).  See docs/CREATION_LANGUAGE.md.

     CL.parse(text, {type, today, known}) -> {title, fields, literal}
     CL.apply(type, parsed, ctx)          -> a payload for that type
     CL.fragment(text, type)              -> the trailing token, for ghost-completion
     CL.date(text, today)                 -> {ymd, consumed} | null

   parse() is PURE: no DOM, no store, no clock read at load time.
   Every side effect (creating a label) lives in apply().  This is
   not style — ghost-completion re-parses on every keystroke, and
   store.addLabel() CREATES the label it looks up.
   ============================================================ */
(function () {
  const WD = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  const WD_FULL = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const MONTH_MAX = 12;

  // ---- the two tables -------------------------------------------------------
  // Which sigils a type even HAS. A sigil a type doesn't accept is not a dead
  // symbol — it is NOT A SYMBOL there, and stays literal title text ("Ship v2 !!!"
  // keeps its bangs on a note). This is why parse() needs the type.
  const ACCEPTS = {
    task: ['#', '!', '$', '/', '{'],
    note: ['#', '$', '/', '{'],          // a note has no priority field
    event: ['#', '$', '/', '{'],         // %recurrence · *reminder come later
  };
  // The abstract field -> that type's column. The ONLY place a type is named.
  const MAP = {
    task: { labels: 'labels', priority: 'priority', date: 'due', category: 'projectId', body: 'notes' },
    note: { labels: 'labels', date: 'reviewAt', category: 'folderId', body: 'body' },
    event: { labels: 'labels', date: 'startAt', category: 'calendarId', body: 'notes' },
  };
  // what a `/` resolves against, per type (the cross-app categorizer — query.js's `category:`)
  const CATEGORY_OF = { task: 'project', note: 'folder', event: 'calendar' };

  const pad = (n) => String(n).padStart(2, '0');
  const ymd = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  // The SAME name match the query engine uses for categorizers (query.js catNameMatch:
  // exact slug, or substring) — so `/tdx` finds `tdx-app` exactly the way `project:tdx`
  // does. Typing a categorizer and querying one must never disagree about what a name is.
  function nameMatch(name, value) {
    const have = slug(name), want = slug(value);
    return have === want || (want.length > 0 && have.includes(want));
  }

  // ---- $ : the human date ---------------------------------------------------
  // Nothing else in the repo does this: Rec.parseYMD is a strict split('-'), and the
  // query engine's `tomorrow`/`friday` are PREDICATES (task -> boolean), never producers.
  //
  // Returns { ymd, consumed } — consumed = how many WORDS were eaten (1, or 2 for
  // "next friday"). null means "not a date", and the caller leaves the text alone:
  // that's the `$5` guard ("pay Bob $5" keeps its five dollars).
  function date(text, today) {
    const base = startOfDay(today || new Date());
    const words = String(text || '').trim().split(/\s+/);
    if (!words[0]) return null;
    const one = words[0].toLowerCase();

    // "next friday" — the ONE multi-word form. A bounded lookahead on a literal
    // keyword, deliberately: no greedy consume-and-stop anywhere in this grammar yet.
    if (one === 'next' && words[1]) {
      const wd = weekday(words[1]);
      if (wd !== -1) return { ymd: ymd(nextWeekday(base, wd, true)), consumed: 2 };
      return null;
    }
    const d = word(one, base);
    return d ? { ymd: ymd(d), consumed: 1 } : null;
  }

  function weekday(w) {
    const s = String(w || '').toLowerCase();
    let i = WD.indexOf(s);
    if (i === -1) i = WD_FULL.indexOf(s);
    return i;
  }
  // the NEXT such weekday. `skipWeek` ("next friday") always lands a week further out
  // than the plain form, so "friday" and "next friday" can't mean the same day.
  function nextWeekday(base, wd, skipWeek) {
    let delta = (wd - base.getDay() + 7) % 7;
    if (delta === 0) delta = 7;                 // "friday" ON a friday means the NEXT one
    if (skipWeek) delta += 7;
    return addDays(base, delta);
  }

  function word(s, base) {
    if (s === 'today' || s === 'tod') return base;
    if (s === 'tomorrow' || s === 'tmw' || s === 'tom') return addDays(base, 1);
    const wd = weekday(s);
    if (wd !== -1) return nextWeekday(base, wd, false);

    // ISO always wins — it's never ambiguous, and it's the form to document.
    let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
    if (m) return valid(+m[1], +m[2], +m[3]);

    // numeric, any separator: M/D · M/D/YY · M/D/YYYY (also - and .)
    m = /^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2}|\d{4}))?$/.exec(s);
    if (m) {
      const a = +m[1], b = +m[2];
      let y = m[3] === undefined ? null : +m[3];
      if (y !== null && y < 100) y += 2000;
      // AMERICAN FIRST, unambiguous fallback: month-first when both readings are
      // possible; the only possible one when just one is. 6/7 -> June 7. 13/7 can
      // only be July 13 (there is no 13th month).
      let mo, day;
      if (a <= MONTH_MAX) { mo = a; day = b; }
      else if (b <= MONTH_MAX) { mo = b; day = a; }
      else return null;
      if (y !== null) return valid(y, mo, day);
      // no year: the next time that month/day comes around (this year, else next)
      const thisYear = valid(base.getFullYear(), mo, day);
      if (!thisYear) return null;
      return thisYear >= base ? thisYear : valid(base.getFullYear() + 1, mo, day);
    }
    return null;
  }
  // a real calendar date, not a rollover (Feb 31 is NOT March 3)
  function valid(y, mo, day) {
    if (mo < 1 || mo > 12 || day < 1 || day > 31) return null;
    const d = new Date(y, mo - 1, day);
    return d.getFullYear() === y && d.getMonth() === mo - 1 && d.getDate() === day ? d : null;
  }

  // ---- parse ----------------------------------------------------------------
  // Word-by-word, so a token's span is exact and everything it doesn't claim stays
  // in the title verbatim. `known(kind, name)` gates `/` (see below); omit it and
  // every `/token` is taken.
  function parse(text, opts) {
    const o = opts || {};
    const type = o.type || 'task';
    const accepts = ACCEPTS[type] || ACCEPTS.task;
    const today = o.today || new Date();
    const known = o.known || (() => true);
    const src = String(text || '');

    const fields = {};
    const literal = [];          // the spans we deliberately did NOT claim
    const titleWords = [];

    // {…} first: it's the one value that may contain spaces, and braces delimit it
    // explicitly (that's WHY braces — no guessing where it ends). An unterminated
    // `{` is literal.
    let rest = src;
    if (accepts.includes('{')) {
      const m = /\{([^}]*)\}/.exec(rest);
      if (m) {
        fields.body = m[1].trim();
        rest = rest.slice(0, m.index) + ' ' + rest.slice(m.index + m[0].length);
      }
    }

    const words = rest.split(/\s+/).filter(Boolean);
    for (let i = 0; i < words.length; i++) {
      const w = words[i];
      const sig = w[0];

      if (sig === '#' && accepts.includes('#') && w.length > 1) {
        (fields.labels || (fields.labels = [])).push(w.slice(1));   // NAMES, not ids — apply() resolves
        continue;
      }
      // FIRST WINS for every single-valued field: a second `!N`/`$date`/`/cat` is
      // literal, not an overwrite. (Labels are the only repeatable field.) This is
      // parseQuickAdd's behavior — its `!` replace was non-global — and it's the only
      // rule that stays predictable when you're editing a half-typed line.
      if (sig === '!' && accepts.includes('!') && fields.priority === undefined) {
        // a single digit 0-5 not followed by another: `!10` and `Ship it !!!` stay text
        const m = /^!([0-5])$/.exec(w);
        if (m) { fields.priority = +m[1]; continue; }
        literal.push(w); titleWords.push(w); continue;
      }
      if (sig === '$' && accepts.includes('$') && fields.date === undefined) {
        // opens a date ONLY if what follows parses as one — otherwise "pay Bob $5"
        // keeps its five dollars. Same shape as the !N guard.
        const tail = [w.slice(1), ...words.slice(i + 1)].join(' ');
        const hit = date(tail, today);
        if (hit) {
          fields.date = hit.ymd;
          i += hit.consumed - 1;          // "next friday" ate one extra word
          continue;
        }
        literal.push(w); titleWords.push(w); continue;
      }
      if (sig === '/' && accepts.includes('/') && w.length > 1 && fields.category === undefined) {
        // A label auto-creates, so `#anything` is always a token. A CATEGORY cannot —
        // projects carry color/glyph/position, folders are real directories on disk.
        // So `/xyz` is a token only if such a thing EXISTS; otherwise it stays visible
        // in the title rather than being silently eaten.
        const name = w.slice(1);
        if (known(CATEGORY_OF[type], name)) { fields.category = name; continue; }
        literal.push(w); titleWords.push(w); continue;
      }
      titleWords.push(w);
    }

    // A parse that ate EVERYTHING (`#tag` on its own) falls back to the raw text — an
    // untitled item is worse than a literal one. This is parseQuickAdd's `title||text`.
    const title = titleWords.join(' ').trim() || src.trim();
    return { title, fields, literal };
  }

  // ---- apply ----------------------------------------------------------------
  // The ONLY type-aware step, and the ONLY place with side effects (a new #label is
  // created here, never during a parse).
  //
  // ctx: { addLabel(name) -> {id}, findCategory(kind, name) -> {id}|null, defaults }
  // defaults = the view's implied fields (store.defaultsFor(type)).
  //
  // PRECEDENCE: what you TYPED beats what the view IMPLIED. `$today` in a due:friday
  // view means today; the view fills only what you left blank. Labels UNION (a view's
  // label plus the ones you typed) — that's the existing task behavior.
  function apply(type, parsed, ctx) {
    const map = MAP[type] || MAP.task;
    const c = ctx || {};
    const def = c.defaults || {};
    const f = parsed.fields || {};
    const out = {};

    // title (never empty: a parse that ate everything falls back to the raw text)
    out.title = parsed.title;

    // labels: view ∪ typed, deduped by id
    const ids = [...(def.labels || [])];
    for (const name of f.labels || []) {
      const lab = c.addLabel ? c.addLabel(name) : null;
      if (lab && !ids.includes(lab.id)) ids.push(lab.id);
    }
    if (ids.length || map.labels) out[map.labels] = ids;

    // date / category / body / priority — typed wins, else the view's default
    const dateKey = map.date;
    if (f.date !== undefined) out[dateKey] = f.date;
    else if (def.date !== undefined) out[dateKey] = def.date;

    const catKey = map.category;
    if (f.category !== undefined) {
      const hit = c.findCategory ? c.findCategory(CATEGORY_OF[type], f.category) : null;
      if (hit) out[catKey] = hit.id;
    } else if (def.category !== undefined) out[catKey] = def.category;

    if (f.body !== undefined) out[map.body] = f.body;
    if (map.priority && f.priority !== undefined) out[map.priority] = f.priority;

    // non-field view defaults that have no symbol (task: created-done in a status:done view)
    if (def.done !== undefined) out.done = def.done;
    return out;
  }

  // ---- ghost-completion -----------------------------------------------------
  // The trailing token being typed, for the quick-add's inline completion. Returns
  // null when the caret isn't in one. `#`/`/` end at whitespace; `$` is the only
  // sigil whose value can hold a space, and only after the literal "next".
  function fragment(text, type) {
    const accepts = ACCEPTS[type] || ACCEPTS.task;
    const m = /(^|\s)([#/$!])([^\s]*)$/.exec(String(text || ''));
    if (!m) return null;
    const sigil = m[2];
    if (!accepts.includes(sigil)) return null;
    return { sigil, fragment: m[3] };
  }

  window.CL = { parse, apply, date, fragment, slug, nameMatch, ACCEPTS, MAP, CATEGORY_OF, WD, WD_FULL };
})();
