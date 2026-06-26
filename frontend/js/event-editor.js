/* event-editor.js — the event create/edit drawer (D2 2d). Split out of calendar.js
   because it's GLOBAL: it opens from the calendar AND from a task's "linked events".
   Keyboard-navigable via the shared KbForm mixin (j/k move fields · i edits · space
   toggles all-day · Enter saves · Esc closes with a discard-changes guard). Rendered
   with v-if on store.eventDetailOpen, so it mounts (and owns the keyboard) only when
   open, exactly like the project/label/save-query modals. */

// the saveable subset, for the dirty-guard (excludes the transient link picker)
const evSnapshot = (f) => ({
  title: f.title, allDay: f.allDay, date: f.date, time: f.time,
  endDate: f.endDate, endTime: f.endTime, location: f.location, recurrence: f.recurrence, notes: f.notes,
});

window.EventDetail = {
  props: ['store'],
  mixins: [window.KbForm],
  data() {
    const e = this.store.editingEvent || {};
    const start = e.startAt || Rec.ymd(new Date());
    const f = {
      id: e.id || null,
      title: e.title || '',
      allDay: e.allDay ?? true,
      date: start.slice(0, 10),
      time: start.length > 10 ? start.slice(11, 16) : '09:00',
      endDate: e.endAt ? e.endAt.slice(0, 10) : '',
      endTime: e.endAt && e.endAt.length > 10 ? e.endAt.slice(11, 16) : '10:00',
      location: e.location || '',
      recurrence: e.recurrence || '',
      notes: e.notes || '',
    };
    return {
      f,
      _orig: JSON.stringify(evSnapshot(f)),
      kbAutofocus: !f.id, // new event → jump into the title; editing → start in nav mode
    };
  },
  // register with the global data-loss guard so a refresh/close-tab with unsaved
  // event edits also trips the browser's "leave site?" prompt (Esc/close already
  // guard via kbAttemptClose). Unregister on close so a stale checker can't linger.
  mounted() { this._unreg = this.store.registerDirty(() => this.kbDirty()); },
  beforeUnmount() { if (this._unreg) this._unreg(); },
  methods: {
    // ---- KbForm wiring ----
    kbRows() {
      return [
        { id: 'title', type: 'input', ref: 'title' },
        { id: 'allDay', type: 'button', activate: () => { this.f.allDay = !this.f.allDay; } },
        { id: 'date', type: 'input', ref: 'date' },
        { id: 'time', type: 'input', ref: 'time', when: () => !this.f.allDay },
        { id: 'endDate', type: 'input', ref: 'endDate' },
        { id: 'endTime', type: 'input', ref: 'endTime', when: () => !this.f.allDay },
        { id: 'location', type: 'input', ref: 'location' },
        { id: 'recurrence', type: 'input', ref: 'recurrence' },
        { id: 'notes', type: 'input', ref: 'notes', multiline: true },
        { id: 'cancel', type: 'button', activate: () => this.kbAttemptClose() },
        { id: 'delete', type: 'button', activate: () => this.del(), when: () => !!this.f.id },
        { id: 'save', type: 'button', activate: () => this.save() },
      ];
    },
    kbSubmit() { this.save(); },
    kbDirty() { return JSON.stringify(evSnapshot(this.f)) !== this._orig; },
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
      });
      if (ok) this.$emit('close');
    },
    async del() {
      if (!this.f.id) return this.$emit('close');
      if (await this.store.deleteEvent(this.f.id)) this.$emit('close');
    },
  },
  template: `
  <div class="ev-overlay" @click.self="kbAttemptClose">
    <div class="ev-card">
      <div class="ev-head">
        <span class="hi">{{ f.id ? 'edit event' : 'new event' }}</span>
        <span class="grow"></span>
        <span class="qbtn" @click="kbAttemptClose">esc</span>
      </div>
      <div class="ev-body">
        <input ref="title" v-model="f.title" placeholder="event title" class="ti" :class="kbCls('title')" @focus="kbFocusRow('title')">
        <label class="ev-lbl" :class="kbCls('allDay')" @click="f.allDay = !f.allDay">
          <span class="checkbox" :class="{ on: f.allDay }">{{ f.allDay ? '✓' : '' }}</span>
          all-day
        </label>
        <div class="ev-row">
          <span class="ev-rl">starts</span>
          <input ref="date" type="date" v-model="f.date" class="ti" :class="kbCls('date')" @focus="kbFocusRow('date')">
          <input v-if="!f.allDay" ref="time" type="time" v-model="f.time" class="ti" :class="kbCls('time')" @focus="kbFocusRow('time')">
        </div>
        <div class="ev-row">
          <span class="ev-rl">ends</span>
          <input ref="endDate" type="date" v-model="f.endDate" class="ti" :class="kbCls('endDate')" @focus="kbFocusRow('endDate')">
          <input v-if="!f.allDay" ref="endTime" type="time" v-model="f.endTime" class="ti" :class="kbCls('endTime')" @focus="kbFocusRow('endTime')">
        </div>
        <input ref="location" v-model="f.location" placeholder="location" class="ti" :class="kbCls('location')" @focus="kbFocusRow('location')">
        <input ref="recurrence" v-model="f.recurrence" placeholder="recurrence (e.g. weekly on mon,wed,fri)" class="ti" :class="kbCls('recurrence')" @focus="kbFocusRow('recurrence')">
        <textarea ref="notes" v-model="f.notes" placeholder="notes" class="ti" :class="kbCls('notes')" rows="3" @focus="kbFocusRow('notes')"></textarea>
        <linked-items v-if="f.id" :store="store" type="event" :id="f.id"></linked-items>
        <div class="ev-actions">
          <button class="btn" :class="kbCls('cancel')" @click="kbAttemptClose">cancel</button>
          <button v-if="f.id" class="btn danger" :class="kbCls('delete')" @click="del">delete</button>
          <button class="btn primary" :class="kbCls('save')" @click="save">{{ f.id ? 'save ↵' : 'create ↵' }}</button>
        </div>
      </div>
    </div>
  </div>`,
};
