/* label-picker.js — the ONE label chip-grid shared by every detail form (task / note /
   full-note editor / event). Two exports:

   - window.LabelPicker: a presentational child that renders the picker. It is COLLAPSED by
     default (see LabelPickable.labelsExpanded): collapsed shows only the item's applied
     labels plus an expander; expanded shows the full `#tag` grid + `+ new` + a collapse
     control. Like linked-items, the grid row lives in the HOST's kbRows() (that's where
     KbForm is), so the host tells us which cell its cursor is on (kbFocus / addFocus /
     toggleFocus) and we tell the host about clicks (@pick / @add / @toggle / @remove).

   - window.LabelPickable: a mixin the host mixes in beside KbForm. It carries the toggle/
     add logic, the collapsed/expanded state, and emits the ladder rows so a host no longer
     copies them. The host overrides labelIds() to name which array it binds (task.labels /
     f.labels / draft.labels), spreads ...this.labelRows() into kbRows(), and resets
     labelsExpanded=false whenever it (re)opens on a new entity (collapsed by default).

   Collapse was added once here and every form inherited it — the payoff of unifying the
   three (now four) hand-copied chip grids into one component. */

window.LabelPicker = {
  // selected = the ids array; expanded = show the full grid vs. just applied labels;
  // kbFocus = the absolute chip index the host's cursor is on (-1 = elsewhere);
  // addFocus / toggleFocus = cursor on the `+ new` / expand-collapse control.
  props: {
    store: Object,
    selected: { type: Array, default: () => [] },
    expanded: { type: Boolean, default: false },
    kbFocus: { type: Number, default: -1 },
    addFocus: { type: Boolean, default: false },
    toggleFocus: { type: Boolean, default: false },
  },
  emits: ['pick', 'add', 'toggle', 'remove'],
  computed: {
    labels() { return this.store.sortedLabels(); },
    // the applied labels, in the same sorted order as the full grid (collapsed view)
    applied() { return this.labels.filter((l) => this.selected.includes(l.id)); },
    // the expander's caption: how many MORE (unapplied) labels the grid would reveal
    collapsedLabel() {
      if (!this.applied.length) return '+ labels';
      const more = this.labels.length - this.applied.length;
      return more ? ('+ ' + more + ' more') : 'edit';
    },
  },
  template: `
  <div class="labelpick" :class="{ expanded }">
    <template v-if="expanded">
      <span v-for="(l,i) in labels" :key="l.id" class="chip"
            :class="[{ on: selected.includes(l.id) }, { kfocus: i === kbFocus }]"
            @click="$emit('pick', i)">#{{ l.name }}</span>
      <span class="chip" :class="{ kfocus: addFocus }" @click="$emit('add')">+ new</span>
      <span class="chip labelpick-toggle" :class="{ kfocus: toggleFocus }" @click="$emit('toggle')">collapse ▴</span>
    </template>
    <template v-else>
      <span v-for="l in applied" :key="l.id" class="chip on" @click="$emit('remove', l.id)" title="click to remove">#{{ l.name }}</span>
      <span class="chip labelpick-toggle" :class="{ kfocus: toggleFocus }" @click="$emit('toggle')">{{ collapsedLabel }} ▸</span>
    </template>
  </div>`,
};

window.LabelPickable = {
  data() { return { labelsExpanded: false }; },   // collapsed by default; hosts reset this on (re)open
  methods: {
    // OVERRIDE per host to return the live selected-ids array. In-place splice/push keeps it
    // reactive (Vue merges a component's own method over this mixin's).
    labelIds() { return []; },
    toggleLabel(id) {
      const v = this.labelIds();
      const i = v.indexOf(id);
      if (i >= 0) v.splice(i, 1); else v.push(id);
    },
    async addLabel() {
      const name = await this.store.askPrompt('new label');
      if (name) { const l = this.store.addLabel(name); const v = this.labelIds(); if (!v.includes(l.id)) v.push(l.id); }
    },
    toggleLabels() {
      this.labelsExpanded = !this.labelsExpanded;
      // collapsing from within the grid would drop the cursor into the field below (the grid
      // rows just vanished) — pin it back on the toggle. Expanding needs no reset: the cursor
      // index that held the toggle now lands on the first chip, which is where you want it.
      if (!this.labelsExpanded) this.$nextTick(() => this.kbFocusRow('labelToggle'));
    },
    // the KbForm ladder rows — spread into a host's kbRows(): ...this.labelRows(). Collapsed
    // contributes one stop (the expander); expanded contributes the grid + new + collapse.
    labelRows() {
      if (!this.labelsExpanded) return [{ id: 'labelToggle', type: 'button', activate: () => this.toggleLabels() }];
      const labels = this.store.sortedLabels();
      return [
        { id: 'labels', type: 'grid', items: labels, cols: 99,
          isOn: (l) => this.labelIds().includes(l.id), select: (l) => this.toggleLabel(l.id), when: () => labels.length > 0 },
        { id: 'addlabel', type: 'button', activate: () => this.addLabel() },
        { id: 'labelToggle', type: 'button', activate: () => this.toggleLabels() },
      ];
    },
    addLabelFocus() { return !!this.kbCls('addlabel').kfocus; },
    labelToggleFocus() { return !!this.kbCls('labelToggle').kfocus; },
  },
};
