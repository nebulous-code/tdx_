# Design: Unified keyboard-form framework — t_278

> Status: **building — Phase 1** (mixin + grid; migrate the 3 edit modals + account screen).
> Decisions below are settled.

## Goal

One reusable way to make any screen/modal keyboard-navigable, instead of re-hand-rolling the
same "roving cursor + enter-a-field + Esc" logic for every surface. Today the project / view /
label modals aren't keyboard-navigable at all (their color/glyph pickers are mouse-only), and
the four surfaces that *are* navigable each implement it from scratch.

## Current state (what we'd consolidate)

| Surface | File | How it's done today |
|---|---|---|
| Filter builder | `query-bar.js` (`navGroups`, `fmove`, `ftoggleFocused`, `isFocused`, `finit`) driven by `index.html` `filterKey` | 2D: `h/l` switch group, `j/k` within group, `space` toggle, `i` query input, `esc` exit |
| Account screen | `account-screen.js` (`rows`, `focusIdx`, `move`, `activate`, `edit`, own `keydown`) | 1D rows: `j/k` move, `i`/click edit, `Enter` save, `Esc` (dirty-guard), theme row uses `h/l` |
| Help modal | `help-modal.js` (`tabs`, `cursor`, own `keydown`) | Tabs via `h/l`, rows via `j/k` |
| Sidebar nav | `index.html` `sidebarKey` + `store.sideItems()` | Tree: `j/k` move, `l/h` expand/collapse/up, `e/a/A/x/m/Tab` actions |
| **Project / View / Label modals** | `modals.js` | **Not navigable** — only the name input + `Enter`/`Esc` work; swatches/glyph grid are click-only |

Each re-creates: a cursor over an ordered set, a `kfocus` highlight, movement keys, an
activate action, `Esc` to leave, scroll-into-view, and a document `keydown` listener with
`stopPropagation` against the global handler.

## The shared concept: **everything is rows**

A screen declares an ordered list of **rows**; a mixin owns the cursor, the keys, and the
highlight. A row has **1…N cells**:
- a plain control (text input, select, button, toggle) is a **1-cell row**;
- a picker (color swatches, glyph grid) is a **multi-cell row group**.

`j/k` always moves between rows (uniform everywhere — no "you're inside a grid now" mode);
`h/l` only does something when the current row has multiple cells.

## Grids = rows + a "magic column" (decided)

The screen passes a grid as one descriptor (a flat `items` list + a `cols` count); the **mixin
auto-chunks it into cell-rows** of `cols`. Vertical movement across rows preserves your column
via a remembered **goal column** (the text-editor "preferred column" trick):
- `h`/`l` → move within the row **and** set `goalCol`.
- `j`/`k` → go to the adjacent row, land at `min(goalCol, row.lastCell)`; **don't** change `goalCol`.

So moving from color #7 down past the Save button (a 1-cell row) into the glyph grid snaps
back to column 7 — and 1-cell rows are just the degenerate case, so the whole form is one
uniform model.

**Gotcha to fix when building:** logical rows must match *visual* rows or `h/l/j/k` feel wrong.
The glyph grid is already `grid-template-columns: repeat(10, …)` (fixed). The **color swatches
use `flex-wrap`** (wraps at whatever width) — give them a fixed-column grid in CSS too so the
declared `cols` always equals what's on screen.

## Proposed abstraction

A Vue **options mixin** (the app is Options API), e.g. `window.KbForm`, configured via a
`kbRows()` method:

```js
kbRows(){
  return [
    { id:'name',  type:'input',  ref:'name' },
    { id:'color', type:'grid',   items: this.store.COLORS, cols: 10,
      isOn:c=>c===this.color, select:c=>{ this.color=c; } },
    { id:'glyph', type:'grid',   items: this.store.GLYPHS, cols: 10,
      isOn:g=>g===this.glyph, select:g=>{ this.glyph=g; } },
    { id:'save',   type:'button', activate:()=>this.save() },
    { id:'delete', type:'button', activate:()=>this.remove(), when:()=>this.model.mode==='edit' },
    { id:'cancel', type:'button', activate:()=>this.$emit('close') },
  ];
}
```
The mixin provides: cursor state (`row` + `cell`, plus `goalCol`), an `kbInsert` flag, the
own `keydown` (attached on mount, `stopPropagation`), template helpers (`kbCls(id, cell)` →
`{ kfocus }`, and click wiring so mouse + keyboard stay in sync), scroll-into-view, focusing
the right `ref` on `nextTick`, and the global-`onKey` early-return while it's open. **Footer
buttons (save / cancel / delete) are rows too**, so `j/k` reaches them (they keep their direct
shortcuts as well). Each screen still owns its `save`/`remove`/validation — it only declares rows.

## Canonical key map (one scheme everywhere)

**Nav mode (not typing):**
- `j` / `k` — previous / next row.
- `h` / `l` — previous / next cell in a multi-cell row; remembers the column (`goalCol`) across rows.
- `i` (or click) — enter/insert the focused input. *(Enter does NOT enter a field.)*
- `space` (or click) — toggle / activate the focused control (flip a toggle, pick the focused grid cell, **press a button** incl. save/cancel/delete).
- `Enter` — always **save the form** (reserved for save; use `space` to press a focused button).
- `Esc` — close (with the dirty-guard prompt if there are unsaved changes).

**Insert mode (typing in a field):**
- single-line input (new-task box, task title) — `Enter` **saves**; `Esc` leaves insert.
- multiline textarea (notes) — `Enter` = **newline**; **`Ctrl`/`Cmd`+`Enter` = save**; `Esc` leaves insert.

So `Enter` is reserved for saving (with the multiline-newline exception), `i` is the only
"insert," `space` is the toggle/activate, and click always still works.

## Phasing (two passes)
- **P1 (highest value):** the mixin + the grid (rows + magic column), then migrate the three
  edit modals (`ProjectModal`, `SaveQueryModal`, `LabelModal`) and the **account screen** so
  color/glyph are finally keyboard-selectable and all modals behave identically. Closes the
  t_153 remainder. Generalize the **dirty-guard** confirm into the mixin here.
- **P2:** retrofit the **help modal** (tabs = a row group) and the **filter builder** (groups
  of chips) onto the mixin to delete their bespoke code.
- **P3 / maybe-never:** the **sidebar** — its `h/l` are tree semantics (expand/collapse/up) and
  it has move-mode; likely keep bespoke, or only adopt the cursor+highlight parts.

## Effort
~3–5 days; the grid (rows + magic column + uniform insert-mode) is ~80% of it.

---

## Decisions (settled)
1. **Scope:** two passes (P1 then P2) on this branch; sidebar stays bespoke.
2. **Grids:** color and glyph are separate grid rows; nav via the **rows + magic-column** model above (fix the swatch CSS to fixed columns).
3. **Enter:** reserved for **save** — single-line inputs save on `Enter`; multiline saves on `Ctrl`/`Cmd`+`Enter` (plain `Enter` = newline). `Enter` always saves, even on a focused button; use `space` to press buttons (save/cancel/delete).
4. **Insert:** only `i` (and click) enters a field; `Enter` no longer does.
5. **Footer buttons** (save/cancel/delete) are rows in the list, reachable by `j/k`, and keep their direct shortcuts.
6. **Dirty-guard:** generalized into the mixin (one shared "unsaved changes? keep editing" confirm).
7. **Priority:** greenlit; Phase 1 in progress (P2 — help + filter builder — to follow).
