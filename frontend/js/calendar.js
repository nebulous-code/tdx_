/* calendar.js — D2 month calendar screen (bolted into the current SPA; will be
   rebuilt as the /events module in the app-shell phase). Shows events (fetched
   per visible range from /api/events) and your dated tasks on a month grid.
   Mouse-driven for now; the event editor is a simple drawer. */

const WD_BASE = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

window.CalendarView = {
  props: ['store'],
  data() {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() };
  },
  computed: {
    weekStart() { return (this.store.currentUser && this.store.currentUser.week_start) ?? 1; },
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
          events: this.store.events.filter((e) => e.date === ymd),
          tasks: this.store.tasks.filter((t) => t.due === ymd),
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
  mounted() { this.load(); },
  methods: {
    load() { this.store.fetchEvents(this.range.from, this.range.to); },
    prev() { if (this.month === 0) { this.year--; this.month = 11; } else { this.month--; } this.load(); },
    next() { if (this.month === 11) { this.year++; this.month = 0; } else { this.month++; } this.load(); },
    today() { const n = new Date(); this.year = n.getFullYear(); this.month = n.getMonth(); this.load(); },
    timeOf(e) { return e.allDay ? '' : (e.startAt.length > 10 ? e.startAt.slice(11, 16) + ' ' : ''); },
    openEvent(occ) {
      // edit the SERIES (occ carries the event fields + the occurrence date)
      const { date, ...ev } = occ;
      this.store.editEvent({ ...ev });
    },
    newEvent(ymd) { this.store.editEvent({ startAt: ymd, allDay: true, title: '' }); },
    openTask(t) { this.store.selectedTaskId = t.id; this.store.detailOpen = true; },
  },
  template: `
  <div class="calendar">
    <div class="cal-head">
      <span class="qbtn cal-nav" @click="prev" title="previous month">‹</span>
      <span class="cal-title">{{ monthLabel }}</span>
      <span class="qbtn cal-nav" @click="next" title="next month">›</span>
      <span class="qbtn" @click="today" title="jump to today">today</span>
      <span class="mut" style="margin-left:auto;font-size:11px;">click a day to add an event</span>
    </div>
    <div class="cal-weekdays">
      <div v-for="w in weekdays" :key="w" class="cal-wd mut">{{ w }}</div>
    </div>
    <div class="cal-grid">
      <div v-for="c in cells" :key="c.ymd" class="cal-cell" :class="{ out: !c.inMonth, today: c.isToday }" @click="newEvent(c.ymd)">
        <div class="cal-daynum">{{ c.day }}</div>
        <div class="cal-items" @click.stop>
          <div v-for="e in c.events" :key="e.id+e.date" class="cal-ev" :title="e.title" @click="openEvent(e)">
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

window.EventDetail = {
  props: ['store'],
  data() { return { f: null, links: [], taskQuery: '' }; },
  computed: {
    open() { return this.store.eventDetailOpen; },
    // tasks matching the picker query, not already linked, capped for the menu
    candidates() {
      const q = this.taskQuery.trim().toLowerCase();
      if (!q) return [];
      const linked = new Set(this.links.map((l) => l.other.id));
      return this.store.tasks
        .filter((t) => !t.archived && !linked.has(t.id) && (t.title || '').toLowerCase().includes(q))
        .slice(0, 8);
    },
  },
  watch: {
    open(v) { if (v) this.sync(); },
  },
  methods: {
    sync() {
      const e = this.store.editingEvent || {};
      const start = e.startAt || Rec.ymd(new Date());
      this.f = {
        id: e.id || null,
        title: e.title || '',
        allDay: e.allDay ?? true,
        date: start.slice(0, 10),
        time: start.length > 10 ? start.slice(11, 16) : '09:00',
        endDate: e.endAt ? e.endAt.slice(0, 10) : '',
        location: e.location || '',
        recurrence: e.recurrence || '',
        notes: e.notes || '',
      };
      this.links = [];
      this.taskQuery = '';
      this.loadLinks();
    },
    async loadLinks() {
      if (!this.f || !this.f.id) { this.links = []; return; }
      this.links = await this.store.fetchLinks('event', this.f.id);
    },
    async linkTask(t) {
      if (await this.store.createLink({ type: 'event', id: this.f.id }, { type: 'task', id: t.id })) {
        this.taskQuery = '';
        await this.loadLinks();
      }
    },
    async unlink(id) {
      if (await this.store.deleteLink(id)) await this.loadLinks();
    },
    close() { this.store.eventDetailOpen = false; },
    async save() {
      if (!this.f.title.trim()) return;
      const startAt = this.f.allDay ? this.f.date : this.f.date + 'T' + (this.f.time || '00:00');
      const ok = await this.store.saveEvent({
        id: this.f.id,
        title: this.f.title.trim(),
        allDay: this.f.allDay,
        startAt,
        endAt: this.f.endDate ? this.f.endDate : null,
        location: this.f.location.trim() || null,
        recurrence: this.f.recurrence.trim() || null,
        notes: this.f.notes,
      });
      if (ok) this.close();
    },
    async del() {
      if (!this.f.id) return this.close();
      if (await this.store.deleteEvent(this.f.id)) this.close();
    },
  },
  template: `
  <div class="ev-overlay" v-if="open && f" @click.self="close">
    <div class="ev-card" @keydown.esc="close">
      <div class="ev-head">
        <span class="hi">{{ f.id ? 'edit event' : 'new event' }}</span>
        <span class="grow"></span>
        <span class="qbtn" @click="close">esc</span>
      </div>
      <div class="ev-body">
        <input v-model="f.title" placeholder="event title" class="ti" @keydown.enter="save">
        <label class="ev-lbl">
          <span class="checkbox" :class="{ on: f.allDay }" @click="f.allDay = !f.allDay">{{ f.allDay ? '✓' : '' }}</span>
          all-day
        </label>
        <div class="ev-row">
          <input type="date" v-model="f.date" class="ti">
          <input v-if="!f.allDay" type="time" v-model="f.time" class="ti">
        </div>
        <label class="ev-lbl">ends <input type="date" v-model="f.endDate" class="ti"></label>
        <input v-model="f.location" placeholder="location" class="ti">
        <input v-model="f.recurrence" placeholder="recurrence (e.g. weekly on mon,wed,fri)" class="ti">
        <textarea v-model="f.notes" placeholder="notes" class="ti" rows="3"></textarea>
        <div v-if="f.id" class="ev-links">
          <div class="ev-links-h mut">linked tasks</div>
          <div v-for="l in links" :key="l.id" class="ev-link">
            <span class="ev-link-title" :title="l.other.title">{{ l.other.title }}</span>
            <span class="qbtn ev-unlink" @click="unlink(l.id)" title="unlink">✕</span>
          </div>
          <div class="ev-link-add">
            <input v-model="taskQuery" placeholder="link a task…" class="ti">
            <div v-if="candidates.length" class="ev-link-menu">
              <div v-for="t in candidates" :key="t.id" class="ev-link-opt" @click="linkTask(t)" :title="t.title">{{ t.title }}</div>
            </div>
          </div>
        </div>
        <div class="ev-actions">
          <button class="btn" @click="close">cancel</button>
          <button v-if="f.id" class="btn danger" @click="del">delete</button>
          <button class="btn primary" @click="save">{{ f.id ? 'save ↵' : 'create ↵' }}</button>
        </div>
      </div>
    </div>
  </div>`,
};
