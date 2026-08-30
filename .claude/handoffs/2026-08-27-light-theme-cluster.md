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

## 1a. CRAFT — 29% of the window is dead space, and the brief caused it

Brandon: "the main section is centered instead of hugging the left menu, that
means wasted pixels on dead space."

Measured at 1280px, transitions disabled, sum check passing:

```
rail 144  +  main 768  +  dead 368  =  1280      368px = 28.7%
```

`#main-content` is flush against the rail — `gapRailToMain` is 0, so it is not
literally centred. But content stops at `max-w-3xl` (768px) regardless of window
width, and a column with a rail on one side and a 368px void on the other reads
as adrift. The perception is right even though the mechanism is not centring.

**The cap is doing two jobs, which is why deleting the class is not the fix.**

- **Reading measure** for slide text and explanatory prose. Legitimate — and
  there are **no element-level measure caps anywhere in `refrain.css`**, so the
  container is the only thing providing it. Remove it naively and slide text
  runs to 1136px, which is worse.
- **Constraining everything else.** Accidental and harmful.

**It costs more than pixels.** Live's key bank is `grid-cols-2 sm:grid-cols-3`
(`live.js:133`, `:138`) — capped at three columns. With the full width it takes
four or five, putting 34 tiles in seven rows instead of twelve, on the screen
where scrolling costs most.

### The fix

1. **Drop the container cap.** Content hugs the rail and fills the width.
2. **Put measure on the elements that need it**, not the container: slide text
   in search results and explanatory copy at roughly 70ch. This has to land in
   the same change as (1) or reading gets worse.
3. **Let the grids grow.** Live's key bank to four or five columns at width.
   Arrangement's rows can return to one line when there is room for name plus
   metadata, falling back to two lines when docked.
4. **Re-aim the too-wide nudge.** It currently fires at setup, which is exactly
   when a wide window is correct. It belongs on the booth path and should say
   to dock before a service, not that the setup is wrong.

### The brief was the root cause, and it is amended

The project card said *always a docked side window; a wide viewport means the
operator has it set up wrong.* That was written from the Reluctant Operator's
persona and applied to all three, so the container was sized for a booth panel
on screens that are never used in one.

**There are two surfaces.** BOOTH: Search and Live, docked, narrow, during a
service. DESK: Health, Setup, Image Crop, QR Codes, Arrangement — a normal
window, at a desk, unhurried. Material, palette, tiers and voice are identical
across both; only the width assumption changes.

Amended in `creative-direction.md` under Project card and Operating conditions.

## 1a-ii. CRAFT — Make the latched nav key present, without a fifth emitter

Brandon asked whether the current nav item's icon and text could glow.

**Not glow.** Emission marks what the machine reports about itself; which screen
you are on is the operator's own navigation, not a machine state. Glowing it is
the same category error as glowing a filter count, settled on provenance. And a
latched key does not brighten — light never increases on press.

**But the instinct is right: the active key is not present enough.** Three
changes, none of which spends an emitter:

1. **Give the lit edge its bleed.** It is a flat `inset 2px 0 0 var(--rf-plum)`.
   The section markers already use a soft lateral bleed with no hot core, which
   is a lit edge rather than an emitter and therefore free:
   `box-shadow: inset 2px 0 0 var(--rf-plum), 0 0 6px rgba(169,111,232,.30);`
2. **Widen the edge** from 2px to 3px. Presence, no light.
3. **Take the legend and icon to `--rf-text`.**

**Item 3 corrects an earlier ruling of mine.** I said the latched key's label
must stay at `--rf-muted` because a bottomed-out key occludes its own light.
That was wrong: **occlusion applies to emitted light, not printed ink.** A
silkscreen legend does not dim when the key is pressed. Brightening it was
available all along and is the closest honest thing to what was asked for.

## 1a-iii. CRAFT — Every screen is a destination with no onward path

The connective tissue between screens has never been designed. Each of the nine
is an island: nothing says what to do next, so the operator has to know the
product to keep moving.

