# Handoff — texture, and the tail

> **This file is the live handoff from the design/planning session to the
> editing session.** It is always the current one. When a new handoff is
> written it replaces this file wholesale, and the superseded version moves to
> `.claude/handoffs/`. Anything not in here is not part of the brief.
>
> **Editing session:** read [creative-direction.md](creative-direction.md)
> first, then work the items below. Append to the Status log at the bottom as
> you go.

Written 2026-08-26. Supersedes
[2026-08-26-closing-the-gap.md](handoffs/2026-08-26-closing-the-gap.md), every
item of which is now done. Texture is unblocked and is the last real gap.

---

## Where this stands

The visual rebuild is essentially complete, verified in the tree rather than
taken on report:

- Radius overridden at `refrain.css:71-73` — 4px / 3px / 2px.
- Status indicators are LED plus silkscreen, with `--rf-fault #C9922E` scoped
  under `#view-health` by selector, one shadow stop, never a fill.
- The nav rail is nine real machined keys, active one lifted with a plum left
  edge, 2px press, 16px icons, Archivo legends at 144px pinned.
- The segmented meter exists as its own module, `public/led-meter.js`.
- The lit collar is on `.go-live-btn` only. Health has none.
- Both stage-name leaks and the `" . "` copy regression are gone.
- All six JS-applied Tailwind utilities have static homes.
- v0.8.0 released.

Answering the three questions honestly: **would someone who runs a console
respect this** is now plausibly yes, where a day ago it was no. The remaining
gap is material, not structure.

---

## 1. Texture — UNBLOCKED, and it is the only real gap left

`mix-blend-mode`: 0 occurrences. `soft-light`: 0. No tile anywhere.

Every surface is still a flat colour field. The palette owns hue; texture
modulates light. Only half that pair exists, and it is the difference between
correct colours on flat panels and a machined object.

Four layers, per the direction: chassis woven at 15% soft-light on panels, grip
on the hero, brick at ~26% on the framing including the nav rail, glass left
smooth.

**Provenance answered (Brandon, 2026-08-26): Subtle Patterns, all CC-BY.** The
files still need re-downloading — `~/Downloads` holds no images — but they are
recoverable from source rather than lost.

CC-BY makes attribution a licence condition, not a courtesy, and there are
three ways to get it wrong:

- **Attribute the individual designer, not the site.** Subtle Patterns
  aggregates work from many contributors, so "from Subtle Patterns" attributes
  the wrong party. Record per tile: pattern name, author, source URL, licence
  version, licence link.
- **Check BY versus BY-SA per tile.** The collection has carried both. Plain
  CC-BY sits fine alongside an MIT project; share-alike on an asset compiled
  into a stylesheet raises questions nobody wants to answer later. If a tile is
  BY-SA, replace it rather than reason about it.
- **Keep them as files, not base64.** `public/vendor/textures/` with rows in
  `public/vendor/README.md`, matching the existing table for fonts and
  libraries. The reference HTML inlines its tiles only because it had to be one
  portable document. A data URI separates the asset from its attribution, and
  the comment is the half that gets deleted.

Re-measure luminance after downloading. The figures in the direction (linen
5.5, noisy net 6.3, carbon 8.6, leather 11.0, denim 14.1) were taken on files
that no longer exist — treat them as which tiles to look for, not as verified
properties of the ones you get. Target is under 12% luminance range.

---

## 2. Open in Todoist, all unblocked

- `CRAFT — Audit DaisyUI's responsive defaults against a permanently narrow
  panel` — new, and a good generalisation from the editing session's own
  `.alert` fix. DaisyUI's defaults assume a page that is sometimes narrow;
  this is a panel that is always narrow, so every "mobile" branch was tuned
  for the wrong thing. Screenshot at each width rather than checking
  `scrollWidth` — the rail's `flex-wrap` bug proved measurement misses layout
  faults.
- `CRAFT — Input is not acknowledged`
- `POLISH — Motion timing, focus rings, reduced motion`
- `Carried forward from the retired UI-consistency pass`
- `Copy — the warm zone is empty` (partially landed; check what remains)
- `Copy — put the Health tooltips on a diet`
- `Feature — Too-wide callout when Refrain is not docked` — still carries an
  open question: runtime or setup-only. Runtime is funnier; setup-only cannot
  possibly interrupt a service. **Do not pick unilaterally.**

---

## 3. Decisions on record, so they are not re-litigated

- **Surface:** always a docked side window. Never maximised.
- **Nav rail:** 144px pinned, not the ~120px originally targeted. At 128px both
  `ARRANGEMENT` and `THEME: DARK` ellipsised, and a truncated legend is a
  legend that failed. Still returns 80px versus the 224px it replaced.
- **Fault colour:** `#C9922E`, Health only, enforced by selector. The one
  exception to reserving saturated warm for live. See creative-direction.md.
- **The meter metaphor is for index progress only.** Not for anything binary.
  A permanent global sync bar was considered and rejected: fifth emitter
  against a ceiling of four, and it would compete with the live readout for the
  most valuable glance in a narrow panel.
- **Tailwind class names stay utility-flavoured** rather than moving to
  semantic hooks. The static homes in `refrain.css` are what make them work,
  and the CLAUDE.md comment is what protects those from being tidied away.

---

## 4. Not a task, needs Brandon

Vendoring solved offline but kept the runtime cost:
`public/vendor/tailwind-cdn.js` is 407KB of browser JIT, so utilities are still
generated by scanning the DOM. Compiling a stylesheet would remove the flash of
unstyled content, drop 407KB from every load, and make dynamic classes reliable
by construction rather than by convention.

That is a build step, which CLAUDE.md deliberately avoids. Brandon's call.

---

## Constraints, unchanged

Everything in CLAUDE.md still applies: core search stays independent, no
telemetry, no silent data loss, no vendor names in shared code, lint clean,
tests passing, `node --check` on touched files, exercise browser-visible
changes against a running dev server, commit only when asked.

Plus, from the direction: copy is final copy in the right zone, never
placeholder. And every texture tile licence-checked before release.

---

## Status log

Editing session appends here. One line per task, newest last. Format:

`YYYY-MM-DD · <task title> · done | partial | blocked · <one line>`

- 2026-08-26 · Phase 1 and 2 · done · commits 72cac6a, 4a5bf52, fbd1fa5, 3d532a4
- 2026-08-26 · Palette, radius, status indicators, fault colour · done · 059bf03
- 2026-08-26 · Nav rail · done · 62bdcda, 144px pinned, nine keys at rest
- 2026-08-26 · Index progress meter · done · 5989346, own module led-meter.js
- 2026-08-26 · Tailwind JIT trap documented · done · 433a058
- 2026-08-26 · Texture · unblocked · Subtle Patterns, CC-BY; files need re-downloading, attribution per tile
