/* ============================================================
   sync.js — pure diff engine for the granular API cutover.
   window.Sync. No DOM, no fetch — index.html orchestrates the
   actual requests; this just decides what changed.
   ------------------------------------------------------------
   snapshot(store) → { tasks, projects, labels, savedQueries },
     each a map { id → {persistentFields…, position} } where
     position is the entity's index in its store array.
   diff(prev, curr) → per type { creates, updates, deletes }
     (arrays of ids, in store-array order so parents precede
     children among creates). Array fields (labels/health) are
     compared as sets so order alone never counts as a change.
   ============================================================ */
(function () {
  // Persistent fields per type (everything the server stores + that the client
  // owns). Excludes transient `collapsed` on tasks, server-derived `completedAt`,
  // immutable `createdAt`, server-managed `updatedAt`, and unused `assigneeId`.
  // `position` is injected from the array index at snapshot time.
  const FIELDS = {
    tasks: ['title','projectId','parentId','done','due','reminder','recurrence','notes','priority','size','labels','position'],
    projects: ['name','parentId','color','glyph','collapsed','health','position'],
    calendars: ['name','color','glyph','position'],
    folders: ['name','parentId','color','glyph','collapsed','position'],
    labels: ['name','pinned'],
    savedQueries: ['name','glyph','query','color','pinned','position'],
  };
  const ARRAY_FIELDS = new Set(['labels','health']);

  function indexEntities(arr, fields){
    const out = {};
    (arr||[]).forEach((o, i) => {
      const rec = {};
      for(const f of fields){
        if(f === 'position') rec.position = i;
        else if(ARRAY_FIELDS.has(f)) rec[f] = Array.isArray(o[f]) ? o[f].slice() : [];
        else rec[f] = (o[f] === undefined ? null : o[f]);
      }
      out[o.id] = rec;
    });
    return out;
  }

  function snapshot(store){
    return {
      tasks: indexEntities(store.tasks, FIELDS.tasks),
      projects: indexEntities(store.projects, FIELDS.projects),
      calendars: indexEntities(store.calendars, FIELDS.calendars),
      folders: indexEntities(store.folders, FIELDS.folders),
      labels: indexEntities(store.labels, FIELDS.labels),
      savedQueries: indexEntities(store.savedQueries, FIELDS.savedQueries),
    };
  }

  // canonical string for set-aware, key-order-independent comparison
  function canon(rec){
    const o = {};
    for(const k of Object.keys(rec).sort()){
      const v = rec[k];
      o[k] = Array.isArray(v) ? v.slice().sort() : v;
    }
    return JSON.stringify(o);
  }
  function eq(a, b){ return canon(a) === canon(b); }

  function diffType(prev, curr){
    const creates = [], updates = [], deletes = [];
    for(const id in curr){
      if(!(id in prev)) creates.push(id);             // new id → create
      else if(!eq(prev[id], curr[id])) updates.push(id); // changed fields/position → update
    }
    for(const id in prev){ if(!(id in curr)) deletes.push(id); }  // gone → delete
    return { creates, updates, deletes };
  }

  function diff(prev, curr){
    return {
      tasks: diffType(prev.tasks, curr.tasks),
      projects: diffType(prev.projects, curr.projects),
      calendars: diffType(prev.calendars, curr.calendars),
      folders: diffType(prev.folders, curr.folders),
      labels: diffType(prev.labels, curr.labels),
      savedQueries: diffType(prev.savedQueries, curr.savedQueries),
    };
  }

  // empty snapshot (used to seed lastSaved before the first load)
  function empty(){ return { tasks:{}, projects:{}, calendars:{}, folders:{}, labels:{}, savedQueries:{} }; }

  window.Sync = { snapshot, diff, empty, FIELDS, _indexEntities: indexEntities, _eq: eq };

  // dual-export for the node:test harness (browser ignores `module`)
  if (typeof module !== 'undefined' && module.exports) module.exports = window.Sync;
})();
