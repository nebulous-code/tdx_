# Design: Weekday window filter — t_228

## Goal / use case

A filter that shows tasks due on the **next occurrence of chosen weekdays**, as a rolling
window that only advances once you're fully past the last selected day. Primary use: a
"weekend" view (`due:su` = Saturday + Sunday) that, mid-window, keeps showing already-passed
days as overdue rather than jumping a week ahead. Generalizes to any weekday set (`due:mwf`).

## Decision: fold it into `due:` (not a new `dow:` field)

Per review, the weekday window is a **`due:` value**, e.g. `due:su`, `due:mwf`, `due:f` —
not a separate `dow:` field. Why this is the better choice:
- It's conceptually a due-date filter, so it belongs with the other `due:` options.
- The builder's **due group is single-select**, so you physically can't stack a weekday
  window with a comparison (`due:<=7d`) — which is exactly the "no overlap" you wanted.
- Task creation "just works": `due` is already in `viewDefaults`' applied set, so a task made
  in a `due:su` view gets a due date assigned (see Q7) and **isn't** flagged by the `⚠` warn.

### Letters (Monday-first by default; configurable later — see Week start)
`m`=Mon `t`=Tue `w`=Wed `r`=Thu `f`=Fri `s`=Sat `u`=Sun. Order/duplicates don't matter
(`due:us` == `due:su`).

### Parsing / disambiguation (in `query.js` `evalTerm` `due:`)
Resolve the `due:` value in this order:
1. **Keyword** — `today · tomorrow · overdue · week · month · set · none`.
2. **Comparison** — matches `^(<=|>=|<|>|=)(-?\d+)d$` (e.g. `<=3d`).
3. **Weekday set** — matches `^[mtwrfsu]+$` → the window logic below.
4. else → no match.

No collisions: no keyword is a single weekday letter or a pure weekday-letter string
(`week` is caught at step 1; `due:w` = Wednesday, `due:s` = Saturday). **Documentation
caveat:** `due:w` (Wednesday) vs `due:week` (next 7 days) is a learning edge — call it out
clearly on the help screen.

---

## Semantics — the rolling window

Let **S** = the selected weekdays, **today** = local start-of-day, **weekStart** = the day the
week begins (default Monday; configurable later).

1. `weekStartDate` = the most recent `weekStart` on/before today.
2. Each day `d ∈ S` sits at `position = (d − weekStart + 7) % 7` → its date = `weekStartDate + position`.
3. `lastDate` = the latest of those dates.
4. **If `today <= lastDate`** → the active window is **this week's** S dates; **else** roll
   everything forward 7 days (next week).
5. A task matches iff its `due` date is **one of the active window dates**.

Tasks with no due never match. In-window days that are already past show up (and render as
overdue) — the "carry until the window closes" behavior. Letter order is irrelevant because
we compute each day's absolute date from its position; rollover keys off the latest date.

### Worked examples
- **`due:su`, today=Wed** → this Sat+Sun (both upcoming). ✅
- **`due:su`, today=Sun** → this Sat (overdue) + Sun (today). ✅
- **`due:mwf`, today=Fri** → this Mon+Wed (overdue) + Fri (today). ✅
- **`due:mwf`, today=Sat** → past Friday → rolls to next week's Mon/Wed/Fri. ✅
- **Week-start=Wed, `due:wmf`, today=Thu** → positions w=0 (Wed, yesterday), f=2 (Fri), m=5
  (next Mon); lastDate=Mon, so window = Wed(overdue)+Fri+Mon. Confirms order is derived, not
  typed. ✅

---

## Implementation

### Query engine — `frontend/js/query.js`
Extend the existing `due` case in `evalTerm`: after the keyword/comparison checks, if the
value is a weekday set, test membership in the active window.
```js
const DOW = { u:0, m:1, t:2, w:3, r:4, f:5, s:6 };               // letter -> JS getDay()
function weekdaySet(v){ const s=new Set(); for(const c of v) if(c in DOW) s.add(DOW[c]); return s; }
function dueWindow(daySet, weekStart=1){                          // weekStart: 0=Sun..6=Sat (default Mon)
  const today = Rec.startOfDay(new Date());
  const back = (today.getDay() - weekStart + 7) % 7;
  const start = Rec.addDays(today, -back);
  let dates = [...daySet].map(d => Rec.addDays(start, (d - weekStart + 7) % 7));
  const last = dates.reduce((a,b)=> a>b ? a : b);
  if (today > last) dates = dates.map(d => Rec.addDays(d, 7));
  return dates.map(Rec.ymd);
}
// inside evalTerm 'due', after existing branches:
else if (/^[mtwrfsu]+$/.test(t.value)) {
  res = !!task.due && dueWindow(weekdaySet(t.value)).includes(task.due.slice(0,10));
}
```
`weekStart` is a parameter now (default Mon) so a future user setting can supply it without
touching the algorithm.

### Task creation — `frontend/js/data.js` `viewDefaults`
Make a new task in a `due:<weekdays>` view land on the **next selected weekday on/after today**
(today if today is selected). This is the "closest to today, preferring future" rule you
described (Thursday + `mwf` → Friday; Monday + `su` → Saturday; on a selected day → that day).

Achieve it by flipping the existing closest-to-today search to **future-first**: try offsets
`0, +1, +2, … , −1, −2, …` instead of `0, −1, +1, …`. The first candidate date that satisfies
the `due:` term wins — which for a weekday set is the earliest in-window date `>= today`.
This is **regression-free** for the other `due:` filters (overdue still resolves to −1 once
the forward scan fails; week→today; tomorrow→+1) — only the symmetric weekday case changes,
which is the one we want to bias forward.

### Builder UI — `frontend/js/query-bar.js`
Add the 7 weekday toggles (`M T W R F S U`) **inside the existing due group**. Because a task
has one `due:` value, the group stays single-value but the weekday chips behave as a
sub-cluster:
- clicking a weekday toggles its letter in the current `due:` value **if that value is already
  a weekday set**, otherwise it starts a fresh set (replacing a keyword/comparison);
- clicking a keyword/comparison chip clears any weekday letters (normal exclusive behavior);
- the `due:` value is re-serialized in `mtwrfsu` order; empty → drop the term.
Wire the toggles into the keyboard `navGroups` like the other due chips. **No preset combo**
(you'll review the chips in place and tweak from there).

### Help — `frontend/js/help-modal.js`
Query-syntax tab: `due:su · due:mwf — due on the next selected weekday(s); carries overdue
until the window passes` and a note that `due:w`=Wednesday vs `due:week`=next 7 days.

---

## Edge cases / notes
- **Manual stacking:** the builder can't combine `due:mwf` with `due:<=7d`, but typing both is
  allowed and they AND (rare; harmless).
- **Timezone:** local `startOfDay`, consistent with the rest of the date logic.
- **Sorting:** the `due` sort still orders tasks within the window naturally.

## Resolved
1. **Future-first task-creation search** — approved; lives in `viewDefaults` (regression-free).
2. **Week start** — default Monday now; `weekStart` is a parameter so a configurable per-user
   setting drops in later. That setting is tracked separately as **t_351** (out of scope here).
3. **Builder chips** — 7 weekday toggles built into the due group; expect a visual tweak pass
   once reviewed in-app.
