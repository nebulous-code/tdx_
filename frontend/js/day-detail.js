/* day-detail.js — the calendar day-schedule drawer (2E §4.2). A right-hand `.detail`-style
   drawer showing an hour-by-hour schedule for store.dayDetailYmd: all-day events pinned in a
   top strip, timed events laid out by time with overlaps in side-by-side columns (longest
   event leftmost). Selecting an event opens the event detail drawer to its RIGHT — a two-level
   right-hand stack (day → event). Keyboard: E opens it (from the grid); inside, j/k step the
   day by hour-slot/event, h/l move across overlap columns, e opens an event, i creates one at
   the focused hour, Esc closes. Driven from the app's onKey (see index.html calendar block).

   The keyboard / slot model is PROVISIONAL (per the doc) — kept in navCells() so it's easy to
   retune by feel. Honors the same calendar-selection + query filters as the month grid. */
const HOUR_PX = 40;            // vertical px per hour
const DEFAULT_DUR = 60;        // minutes assumed when an event has no end time

window.DayDetail = {
  props: ['store'],
  data() { return { cursor: { i: 0, col: 0 } }; },
  computed: {
    ymd() { return this.store.dayDetailYmd; },
    dateLabel() {
      const d = Rec.parseYMD(this.ymd);
      return d ? d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }) : '';
    },
    calFilter() { return this.store.view.calendarId || null; },   // the nav's selected calendar (used only when CREATING here)
    // ---- what this drawer shows (audit e.6) --------------------------------------------
    // EVERYTHING on this day — every event and every dated task — regardless of the current
    // query, type: rule or selected calendar. The GRID answers the query; the DAY DRAWER tells
    // the truth, because it's the surface you schedule against: when you're about to drop
    // something on a day you want to see what's already there, not a filtered subset of it.
    //
    // This is also the blank-drawer fix. It used to start with `if (!store.gridShowsEvents())
    // return []` (my e.5 change), which on a task-only view is ALWAYS false — so the drawer showed
    // zero events forever: 24 empty hour rows, i.e. the "blank spacer".
    dayOccs() { return this.store.events.filter((e) => e.date === this.ymd); },
    allDay() { return this.dayOccs.filter((e) => e.allDay || (e.startAt || '').length <= 10); },
    dayTasks() { return this.store.tasks.filter((t) => t.due === this.ymd && !t.archived); },
    // timed occurrences with parsed start/end minutes + duration
    timed() {
      return this.dayOccs.filter((e) => !e.allDay && (e.startAt || '').length > 10).map((e) => {
        const s = this.minutesOf(e.startAt);
        let en = e.endAt && e.endAt.length > 10 ? this.minutesOf(e.endAt) : s + DEFAULT_DUR;
        if (!(en > s)) en = s + DEFAULT_DUR;
        en = Math.min(en, 24 * 60);
        return { ev: e, s, e: en, dur: en - s };
      });
    },
    // column-packed blocks for the timed events: longest-leftmost, overlaps side-by-side.
    // Each block carries {ev, s, e, col, cols} → absolute top/height/left/width in the template.
    blocks() {
      const evs = this.timed.slice().sort((a, b) => a.s - b.s || b.dur - a.dur);
      const out = [];
      let cluster = [], clusterEnd = -1;
      const flush = () => {
        if (!cluster.length) return;
        const colEnds = [];                          // last end-minute per column
        for (const it of cluster) {
          let c = colEnds.findIndex((end) => end <= it.s);
          if (c === -1) { c = colEnds.length; colEnds.push(it.e); } else colEnds[c] = it.e;
          it.col = c;
        }
        const cols = colEnds.length;                 // = max concurrency in the cluster
        for (const it of cluster) out.push({ ...it, cols });
        cluster = []; clusterEnd = -1;
      };
      for (const it of evs) {
        if (cluster.length && it.s >= clusterEnd) flush();
        cluster.push(it); clusterEnd = Math.max(clusterEnd, it.e);
      }
      flush();
      return out;
    },
    // PROVISIONAL navigable cell list (the j/k stops), in time order:
    //  • an event-GROUP per clock-hour that has events starting in it (h/l across them, leftmost first)
    //  • an empty hour-slot for any hour NOT covered by a timed event
    // (the doc's leftover-gap / partial-overlap cases are accepted imperfections — retune here.)
    navCells() {
      const cells = [];
      if (this.allDay.length) cells.push({ type: 'allday', events: this.allDay });   // top strip is a stop (h/l across)
      if (this.dayTasks.length) cells.push({ type: 'task', events: this.dayTasks });  // dated tasks strip (h/l across)
      const byHour = {};                                   // hour → blocks starting in it
      for (const b of this.blocks) (byHour[Math.floor(b.s / 60)] ||= []).push(b);
      const covered = (h) => this.blocks.some((b) => b.s < (h + 1) * 60 && b.e > h * 60);
      for (let h = 0; h < 24; h++) {
        if (byHour[h]) {
          const evs = byHour[h].slice().sort((a, b) => a.s - b.s || a.col - b.col);
          cells.push({ type: 'event', hour: h, events: evs });
        } else if (!covered(h)) {
          cells.push({ type: 'slot', hour: h });
        }
      }
      return cells;
    },
    focusedCell() { return this.navCells[this.cursor.i] || null; },
    // the item under the column cursor for any multi-item cell (task / all-day / timed-event)
    focusedRow() {
      const c = this.focusedCell;
      if (!c || !c.events) return null;
      return c.events[Math.min(this.cursor.col, c.events.length - 1)] || null;
    },
    focusedEvent() {
      const c = this.focusedCell, item = this.focusedRow;
      if (!c || !item || c.type === 'task') return null;
      return c.type === 'allday' ? item : (item.ev || null);   // 'event' cells hold {ev,...} blocks
    },
    focusedTask() { return this.focusedCell && this.focusedCell.type === 'task' ? this.focusedRow : null; },
  },
  watch: {
    ymd() { this.cursor = { i: 0, col: 0 }; this.$nextTick(this.scrollToMorning); },
  },
  mounted() { this.$nextTick(this.scrollToMorning); },
  methods: {
    minutesOf(ts) { const hh = +ts.slice(11, 13), mm = +ts.slice(14, 16); return hh * 60 + mm; },
    scrollToMorning() { const g = this.$refs.grid; if (g) g.scrollTop = 8 * HOUR_PX; },   // default-scroll to ~8am
    evColor(e) { const c = e.calendarId && this.store.calendarById(e.calendarId); return c ? this.store.resolveColor(c.color) : 'var(--amber)'; },
    blockStyle(b) {
      const col = this.evColor(b.ev);
      return {
        top: (b.s / 60) * HOUR_PX + 'px',
        height: Math.max((b.dur / 60) * HOUR_PX - 2, 14) + 'px',
        left: `calc(${(b.col / b.cols) * 100}% + 2px)`,
        width: `calc(${(1 / b.cols) * 100}% - 4px)`,
        color: col, borderLeft: '2px solid ' + col,
      };
    },
    timeLabel(h) { return String(h).padStart(2, '0') + ':00'; },
    evTime(b) { const p = (m) => String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'); return p(b.s) + '–' + p(b.e); },
    // is the keyboard cursor on this slot-hour / block / task?
    slotFocused(h) { const c = this.focusedCell; return c && c.type === 'slot' && c.hour === h; },
    blockFocused(b) { const c = this.focusedCell; return !!(c && c.type === 'event' && this.focusedEvent && this.focusedEvent.id === b.ev.id); },
    taskFocused(t) { return !!(this.focusedTask && this.focusedTask.id === t.id); },
    // ---- keyboard (routed from the app onKey calendar block while store.dayDetailOpen) ----
    dayKey(e) {
      switch (e.key) {
        case 'j': case 'ArrowDown': e.preventDefault(); this.move(1); break;
        case 'k': case 'ArrowUp':   e.preventDefault(); this.move(-1); break;
        case 'l': case 'ArrowRight': e.preventDefault(); this.moveCol(1); break;
        case 'h': case 'ArrowLeft':  e.preventDefault(); this.moveCol(-1); break;
        case 'e': e.preventDefault(); this.openFocused(); break;
        case 'i': e.preventDefault(); this.createAtFocus(); break;
        case 'Escape': e.preventDefault(); this.store.dayDetailOpen = false; break;
      }
    },
    move(d) {
      const n = this.navCells.length; if (!n) return;
      this.cursor.i = Math.max(0, Math.min(n - 1, this.cursor.i + d));
      this.cursor.col = 0;                                  // arrive leftmost in a new group
      this.scrollFocusIntoView();
    },
    moveCol(d) {
      const c = this.focusedCell; if (!c || !c.events) return;   // across overlap columns / all-day items
      this.cursor.col = Math.max(0, Math.min(c.events.length - 1, this.cursor.col + d));
      this.scrollFocusIntoView();
    },
    scrollFocusIntoView() {
      this.$nextTick(() => { const el = this.$el && this.$el.querySelector('.kfocus'); if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' }); });
    },
    openFocused() {
      if (this.focusedCell && this.focusedCell.type === 'task') { if (this.focusedTask) this.openTask(this.focusedTask); return; }
      const ev = this.focusedEvent; if (ev) this.openEvent(ev);
    },
    openEvent(occ) { const { date, ...ev } = occ; this.store.editEvent({ ...ev }); },   // opens the event drawer to the right
    // open the task detail drawer to the right (the detailOpen watcher closes the event/note
    // drawers + takes the keyboard; the day drawer stays open underneath, like events)
    openTask(t) { this.store.selectedTaskId = t.id; this.store.detailOpen = true; },
    createAtFocus() { const c = this.focusedCell; this.createAt(c && typeof c.hour === 'number' ? c.hour : 8); },
    alldayFocused(e) { const c = this.focusedCell; return !!(c && c.type === 'allday' && this.focusedEvent && this.focusedEvent.id === e.id); },
    // `i` creates what the APP you're in is about — a task on Tasks, an event on Events — so the
    // drawer agrees with the grid behind it (e.5/e.6). A task has no time-of-day, so the hour is
    // only used for events; the task just lands on this day.
    createAt(hour) {
      if (this.store.currentApp() === 'tasks') {
        this.store.startDraftTask({ due: this.ymd });   // draft — only written once it has a name (e.6)
        return;
      }
      this.store.editEvent({
        startAt: this.ymd + 'T' + String(hour).padStart(2, '0') + ':00',
        allDay: false, title: '', calendarId: this.calFilter || null,
      });
    },
  },
  template: `
  <!-- the day agenda holds the OUTER edge (right:0) and never moves; when an item opens from it,
       the detail drawer slides in INBOARD of it (.main.day-open, styles.css) — audit e.6 -->
  <div class="detail day-detail">
    <div class="detail-head">
      <span class="mut">day</span>
      <span class="cy">{{ dateLabel }}</span>
      <span class="x" @click="store.dayDetailOpen=false" title="Close (esc)">✕</span>
    </div>

    <div v-if="allDay.length" class="day-allday">
      <div v-for="e in allDay" :key="e.id" class="day-ad-ev" :class="{ kfocus: alldayFocused(e) }" :style="{ color: evColor(e), borderLeft: '2px solid '+evColor(e) }" :title="e.title" @click="openEvent(e)">{{ e.title }}</div>
    </div>

    <div v-if="dayTasks.length" class="day-tasks">
      <div v-for="t in dayTasks" :key="t.id" class="day-task" :class="{ kfocus: taskFocused(t), done: t.done }" :title="t.title" @click="openTask(t)">
        <span class="day-task-cb" @click.stop="store.toggleDone(t)">{{ t.done ? '✓' : '☐' }}</span>{{ t.title }}
      </div>
    </div>

    <div class="day-grid" ref="grid">
      <div class="day-body" :style="{ height: (24*${HOUR_PX})+'px' }">
        <div v-for="h in 24" :key="h-1" class="day-hour" :class="{ kfocus: slotFocused(h-1) }"
             :style="{ top: ((h-1)*${HOUR_PX})+'px', height: ${HOUR_PX}+'px' }" @click="createAt(h-1)">
          <span class="day-hr-label mut">{{ timeLabel(h-1) }}</span>
        </div>
        <div class="day-lane">
          <div v-for="b in blocks" :key="b.ev.id" class="day-ev" :class="{ kfocus: blockFocused(b) }"
               :style="blockStyle(b)" :title="b.ev.title" @click.stop="openEvent(b.ev)">
            <div class="day-ev-t">{{ b.ev.title }}</div>
            <div class="day-ev-time mut">{{ evTime(b) }}</div>
          </div>
        </div>
      </div>
    </div>
  </div>`,
};
