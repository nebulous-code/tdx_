# Design sketch: Unified keyboard-form framework — t_278

> Status: **sketch for review** — open questions at the bottom. Nothing built yet.

## Goal

One reusable way to make any screen/modal keyboard-navigable, instead of re-hand-rolling
the same "roving cursor + enter-a-field + Esc" logic for every surface. Today the project /
view / label modals aren't keyboard-navigable at all (their color/glyph pickers are
mouse-only), and the four surfaces that *are* navigable each implement it from scratch.

## Current state (what we'd consolidate)

| Surface | File | How it's done today |
|---|---|---|
| Filter builder | `query-bar.js` (`navGroups`, `fmove`, `ftoggleFocused`, `isFocused`, `finit`) driven by `index.html` `filterKey` | 2D: `h/l` switch group, `j/k` within group, `space` toggle, `i` query input, `esc` exit |
| Account screen | `account-screen.js` (`rows`, `focusIdx`, `move`, `activate`, `edit`, own `keydown`) | 1D rows: `j/k` move, `i`/click edit, `Enter` save, `Esc` (dirty-guard), theme row uses `h/l` |
| Help modal | `help-modal.js` (`tabs`, `cursor`, own `keydown`) | Tabs via `h/l`, rows via `j/k` |
| Sidebar nav | `index.html` `sidebarKey` + `store.sideItems()` | Tree: `j/k` move, `l/h` expand/collapse/up, `e/a/A/x/m/Tab` actions |
| **Project / View / Label modals** | `modals.js` | **Not navigable** — only the name input + `Enter`/`Esc` (via the global ladder) work; swatches/glyph grid are click-only |

Every one of these re-creates: a cursor over an ordered set, a `kfocus` highlight, movement
keys, an "activate/enter" action, `Esc` to leave, scroll-into-view, and a document `keydown`
listener with `stopPropagation` against the global handler.

## The shared concept

A screen declares **an ordered list of focusable fields**; a mixin owns the cursor, the keys,
and the highlight. Field kinds we need:

- **input** — text/textarea/date/select: `i`/`Enter`/click focuses it ("insert mode"); `Esc`
  returns to nav (reusing the task-detail dirty-confirm pattern where relevant).
- **button / toggle** — `Enter`/`space`/click activates (save, logout, toggle done…).
- **grid** — the color swatches and 30-glyph picker: a 2D field with a known column count;
  `h/l`/`j/k` move within it, `Enter`/`space` selects. This is the hard part and the main
  reason the modals aren't navigable today.

## Proposed abstraction

A Vue **options mixin** (the app is Options API), e.g. `window.KbForm`, that a component mixes
in and configures via a `kbFields()` method returning descriptors:

```js
kbFields(){
  return [
    { id:'name',  type:'input',  ref:'name' },
    { id:'color', type:'grid',   ref:'color', cols: this.store.COLORS.length, items:this.store.COLORS,
      isOn:c=>c===this.color, select:c=>{ this.color=c; } },
    { id:'glyph', type:'grid',   ref:'glyph', cols:10, items:this.store.GLYPHS,
      isOn:g=>g===this.glyph, select:g=>{ this.glyph=g; } },
    { id:'save',  type:'button', activate:()=>this.save() },
    { id:'del',   type:'button', activate:()=>this.remove(), when:()=>this.model.mode==='edit' },
  ];
}
```

The mixin provides:
- state: `kbFocus` (field id + cell index for grids), `kbInsert` (in an input?).
- keys (own `keydown`, attached on mount, `stopPropagation`): `j/k` move between fields (and
  rows within a grid), `h/l` move within a grid / across groups, `i`/`Enter`/`space` per the
  field type, `Esc` leaves insert mode → then closes (with optional dirty-confirm hook).
- template helpers: `kbCls(id, cell)` → `{ kfocus: … }` to drop on each focusable element,
  and `kbAttrs` to wire clicks so mouse + keyboard stay in sync.
- lifecycle: scroll-into-view, focus the right `ref` on `nextTick`, and integration with the
  global `onKey` (it early-returns while a mixin-owning modal is open, same as today's
  `accountOpen` guard).

Each screen keeps its own `save`/`remove`/validation; it only *declares* fields.

## Canonical key map (one scheme everywhere)
`j/k` = move · `h/l` = move within a 2D field (grid) or between groups · `i` (or click) = edit
the focused input · `space` = toggle/activate the focused control · `Enter` = save the form
(or activate a focused button) · `Esc` = leave insert mode, then close.

## Phasing
- **P1 (highest value):** the mixin + the **grid** field type, then migrate the three
  edit modals (`ProjectModal`, `SaveQueryModal`, `LabelModal`) and the **account screen** so
  color/glyph are finally keyboard-selectable and all modals behave identically. Closes the
  t_153 remainder.
- **P2:** retrofit the **help modal** (tabs map to a group) and the **filter builder** (groups
  of chips) onto the same mixin to delete their bespoke code.
- **P3 / maybe-never:** the **sidebar** — its `h/l` are tree semantics (expand/collapse/up) and
  it has move-mode; likely keep bespoke, or only adopt the cursor+highlight parts.

## Effort
~3–5 days. The 2D grid field + uniform insert-mode is ~80% of it. An 80/20 cut is P1 with
1D fields only (inputs/buttons), leaving color/glyph grids mouse-only (~1–2 days) — but that
leaves the modals' main gap unsolved, so doing the grid is recommended.

---

## Open questions
1. **Migration scope:** P1 modals only, or commit to P2 (help + filter builder) so we actually
   delete the duplicated code? And do we leave the sidebar bespoke (its tree/`h-l` + move-mode
   don't fit the generic model cleanly)?
   - Two passes is fine. I can do this on a separate branch to keep the code changes clean and separate.
2. **Grid representation:** treat color and glyph as **two separate grid fields** (recommended)
   or one combined picker? Grid nav needs a fixed column count — OK to hardcode per grid
   (e.g. glyphs = 10 cols to match the current CSS) or derive from layout?
   - Lets go with the send row and track magic column solution we discussed.
3. **`Enter` semantics:** form-level "save" (as the account screen does now) vs "activate the
   focused field." Proposal: `Enter` = save the form *unless* a button/grid is focused, where
   it activates. Confirm that won't surprise.
   - That makes sense. I would really like ctrl/cmd+Enter to handle the enter logic in those situations. So if i'm in a text box I hit control enter it saves. If I hit plain enter it gives me a new line. Only exception worth calling out is one line entries like the new task or task title. In those cases enter would be useful to be save.
4. **`i` vs `Enter` to enter an input:** keep `i` as the explicit "insert" (vim-ish) and let
   `Enter`/click also work? (Current account screen uses `i`.)
   - I'm willing to remove Enter from this logic and lean on only i to insert into a field. Enter can be reserved for saving (except the situations where a new line or toggle interaction is relevant (and even the toggle could move to space which we use some places)). Click should obviously stil work to enter/interact with a field
5. **Footer actions as fields:** should save/cancel/delete buttons be part of the same field
   list (so `j/k` reaches them) — yes in the account screen today; keep that everywhere?
   - Yes this would be helpful. The buttons have their own shortcuts as well but an extra way to reach them would be nice.
6. **Dirty-guard:** generalize the task-detail/account "unsaved changes? keep editing" confirm
   into the mixin, or leave each screen to opt in via a hook?
   - Generalizing them is good.
7. **Worth it now?** It's a refactor with no new user-facing feature except "modals are
   keyboard-navigable." Fine to defer until the modal friction actually bites?
   - Not sure what you mean by this
