# Handoff — design rebuild work order

Written by the creative-direction session on 2026-08-26. Read
[creative-direction.md](creative-direction.md) first; it is the standing brief
and everything below is downstream of it.

Full findings with real values live in Todoist, project **IT › Refrain Feature
Request** (17 open tasks). This file is the sequencing and the decisions, not a
restatement of the findings.

---

## What happened

A full review of the current build against the creative direction. Ran the app
on :3050, measured computed styles and contrast rather than eyeballing, walked
the flow as the Reluctant Operator, the Fluent Regular and the Installer.

The verdict on the three questions:

- **Would someone who runs a real console respect this?** No. It reads as a
  competent Tailwind admin panel in dark mode.
- **Could a nervous volunteer succeed on their second Sunday?** Mostly. But
  they cannot tell whether their press worked or whether the tool is still
  connected, which is exactly where nerves live.
- **Does it have a pulse?** No. Swap the wordmark and nothing identifies it.

An earlier pass of ten UI-consistency tasks was **retired** (completed in
Todoist, not deleted). Most of what it described — four heading styles, five
disclosure patterns, three input sizes, card-versus-flat — dissolves once
there is a real material and elevation system, so fixing it first would be work
done twice. The behavioural and copy items that survive were consolidated into
the task "Carried forward from the retired UI-consistency pass". Do not work
from the retired tasks.

---

## Two things that block other work

Settle these before starting, because both change what the rest of the backlog
looks like.

### 1. The CDN decision

`public/index.html:9-10` loads Tailwind from `cdn.tailwindcss.com` (the browser
JIT build, which its own docs exclude from production) and DaisyUI as a 2.9MB
file from jsdelivr. Nothing is vendored.

A booth machine without internet renders the app completely unstyled during a
service. Separately, this caps the visual work: a real palette, junction
shadows, self-hosted fonts and texture tiles all want either a build step or a
vendored stylesheet.

CLAUDE.md states plain ESM with no build step as an explicit value. If that
holds, the answer is **vendoring the two stylesheets and the fonts into
`public/`**, not adding a bundler. Decide before touching the palette or type
tasks.

### 2. The nav rail on a docked surface

The surface is confirmed: **always a docked side window beside ProPresenter.**
Never maximised. The project card in creative-direction.md has been updated.

With the rail pinned open it takes 224px of the panel. At a real dock width
that is a large fraction of a tool whose job is one search box and one Go key.
Worth asking whether the rail should be pinnable at all on this surface, or
whether it collapses permanently and the Fluent Regular navigates by the
existing Cmd/Ctrl+1–9 shortcuts.

This is a product decision, not a finding, so it is deliberately not a Todoist
task. It affects the elevation and hero work materially.

**Decided 2026-08-26: narrower pinned rail.** Pinning stays, but the pinned rail
is redesigned much narrower - icons plus 8-10px silkscreen labels at 0.15em
tracking instead of full-size text, targeting ~120px rather than 224px. Keeps
the Reluctant Operator's visible labels without spending a fifth of a docked
panel on them. Belongs with the Phase 3 type work, since the labels are the
silkscreen treatment.

---

## Suggested order

**Phase 1 — the two BLOCKERs.** Live-safety, not styling. Independent of the
CDN decision, so they can start immediately.

- `BLOCKER — Go Live produces no result, and nothing ever shows what is live`
- `BLOCKER — Connection state is a page-load snapshot with no always-visible
  indicator`

Do the live readout first. It is the reason no screen currently has an E2:
there is no live state to build a hero around. Everything in Phase 3 gets
easier once it exists.

**Phase 2 — the copy pass.** Fully independent of everything else; can run in
parallel with Phase 1 by a different hand.

- `Copy — remove the 125 em dashes and the LLM constructions`
- `Copy — the warm zone is empty`
- `Copy — put the Health tooltips on a diet`
- `Copy — dedupe strings and drop the cold-zone hedges`

The em dash sweep is mechanical and safe. The warm-zone task is the one that
gives the product a pulse, and it is small: four places, a handful of lines.

**Phase 3 — the visual layer.** Gated on the CDN decision. Do in this order,
because each depends on the one before.

1. `CRAFT — Surfaces do not separate, and the palette is cold` — the palette
   ladder and the junction shadow blocks. Everything else sits on this.
2. `CRAFT — There is no elevation model` — recessed / flush / E1 / E2.
3. `CRAFT — Every screen has zero heroes or many` — one E2 and one lit collar
   per screen. Needs the readout from Phase 1 and the elevation from step 2.
4. `CRAFT — Typography is the framework default` — self-hosted Archivo and
   Martian Mono.
5. `CRAFT — The hottest colour on screen is a search highlight, not live` —
   reclaim saturated warm for live only.
6. `CRAFT — Contrast failures, including on the Go Live label` — retire
   `opacity-*` as a text-colour mechanism. Partly resolves itself once the
   lit-collar button model replaces green-fill-with-white-text.

**Phase 4 — the rest.**

- `CRAFT — Input is not acknowledged`
- `POLISH — Motion timing, focus rings, reduced motion`
- `Carried forward from the retired UI-consistency pass`
- `Feature — Too-wide callout when Refrain is not docked` (has an open
  question in the task: runtime or setup-only. Runtime is funnier; setup-only
  cannot possibly interrupt a service.)

---

## Constraints that still apply

From CLAUDE.md, unchanged by any of this:

- Core search stays free of everything else. None of the above may make search
  depend on a module or a provider.
- No telemetry, ever.
- Never lose data silently. Atomic config writes, staged arrangement writes.
- No vendor names in shared code. Read `Provider.displayName`.
- `npm run lint` clean, `npm test` passing, `node --check` on every touched
  file.
- Exercise browser-visible changes against a running dev server before calling
  them done. A dev server is already running on :3050.
- Commit only when asked.

Two additions from the direction, for this work specifically:

- **Copy is final copy, in the right zone, never placeholder.** A string that
  ships is a string that was written on purpose.
- **Every texture tile licence-checked before release.** Candidate tiles are
  sitting in `~/Downloads` (`black_linen_v2.png`, `noisy_net.png`,
  `real_cf.png`, `dark_leather.png`, `denim.webp`, `fake_brick.png`) with no
  provenance established. This ships open source; a CC-BY tile with no
  attribution is a real problem, not a footnote.

---

## One note on state

The review touched the running app's persisted preferences (theme, nav pin) and
restored both. Theme is back on System, rail back to collapsed. If either looks
wrong, that is why.
