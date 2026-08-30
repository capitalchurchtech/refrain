# Handoff — width, continuity, and the tail

> **This file is the live handoff, and the only record of findings.** Severity
> in the heading. When a new handoff replaces this one the old version moves to
> `.claude/handoffs/`. Anything not in here is not part of the brief.
>
> **Editing session:** read [creative-direction.md](creative-direction.md)
> first, then work the items in order. Append to the Status log as you go.

Written 2026-08-27. Supersedes
[2026-08-27-light-theme-cluster.md](handoffs/2026-08-27-light-theme-cluster.md),
whose light-theme items are all shipped.

The older Todoist project is **archive**. Do not add to it and do not assume a
task there is live.

---

## Where this stands

`v0.10.0` shipped; **seven commits sit unpushed after it**. The visual system is
complete and verified in all three themes: palette, junctions, texture, display
type, engraved wordmark, uniform 44px key bank, Forms pattern on all five
sub-pages, hash routing, accessible names on all 100 inputs, and the whole
light-theme signal cluster (AA on the primary action, tier heights, press
feedback, link lamp, index meter).

The three questions: a console operator would respect it; a nervous volunteer
would succeed; and it has a pulse. What is left is width, continuity between
screens, and a short tail.

---

## 1. CRAFT — 29% of the window is dead space, and the brief caused it

Brandon: "the main section is centered instead of hugging the left menu, that
means wasted pixels on dead space."

Measured at 1280px, transitions disabled, sum check passing:

```
rail 144  +  main 768  +  dead 368  =  1280      368px = 28.7%
```

`#main-content` is flush against the rail — `gapRailToMain` is 0, so it is not
literally centred. But content stops at `max-w-3xl` (768px) regardless of window
width, and a column with a rail on one side and a 368px void on the other reads
as adrift.

**The cap is doing two jobs, so deleting the class is not the fix.**

- **Reading measure** for slide text and explanatory prose. There are **no
  element-level measure caps anywhere in `refrain.css`**, so the container is
  the only thing providing it. Remove it naively and slide text runs to 1136px,
  which is worse.
- **Constraining everything else.** Accidental and harmful.

**It costs more than pixels.** Live's key bank is `grid-cols-2 sm:grid-cols-3`
(`live.js:133`, `:138`) — three columns maximum. With the full width it takes
four or five, putting 34 tiles in seven rows instead of twelve, on the screen
where scrolling costs most.

### The fix

1. **Drop the container cap.** Content hugs the rail and fills the width.
2. **Put measure on the elements that need it**, not the container — slide text
   and explanatory copy at roughly 70ch. Must land in the same change as (1).
3. **Let the grids grow.** Live's key bank to four or five columns at width.
4. **Re-aim the too-wide nudge.** It fires at setup, which is exactly when a
   wide window is correct. It belongs on the booth path and should say to dock
   before a service, not that the setup is wrong.

### The brief was the root cause and is amended

The project card said *always a docked side window*. That came from the
Reluctant Operator's surface and was applied to all nine screens.

**There are two surfaces.** BOOTH: Search and Live, docked, narrow, during a
service. DESK: Health, Setup, Image Crop, QR Codes, Arrangement — a normal
window, at a desk, unhurried. Material, palette, tiers and voice are identical;
only the width assumption changes. Amended in `creative-direction.md` under
Project card and Operating conditions.

---

## 2. CRAFT — Make the latched nav key present, without a fifth emitter

Brandon asked whether the current nav item's icon and text could glow.

**Not glow.** Emission marks what the machine reports about itself; which screen
you are on is the operator's own navigation. Same category error as glowing a
filter count. And a latched key does not brighten.

**But the instinct is right — it is not present enough.** Three changes, none
spending an emitter:

1. **Give the lit edge its bleed**, as the section markers already have:
   `box-shadow: inset 2px 0 0 var(--rf-plum), 0 0 6px rgba(169,111,232,.30);`
2. **Widen the edge** from 2px to 3px.
3. **Take the legend and icon to `--rf-text`.**

