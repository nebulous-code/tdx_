# tdx_ — Style Guide

A handoff reference for implementing the **tdx_** terminal to-do app UI. Dark-mode only, retro CRT / amber-phosphor aesthetic. Built with Vue 3, but the visual system is framework-agnostic.

---

## 1. Aesthetic Principles

- **Terminal-native, not skeuomorphic.** Monospace everything. Boxy. Hairline borders. Glyphs over icons. No rounded "app card" look beyond a 2px radius.
- **Phosphor glow, used sparingly.** Amber text on warm near-black, with a soft text-shadow that reads as CRT bloom — never neon. Glow is strongest on the active/primary element only.
- **One accent, many category colors.** The UI chrome is monochrome amber. *Project categories* carry their own flat colors; those are the only non-amber hues in normal use (plus semantic green/red/cyan).
- **Density is a feature.** This is a power tool. Tight line-height, compact rows, keyboard-first. Don't add whitespace to "breathe" — breathe with hairlines and dim text instead.
- **Motion is subtle and optional.** Scanlines, a slow flicker, a blinking cursor. All decorative motion must respect `prefers-reduced-motion`.

---

## 2. Color Tokens

All defined as CSS custom properties on `:root`. Use the tokens, never raw hex.

### Base (warm near-black)
| Token | Value | Use |
|---|---|---|
| `--bg` | `#0b0a07` | App background |
| `--bg-1` | `#100e0a` | Panels (sidebar, bars, palette) |
| `--bg-2` | `#16130d` | Raised / selected row |
| `--bg-3` | `#1e1a11` | Inputs, hover, active nav |
| `--line` | `#2a2414` | Hairline borders |
| `--line-2` | `#3a3119` | Stronger borders, chip outlines |

### Amber phosphor (foreground ramp)
| Token | Value | Use |
|---|---|---|
| `--amber` | `#ffb000` | Primary accent, prompts, active marks |
| `--amber-hi` | `#ffd166` | Brightest text — titles, focused input |
| `--amber-dim` | `#b9892f` | Default body text |
| `--amber-mut` | `#7c5f24` | Secondary / meta / labels |
| `--amber-faint` | `#4a3a18` | ASCII art, disabled |

### Semantic
| Token | Value | Use |
|---|---|---|
| `--green` | `#46d369` | Success, "add" prompt, online dot |
| `--red` | `#ff5c5c` | Overdue, destructive |
| `--cyan` | `#3fd7d7` | Recurrence, query syntax echo |

### Glow
| Token | Value |
|---|---|
| `--glow` | `0 0 6px rgba(255,176,0,.35)` |
| `--glow-soft` | `0 0 4px rgba(255,176,0,.22)` |
| `--glow-strong` | `0 0 10px rgba(255,176,0,.55)` |

Body text carries `text-shadow: var(--glow-soft)` globally. Disable glow (`text-shadow:none`) on small meta text, counts, and chips to keep them crisp.

### Category color palette (projects)
Flat, single colors. Stored per-project. Curated set:
```
#ffb000 amber   #46d369 green   #3fd7d7 cyan    #5b8cff blue    #c78bff violet
#ff6fae pink    #ff5c5c red     #ff9f43 orange  #b6c948 lime    #8a93a6 slate
```

---

## 3. Typography

```
--mono: 'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, monospace;  /* everything */
--crt:  'VT323', var(--mono);   /* wordmark + big readouts only */
```

- **Body / all UI:** JetBrains Mono. Base size **13px**, line-height **1.55**.
- **VT323** is the pixel/CRT face — use ONLY for: the `tdx_` wordmark, the active view title, and large numeric readouts. Never for body copy (poor legibility at length).
- **Sizes:** body 13px · meta/labels 11px · micro (counts, kbd) 10px · view title 18px (VT323) · wordmark 20px (VT323) · detail task title 15px.
- **Uppercase + letter-spacing** for section headers: `font-size:10px; letter-spacing:1.5px; text-transform:uppercase; color:var(--amber-mut)`.
- **Case:** UI nouns are lowercase (`projects`, `views`, `add task…`). This is intentional terminal styling — keep it.

---

## 4. Spacing, Borders, Radius

- **Radius:** `--radius: 2px`. That's the max. Chips/swatches may go to `9–10px` pill radius; nothing else rounds.
- **Borders:** 1px, `--line` for structure, `--line-2` for interactive outlines. Dashed `--line-2` for the recurrence summary box.
- **Grid rhythm:** rows pad `5px 12px`. Section headers pad `6px 12px 4px`. Tree indentation: **14px per depth** (projects), **22px per depth** (subtasks).
- **No drop shadows** except: the detail drawer (`-16px 0 40px rgba(0,0,0,.5)`) and overlays/palette (large soft black + amber glow ring).

---

## 5. CRT Treatment

Three fixed, `pointer-events:none`, full-viewport layers at `z-index:9999`:

1. **`.crt-scanlines`** — `repeating-linear-gradient` of 1px dark lines every ~3px, `mix-blend-mode:multiply`, opacity .55.
2. **`.crt-vignette`** — radial gradient darkening the corners.
3. **`.crt-flicker`** — faint amber wash with a 6s stepped opacity `flicker` animation. **Gate behind `@media (prefers-reduced-motion: no-preference)`** — set `animation:none` for reduce.

