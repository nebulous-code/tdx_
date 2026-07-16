/* calendar.js — D2 2d events module: the month calendar grid. Shows events (fetched
   per visible range from /api/events, recurrence expanded) and your dated tasks. The
   editor drawer lives in event-editor.js (it's global). Keyboard: a focused-day cursor
   — h/l = ∓1 day, j/k = ∓1 week (both flow across the month edge), H/L = ∓1 month,
   i = new event on the cursor day. Enter is reserved for saving, so it never creates. */

const WD_BASE = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

window.CalendarView = {
  props: ['store'],
  data() {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth(), cursor: Rec.ymd(now), _fseq: 0,
      draft: '' };   // the quick-add bar's text (e.9)
  },
  computed: {
    weekStart() { return (this.store.currentUser && this.store.currentUser.week_start) ?? 1; },
    // ---- the quick-add bar (e.9) -------------------------------------------------------
    // It creates what the APP is about — a task on Tasks, an event on Events — NOT what the
    // surface shows. Same discriminator `i` has always used (e.5/e.6), so a task view flipped
    // to calendar display keeps making tasks, and `!2` is a priority there again.
    clType() { return this.store.currentApp() === 'tasks' ? 'task' : 'event'; },
    addPlaceholder() {
      const day = this.cursor;
      return this.clType === 'task'
        ? 'add task on ' + day + '…  (try: Call plumber /home #errand !2)'
        : 'add event on ' + day + "…  (try: Mom's Birthday /Birthdays #fun)";
    },
    tagGhost() { return this.store.clGhost(this.draft, this.clType); },
    // ⚠ when the view filters on something a new item won't have — it's still created, just
    // hidden from this grid. store.viewWarn() can't be reused: it's task-shaped (type:→'task').
    warn() {
      // a new item satisfies: type: · calendar:/folder:/category: (it's filed where you are) ·
      // label: (inherited) · due: (it lands on the cursor day) · has:. Not: free text, flags.
      const ok = new Set(['type', 'calendar', 'category', 'project', 'label', 'due', 'status', 'has']);
      return Q.parse(this.activeQuery).terms.some((t) => !ok.has(t.field));
    },
    warnTip() {
      return this.warn ? 'This view filters on things a new item won’t have — it’ll be created, just hidden from this grid.' : '';
    },
    // when a specific calendar is selected in the nav, show only its events
    calFilter() { return this.store.view.calendarId || null; },
    activeCalendar() { return this.calFilter ? this.store.calendarById(this.calFilter) : null; },
    // the active query (type:event by default); a real predicate beyond type: narrows the grid
    activeQuery() { return this.store.currentQuery(); },
    hasPredicate() { return Q.parse(this.activeQuery).terms.some((t) => t.field !== 'type'); },
    weekdays() {
      const ws = this.weekStart;
      return Array.from({ length: 7 }, (_, i) => WD_BASE[(ws + i) % 7]);
    },
    monthLabel() {
      return new Date(this.year, this.month, 1)
        .toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    },
    // 6-week grid (42 cells) starting on the user's week-start
    cells() {
      const first = new Date(this.year, this.month, 1);
      const back = (first.getDay() - this.weekStart + 7) % 7;
      const start = Rec.addDays(first, -back);
      const today = Rec.ymd(new Date());
      const out = [];
      for (let i = 0; i < 42; i++) {
        const d = Rec.addDays(start, i);
        const ymd = Rec.ymd(d);
        out.push({
          ymd,
          day: d.getDate(),
          inMonth: d.getMonth() === this.month,
          isToday: ymd === today,
          isCursor: ymd === this.cursor,
          // Each overlay is gated by the query's type: rule (e.5), then filtered by the query.
          // store.calShows = series-level match AND this occurrence's own date (e.1) — an id-only
          // filter can't narrow a recurring series to the dates that actually matched.
          events: this.store.gridShowsEvents()
            ? this.store.events.filter((e) => e.date === ymd && (!this.calFilter || e.calendarId === this.calFilter) && this.store.calShows(e))
            : [],
          tasks: this.store.tasks.filter((t) => t.due === ymd && this.store.taskShows(t)),
        });
      }
      return out;
    },
    // What the CURRENT view puts on the focused day — the same filtered sets the grid paints, so
    // it honors the query, the type: rule and the selected calendar. E opens the FIRST of these
    // (e.7), and "first" is the agenda's own reading order, so the two surfaces never disagree:
    // all-day events → dated tasks → timed events by start. Untimed things (all-day, tasks) have
    // no clock to sort by, so they fall back to title, alphabetical.
    cursorItems() {
      const c = this.cells.find((x) => x.ymd === this.cursor);
      if (!c) return [];
      const isAllDay = (e) => e.allDay || (e.startAt || '').length <= 10;
      const byTitle = (a, b) => (a.item.title || '').localeCompare(b.item.title || '');
      const alldayEvents = c.events.filter(isAllDay).map((e) => ({ type: 'event', item: e })).sort(byTitle);
      const tasks = c.tasks.map((t) => ({ type: 'task', item: t })).sort(byTitle);
      const timed = c.events.filter((e) => !isAllDay(e)).map((e) => ({ type: 'event', item: e }))
        .sort((a, b) => (a.item.startAt || '').localeCompare(b.item.startAt || '') || byTitle(a, b));
      return [...alldayEvents, ...tasks, ...timed];
    },
    // depends only on the month (NOT on cells/events) so loading doesn't loop
    range() {
      const first = new Date(this.year, this.month, 1);
      const back = (first.getDay() - this.weekStart + 7) % 7;
      const start = Rec.addDays(first, -back);
      return { from: Rec.ymd(start), to: Rec.ymd(Rec.addDays(start, 41)) };
    },
  },
  watch: {
    activeQuery() { this.refilter(); },
  },
  mounted() { this.load(); this.refilter(); },
  methods: {
    // Run the query through the unified engine and keep the matching EVENT ids (a query with only
    // type: and no real predicate clears the filter). Events only: tasks are filtered synchronously
    // by store.taskShows (the client engine) — they don't need the server, and an async id-set left
    // the grid unfiltered until the fetch landed.
    //
    // NOTE `this.activeQuery` is a COMPUTED — a string, not a function. Calling it (`activeQuery()`)
    // threw, so this whole method died before it set calMatchIds or jumped. It failed silently:
    // the date filtering still worked (store.calShows does that pass independently), which is
    // exactly why only the month-jump looked broken.
    async refilter() {
      if (!this.hasPredicate) { this.store.calMatchIds = null; return; }
      const seq = ++this._fseq;
      const items = await this.store.runQuery(this.activeQuery);
      if (seq !== this._fseq) return;
      const evs = (items || []).filter((i) => i.type === 'event');
      this.store.calMatchIds = new Set(evs.map((i) => i.id));
      this.jumpToMatches(evs);
    },
    // A DATE query picks the window: move the grid to the first thing it matched. (Other
    // predicates — label:, calendar: — just filter; they shouldn't yank you to another month.)
    //
    // Two things this has to get right:
    //  · Compare against the DISPLAYED MONTH, not the 42-day grid window. July's sheet runs to
    //    Aug 9, so "next month" had a match "in view" and never jumped — you were looking at
    //    August's first days on the July sheet, which only ever looked right by coincidence.
    //  · Consider TASKS too, not just events. The grid draws dated tasks now (e.5), so a
    //    task-only query (`type:task due:>90d`) has no events to jump to and would sit still.
    //
    // (`date` on an event result is the matching OCCURRENCE, not the series start — a recurring
    // event's startAt can be months earlier, so startAt would jump to the wrong place.)
    jumpToMatches(evs) {
      if (!this.store.isDateRangeQuery(this.activeQuery)) return;
      const dates = [];
      for (const e of evs) { const d = e.date || (e.startAt || '').slice(0, 10); if (d) dates.push(d); }
      if (this.store.gridShowsTasks()) {
        for (const t of this.store.tasks) if (t.due && this.store.taskShows(t)) dates.push(t.due);
      }
      if (!dates.length) return;
      dates.sort();
      const d = Rec.parseYMD(dates[0]);
      if (d.getFullYear() === this.year && d.getMonth() === this.month) return;   // already showing it
      this.year = d.getFullYear();
      this.month = d.getMonth();
      this.cursor = dates[0];
      this.load();
    },
    // start (top-left cell) of the 6-week grid for a given month
    gridStart(y, m) {
      const first = new Date(y, m, 1);
      const back = (first.getDay() - this.weekStart + 7) % 7;
      return Rec.addDays(first, -back);
    },
    load() { this.store.fetchEvents(this.range.from, this.range.to); },
    // move the displayed month to wherever the cursor landed (h/l/j/k can cross the edge)
    syncMonth() {
      const d = Rec.parseYMD(this.cursor);
      if (d.getMonth() !== this.month || d.getFullYear() !== this.year) {
        this.year = d.getFullYear();
        this.month = d.getMonth();
        this.load();
      }
    },
    moveCursor(days) {
      this.cursor = Rec.ymd(Rec.addDays(Rec.parseYMD(this.cursor), days));
      this.syncMonth();
    },
    // whole-month jump keeping the DAY-OF-MONTH (H/L and the ‹ › buttons) — "every 13th"
    moveMonth(delta) {
      const day = Rec.parseYMD(this.cursor).getDate();
      let m = this.month + delta;
      let y = this.year;
      if (m < 0) { m = 11; y--; } else if (m > 11) { m = 0; y++; }
      const last = new Date(y, m + 1, 0).getDate();
      this.year = y;
      this.month = m;
      this.cursor = Rec.ymd(new Date(y, m, Math.min(day, last)));
      this.load();
    },
    // whole-month jump keeping the GRID CELL (J/K) — same column+row, i.e. "every Monday"
    moveMonthKeepCell(delta) {
      const idx = Rec.daysBetween(this.gridStart(this.year, this.month), Rec.parseYMD(this.cursor));
      let m = this.month + delta;
      let y = this.year;
      if (m < 0) { m = 11; y--; } else if (m > 11) { m = 0; y++; }
      this.year = y;
      this.month = m;
      this.cursor = Rec.ymd(Rec.addDays(this.gridStart(y, m), idx));
      this.load();
    },
    today() {
      const n = new Date();
      this.year = n.getFullYear();
      this.month = n.getMonth();
      this.cursor = Rec.ymd(n);
      this.load();
    },
    timeOf(e) { return e.allDay ? '' : (e.startAt.length > 10 ? e.startAt.slice(11, 16) + ' ' : ''); },
    // an event is tinted by its calendar's color (falls back to the theme accent)
    evColor(e) { const c = e.calendarId && this.store.calendarById(e.calendarId); return c ? this.store.resolveColor(c.color) : 'var(--amber)'; },
    evStyle(e) { const col = this.evColor(e); return { color: col, borderLeft: '2px solid ' + col }; },
    openEvent(occ) {
      // edit the SERIES (occ carries the event fields + the occurrence date)
      const { date, ...ev } = occ;
      this.store.editEvent({ ...ev });
    },
    // e: open the hour-by-hour day schedule (§4.2) for the focused day
    openDay() { this.store.dayDetailYmd = this.cursor; this.store.dayDetailOpen = true; },
    // E: the agenda AND the day's FIRST item in the view you're looking at, opened beside it
    // (e.7). "In the view you're looking at" is the filtered grid — on a birthdays calendar the
    // 4th's items are its birthdays, even if the day is otherwise packed — while the agenda still
    // shows the whole day (e.6: it's context, not a query result). Only an EMPTY day falls back
    // to the agenda alone: a rule that opened a detail on one-item days and not on two-item days
    // is unpredictable from the keyboard, which is the whole complaint it's fixing.
    openDayItem() {
      this.openDay();                       // agenda first, so the detail stacks to its right
      const it = this.cursorItems[0];
      if (!it) return;
      if (it.type === 'event') this.openEvent(it.item); else this.openTask(it.item);
    },
    onCell(ymd) { this.cursor = ymd; this.newEvent(ymd); },
    newEvent(ymd) { this.store.editEvent({ startAt: ymd, allDay: true, title: '', calendarId: this.calFilter || null }); },
    openTask(t) { this.store.selectedTaskId = t.id; this.store.detailOpen = true; },
    // ---- the quick-add bar (e.9) — the creation language's last caller ------------------
    focusAdd() { const el = this.$refs.qa; if (el) el.focus(); },
    // Esc must be bound on the input: the app's global onKey bails at its typing gate, so the
    // key never reaches the calendar's map. Hands the keyboard back to the grid.
    escAdd() { this.draft = ''; const el = this.$refs.qa; if (el) el.blur(); },
    // Tab / → accept the grey completion (#label · /calendar · $date). → only at the very end
    // of the line, so it doesn't hijack cursor movement.
    acceptTag(e) {
      if (!this.tagGhost) return;
      if (e.key === 'ArrowRight') { const el = this.$refs.qa; if (el && el.selectionStart !== el.value.length) return; }
      e.preventDefault();
      this.draft += this.tagGhost;
    },
    async commitAdd() {
      const text = this.draft.trim();
      if (!text) return;
      const type = this.clType;
      const parsed = CL.parse(text, { type, known: this.store.clKnown });
      const payload = CL.apply(type, parsed, this.store.clCtx(type));
      // DATE PRECEDENCE: what you TYPED beats the grid CURSOR, which beats the view's default.
      // CL.apply already filled the date from the view's query; the cursor is a stronger signal
      // (you moved there on purpose), so it overrides that — but never overrides a typed $date.
      const typedDate = parsed.fields.date !== undefined;
      if (type === 'task') {
        if (!typedDate) payload.due = this.cursor;
        this.store.addTask(payload);
        this.store.toast('+ task added');
      } else {
        if (!typedDate) payload.startAt = this.cursor;
        // CL.apply doesn't produce allDay, and saveEvent sends allDay:!!ev.allDay — without this
        // the row would claim to be TIMED while holding a date with no time. The drawer (I) is
        // where a timed event gets made; the bar has no time token yet.
        payload.allDay = true;
        // no /calendar typed → the calendar you're FILTERED to, else the first one — matching the
        // drawer's default (event-editor.js). On the "Everything" view calFilter is null, so
        // without the calendars[0] fallback a bar event there would be HOMELESS (calendar_id null):
        // it'd render but vanish the moment you filtered to any calendar. A typed /calendar wins
        // (it's already set, so this guard is skipped).
        if (payload.calendarId === undefined) {
          payload.calendarId = this.calFilter || (this.store.calendars[0] ? this.store.calendars[0].id : null);
        }
        if (!(await this.store.saveEvent(payload))) return;   // failed → keep the text, don't strand them
        this.store.toast('+ event added');
      }
      this.draft = '';
    },
  },
  template: `
  <div class="calendar">
    <!-- the quick-add bar (e.9) — the same slot tasks and notes use: below the query bar, above
         the month header. It creates what the APP is about (a task on Tasks, an event on Events),
         which is why it lives in this component: the tasks-as-calendar grid gets it too. -->
    <div class="quickadd">
      <span class="prompt" :class="{ warn }" :data-tip="warnTip">{{ warn ? '⚠' : '+' }}</span>
      <span class="qa-caret">❯</span>
      <span class="qa-input-wrap">
        <input ref="qa" v-model="draft" :placeholder="addPlaceholder"
               @keydown.enter.prevent="commitAdd" @keydown.esc.stop.prevent="escAdd"
               @keydown.tab="acceptTag" @keydown.right="acceptTag" />
        <span v-if="tagGhost" class="qa-ghost" aria-hidden="true"><span class="qa-ghost-pre">{{ draft }}</span>{{ tagGhost }}<span class="qa-ghost-hint"> →</span></span>
      </span>
      <span class="mut" style="font-size:11px;">↵ add</span>
    </div>

    <div class="cal-head">
      <span class="qbtn cal-nav" @click="moveMonth(-1)" title="previous month (H)">‹</span>
      <span class="cal-title">{{ monthLabel }}</span>
      <span class="qbtn cal-nav" @click="moveMonth(1)" title="next month (L)">›</span>
      <!-- label wrapped in ONE span: .btn is inline-flex with a gap, so a bare <u> beside loose
           text renders as "t oday" (the n.8 trap) -->
      <button class="btn cal-today" @click="today" title="jump to today (t)"><span><u>t</u>oday</span></button>
      <span v-if="activeCalendar" class="cal-filter" :style="{ color: store.resolveColor(activeCalendar.color) }" title="filtered to this calendar">{{ activeCalendar.glyph }} {{ activeCalendar.name }} <span class="cal-filter-x" @click="store.openCalendar()" title="show all calendars">✕</span></span>
      <span class="grow"></span>
      <span class="qbtn" @click="store.toggleDisplay()" title="show this query as a list (v)">☰ list <span class="mut">v</span></span>
      <span class="mut cal-hint">hjkl move · H/L · J/K month · i quick-add · I full editor</span>
    </div>
    <div class="cal-weekdays">
      <div v-for="w in weekdays" :key="w" class="cal-wd mut">{{ w }}</div>
    </div>
    <div class="cal-grid">
      <div v-for="c in cells" :key="c.ymd" class="cal-cell" :class="{ out: !c.inMonth, today: c.isToday, cursor: c.isCursor }" @click="onCell(c.ymd)">
        <div class="cal-daynum">{{ c.day }}</div>
        <div class="cal-items" @click.stop>
          <div v-for="e in c.events" :key="e.id+e.date" class="cal-ev" :style="evStyle(e)" :title="e.title" @click="openEvent(e)">
            <span class="cal-evtime mut" v-if="timeOf(e)">{{ timeOf(e) }}</span>{{ e.title }}
          </div>
          <div v-for="t in c.tasks" :key="t.id" class="cal-task" :class="{ done: t.done }" :title="t.title" @click="openTask(t)">
            <span class="cal-tk">✓</span> {{ t.title }}
          </div>
        </div>
      </div>
    </div>
  </div>`,
};