**Item 3 corrects an earlier ruling of mine.** I said the latched label must
stay at `--rf-muted` because a bottomed-out key occludes its own light. Wrong:
**occlusion applies to emitted light, not printed ink.** A silkscreen legend
does not dim when the key is pressed.

---

## 3. CRAFT — Every screen is a destination with no onward path

The connective tissue between screens was never designed. Nine islands; nothing
says what to do next, so the operator has to know the product to keep moving.

- **Spell Check** flags a word, jumps to ProPresenter, and stops. No "next
  flagged word", so nine typos is nine round trips driven manually.
- **Lyrics** ends on "copy each into a new presentation." No path back to
  Search to confirm it landed.
- **Arrangement** pushes a correction and stops.
- **Search is the hub and nothing visibly returns to it.** There is a `/`
  shortcut the Fluent Regular knows and the Reluctant Operator never will.

**Not a breadcrumb.** Every screen should end on the next action, the same way
the voice rules already require of copy. Spell Check gets `Next flagged word`.
Lyrics gets a way back to Search. Continuity built out of the work, not chrome.

**Scroll position should persist per screen.** Verified reset. Query and results
*do* survive navigation — leave Search for Health, come back, and the query and
all 117 results are intact. Do not disturb that; only scroll is lost, and
returning to the top of 117 results mid-service is what makes it feel like a
website rather than a tool.

**Do not add a page transition.** Instant is correct — perceived power is almost
entirely latency. The direction says nothing animates on the path to live;
extend that to navigation.

---

## 4. CRAFT — Finish the semantic colour sweep

Raw DaisyUI semantic colours by file: `health.js` 44, `arrangement.js` 19,
`library-sync.js` 8, `setup.js` 6, `search.js` 2, `live.js` 2,
`error-boundary.js` 2.

**These are grep counts, so they are a starting point for looking, not
findings.** Health's are largely the migrated fault/status vocabulary doing its
job — resolve values before changing anything.

Sweep **by concept, not by screen.** Doing it screen by screen is what left the
inverted performance-mode dot in place while Health looked finished.

---

## 5. CRAFT — Arrangement: the list-and-compare pattern

The least-finished screen, and the fourth shape in the product after the
readout, the key bank and the form. Spec follows; it is meant to be buildable
without further questions. Off the live path and an optional module, so it does
not jump the queue.

### What the screen is for

Reconciliation. It answers "was this song played the way the plan said" and lets
you correct the record. Three views, two of which are never on screen together:

- **Plan card** — a plan selector, a match summary, the plan's songs.
- **List view** — a filter and every tracked song, with status and history.
- **Detail view** — one song: actual arrangement, section mapping, planned
  arrangement, comparison, history.

### One E2 per view, not per screen

List and detail are never both visible, so each gets its own hero. That is
consistent with the rule rather than an exception to it.

- **List view hero: the plan card.** It is the answer to why the operator opened
  the screen. The lit collar goes on `Compare All Songs`.
- **Detail view hero: the comparison.** See below — this is the substantive
  design change.

### Rows are not keys

184 raised keys would be absurd, and the current 77px `btn-ghost` stack is the
result of treating a list like a button bank. A list row is a line on a panel
you can touch, not a key you press.

So rows sit **flush** at chassis level, separated by hairline grooves, with
hover as the affordance rather than a raised fill. `.row` density is the
ancestor, not Tier 2.

**Two lines, not one.** The current row crams status, name, history count and
date onto one line, which in a 316px column truncates the name to roughly
150px — the one thing the operator is scanning by.

```
● Great Is Thy Faithfulness
  4 SERVICES · 2026-07-08
```

Line 1: lamp plus name at 15px. Line 2: mono metadata at 9-10px, `--rf-muted`,
indented to the name's axis — not floating right. Target 36px on pointer, 44px
on touch via the existing `@media (hover: none)` floor. Full name in `title`
since it is the operator's own.

### The status icon becomes a lamp, and loses its colour

Currently `check-circle-2` in `text-success` versus `alert-circle` in
`text-warning` — both retired colours, and part of item 2's sweep.

