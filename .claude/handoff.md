# Handoff — the tail

> **This file is the live handoff, and now the only record of findings.**
> Findings are written here rather than in a tracker, with severity in the
> heading. When a new handoff replaces this one the old version moves to
> `.claude/handoffs/`. Anything not in here is not part of the brief.
>
> **Editing session:** read [creative-direction.md](creative-direction.md)
> first, then work the items below in order. Append to the Status log as you go.

Written 2026-08-26. Supersedes
[2026-08-26-reference-audit.md](handoffs/2026-08-26-reference-audit.md), every
item of which is done.

The older Todoist project is **archive**. Do not add to it and do not assume a
task there is still live — several are stale or were superseded by decisions
recorded below.

---

## Where this stands

`v0.10.0` shipped. Since the last handoff: the rail specificity bug that was
charging the rail's width twice and leaving every screen under half its column;
the inverted performance-mode indicator; hash routing; the touch-target floor
that had been dead since the tier heights outranked it; the Forms pattern across
all five sub-pages; the engraved wordmark; the lit-edge section markers;
phosphor on values; the icon-size default; a uniform 44px key bank; and an
accessible name on all 100 inputs.

The three questions, honestly:

- **Would someone who runs a real console respect this?** Yes, now.
- **Could a nervous volunteer succeed on their second Sunday?** Yes. The
  strongest of the three.
- **Does it have a pulse?** Yes. The wordmark, the display titles and the
  section markers carry it.

What remains is tail, plus one thing only a person can do.

---

## 0. CRAFT — The `LINKED` lamp is off the icon axis

Brandon spotted this; my icon audit missed it because I queried `svg` and
`[data-lucide]` and the LED is neither.

Measured from the rail's left edge, pinned:

| | glyph left | glyph width | glyph centre | label left |
|---|---|---|---|---|
| every icon row | 12 | 16 | **20** | 36 |
| `#link-row` | 8 | 8 | **12** | 24 |

`#link-row` is `flex items-center gap-3 px-2 h-7` with a bare 8px dot, so
8 padding + 8 dot + 8 gap puts the label at 24. The icon rows are 12 + 16 + 8 =
36. The lamp is 8px off the icon axis and the word is 12px left of every other
label, which is why it reads as drifting rather than just small.

Fix: give the LED the same 16px column an icon occupies, with the 8px lamp
centred inside it, and match the row's left padding.

```css
#link-row { padding-left: 12px; }
#link-led {
  width: 16px; height: 16px;
  display: grid; place-items: center;
  background: none; box-shadow: none;   /* move to ::before */
}
#link-led::before {
  content: ""; width: 8px; height: 8px; border-radius: 50%;
  background: var(--rf-neon-plum-core);
  box-shadow: 0 0 6px var(--rf-neon-plum), 0 0 15px rgba(199,155,255,.7);
}
```

Lamp centre lands at 20, label at 36 — identical to every row above.

**While in there:** check the unlit state keeps the 16px column, and check the
collapsed rail, where the icon rows get extra left padding to centre a 16px
glyph in the narrow rail. The lamp needs the same treatment or it will drift
again in the other state.

## 1. CRAFT — `btn-brand` renders green in light theme

**Ruled 2026-08-26: this is a bug, not a scope question.**

The "light theme is left to DaisyUI" concession covers *surfaces and neutrals*.
The reasoning was that a warm-graphite machined object does not really have a
light mode, so its ground, panels and hairlines are not worth inventing twice.
It was never a concession on signal colours.

`btn-brand` is a project-authored class, ours in every theme. Green is not in
the palette — it was retired. So this is the retired colour surviving in the one
place it matters most: the primary action, including Go Live. An operator on
light theme sees a green Go Live in a product where green means nothing and plum
means armed.

Plum in both themes. The wordmark needed a light-specific ramp because a
specular highlight cannot exist on a light panel — that was real physics. A
button fill has no such constraint.

Do this first: small, and on the live path.

## 2. CRAFT — Finish the semantic colour sweep

Raw DaisyUI semantic colours remaining, by file: `health.js` 44,
`arrangement.js` 19, `library-sync.js` 8, `setup.js` 6, `search.js` 2,
`live.js` 2, `error-boundary.js` 2.

Health's 44 are largely the migrated fault/status vocabulary doing its job —
check before changing. The others are the unfinished half of the sweep that
started with the performance-mode indicator.

