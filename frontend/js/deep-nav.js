/* deep-nav.js — D2 2d app-switcher drawer. A thin icon rail (Tasks / Events /
   Notes) to the left of the per-app nav. Switching apps drives store.view (and the
   router syncs the URL). Desktop: a grid column, collapsed via `N`; mobile: a fixed
   overlay opened by the bottom-left `>`. Icons are Lucide, tinted to the theme color. */

window.DeepNav = {
  props: ['store'],
  data() { return { icons: window.Icons }; },
  computed: {
    // which app the current view belongs to (calendar→events, notes→notes, else tasks)
    app() {
      const k = this.store.view.kind;
      return k === 'calendar' ? 'events' : k === 'notes' ? 'notes' : 'tasks';
    },
    // the keyboard cursor is shown only while the rail is the focused pane (§4.4)
    kbFocused() { return this.store.focusPane === 'deepnav'; },
  },
  methods: {
    go(app) {
      if (app === this.app) { this.store.deepNavOpen = false; return; }
      if (app === 'tasks') {
        const top = this.store.savedQueries[0];
        if (top) this.store.openQueryView(top, 'tasks');   // the rail means "go to Tasks" (a.7)
      } else if (app === 'events') {
        this.store.openCalendar();
      } else if (app === 'notes') {
        this.store.openNotes();
      }
      this.store.deepNavOpen = false; // close the mobile rail after switching apps
    },
  },
  template: `
  <nav class="deepnav" :class="{ open: store.deepNavOpen }">
    <button class="dn-btn" :class="{ on: app==='tasks',  kfocus: kbFocused && store.deepNavCursor===0 }" @click="go('tasks')" title="tasks" v-html="icons.tasks"></button>
    <button class="dn-btn" :class="{ on: app==='events', kfocus: kbFocused && store.deepNavCursor===1 }" @click="go('events')" title="events" v-html="icons.events"></button>
    <button class="dn-btn" :class="{ on: app==='notes',  kfocus: kbFocused && store.deepNavCursor===2 }" @click="go('notes')" title="notes" v-html="icons.notes"></button>
  </nav>`,
};