This is binary: a planned arrangement is on record, or it is not. Absent is not
a fault. So **lit plum LED when a planned arrangement exists, unlit `#302838`
dot when it does not.** No green, no amber. Same vocabulary as the rail's link
lamp, and it gives the list a scannable left column of lit-versus-dark.

Give it the icon column treatment from item 0 — 16px column, 8px lamp centred,
lamp drawn by `::before` so neither state can collapse the column.

### The filter needs a label and a count

`Filter...` is placeholder-only (item in the labels sweep). Silkscreen label
above a recessed input, per the Forms pattern. Add the count beside it in mono
`--rf-muted`: `184 TRACKED`, dropping to the filtered count as they type.

Not phosphor. Phosphor is reserved for the live readout, the meter, Health's
status strip and the Search stats; a filter count is a fourth-tier value and
spreading the emitter further dilutes what it means.

### The list needs a heading

There is none, so nothing says what the list is or how it relates to the plan
above it. Use the standard section heading — mono 10px, 0.16em, uppercase,
`--rf-plum-lit`, hairline underline, 2px lit edge. `TRACKED SONGS` names it;
avoid anything that reads as a duplicate of the plan card.

### The detail view: make the comparison the hero

This is the most substantive change and the reason the screen currently feels
like a form rather than a reconciliation tool.

Right now **actual** renders as a prose line of arrow-joined names while
**planned** is a textarea. One is prose, the other is an edit field, so the two
things the screen exists to compare cannot be compared at a glance.

Put them adjacent in the **same** treatment, stacked in a narrow column, with
the difference marked:

```
ACTUAL · FROM PROPRESENTER
V1 → C → V2 → C → BRIDGE → C

PLANNED
V1 → C → V2 → C
```

Same type, same alignment, same axis, so a divergence is visible as a shape
rather than read as a sentence. The E2 carries both. Editing stays possible —
the planned side can become an input on focus, or keep a Tier 2 edit control —
but the resting state is a comparison, not a form field.

`Run Comparison` takes the detail view's lit collar. Drop "Now" — it is filler.

### The four sub-headings are a fifth heading style

"Actual arrangement (from ProPresenter)", "Section mapping", "Planned
arrangement (one section per line)", "History" are all `text-sm font-semibold`.
Move them to the silkscreen label treatment at 9-10px uppercase, which gives the
detail view the instrument rhythm the rest of the app has.

Both parentheticals are doing different jobs and neither belongs in a label:
"from ProPresenter" is provenance and becomes part of the silkscreen line;
"one section per line" is an input hint and becomes helper text under the field.

### Buttons and copy

Three Tier 2 outline buttons at mixed `btn-xs`/`btn-sm` (`Save Mapping`,
`Save Planned Arrangement`, `Run Comparison Now`). Apply the Forms rule: one
Tier 2 primary per row, everything else a chip. Casing is Title Case here and
sentence case elsewhere in the app — pick sentence case, matching the majority.

Errors on this screen use `text-warning` in five places (`arrangement.js` 157,
282, 303, 307, 311) — retired amber outside Health, and part of item 2.

### Two things to preserve

- The **stale-response guard** at `renderDetail` (`latestRequestedSongId`) is
  load-bearing. Fast clicking through the list would otherwise paint an older
  song's record over a newer one. Do not lose it in a refactor.
- The **reader/logger split** hides the save and comparison controls for readers.
  Keep it; a reader seeing disabled write controls would be worse than not
  seeing them.

---

## 6. POLISH — Disabled controls give no reason

`Check spelling` on Spell Check, `PNG` and `SVG` on QR Codes. All `title: null`.
A `title` is the minimum; helper text near the control is better, since a
tooltip on a disabled button is unreliable on touch.

---

## 7. Only Brandon can close this: the keyboard tab-through

Three authored `:focus-visible` rules exist. **Neither session can verify them** —
`:focus-visible` is a heuristic about input modality, not a media query, and no
synthetic focus satisfies it.

The check: tab from Search through to Go Live and back, in a dark room at low
brightness. If focus disappears anywhere on that path, the Fluent Regular's
keyboard-speed premise is broken and nothing either session can screenshot would
reveal it. Five minutes for a person, impossible for us.