The blinking block cursor (`▋`) uses a 1.1s stepped `blink` keyframe — also reduce-motion aware in spirit (it's low-key; acceptable to keep).

> When porting: keep these as sibling overlays of the app root, not as backgrounds on content, so text glow stays readable above them.

---

## 6. Iconography

**No SVG icons.** Use monospace-safe Unicode glyphs as "icons":

- Project glyphs (user-pickable): `❯ ◆ ▲ ● ★ ■ ◈ ⌘ ⚙ § ¶ λ Σ ∆ ▒ ☰ ⎔ ⊞ ✦ ⛁ ♜ ⌬ ∴ ▚ ◇ ✧ ⊹ ⌗ ⟁ ❖` (plus `⌂` home, etc.).
- System view glyphs: `☉` today · `!` overdue · `☰` week · `↻` recurring · `∅` none · `★` saved.
- Inline meta: `◷` due · `◔` reminder · `↻` recurrence · `⊟` subtask progress · `#` label.
- Controls: `✓` check · `▾/▸` twist · `└` subtask leader · `✕` close/delete · `⧉` duplicate.

Render a project's glyph in its category color; everything else in the amber ramp.

---

## 7. Core Components

### Buttons
- `.btn` — bordered, `--bg-2`, dim text. Hover → amber text + amber-mut border.
- `.btn.primary` — solid `--amber` fill, `#1a1300` text (near-black-on-amber), weight 500.
- `.btn.danger` — hover turns text + border red.

### Chips (toggles / filters / presets)
- `.chip` — pill, 1px border, dim. `.chip.on` → solid amber fill, dark text. `white-space:nowrap`.
- Used in: query builder, recurrence builder, label pickers. Exclusive groups (status, due, project) clear siblings on select; additive groups (labels, flags) toggle independently.

### Inputs
- `.input` — `--bg-3` fill, `--line-2` border, amber-hi text, 2px radius. Focus → amber-mut border + soft glow.
- Set `color-scheme: dark` globally and theme `input[type=date]` (amber text, inverted/recolored picker indicator) so native pickers match.
- Bare "terminal" inputs (query bar, quick-add, palette) are borderless on transparent bg with `caret-color:var(--amber)` and an amber/green prompt glyph to the left.

### Nav item (sidebar rows)
- `.nav-item` — `[glyph][label][···][count]`. Hover → `--bg-2` + amber. `.active` → `--bg-3`, amber-hi, **2px amber left bar with glow** via `::before`.
- Counts are 10px, `--amber-mut`, no glow, right-aligned.

### Task row
- `[twist][checkbox][title + meta]`. Selected row: `--bg-2` + amber left bar. Done: title `line-through`, dimmed.
- `.checkbox` 15px box, amber-mut border → fills solid amber with dark `✓` when checked.
- `.tmeta` is a `flex-wrap` row of `gap`-separated `.m` items; each `.m` is `nowrap`. Due states recolor: `.due` (dim) / `.today` (amber glow) / `.overdue` (red).

### Detail drawer
- Absolutely positioned, right, `380px`, slides via `transform: translateX(100%)` ↔ `0` (.16s). `--detail-w:100%` on mobile.

### Command palette & modals
- Centered overlay, `--bg-1` panel, **amber-mut border + glow ring**. Palette options: `[glyph][label][desc→right]`, active row `--bg-3`. Category subheaders in uppercase mut.

### Toasts
- Bottom-center, `--bg-2`, amber-mut border, soft glow, auto-dismiss ~2.2s.

---

## 8. Layout

CSS Grid shell:
```
grid-template-columns: 256px 1fr;           /* sidebar | main */
grid-template-rows:    28px 1fr 22px;        /* topbar | body | statusbar */
areas: "topbar topbar" / "side main" / "status status"
```
- **Detail drawer** overlays inside `main` (absolute), it does not reflow the grid.
- **≤860px:** collapse to single column; sidebar becomes a fixed off-canvas drawer (`translateX(-100%)` → `0`) with a scrim; detail goes full-width; show the `≡` menu button and `⌘K` affordance.

---

## 9. Interaction & Motion

- **Transitions:** only on the drawer (transform .16s) and toast entrance (.18s). Everything else is instant — terminals don't animate.
- **Hover** always shifts text up one step in the amber ramp (dim → amber/hi) and may add a soft glow; avoid background-only hovers on text controls.
- **Focus** is shown with border color + soft glow, never a default browser outline on styled inputs.
- **Selection color:** `::selection { background: rgba(255,176,0,.28); color: var(--amber-hi); }`.

---

## 10. Keyboard Model (must-have)

Global, when not typing in a field:
| Key | Action |
|---|---|
| `⌘K` / `Ctrl+K` | Toggle command palette |
| `j` / `k` (or ↓/↑) | Move task selection |
| `x` / `Space` | Toggle done on selected |
| `e` / `Enter` | Open detail drawer |
| `n` | New task (focus quick-add) |
| `/` | Focus query bar |
| `c` | Toggle "show completed" |
| `Esc` | Close palette → modal → drawer (in that priority) |

Palette: ↑/↓ navigate, Enter executes, Esc closes. Always intercept `⌘K` even while typing.

---

## 11. Do / Don't

**Do**
- Keep chrome monochrome amber; let project colors do the categorizing.
- Use dim text + hairlines for hierarchy before reaching for spacing.
- Echo machine-readable state (query strings, recurrence syntax) in cyan so it reads as "code".
- Keep all labels lowercase.

**Don't**
- Add gradients, glassmorphism, big shadows, or rounded cards.
- Use emoji or multicolor SVG icons.
- Introduce a second font for body text.
- Animate routine state changes.
- Let glow bloom on dense data (counts, tags, table-like meta).
