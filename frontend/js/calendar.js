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
    return { year: now.getFullYear(), month: now.getMonth(), cursor: Rec.ymd(now), _fseq: 0 };
  },
  computed: {
    weekStart() { return (this.store.currentUser && this.store.currentUser.week_start) ?? 1; },
    // when a specific calendar is selected in the nav, show only its events
    calFilter() { return this.store.view.calendarId || null; },
    activeCalendar() { return this.calFilter ? this.store.calendarById(this.calFilter) : null; },
    // the active query (type:event by default); a real predicate beyond type: narrows the grid
    activeQuery() { return this.store.currentQuery(); },
    hasPredicate() { return Q.parse(this.activeQuery()).terms.some((t) => t.field !== 'type'); },
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
          events: this.store.events.filter((e) => e.date === ymd && (!this.calFilter || e.calendarId === this.calFilter) && (!this.store.calMatchIds || this.store.calMatchIds.has(e.id))),
          // a query predicate narrows the grid to events → hide the dated-task overlay
          tasks: this.store.calMatchIds ? [] : this.store.tasks.filter((t) => t.due === ymd),
        });
      }
      return out;
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
    // run the query through the unified engine and keep the set of matching event ids;
    // a query with only type: (no real predicate) clears the filter (show every event)
    async refilter() {
      if (!this.hasPredicate) { this.store.calMatchIds = null; return; }
      const seq = ++this._fseq;
      const items = await this.store.runQuery(this.activeQuery());
      if (seq !== this._fseq) return;
      this.store.calMatchIds = new Set((items || []).filter((i) => i.type === 'event').map((i) => i.id));
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
    // E: open the hour-by-hour day schedule (§4.2) for the focused day
    openDay() { this.store.dayDetailYmd = this.cursor; this.store.dayDetailOpen = true; },
    onCell(ymd) { this.cursor = ymd; this.newEvent(ymd); },
    newEvent(ymd) { this.store.editEvent({ startAt: ymd, allDay: true, title: '', calendarId: this.calFilter || null }); },
    openTask(t) { this.store.selectedTaskId = t.id; this.store.detailOpen = true; },
  },
  template: `
  <div class="calendar">
    <div class="cal-head">
      <span class="qbtn cal-nav" @click="moveMonth(-1)" title="previous month (H)">‹</span>
      <span class="cal-title">{{ monthLabel }}</span>
      <span class="qbtn cal-nav" @click="moveMonth(1)" title="next month (L)">›</span>
      <span class="qbtn" @click="today" title="jump to today">today</span>
      <span v-if="activeCalendar" class="cal-filter" :style="{ color: store.resolveColor(activeCalendar.color) }" title="filtered to this calendar">{{ activeCalendar.glyph }} {{ activeCalendar.name }} <span class="cal-filter-x" @click="store.openCalendar()" title="show all calendars">✕</span></span>
      <span class="mut cal-hint">hjkl move · H/L · J/K month · i new event</span>
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
