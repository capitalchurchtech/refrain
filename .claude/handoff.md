# Handoff — closing the gap to the reference

> **This file is the live handoff from the design/planning session to the
> editing session.** It is always the current one. When a new handoff is
> written it replaces this file wholesale, and the superseded version moves to
> `.claude/handoffs/`. Anything not in here is not part of the brief.
>
> **Editing session:** read [creative-direction.md](creative-direction.md)
> first, then work the items below. Append to the Status log at the bottom as
> you go.

Written 2026-08-26 by the creative-direction session, after reviewing
`public/refrain.css` and a screenshot of the Health screen against the
reference HTML. Supersedes
[2026-08-26-design-rebuild-phase1-3.md](handoffs/2026-08-26-design-rebuild-phase1-3.md).

---

## Credit where it is due

The foundation is right, and it was the hard part. Vendored dependencies, the
full token ladder, **both** junction blocks, the recessed treatment, Archivo
and Martian Mono, 15px body, the lit collar correctly built on `.go-live-btn`,
a live readout, a link indicator, the em-dash sweep, the warm zone filled.
Phase 1 and Phase 2 are done and the Todoist backlog went from 17 open to 6.

Nothing in this handoff is rework. It is all additive.

---

## The gap, in one sentence

The build adopted the palette and skipped the material. Correct hex values on
flat, soft-cornered surfaces still read as a dark web app, because in the
reference the hue is only half the story and texture and corners are the other
half.

---

## Work, in order

### 1. Radius — three lines, highest payoff on the list

`--rounded-box`, `--rounded-btn` and `--rounded-badge` appear nowhere in
`refrain.css`. There is exactly one explicit `border-radius: 2px` in 580 lines,
so everything else inherits DaisyUI: cards at 16px, buttons at 8px, badges as
full pills.

```css
--rounded-box: 4px;
--rounded-btn: 3px;
--rounded-badge: 2px;
```

The only round things in the entire reference are the knurled knob and the
LEDs, because those are the only round things on real hardware. Do this first;
it changes the feel of every screen for almost no effort.

### 2. Status indicators — Todoist: `CRAFT — Status indicators are built like buttons`

`badge-success` and `btn-success` have byte-identical fill and text colour.
There are no `.badge` rules in `refrain.css`, so the green pills survived the
palette work — and they are now the only green in a violet product, which makes
them the loudest thing on Health rather than the quietest.

LED plus silkscreen, no lozenge. Full spec and the state mapping are in the
task.

**The error-colour question is settled** (Brandon, 2026-08-26): one desaturated
amber, Health only.

```css
--rf-fault: #C9922E;   /* hue 39°, saturation 63% */
```

29° of hue separation from `--rf-go` and 37 points less saturated, so the two
cannot read as the same signal. Clears AA on every Health surface. Three
conditions, all load-bearing:

- **Health only, enforced by selector, not convention.** Scope it under the
  Health view or a dedicated class so it cannot leak onto the live path.
- **It lights, it does not emit.** `box-shadow: 0 0 4px rgba(201,146,46,.7)`,
  one stop, no wide halo. Does not count against the four-emitter ceiling.
  Never pulses.
- **Never a fill.** Dot plus label. No lozenge, no pill, no filled badge.

Full reasoning is in a comment on the Todoist task and in
[creative-direction.md](creative-direction.md) under "The one exception: fault,
on Health only".

### 3. Nav rail — Todoist: `CRAFT — The nav rail reads as a void, not a machined panel`

Superseded by its own task, because Brandon called it out directly: "should
feel like a machined part not a void. Each button should feel real. Expanded
labels are really weird."

The recessed key legends and the silkscreen label sizing already landed and are
right. Four things remain, three of them unblocked:

1. **Icons are 24px next to a 9px label.** `nav.js:144` renders the lucide icon
   with no size class, so it defaults to 24×24 while everywhere else in the app
   passes `w-4 h-4`. Fix: `class="shrink-0 w-4 h-4"`.
2. **Labels are in the wrong typeface.** `refrain.css:611` uses `--rf-mono`.
   Mono is for data — numbers, counts, timestamps. `SPELL CHECK` is a legend.
   Martian Mono is wide to begin with, so uppercase plus 0.15em eats the rail.
   Move to `--rf-sans` at 10px / 0.12em.