- **Spell Check** flags a word, jumps to ProPresenter to fix it, and stops. No
  "next flagged word", so a playlist with nine typos is nine round trips the
  operator drives manually.
- **Lyrics** splits slides and ends on "copy each into a new presentation."
  No path back to Search to confirm it landed.
- **Arrangement** finds drift, pushes the correction, and stops.
- **Search is the hub and nothing visibly returns to it.** There is a `/`
  shortcut the Fluent Regular knows and the Reluctant Operator never will.

**The fix is not a breadcrumb.** Every screen should end on the next action, the
same way the voice rules already require of copy — "end on the action, not the
limitation." Spell Check gets `Next flagged word`. Lyrics gets a way back to
Search once slides are built. Continuity built out of the work rather than out
of chrome.

**Also: scroll position should persist per screen.** Verified reset. Query and
results *do* survive navigation — leave Search for Health and come back and the
query and all 117 results are intact, which is good and should not be disturbed.
Only scroll is lost, and returning to the top of 117 results mid-service is the
one thing that makes the app feel like a website rather than a tool.

**And explicitly do not add a page transition.** Instant is correct. Perceived
power is almost entirely latency, and a crossfade between screens buys
atmosphere at the cost of the thing that makes an operator trust the tool. The
direction says nothing animates on the path to live; extend that to navigation.

## 1b. CRAFT — Tier heights into light theme (heights only)

Found while fixing item 1. In light theme `.btn-brand` computes
`min-height: 32px`, because the tier heights are dark-scoped — so light theme's
primary action, Go Live included, sits **below the 44px touch floor**.

**Ruled: extend the tier heights into light theme. Heights only, not the tier
system.** The parallel with item 1 is exact — a touch target is accessibility,
not surfaces-and-neutrals, so the "light is left to DaisyUI" concession does not
cover it, for the same reason it did not cover a failing contrast ratio.

But the concession does still cover **material**. Light theme does not need the
anodized cap gradient, the collar, the junction blocks or the texture; a light
panel is not a machined one and pretending otherwise would be two products.

So the split, now recorded in the direction: **material may be dark-only, signal
and accessibility may not.** Take the three tier heights and the touch floor
across. Leave the gradients, collars and junctions where they are.

Smaller than item 1 and the same shape, so it should be quick.

## 1c. CRAFT — The link lamp reads backwards in light theme

Flagged by the editing session as material and therefore out of scope for 6b53a37.
I measured it and it is not material — it is an inverted signal, which by the
boundary in item 1b crosses into light theme.

The LED rules were never theme-scoped, so light theme keeps the dark treatment.
Against the light rail at `#F2F2F2`:

| | contrast |
|---|---|
| lit core `#EDE0FF` | **1.12:1** — effectively invisible |
| unlit `#302838` | **12.62:1** — bold |
| plum `#8446C9` | 5.07:1 |

So in light theme **`LINKED` is not a quiet dot, it is no dot at all** — an
empty space with a soft plum halo around nothing — while lost link is a strong
dark dot.

**Corrected diagnosis** (the editing session caught this and was right): it is
not a polarity bug. I first wrote that the loud state had come to mean normal,
which contradicts itself — if lost link is the loud one, the instinct is working.
The real failure is that at 1.12:1 the operator sees nothing and cannot tell
whether that means linked or means the indicator is broken. An invisible lamp
fails **silently**, which for the one control the quality floor names is the
worse mode. A mis-polarised lamp at least reports something.

**Fix: on a light panel a status lamp is printed, not lit.** Lit becomes a solid
`--rf-plum` fill at 5.07:1; unlit becomes a hollow ring or a pale dot. Ink where
the dark theme has light. Keep the 16px column and the `::before` lamp from
item 0 — only the fill and the shadow change.

Not filed higher than CRAFT because light theme is not the booth condition, and
the direction says a warm-graphite object does not really have a light mode. But
it is the link indicator, which is the one thing the quality floor singles out,
so it should not sit behind the semantic sweep.

**Also left deliberately and genuinely material, so not an item:** light theme's
section headings stay sentence-case bold rather than mono silkscreen. That one is
appearance, and the concession covers it.

