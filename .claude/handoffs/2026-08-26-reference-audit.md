# Handoff — full audit against the reference HTML

> **This file is the live handoff from the design/planning session to the
> editing session.** It is always the current one. When a new handoff is
> written it replaces this file wholesale, and the superseded version moves to
> `.claude/handoffs/`. Anything not in here is not part of the brief.
>
> **Editing session:** read [creative-direction.md](creative-direction.md)
> first, then work the items below in order. Append to the Status log at the
> bottom as you go.

Written 2026-08-26 after a full audit of the running build at a docked 460px
against the reference HTML, measuring computed values rather than reading
screenshots. Supersedes
[2026-08-26-texture-and-tail.md](handoffs/2026-08-26-texture-and-tail.md).

---

## What is right, so nobody re-does it

Palette and both junction blocks. The recessed treatment. The latched nav key
with its plum edge. LED-plus-silkscreen status. `--rf-fault` scoped under
`#view-health`. The live readout in glass and phosphor. The lit collar on
`.go-live-btn` only. Plum search highlights. 15px Archivo body, 10px/0.12em nav
legends, 8px group legends. Scored grooves with SERVICE / PREP / SYSTEM. Linen
at 15% / 0.5 / soft-light with the exact spec filter. The segmented meter. The
docked-width nudge.

That is most of the system, and it is correct.

---

## Work, in order

### 1. Global grain — four lines, highest payoff on the list

`body::after` has no background image. The reference lays the chassis tile over
the whole viewport at `opacity: .32`, `mix-blend-mode: soft-light`,
`filter: contrast(.84)`, `background-size: 15%`.

Only cards carry texture today, so the field between them is bare. That is
exactly why the app still reads flat despite texture having shipped — the cards
look like stickers on nothing. Do this first.

Todoist: `CRAFT — No global grain, and three of four materials are unused`

### 2. Framing texture on the rail — Brandon's call on the tile

Use `noisy_net` for the framing role the missing brick was meant to fill. It
failed screening on chroma (mean 9.7), not on grain, and it is coarser than
linen, which is what framing wants. Strip the chroma at render time:

```css
background-size: 17%;
opacity: .26;
mix-blend-mode: soft-light;
filter: saturate(0) contrast(.72) brightness(1.03);
```

`saturate(0)` is the whole trick — grain survives, hue does not. This also
closes the last open item on the nav-rail task: the rail's empty lower half
gets material instead of absence.

### 3. Display type and section headings — the pulse

**These two are the answer to "does it have a pulse."** Everything else on this
list makes the app better; this pair makes it recognisable, and both are cheap.

Only Archivo and Martian Mono are in use anywhere. `main h1` computes 18px /
weight 600 / sentence case. The reference `h1` is the badge face at 46px,
`font-stretch: 118%`, `letter-spacing: -.018em`, uppercase, `line-height: .94`.
Archivo already has the width axis, so no new font file is needed.

Section headings use `card-title text-base` — 16px sentence case with a lucide
icon — where the reference `h2` is Martian Mono 10px / 0.16em / uppercase /
`--plum-lit`, hairline `border-bottom`, and a 5px plum square marker. After the
keys that is the most recognisable element in the reference, and it finally
resolves the four-heading-systems problem from the first review.

One judgement call in the task: the reference's marker glows, which would be a
fifth emitter against a ceiling of four. Render it unlit — a section heading is
not reporting a state.

Todoist: `CRAFT — There is no display type anywhere, and section headings ignore the reference`

### 4. The button tiers — largest structural deviation left

`.nav-item`, `.go-live-btn` and `.btn-ghost` all compute **48px**. DaisyUI's
default, inherited everywhere. The reference separates tiers by size, material
*and* emission; the app separates by material and emission only, so everything
is Tier-1-sized.

Reference: chip ~26px, machined key ~36px, lit collar ~50px.

On a 460px panel this costs real money — nine nav keys eat 432px of height, and
the result action column takes ~250px of width. Same pass: body leading is
15/22.5 where the spec is 15/21.3, and padding is generous too, so the app has
"recover room in padding, never in line height" backwards.

Todoist: `CRAFT — All three button tiers render at 48px; the tier system has collapsed`

### 5. Batch — three reference patterns with obvious homes

Titles wrapping to four lines (fixed for free by item 4 — re-check first), the
Date filter / Libraries void wanting `.btn-chip`, and the absent `.row` and
`.call` patterns.

Todoist: `POLISH — Three reference patterns the app has obvious uses for`

---

## The three questions, as of this audit