---

## Decisions on record, so they are not re-litigated

- **Two surfaces:** booth (Search, Live) and desk (everything else).
- **Light theme stays.** `system` is the default and resolves to light on any
  machine not in dark mode, so it is the out-of-box rendering for a church
  office computer. Not an opt-in minority. Do not raise dropping it again.
- **Material may be dark-only; signal and accessibility may not.** Contrast,
  hit area, press feedback and whether a component renders cross the theme
  boundary. Gradients, collars and texture do not have to.
- **Nav rail:** 144px pinned, 3.5rem collapsed. A truncated legend is a legend
  that failed.
- **Fault colour:** `#C9922E`, Health only, enforced by selector.
- **`--rf-dim` is a non-text token**, and there is no third text step.
- **An emitter has a hot core; a lit edge does not.** Only emitters count
  against the ceiling of four.
- **Phosphor is for values the machine reports about itself**, never feedback on
  the operator's own action.
- **Occlusion applies to emitted light, not printed ink.**
- **The meter metaphor is for index progress only.**
- **The too-wide callout is setup-only** — and see item 1.4, it is misaimed.
- **Looks and Macros are Tier 3 by design.**
- **Refrain never restyles a name its user wrote.**
- **Texture tiles are CC BY-SA 3.0** by Atle Mo, attributed per tile.
- **Tailwind class names stay utility-flavoured**, with static homes in
  `refrain.css`. Those rules look redundant and must not be tidied away.

---

## Before you measure anything

Read the instrument section of `creative-direction.md`. Six confident wrong
readings happened in two days. The two that will bite you fastest:

- **The pane's animation clock is frozen.** Anything under `transition-all`
  reports its start value forever — including colour. Set
  `transition: none !important`, force a reflow, then measure.
- **Cache-bust the page, not the stylesheet** (`/?r=N#screen`). The pane holds
  the document and the modules independently, so current JS is not evidence of a
  current stylesheet.

Use `offsetHeight` for heights, and make transitioned measurements satisfy an
independent sum.

---

## Constraints, unchanged

Everything in CLAUDE.md applies: core search stays independent, no telemetry, no
silent data loss, no vendor names in shared code, lint clean, tests passing,
`node --check` on touched files, exercise browser-visible changes against a
running dev server, commit only when asked.

Plus: copy is final copy in the right zone, never placeholder.

---

## Status log

`YYYY-MM-DD · <item> · done | partial | blocked · <one line>`

- 2026-08-26 · Palette, radius, status indicators, fault colour · done · 059bf03
- 2026-08-26 · Nav rail, meter, JIT trap documented · done · 62bdcda, 5989346, 433a058
- 2026-08-26 · Texture · done · 633a697
- 2026-08-26 · Rail latching, icons, separators · done · 8765d47
- 2026-08-26 · Wordmark, lit-edge marker, phosphor, hash routing · done · 4016bbd
- 2026-08-26 · Perf-mode indicator + rail specificity bug · done · 4c27425
- 2026-08-26 · Forms pattern, all five sub-pages · done · 5f56e7d, 180db3e
- 2026-08-26 · Tile rename, touch floor restored · done · 6ba9818, 3aeaf24
- 2026-08-26 · Release v0.10.0 · done · c75f9a4
- 2026-08-26 · Icon default, uniform key bank, 100/100 names · done · ae928d4
- 2026-08-26 · Narrow-plus-pointer rule corrected · done · 1b56e5b
- 2026-08-26 · Button spring killed, rail keys stilled · done · 7841005
- 2026-08-26 · Collapsed rail to 3.5rem · done · 66c1a51
- 2026-08-27 · LINKED lamp on the icon axis · done · a97104b
- 2026-08-27 · btn-brand plum in light theme · done · 3b175ce
- 2026-08-27 · Tier heights + touch floor into light theme · done · 6b53a37
- 2026-08-27 · Link lamp printed, not lit, in light theme · done · 14e698e
- 2026-08-27 · Index meter renders in light theme · done · add13de