## 1d. CRAFT — The index meter is entirely invisible in light theme

Flagged by the editing session as the same trap as item 1c. It is, and it is
worse. Verified in `refrain.css`:

- `.rf-meter-cell` (1227) is unscoped and declares only `flex`, `min-width` and
  `border-radius` — **no background.**
- `[data-theme="dark"] .rf-meter-cell` (1233) carries the unlit fill.
- `[data-theme="dark"] .rf-meter-cell.lit` (1241) carries the lit fill
  (`--rf-neon-plum`) and the two-stop glow.

So in light theme **both** states fall through to a rule with no background.
Lit and unlit are identically transparent: the meter does not render at all.
During the longest wait in the product, a light-theme operator sees a 14px empty
strip and a count, with no progress indication whatsoever.

Worse than the lamp, which at least had one visible state. Same root cause —
fills scoped to dark with no light fallback — and the same fix shape: on a light
panel the lit cell is a solid `--rf-plum` fill and the unlit cell is a pale
recessed grey. Ink where the dark theme has light.

Note the editing session's detail was slightly off (they had the lit cell as
`#EDE0FF`-family; it is `#C79BFF`) but the instinct was right and the real
finding is more severe than the one reported. Worth doing 1c and 1d together
since they are one mistake in two places.

**Then sweep for the general case:** any two-state indicator where both fills
are dark-scoped. A signal with one legible state is not a signal, and one with
none is furniture.

## 1e. NOTE — A prior question for Brandon: should light theme exist?

Raised because the cost of keeping it is now measurable rather than theoretical.

**Four of the last six commits were light-theme defects, and three were on Go
Live:** `btn-brand` carrying a known 3.01:1 AA failure the dark theme had been
rebuilt around; Tier 1 at 32px, below the touch floor; the spring removal taking
light theme's only press feedback with it; then the link lamp invisible and the
index meter absent entirely.

None were cosmetic. Every one sat in the category we established crosses the
theme boundary — contrast, touch target, press feedback, signal legibility. And
each surfaced while fixing the previous one, reactively, which is the pattern
that says there are more.

The editing session's summary is the honest one: **light theme was never
verified rather than never designed.**

**RESOLVED 2026-08-27: light theme stays. Do not raise dropping it again.**

The question is answered by the code, not by preference. `prefs.theme ?? "system"`
is the default when the key is unset (`nav.js:121`, `main.js:37`), and `system`
resolves `prefers-color-scheme: dark ? dark : light` (`nav.js:62-69`). So
**light theme is the out-of-box rendering for any machine not already in dark
mode** — a church office computer in daylight, which is the Installer's
condition and a first-class persona in this document.

My earlier framing of it as an opt-in minority was wrong. It is a default path,
and dropping a default is not a quality improvement.

One piece of evidence deliberately **not** relied on: `config.json` on this
install reads `"theme": "light"`, but its mtime is after both sessions were
verifying light theme with the persisting toggle, so it cannot be attributed to
a user choice. Do not build an argument on it.

So the verification pass is the answer to the ongoing tax, not deletion. The
options below are kept only to record why the question was closed.

**(a) Keep it, and pay for it.** A deliberate pass with resolved-value
assertions per component — not a visual sweep, since four of these were
invisible to the eye in the theme we work in. Plus ongoing cost: every future
change to a dark-scoped signal rule needs the light check, forever.

**(b) Drop it.** Reduce the cycle to system / dark / Blackroom, where system
resolves to dark. That permanently closes a class of defect that has produced
five accessibility failures on the primary action, on a product whose stated
operating condition is a dark room at low brightness, and whose own direction
says a warm-graphite machined object does not really have a light mode.

I lean (b), but it turns on something only Brandon knows: whether anyone
actually runs Refrain in light theme. If a church office uses it at a desk in
daylight, (b) is user-hostile and (a) is the answer. If it exists because
DaisyUI shipped with it, deleting it is the cheapest quality improvement
available.

If (a), it becomes a real item with the resolved-value approach. If (b), items
1c and 1d stay done and the rest of the class disappears.

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
