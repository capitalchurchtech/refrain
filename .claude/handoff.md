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

## 3. CRAFT — Arrangement needs its own pattern, spec first

The least-finished screen. 184 buttons, 183 at exactly 77px — one height, no
tier variation, roughly 14,000px of scroll. Unlabelled `Filter...` input. No
heading on the lower list, so nothing says what it is or how it relates to the
plan above.

**Do not force it into the Forms pattern.** It is a fourth shape after the
readout, the key bank and the form: a **list-and-compare** screen. Rows are
interactive but scanned, so they want something closer to `.row` density than a
button stack, while still reading as pressable.

Off the live path and an optional module, so it should not jump the queue. The
planning session owes a spec here rather than leaving it to inference.

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
- 2026-08-26 · Motion polish · done · 7841005
