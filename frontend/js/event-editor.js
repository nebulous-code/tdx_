/* event-editor.js — the event create/edit drawer (D2 2d; right-hand drawer since 2E §4).
   GLOBAL: opens from the calendar (create on a day + edit a series), from a task's "linked
   events", and from mixed/search results. Renders in the shared right-hand `.detail` drawer
   (same surface as task + note detail), NOT a centered modal. Keyboard-navigable via the
   shared KbForm mixin (j/k move fields · i edits · space toggles all-day · Enter saves · Esc
   closes with a discard-changes guard). Mounted with v-if on store.eventDetailOpen; the app's
   onKey routes keys here while store.focusPane==='event'. */

// the saveable subset, for the dirty-guard (excludes the transient link picker)
const evSnapshot = (f) => ({
  title: f.title, allDay: f.allDay, date: f.date, time: f.time,
  endDate: f.endDate, endTime: f.endTime, location: f.location, recurrence: f.recurrence, notes: f.notes,
  calendarId: f.calendarId,
});

window.EventDetail = {
  props: ['store'],
  mixins: [window.KbForm],
  data() {
    const f = this.seedForm();
    return {
      f,
      _orig: JSON.stringify(evSnapshot(f)),
      kbAutofocus: !f.id, // new event → jump into the title; editing → start in nav mode
      linkList: [],       // links emitted up by <linked-items> ($refs isn't reactive) — n.13
    };
  },
  // Re-seed IN PLACE when the drawer is pointed at a different event (a mouse click on another
  // event — audit e.2 — or a J/K list swap — a.2). This used to be done with a :key that
  // remounted the whole component, which also killed the open/close slide animation: a remount
  // reads as a leave+enter to <Transition>. Watching is cheaper and keeps the drawer put.
  watch: {
    'store.editingEvent'(ev) {
      if (!ev) return;
      const f = this.seedForm();
      this.f = f;
      this._orig = JSON.stringify(evSnapshot(f));
      this.linkList = [];
      this.$nextTick(() => this.kbInit());   // cursor back to the top of the new event's ladder
    },
  },
  // register with the global data-loss guard so a refresh/close-tab with unsaved
  // event edits also trips the browser's "leave site?" prompt (Esc/close already
  // guard via kbAttemptClose). Unregister on close so a stale checker can't linger.
  mounted() { this._unreg = this.store.registerDirty(() => this.kbDirty()); },
  beforeUnmount() { if (this._unreg) this._unreg(); },
  computed: {
    // which link chip the cursor is on → <linked-items :kb-focus> (the child renders the chips) — n.13
    linkFocus() { return this.kbCellOf('links'); },
  },
  methods: {
    // the editable form for whatever event the store is pointing at (used by data() AND the
    // re-seed watcher above — Vue sets methods up before data, so this is safe to call there)
    seedForm() {
      const e = this.store.editingEvent || {};
      const start = e.startAt || Rec.ymd(new Date());
      return {
        id: e.id || null,
        readableId: e.readableId || null,   // display-only (e_0001); the uuid stays canonical
        title: e.title || '',
        allDay: e.allDay ?? true,
        date: start.slice(0, 10),
        time: start.length > 10 ? start.slice(11, 16) : '09:00',
        endDate: e.endAt ? e.endAt.slice(0, 10) : '',
        endTime: e.endAt && e.endAt.length > 10 ? e.endAt.slice(11, 16) : '10:00',
        location: e.location || '',
        recurrence: e.recurrence || '',
        notes: e.notes || '',
        // default a new event to the first calendar (or the one being viewed)
        calendarId: e.calendarId ?? (this.store.calendars[0] ? this.store.calendars[0].id : null),
      };
    },
    // ---- KbForm wiring ----
    kbRows() {
      return [
        { id: 'title', type: 'input', ref: 'title' },
        { id: 'calendar', type: 'input', ref: 'calendar', when: () => this.store.calendars.length > 0 },
        { id: 'allDay', type: 'button', activate: () => { this.f.allDay = !this.f.allDay; } },
        { id: 'date', type: 'input', ref: 'date' },
        { id: 'time', type: 'input', ref: 'time', when: () => !this.f.allDay },
        { id: 'endDate', type: 'input', ref: 'endDate' },
        { id: 'endTime', type: 'input', ref: 'endTime', when: () => !this.f.allDay },
        { id: 'location', type: 'input', ref: 'location' },
        { id: 'recurrence', type: 'input', ref: 'recurrence' },
        { id: 'notes', type: 'input', ref: 'notes' },   // ref → md-field.focus() (i edits)
        // links = a grid row, like labels: j/k skip it, h/l cross the chips, space opens (n.13)
        { id: 'links', type: 'grid', items: this.linkList, cols: 99,
          select: (l) => this.$refs.links && this.$refs.links.open(l), when: () => this.linkList.length > 0 },
        { id: 'cancel', type: 'button', activate: () => this.kbAttemptClose() },
        { id: 'delete', type: 'button', activate: () => this.del(), when: () => !!this.f.id },
        { id: 'save', type: 'button', activate: () => this.save() },
      ];
    },
    kbSubmit() { this.save(); },
    kbDirty() { return JSON.stringify(evSnapshot(this.f)) !== this._orig; },
    // J/K walk the list underneath and swap what this drawer shows, without closing it (a.2).
    // It has to live here: this drawer is a KbForm takeover with its own key listener, so the
    // app's onKey bails while it's open and would never see J/K. Not while typing.
    kbDelegate(e) {
      if (e.key !== 'J' && e.key !== 'K') return false;
      const a = document.activeElement, tag = (a && a.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return false;
      e.preventDefault();
      this.store.listSwap(e.key === 'J' ? 1 : -1);
      return true;
    },
    blurField() { const a = document.activeElement; if (a && a.blur) a.blur(); },   // Esc in a field → nav mode (don't close the drawer)
    // ---- save / delete (close on success) ----
    async save() {
      if (!this.f.title.trim()) return;
      const startAt = this.f.allDay ? this.f.date : this.f.date + 'T' + (this.f.time || '00:00');
      const endAt = !this.f.endDate
        ? null
        : this.f.allDay ? this.f.endDate : this.f.endDate + 'T' + (this.f.endTime || '00:00');
      const ok = await this.store.saveEvent({
        id: this.f.id,
        title: this.f.title.trim(),
        allDay: this.f.allDay,
        startAt,
        endAt,
        location: this.f.location.trim() || null,
        recurrence: this.f.recurrence.trim() || null,
        notes: this.f.notes,
        calendarId: this.f.calendarId || null,
      });
      if (ok) this.$emit('close');
    },
    async del() {
      if (!this.f.id) return this.$emit('close');
      if (await this.store.deleteEvent(this.f.id)) this.$emit('close');
    },
  },
  template: `
  <div class="detail">
    <div class="detail-head">
      <span class="mut">event</span>
      <span class="cy">{{ f.id ? (f.readableId || '') : 'new' }}</span>
      <span class="x" @click="kbAttemptClose" title="Close (esc)">✕</span>
    </div>

    <div class="detail-body">
      <input ref="title" class="d-title" :class="kbCls('title')" v-model="f.title" placeholder="event title" @focus="kbFocusRow('title')" @keydown.enter.prevent="save" @keydown.esc.stop.prevent="blurField">

      <!-- calendar + all-day -->
      <div class="row2">
        <div v-if="store.calendars.length" class="field">
          <label>calendar</label>
          <select ref="calendar" class="input" :class="kbCls('calendar')" v-model="f.calendarId" @focus="kbFocusRow('calendar')" @keydown.esc.stop.prevent="blurField">
            <option v-for="c in store.calendars" :key="c.id" :value="c.id">{{ c.glyph }} {{ c.name }}</option>
          </select>
        </div>
        <div class="field">
          <label>all-day</label>
          <button class="btn" style="width:100%;justify-content:center;" :class="[{primary: f.allDay}, kbCls('allDay')]" @click="f.allDay = !f.allDay">{{ f.allDay ? '✓ all-day' : '☐ timed' }}</button>
        </div>
      </div>

      <!-- starts -->
      <div class="row2">
        <div class="field" :class="kbCls('date')">
          <label>starts</label>
          <input ref="date" class="input" type="date" v-model="f.date" @focus="kbFocusRow('date')" @keydown.enter="save" @keydown.esc.stop.prevent="blurField">
        </div>
        <div v-if="!f.allDay" class="field" :class="kbCls('time')">
          <label>time</label>
          <input ref="time" class="input" type="time" v-model="f.time" @focus="kbFocusRow('time')" @keydown.enter="save" @keydown.esc.stop.prevent="blurField">
        </div>
      </div>

      <!-- ends -->
      <div class="row2">
        <div class="field" :class="kbCls('endDate')">
          <label>ends</label>
          <input ref="endDate" class="input" type="date" v-model="f.endDate" @focus="kbFocusRow('endDate')" @keydown.enter="save" @keydown.esc.stop.prevent="blurField">
        </div>
        <div v-if="!f.allDay" class="field" :class="kbCls('endTime')">
          <label>time</label>
          <input ref="endTime" class="input" type="time" v-model="f.endTime" @focus="kbFocusRow('endTime')" @keydown.enter="save" @keydown.esc.stop.prevent="blurField">
        </div>
      </div>

      <div class="field" :class="kbCls('location')">
        <label>location</label>
        <input ref="location" class="input" v-model="f.location" placeholder="location" @focus="kbFocusRow('location')" @keydown.enter="save" @keydown.esc.stop.prevent="blurField">
      </div>
      <div class="field" :class="kbCls('recurrence')">
        <label>recurrence</label>
        <input ref="recurrence" class="input" v-model="f.recurrence" placeholder="e.g. weekly on mon,wed,fri" @focus="kbFocusRow('recurrence')" @keydown.enter="save" @keydown.esc.stop.prevent="blurField">
      </div>

      <div class="field">
        <label>notes</label>
        <md-field ref="notes" :class="kbCls('notes')" v-model="f.notes" placeholder="notes…" @submit="save"></md-field>
      </div>

      <div class="field" v-if="f.id">
        <linked-items ref="links" :store="store" type="event" :id="f.id"
                      :kb-focus="linkFocus" @links="linkList = $event" @pick="kbPick('links', $event)"></linked-items>
      </div>
    </div>

    <div class="d-actions">
      <button v-if="f.id" class="btn danger" :class="kbCls('delete')" style="margin-right:auto;" @click="del">delete</button>
      <button class="btn" :class="kbCls('cancel')" @click="kbAttemptClose">cancel</button>
      <button class="btn primary" :class="kbCls('save')" @click="save">{{ f.id ? 'save ↵' : 'create ↵' }}</button>
    </div>
  </div>`,
};