3. **Only the active key exists.** All eight others are `btn-ghost`, invisible
   at rest. That is the void. Every `.nav-item` gets the Tier 2 machined
   treatment at rest; the active one keeps its lift plus the plum. "One E2 per
   screen" governs the hero and the emitter, not whether objects exist.
4. **The rail has no material.** The right-edge junction is unblocked and does
   a lot on its own. The brick framing texture is blocked with the rest of the
   texture work.

### 3b. Index progress meter — Todoist: `Feature — Segmented LED meter for index progress`

A segmented LED ladder for index builds, in setup and in Health's Search Index
card. This is the **only** place a meter metaphor is honest, because it is the
only place a real quantity varies. A permanent global sync bar was considered
and rejected: fifth emitter against a ceiling of four, and it would compete
with the live readout for the most valuable glance in a narrow panel.

Also retires the `Indexing (fingerprint)...` stage-name leak at `setup.js:147`.

### 4. Move the lit collar off Reindex — same task, item 4

The Health screen currently puts the plum collar around "Reindex changed only."
Health should not have a lit collar at all. E2 is "the one thing the screen
exists for," and nothing on Health goes to a screen. This is the single
clearest reason that screenshot reads as decorated rather than instrumented.

### 5. Texture — same task, item 1. BLOCKED

`mix-blend-mode`: 0 occurrences. `soft-light`: 0. No tile anywhere.

This is the largest remaining gap and the reason the screens still look flat.
Texture modulates light; the palette owns hue. Only half that pair exists.

**Blocked on licence provenance.** Candidate tiles are in `~/Downloads`
(`black_linen_v2.png`, `noisy_net.png`, `real_cf.png`, `dark_leather.png`,
`denim.webp`, `fake_brick.png`) with nothing established. This ships open
source; a CC-BY tile with no attribution is a real problem, not a footnote.
Do not inline any tile until its licence is known and recorded.

### 6. Regression from the em-dash sweep

`public/health.js:845` ships as "Watching 2 library folders **.** Edited
presentations reindex on their own." The dash went, the surrounding space
stayed. Grep for `" . "` in case there are siblings.

---

## Still open in Todoist, unchanged by this handoff

- `CRAFT — Input is not acknowledged`
- `POLISH — Motion timing, focus rings, reduced motion`
- `Carried forward from the retired UI-consistency pass`
- `Copy — the warm zone is empty` (partially landed; check what remains)
- `Copy — put the Health tooltips on a diet`
- `Feature — Too-wide callout when Refrain is not docked` — still carries an
  open question: runtime or setup-only. Runtime is funnier; setup-only cannot
  possibly interrupt a service. Do not pick unilaterally.

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

- 2026-08-26 · Phase 1 and 2 · done · see commits 72cac6a, 4a5bf52, fbd1fa5, 3d532a4
- 2026-08-26 · Radius · done · --rounded-box 4px, --rounded-btn 3px, --rounded-badge 2px. Applied to every theme: a corner radius is form language, not a dark-mode skin.
- 2026-08-26 · CRAFT — Status indicators are built like buttons · done · LED plus silkscreen, no lozenge. Lit for present, dark dot for absent, so lit-versus-dark scans in one glance. health.js:1030 is a Tier 3 chip rather than a button in badge clothing. Fault implemented per Brandon's decision: #C9922E, scoped under #view-health by selector, one shadow stop, never a fill. Verified in situ on a real Diagnose PROBLEM finding.
- 2026-08-26 · CRAFT — The surface layer is missing · partial · Radius and nav rail done, collar moved off Health. Texture still blocked, and the candidate tiles are no longer in ~/Downloads.
- 2026-08-26 · Nav rail · done · Silkscreen labels, recessed number chips, active item raised, 224px to 128px pinned. Two bugs found on the way: the pinned width would not apply through a Tailwind utility at all, so refrain.css owns it at #id.class specificity; and at 9px the longest legends wrapped under their icons, so labels are 8px, still inside the 8-10px band, with the tracking untouched.
- 2026-08-26 · Lit collar off Reindex · done · Health now has no collar at all. Nothing on that screen goes to a screen.
- 2026-08-26 · Em-dash regression · done · One instance, health.js:845. Grepped for siblings, no others.