Sweep **by concept, not by screen**: find every place the app reports a state,
decide what the state is, apply the one vocabulary. Doing it screen by screen is
what left the inverted dot in place while Health looked finished.

## 3. CRAFT — Arrangement: the list-and-compare pattern

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

## 4. POLISH — Disabled controls still give no reason

`Check spelling` on Spell Check, `PNG` and `SVG` on QR Codes. All `title: null`.
A `title` is the minimum; helper text near the control is better, since a
tooltip on a disabled button is unreliable on touch and QR Codes has the space
beneath its preview.

---

## 5. Only Brandon can close this: the keyboard tab-through

Three authored `:focus-visible` rules exist. **Neither session can verify them.**
`:focus-visible` is a heuristic about input modality, not a media query, and no
synthetic focus satisfies it — both sessions drive the browser the same way and
both fail identically.

The check: tab from Search through to Go Live and back, in a dark room at low
brightness. If focus disappears anywhere on that path, the Fluent Regular's
keyboard-speed premise is broken, and nothing either session can screenshot
would reveal it.

Five minutes for a person. Impossible for us. The quality floor asks for
keyboard operability end to end, so this is the one open item standing between
the app and that claim.

---

## Decisions on record, so they are not re-litigated

- **Surface:** always a docked side window. Never maximised.
- **Nav rail:** 144px pinned. A truncated legend is a legend that failed.
- **Fault colour:** `#C9922E`, Health only, enforced by selector.
- **`--rf-dim` is a non-text token**, and there is no third text step. Quieter
  than `muted` is achieved with size and tracking, not a fainter colour.
- **Occlusion is a depth cue, not a colour cue.** A latched key is already
  recessed; do not darken its legend too.
- **An emitter has a hot core; a lit edge does not.** Only emitters count
  against the ceiling of four.
- **Phosphor is for values, not labels.** The number glows; the word does not.
- **The meter metaphor is for index progress only.** Never anything binary.
- **The too-wide callout is setup-only.** Never a runtime overlay.
- **Looks and Macros are Tier 3 by design.** `h-20` was inert and stays gone;
  the 44px floor covers touch.
- **Refrain never restyles a name its user wrote.** No case transform, no
  abbreviation; clamp with the full name in `title`.
- **Texture tiles are CC BY-SA 3.0** by Atle Mo, attributed per tile. Share-alike
  is an accepted risk, recorded not resolved.
- **Screen tiles on chroma as well as luminance.**
- **Tailwind class names stay utility-flavoured**, with static homes in
  `refrain.css`. Those rules look redundant and must not be tidied away.

---

## Constraints, unchanged

Everything in CLAUDE.md still applies: core search stays independent, no
telemetry, no silent data loss, no vendor names in shared code, lint clean,
tests passing, `node --check` on touched files, exercise browser-visible changes
against a running dev server, commit only when asked.

Plus: copy is final copy in the right zone, never placeholder.

---

## Status log

One line per item, newest last. Format:

`YYYY-MM-DD · <item> · done | partial | blocked · <one line>`

- 2026-08-26 · Palette, radius, status indicators, fault colour · done · 059bf03
- 2026-08-26 · Nav rail, meter, JIT trap documented · done · 62bdcda, 5989346, 433a058
- 2026-08-26 · Texture · done · 633a697, two tiles, CC BY-SA, attributed
- 2026-08-26 · Rail latching, icons, separators · done · 8765d47
- 2026-08-26 · Wordmark, lit-edge marker, phosphor, hash routing · done · 4016bbd
- 2026-08-26 · Perf-mode indicator + rail specificity bug · done · 4c27425
- 2026-08-26 · Forms pattern, all five sub-pages · done · 5f56e7d, 180db3e
- 2026-08-26 · Tile rename, touch floor restored · done · 6ba9818, 3aeaf24
- 2026-08-26 · Release v0.10.0 · done · c75f9a4
- 2026-08-26 · Icon default, uniform key bank, 100/100 accessible names · done · ae928d4
- 2026-08-26 · Narrow-plus-pointer rule corrected · done · 1b56e5b
- 2026-08-26 · Killed DaisyUI's button-pop spring, stopped rail keys travelling · done · 7841005
- 2026-08-26 · Collapsed rail to 3.5rem, glyphs centred by construction · done · 66c1a51