- **Would someone who runs a real console respect this?** Close to yes. Keys,
  readout and status are right. Uniform 48px controls and the missing display
  face are what still make it read as an unusually well-made dark web app.
- **Could a nervous volunteer succeed on their second Sunday?** Yes. This is
  now the strongest of the three.
- **Does it have a pulse?** Not yet. Swap the wordmark and it is anonymous.
  Item 3 is the whole answer.

---

## Also open in Todoist, not part of this audit

- `CRAFT — Audit DaisyUI's responsive defaults against a permanently narrow panel`
- `CRAFT — Input is not acknowledged`
- `POLISH — Motion timing, focus rings, reduced motion`
- `Carried forward from the retired UI-consistency pass`
- `Copy — the warm zone is empty` (partially landed; check what remains)
- `Copy — put the Health tooltips on a diet`

---

## Decisions on record, so they are not re-litigated

- **Surface:** always a docked side window. Never maximised.
- **Nav rail:** 144px pinned. A truncated legend is a legend that failed.
- **Fault colour:** `#C9922E`, Health only, enforced by selector.
- **`--rf-dim` is a non-text token.** It fails AA on every surface. And there
  is no third text step — anything between `muted` and `dim` lands within
  0.3:1 of `muted` on `machined`, which nobody can see. When something needs to
  read quieter than `muted`, use size and tracking, not a fainter colour.
- **Occlusion is a depth cue, not a colour cue.** A latched key is already
  recessed; do not darken its legend as well.
- **The meter metaphor is for index progress only.** Never anything binary.
- **The too-wide callout is setup-only.** Never a runtime overlay.
- **Texture tiles are CC BY-SA 3.0**, by Atle Mo, attributed per tile with a
  visible credit. Share-alike is an accepted risk, recorded not resolved.
- **Screen tiles on chroma as well as luminance.** A luminance-only test lets
  hue through, which is how `noisy_net` passed and would have tinted the panel.
- **Tailwind class names stay utility-flavoured**, with static homes in
  `refrain.css`. Those rules look redundant and must not be tidied away.

---

## Constraints, unchanged

Everything in CLAUDE.md still applies: core search stays independent, no
telemetry, no silent data loss, no vendor names in shared code, lint clean,
tests passing, `node --check` on touched files, exercise browser-visible
changes against a running dev server, commit only when asked.

Plus, from the direction: copy is final copy in the right zone, never
placeholder.

---

## Status log

Editing session appends here. One line per task, newest last. Format:

`YYYY-MM-DD · <task title> · done | partial | blocked · <one line>`

- 2026-08-26 · Phase 1 and 2 · done · 72cac6a, 4a5bf52, fbd1fa5, 3d532a4
- 2026-08-26 · Palette, radius, status indicators, fault colour · done · 059bf03
- 2026-08-26 · Nav rail · done · 62bdcda, 144px pinned, nine keys at rest
- 2026-08-26 · Index progress meter · done · 5989346, led-meter.js
- 2026-08-26 · Tailwind JIT trap documented · done · 433a058
- 2026-08-26 · Texture · done · 633a697, two tiles, CC BY-SA, attributed
- 2026-08-26 · Rail latching, icons, separators · done · 8765d47
- 2026-08-26 · Docked-width nudge · done · refrain.css section 17
- 2026-08-26 · CRAFT — No global grain, and three of four materials are unused · partial · body::after carries the chassis tile across the viewport, which is what stops the cards reading as stickers on nothing. Rail framing uses noisy_net with saturate(0), so the grain survives and the chroma does not. Grip still a stand-in; no dedicated grip tile.
- 2026-08-26 · CRAFT — There is no display type anywhere · done · Page titles are Archivo 900 at stretch 118%, uppercase, leading 0.94, clamped to 5.6vw because ARRANGEMENT was being clipped silently at the reference's 46px. Section headings are Martian Mono 10px/0.16em plum-lit with a hairline rule and an unlit 5px marker. Icons dropped from both: the rail already says which screen you are on.
- 2026-08-26 · CRAFT — All three button tiers render at 48px · done · Root cause was a vendoring regression, not a missing tier system: styled.min.css omits every size modifier, so 35 app-used classes did nothing. Full build restored, tiers now 46/34/25 against the reference's 50/36/26, and set explicitly so they cannot drift. Body leading 22.5 to 21.3 (DaisyUI's later `body { line-height: inherit }` was winning).
- 2026-08-26 · POLISH — Three reference patterns · done · .btn-chip row for Date filter and Libraries, .rf-row for field/value pairs, .rf-call applied to the docked-width nudge. Title wrapping fixed for free by the tier work, as predicted: one line now, was four.
