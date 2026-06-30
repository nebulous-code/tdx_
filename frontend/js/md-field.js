/* md-field.js — window.MdField: the SHARED render-when-not-editing / i-to-edit-raw
   markdown field used by the task, event, and note detail drawers (2E §4). Default
   shows the rendered markdown (window.MdRender.html); pressing `i` (or clicking the
   rendered area) drops into a raw <textarea>; Esc/blur returns to the rendered view.

   This is the SIMPLE tier — NOT the vim/link-picker/clickable-checkbox editor, which
   stays on the full /notes screen (notes.js, §6.1).

   Drop-in v-model: props { modelValue, placeholder }; emits 'update:modelValue' on every
   keystroke (so the parent's bound field stays current) and 'submit' on Ctrl/Cmd+Enter
   (so a drawer can save-from-notes, like the task drawer's ⌘+↵ today).

   KbForm-friendly: exposes focus() so the parent drawer's `i`/kbEditCurrent (which calls
   $refs.<ref>.focus()) drops straight into edit mode. The parent applies the kfocus
   highlight to this component's root via :class="kbCls('notes')". */
window.MdField = {
  props: {
    modelValue: { type: String, default: '' },
    placeholder: { type: String, default: '# markdown…' },
  },
  emits: ['update:modelValue', 'submit'],
  data() { return { editing: false }; },
  computed: {
    rendered() {
      const v = this.modelValue || '';
      if (!v.trim()) return '';
      return window.MdRender ? window.MdRender.html(v) : v;
    },
  },
  methods: {
    // public — the parent drawer's KbForm `i` (kbEditCurrent → $refs.notes.focus()) lands here
    focus() { this.edit(); },
    edit() {
      this.editing = true;
      this.$nextTick(() => { const ta = this.$refs.ta; if (ta && ta.focus) ta.focus(); });
    },
    done() { this.editing = false; },               // Esc / blur → back to the rendered view
    onInput(e) { this.$emit('update:modelValue', e.target.value); },
  },
  template: `
  <div class="mdf">
    <textarea v-if="editing" ref="ta" class="d-notes mdf-edit"
      :value="modelValue" :placeholder="placeholder"
      @input="onInput" @blur="done"
      @keydown.esc.stop.prevent="done"
      @keydown.enter.ctrl.prevent="$emit('submit')"
      @keydown.enter.meta.prevent="$emit('submit')"></textarea>
    <div v-else class="md-body mdf-render" @click="edit">
      <div v-if="rendered" v-html="rendered"></div>
      <div v-else class="mut mdf-ph">{{ placeholder }}</div>
    </div>
  </div>
  `,
};
