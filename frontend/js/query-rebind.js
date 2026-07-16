/* query-rebind.js — window.QueryRebind.
   When an entity is renamed, rewrite the saved-query tokens that named it so they keep
   resolving. This lives client-side because renames are client-driven: the diff-sync in
   index.html pushes the rewritten saved queries in the same batch as the rename, so a
   server-side rewrite would only diverge from the store and get clobbered by a later edit.

   A token is rewritten only when BOTH: its value slug EXACTLY equals the old name's slug,
   and the old name is no longer borne by any entity in that field's domain ("fully-freed").
   The second rule is what makes non-unique names safe — if another project still holds the
   old name, `project:old` still validly matches it and is left alone.

   Uses the global Q (query.js) for parse/build/slug — client-only, so no parity concern. */
(function () {
  // query fields a rename of each entity kind can affect. `category:` spans the three
  // categorizers (project/calendar/folder), so renaming any of them may touch category: too.
  var KIND_FIELDS = {
    project: ['project', 'category'],
    calendar: ['calendar', 'category'],
    folder: ['folder', 'category'],
    label: ['label'],
  };
  // the entity list(s) a query FIELD resolves against — used for the fully-freed check
  var FIELD_DOMAINS = {
    project: ['projects'],
    calendar: ['calendars'],
    folder: ['folders'],
    label: ['labels'],
    category: ['projects', 'calendars', 'folders'],
  };
  var SNAP_KEY = { project: 'projects', calendar: 'calendars', folder: 'folders', label: 'labels' };

  // renames since the last synced snapshot `prev`, found by comparing names to the live store
  function detectRenames(prev, store) {
    var out = [];
    for (var kind in SNAP_KEY) {
      var key = SNAP_KEY[kind];
      var prevMap = (prev && prev[key]) || {};
      (store[key] || []).forEach(function (e) {
        var was = prevMap[e.id];
        if (was && was.name !== e.name) out.push({ kind: kind, oldName: was.name, newName: e.name });
      });
    }
    return out;
  }

  // is `name` no longer used by any entity in `field`'s domain? (store is post-rename)
  function fieldFreed(field, name, store) {
    var want = Q.slug(name);
    return !(FIELD_DOMAINS[field] || []).some(function (key) {
      return (store[key] || []).some(function (e) {
        return Q.slug(e.name) === want;
      });
    });
  }

  // rewrite one query string for a set of renames — pure; returns the original string unchanged
  // if nothing matched (so untouched queries never get re-normalized by build()).
  function rebindQuery(queryStr, renames, store) {
    if (!queryStr || !renames.length) return queryStr;
    var parsed = Q.parse(queryStr);
    var changed = false;
    parsed.terms.forEach(function (term) {
      for (var i = 0; i < renames.length; i++) {
        var r = renames[i];
        if (
          (KIND_FIELDS[r.kind] || []).indexOf(term.field) !== -1 &&
          Q.slug(term.value) === Q.slug(r.oldName) &&
          fieldFreed(term.field, r.oldName, store)
        ) {
          term.value = Q.slug(r.newName);
          changed = true;
          break;
        }
      }
    });
    return changed ? Q.build(parsed.terms) : queryStr;
  }

  // detect renames vs the `prev` snapshot and rewrite the store's savedQueries in place.
  // returns the number of saved queries changed.
  function reconcile(prev, store) {
    var renames = detectRenames(prev, store);
    if (!renames.length) return 0;
    var n = 0;
    (store.savedQueries || []).forEach(function (sv) {
      var nq = rebindQuery(sv.query, renames, store);
      if (nq !== sv.query) {
        sv.query = nq;
        n++;
      }
    });
    return n;
  }

  var api = { reconcile: reconcile, rebindQuery: rebindQuery, detectRenames: detectRenames, fieldFreed: fieldFreed };
  if (typeof window !== 'undefined') window.QueryRebind = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
