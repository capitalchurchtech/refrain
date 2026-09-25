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

## 1. BLOCKER — Show is the default action, not Go Live

Brandon: "Most primary actions should show the item not push a slide live,
ensure that's the default across all quick items."

Filed BLOCKER because the current default is the hazardous one on the live path,
for the persona the direction says sets the default path.

### The principle: hazard scales with what you cannot see

Brandon's clarification sharpens this, and it is better than a blanket rule.
It is not "Show everywhere." It is that **a live action is only legitimate once
the operator can see what they are firing.**

**Presentation header — remove Go Live entirely.** `Go Live (Slide 1)`
(`search.js:157`) is a blind action: you searched for a word, matched a
presentation, and the header offers to fire *slide 1* — a slide you have not
looked at and which by definition is not the one you matched. If you wanted
slide 1 you would be browsing, not searching. Header becomes **Show in Editor
only**.

**Per-slide rows — Go Live stays, and stays primary.** The slide's text is
rendered right there. You found it, you read it, you send it. That is the core
loop of the product. Add a Show option alongside it (they currently have none,
`search.js:176`) as the secondary action, for opening the editor to check
context before committing.

So the safe default applies to the *unseen* action, not to every action.

**And slide 1 is useless as a target generally, not just as a live one.** It is
the one slide guaranteed *not* to be the match — the search found a word
somewhere in the presentation and slide 1 is the position that had nothing to do
with it.

**CORRECTED 2026-08-27 — this part is not possible and must not be re-specced.**
ProPresenter 21.3 exposes no slide-level focus. Probed against the live rig:
`/v1/presentation/{id}/focus` works at presentation level (204); every
slide-indexed variant 404s, and `slide_index` appears **only** alongside
`trigger` — which is the hazard this item exists to remove.

So `/api/focus` stays as it is, Show opens the presentation, and header Show and
per-slide Show do the same thing. The per-slide one still earns its place, but
for a different reason than I gave: **it is the safe action in the row where the
live one is**, so the operator never travels to the header to avoid firing.
That is a mis-aim and tab-order argument, not a precision one.

I asserted a capability without checking the API. The editing session probed it
rather than building against my assumption.

### The collar resolves itself

`search.js:194` applies `rf-armed` to the **first** `.go-live-btn` in the
results. With the header button gone, that naturally becomes the first slide
row — one collar, on the only live action on the screen, and it is the informed
one. Verify this still lands correctly after the header button is removed
rather than assuming it.

**Guard by separation, not confirmation.** A confirm dialog would violate
"confirmation is instantaneous or the operator presses twice." Within a slide
row, Go Live sits apart from Show rather than butted against it, so a mis-aim
lands on nothing.

### A knock-on worth having

The header currently stacks two buttons in a ~250px column, which is what wraps
presentation titles onto four lines at docked width (logged separately in the
earlier audit). Dropping to one button gives the title that width back.

### Scope: found things, not live controls

Applies to **search results, Spell Check jumps, Arrangement rows, history
entries** — anything that is a *found item*.

**Explicitly excluded: the Live screen.** Clear, Looks and Macros are live
controls by definition; their whole job is putting things on screens. Nothing
there changes.

### The one piece of server work

`/api/focus` (`server/index.js:1048`) accepts only `presentationId`, so "show in
editor" opens the presentation rather than the slide that was found. It needs a
slide index, and `focusPresentation` needs to navigate to it — otherwise Show
cannot be the default for a slide result, which is the case that matters most.

### Keyboard

Enter on a focused result must Show, not Go Live. Go Live needs a deliberate
modifier or its own key. The Fluent Regular currently has Go Live as the only
keyboard path, and that is the same hazard in the power path.

---

## 1b. CRAFT — Fresh review of Search, 2026-08-30

Item 2 below is **done** — measured 56 + 404 = 460 at docked width, no dead
space. Verify before working it.

Four findings from a fresh pass, ranked.

### a. The index is four days stale and nothing says so — highest value

The strip reads `445 · 8/26, 11:27 AM · 0s`. Today is 8/30. It renders
identically to a fresh index: same colour, same weight, no signal.

This is the silent failure mode — search misses anything edited since Tuesday
and the operator cannot know. **The direction already wrote the copy for it**
and it was never built: `Index is 2 days old. Refresh.`

Operational rather than cosmetic. Treat staleness as a state with a threshold,
surface it in the strip, and give it a one-press remedy. Not a lamp — see the
meter reasoning; this is a text state, not an indicator.

### b. The collar arms the first result at rest, which means nothing

300 Go Live buttons, exactly one armed, and it is the first — not because the
operator chose it but because it is first. A lit collar marking *position*
rather than *state* is the same failure as a lamp that never changes, and it is
the argument that killed the global sync bar, applied to the app's only Tier 1
emitter.

**Fix: at rest nothing is armed, so nothing is lit.** The readout is the hero at
rest. The collar appears on hover or focus, where it genuinely marks what Enter
would fire. That also makes the emitter mean something in the one place the
operator most needs it to.

### c. One action, two names, two treatments

Header `Show in editor` (102px, sentence case, Tier 2) versus row `SHOW` (58px,
mono uppercase, chip). Same action. The direction: an action keeps its name
across the flow. Pick one name and one treatment.

### d. Slide text gets 59% of the column, actions 37%

Text measures 238px of a 404px column and wraps to five and seven lines. The
text is what the operator is scanning.

At docked width the actions probably belong **below** the slide text rather than
beside it, returning the full column to the thing being read. Worth trying
rendered rather than deciding here.

**Minor:** slide numbers render as sentence-case body where they are data. The
type rules put data in mono.

## 1c. CRAFT — Fresh review of the other eight screens, 2026-08-30

### Verified fixed — do not re-work

Zero unlabelled inputs on all eight screens. Every disabled button carries a
`title` (**item 12 is done**). `h1` is 25.76px uppercase on every screen. Live's
tiles are uniform 44px. Arrangement's rows are 33px, not 77px — scroll height
6,318 rather than ~14,000.

### a. Three screens have no real headings

**Live, Image Crop and QR Codes have zero `<h2>` elements.** Their sections are
`<div>`s styled to look like headings:

- Live: `PERFORMANCE MODE`, `CLEAR`, `LOOKS`, `MACROS` — divs at 12px uppercase
- Image Crop: `OUTPUT PRESETS`, `RECENT ACTIVITY` — divs at 9px uppercase
- QR Codes: no section structure at all beyond `h1`

Same class as the `<div class="label">` finding: the design is right, the
structure is not. A screen-reader user cannot navigate Live by heading, and Live
is the busiest screen during a service. Health, Scripture, Lyrics, Spell Check
and Arrangement all have real `h2`s, so this is three screens out of step rather
than a missing convention.

### b. Live's tiles are in monospace, and those are user-authored names

"Full Screen/Standard", "Christmas Countdown", "(FS) Worship" render in Martian
Mono. **That restyles names the operator wrote in ProPresenter**, which breaks
the rule in the direction. Mono is for data — counts, timestamps, indices. A
name is content and belongs in `--rf-sans`.

Also practically worse: mono is wider, so "Full Screen/Standard" wraps to two
lines where the interface face probably would not.

### c. Section labels disagree on size

Live's are 12px, Image Crop's are 9px. Same role, two values. Pick one — the
silkscreen spec is 8-10px, so 9px is the compliant one.

### d. Health has two `h2` treatments

`Settings` renders at 17px uppercase while the card titles use the 10px mono
silkscreen. This is the finding from the very first review and it is still open.

### e. Health still has two singleton button heights

One at 28px, one at 30px, among 36×13 and 44×31. Two controls that never got a
tier class.

### Instrument note

A `glowingEls` count in this pass was invalid — the query omitted a visibility
filter and accumulated across screens as they rendered into the DOM. Nothing is
reported from it. Recording the error rather than the number, per the rule about
grep-shaped and selector-shaped audits.

## 1d. FEATURE — A crash report the operator copies, not one the app sends

**Brandon's revision, and it is better than the emailing version I specced
first. Build this one.** The original spec is kept below the line for its
report-contents section, which still applies; ignore its transport.

Instead of the app sending mail, the crash surface shows the report and offers
one button that copies it. The operator pastes it wherever they like.

### Why this is the better design

- **It deletes the risk surface.** No SMTP, no credentials, no recipient
  config, no `nodemailer`, no `POST /api/crash-report` to protect, no rate
  limiting, no crash-loop mail storm, no swallowed send failures. Roughly half
  the original spec was machinery to stop the reporter making things worse.
- **The telemetry question stops existing** rather than being defensible.
  Nothing leaves the machine, so the README's claim is untouched.
- **Redaction stops being load-bearing.** The operator sees the report before it
  goes anywhere. Consent rather than engineering, and better than any scrubbing
  rule I could write. Keep the redaction anyway — someone will paste without
  reading — but it is now a second line of defence rather than the only one.
- **It works when an emailer could not.** A mailer cannot report a server crash
  that killed the server, or anything at all with the network down — often
  exactly why things broke. A client-rendered page with a copy button works in
  both cases.

Accepted cost: fewer reports, because a volunteer mid-service will reload and
carry on rather than copy anything. That is the right behaviour for them, and a
crash that matters recurs.

### Where it lives — extend what exists, do not build a new page

`public/error-boundary.js` already has both surfaces:

- `safeRender` shows an in-view message when a screen's render throws. That is
  already a crash page for that screen — give it the report.
- `installGlobalErrorBoundary` shows a dismissible banner for uncaught errors
  and rejections. Give it the report too.

### Craft that makes it good rather than merely simpler

- **Two actions, and the volunteer's is the obvious one.** `Reload` is primary
  and large — mid-service that is the only thing they should do. `Copy report`
  is secondary, for the admin afterwards.
- **Show the report, do not hide it behind the button.** Visibility is the
  consent mechanism. A scrollable block is fine.
- **One press copies everything.** A `Copy report` button writing the whole
  block to the clipboard, not "select the text below".
- **Do not use `mailto:`.** Practical URL length caps around 2,000 characters
  truncate the report silently, and formatting is mangled. Clipboard plus "paste
  it into an email" is more reliable and platform-agnostic.
- **The crash surface must not depend on the app that crashed.** No module
  imports, minimal JS, inline styles if necessary. If the renderer died, the
  thing reporting it cannot rely on the renderer.
- **Assembling the report must not throw.** Guard the serialisation — a circular
  object in an error payload will break `JSON.stringify` — and fall back to
  whatever partial report can be built. A crash reporter that crashes is the
  joke that writes itself.
- **Cold zone.** A crash mid-service is the coldest moment in the product. State
  what happened and what to do now. No charm anywhere near it.

### Copy

Something close to:

```
This screen stopped working. Reload to carry on.
If it keeps happening, copy the report and send it to your tech admin.
```

Report contents, the ranked field list, and the redaction rules are unchanged
from the section below — only the transport changes.

---

## 1d-orig. Superseded transport: crash reports by email

Brandon: any error that would normally crash the app emails him a report
detailed enough that fixing it is trivial — which app, which page, what the last
actions were.

### First: this is not telemetry, but only if built exactly this way

CLAUDE.md forbids telemetry absolutely: *no phoning home to anything the project
controls*. An email from the operator's own server, using their own SMTP
credentials, to their own address, is the machine telling its owner — a
different thing. Three conditions keep it that way, and the first is
non-negotiable:

1. **No default recipient, ever.** `to` ships empty. If unset, the feature is
   inert and no code path sends anything. A default address in shipped code
   would route every other church's crashes to one inbox with nobody opting in.
   That would be telemetry, and the worst kind.
2. **The project never proxies.** SMTP credentials are the operator's, in
   `.env`. No relay, no Refrain-hosted endpoint, no third-party error service.
3. **The README gets updated honestly.** "No telemetry" stays true, but the
   distinction has to be stated rather than left for someone to discover. That
   is the "be honest in the docs" rule.

### Second: what must never be in a report

A crash on Search could otherwise carry slide text, a search query, or
presentation names. CLAUDE.md forbids *committing* real church data; emailing it
is worse.

**Breadcrumbs record what was pressed, never what was found.**

- **Never:** slide text, search query strings, presentation or song names, lyrics,
  scripture text, macro names (user-authored), library file paths.
- **Yes:** route, Refrain's own control ids and labels, HTTP method + path +
  status, timings, error message and stack, counts.

A search breadcrumb reads `search → 117 results`, never the query. Presentation
UUIDs are safe; names are not.

### What makes a report actually actionable

Ranked by whether an agent can fix without it:

1. **Commit SHA.** Without it everything else is guesswork about which code ran.
   Highest-value single field. Include whether the tree was dirty at boot.
2. **Error message, class, and stack with file:line.**
3. **Which side** — client or server. Different files, different fixes.
4. **Route** (`#health`) — the hash routing added earlier makes this free.
5. **Breadcrumb timeline** — the last ~25 events, ring buffer, memory only,
   never persisted.
6. **State that changes behaviour:** theme, viewport, rail pinned or collapsed,
   role (logger/reader), which modules are active, ProPresenter reachable, index
   age.
7. **Occurrence count** — is this the first time or the fortieth. A crash loop
   and a one-off need different responses.

### Format: one fenced block, paste-ready

Subject: `Refrain crash · <screen> · <error class>` so it is scannable in an
inbox. Body is a single fenced block containing the whole report, so it can be
copied into an agent session in one action rather than reassembled.

Lead the block with repo, version and commit — the fix starts there.

### The reporter must never make things worse

- **Never crashes the app.** A failing send is swallowed. A reporter that throws
  inside an error handler turns a recoverable error into a dead app.
- **Never blocks.** Fire and forget; nothing on the live path waits on SMTP.
- **Rate limited.** Dedupe by error signature, cap per hour. A crash loop must
  not send four hundred emails during a service.
- **Independent of ProPresenter.** The most useful reports are the ones where
  ProPresenter is the thing that broke.
- Client errors need `POST /api/crash-report` to reach the mailer. Rate-limit
  that endpoint too.

### Where it hooks in — all four points exist already

- `public/error-boundary.js` — `installGlobalErrorBoundary` (uncaught +
  unhandledrejection) and `safeRender` (per-screen render failures).
- `server/index.js:131` and `:134` — `unhandledRejection` and
  `uncaughtException`.
- Add Express error middleware for 500s, which currently return JSON and vanish.

### Architecture, per CLAUDE.md

- Non-secret config in `config.json`: `crashReport: { enabled, to, from }`.
  Document the shape in `config.example.json`.
- Secrets in `.env`: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`. Names
  listed blank in `.env.example`.
- `getCrashReportModuleStatus(config)` in `server/config.js`, reporting off /
  misconfigured / active, surfaced on Health like every other optional module.
  Missing credentials degrade to misconfigured — never crash, never silently
  stop reporting.
- Tests for the redaction and the rate limiter specifically. Redaction is the
  part where a bug leaks church data, so it earns a test rather than a manual
  check.

### One decision for Brandon

Sending mail needs a dependency; `nodemailer` is the conventional choice. This
project is deliberately spare, so that is worth an explicit yes rather than
assuming. The alternative is hand-rolling SMTP, which is worse.

## 2. CRAFT — 29% of the window is dead space, and the brief caused it

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

## 3. CRAFT — The nav rail becomes a butted key bank

Brandon, in three messages: square corners rather than rounded, drop the gaps,
let the buttons touch. One change.

**Current state:** `#nav-items` is `flex flex-col gap-1` (4px), the bottom
control group is also `gap-1`, and nav keys inherit `--rounded-btn: 3px` with no
nav-specific radius rule.

**Target:** `gap: 0` and `border-radius: 0` on the nav keys and the bottom
control group. Scoped to the rail.

### Why this is right, beyond looking tighter

**The junction treatment already does the job the gap was faking.** Each key
carries `inset 0 1px 0` catching light on its top edge and `inset 0 -1px 0`
falling to shadow at the bottom. When keys touch, one key's trailing shadow sits
directly against the next key's leading highlight, and that dark-then-light pair
*is* the seam between two key caps on real hardware. The gap was a substitute
for a seam the material can produce properly.

Square corners follow from the same logic: at 3px radius on butted keys you get
a notch of background at every junction — sixteen of them down a nine-key
column. Squares let the bank read as one machined block divided by seams.

### Two consequences

**The latched key gets more present for free.** Recessed between two raised
neighbours and framed by their edges, it reads far more strongly as a pressed
key in a bank. **Re-check item 2 before doing it** — widening the accent edge to
3px may become unnecessary, and item 2's other two parts may be enough.

**The group dividers become load-bearing.** With the gaps gone, the SERVICE /
PREP / SYSTEM score lines are the only horizontal breaks in the column. They
need to be a real machined groove — `border-top: 1px solid var(--rf-shadowline)`
with `box-shadow: 0 1px 0 rgba(255,240,235,.06)` below — not a partial-opacity
hairline. If that has already landed, verify it still reads at gap 0.

### The general rule, so this is principled rather than a one-off

**Anything in a butted bank is square; anything free-standing keeps its radius.**
Content buttons, cards and chips are separated by space and keep 4/3/2px. The
rail is the only butted bank in the product today, which is why this is a rail
change and not a global one.

**Open question, not a decision:** the Live tile bank is also a key bank, but
its tiles are separated by `gap-3`. A console's Looks bank would plausibly be
butted too — but 34 butted tiles with variable-length names may read as a wall
rather than a bank. Worth trying once the rail lands and judging it rendered,
rather than deciding it here.

---

## 4. CRAFT — A status cluster, replacing the orphaned LINKED row

Brandon: "Live indicator light on collapsed menu looks way off. On expanded menu
still looks off. Maybe have a status section that looks like hardware with
several status lights?"

**The geometry is already correct — do not nudge pixels.** Measured with
transitions disabled: expanded rail 144, every glyph centre at 20; collapsed
rail 56, every glyph centre at 28, which is the exact rail centre. The lamp is
8×8 in a 16px box in both states. The axis fix from `a97104b` holds.

Three other things are wrong, and they are why it still reads badly:

- **Optical mass.** A 16px lucide icon is a line drawing filling its box; an 8px
  solid dot covers about 20% of the same area. Centred but recessive — it cannot
  hold a column of icons.
- **Row height.** `#link-row` is `h-7`, **28px**, among nav items at 36 and
  bottom controls at 40. The shortest thing in the rail.
- **Category.** Everything else in that column is a control with hover and press
  behaviour. LINKED is a static readout wedged among them, so it reads as an
  orphan — a status line dressed as a menu item.

### The cluster

Brandon's instinct is right and it is the correct fix. It solves the category
problem — status stops pretending to be navigation — and it is the most
recognisable rack-unit vocabulary the product has not used.

It also fixes a scattering problem: **status currently lives in four places.**
Link in the rail, index freshness on Search's stat strip, performance mode on
Live (`live.js`, 11 references), live state in `live-readout.js` on Search only.
Nothing tells the operator what is live while they are on Health.

**Which lamps earn a place.** Same discipline that ruled out the global sync
bar: a lamp that never changes is decoration.

- **LINK** — yes. The quality floor names it: disconnected must be unmistakable
  and always visible.
- **LIVE** — yes, and arguably the strongest of the three. The phosphor readout
  exists only on Search, so nothing reports live state from any other screen.
- **PERF** — yes, probably. It varies on its own, arming after something has
  been live a couple of minutes and releasing when the screens clear, so it is a
  machine-reported state that actually moves.
- **INDEX** — no. Stale index is real but not binary and rarely changes. The
  direction already wrote the text line for it: `Index is 2 days old. Refresh.`
  A lamp that holds one colour for weeks is furniture.

**No emitter-budget problem.** The ceiling counts emitter *kinds*, and "the
LEDs" is already one of the four. A cluster of three is still one kind.

### Form

A recessed sub-panel at the foot of the rail, above the controls, separated by a
score line. Junction treatment pointing inward so it reads as an inset
instrument rather than another row — this is the one place in the rail that is
recessed rather than flush or raised, which is exactly right: **recessed means
information comes out.**

- Expanded: lamp plus silkscreen legend at 8px / 0.15em, one per row, on the
  existing 16px icon column so the axis survives.
- Collapsed at 56px: lamps only, stacked, centred on the rail axis. Legends drop.
- The lamps keep the item-0 construction — 16px column, 8px lamp drawn by
  `::before`, so neither state can collapse the column.
- Light theme: printed, not lit, per the rule in the direction. Solid fill lit,
  hollow ring unlit.

Give the panel a real height rather than `h-7` per row, so it reads as one
object with three indicators rather than three short rows.

**Do not** make the lamps interactive. They report; they are not controls. That
is the whole point of separating them from the key bank.

---

## 5. CRAFT — Health's accordion headers use three different treatments

Brandon: "Health accordion icons are not vertically aligned nicely."

Measured: the icons *are* centred within their own rows — vertical centre offset
0 on all five that have one. The rows are the problem.

**Three header treatments in one screen:**

| where | `health.js` | treatment |
|---|---|---|
| Library Sync, error state | 594 | `flex items-center gap-2` **with icon** |
| Library Sync, normal state | 605 | plain block, **no icon at all** |
| Five config sections | 964, 1018, 1059, 1102, 1143 | `min-h-0 py-2`, icon, inline hint |

Consequences:

- **Library Sync only gets an icon when it is broken.** In its normal state the
  icon column has a hole, and the label starts where the others' icons do.
- **Row heights are 56, 56, 64, 64, 76 and 80px** — five heights across six
  rows. The `text-xs opacity-50` hint ("host, port, role", "scope,
  arrangements", "defaults") sits inline after the name and wraps differently
  per row, so each row is sized by its own content.
- An icon centred in a 76px row sits *below* the name it labels; centred in a
  56px row it sits beside it. That drift down the column is what reads as bad
  alignment.

### Fix

**One treatment for all six**, and **align the icon to the first text line
rather than to the row.** Centring in the row is what causes the drift, and it
will keep drifting at docked width where the hints wrap whatever the padding is:

```css
/* header row */
display: flex;
align-items: flex-start;
gap: 8px;

/* the icon, sitting on the name's cap height rather than the block centre */
margin-top: calc((1lh - 16px) / 2);   /* or a measured px equivalent */
flex: none;
```

Every header gets an icon at `w-4 h-4 opacity-70`, including Library Sync's
normal state — pick the same `folder-sync` glyph its error state already uses.

Then apply the item-0 lesson: **audit the column, not the class.** Once these
six agree, check every other icon-plus-label row on Health against the same
axis, since the screen has 46 buttons and several row idioms.

**Related, already logged as item 4:** the hint text is a candidate for the
`.row` treatment — silkscreen label, value beside it — which would make the
rows uniform by construction rather than by tuning.

---

## 6. CRAFT — History entries jump to the editor on click — DONE 2026-09-02

Brandon: "The history panel needs to have the items jump you there on click
(not on the screens but the editor)."

Consistent with 1d, and the same reasoning: a history entry is a record of
something that happened, so acting on it means going to look at it.

Arrangement's history entries (`arrangement.js:440`) are
`<div class="... history-entry" data-service-date="...">` — not interactive. The
row becomes clickable and calls `/api/focus`, opening the song in the
ProPresenter editor. **Never `/api/trigger`.**

Two implementation notes:

- There is already a button inside each entry (`arrangement.js:502` reads
  `btn.closest(".history-entry")`). Making the row clickable must not swallow
  that button's click — stop propagation on the inner control.
- The row needs a hover affordance and a real accessible name, per the Forms
  pattern. A clickable div with no keyboard path is worse than a static one.

Same treatment as the Arrangement list rows in item 5: flush, hairline groove,
hover as the affordance, not a raised key.

---

## 7. CRAFT — Macro tiles carry the macro's own colour

Brandon: "The macro icons need to pull the square and color just like in
ProPresenter's UI. Do it creatively so it doesn't look horrible but respects the
real version of the macro."

**This reverses a deliberate decision, so read the existing reasoning first.**
`propresenter-client.js:219` drops the colour on purpose: *"they are arbitrary
hues (this rig has magenta, lime and two blues) and the palette reserves
saturated warm for what is live. An icon is structural and survives being drawn
in one colour; a hue does not."*

That argument is correct about **filling a tile** with an arbitrary hue. It is
not an argument for discarding the colour, and a rule written since points the
other way: **"Refrain never restyles a name its user wrote."** A macro's colour
is the operator's own classification, the same category as its name. Dropping it
is a stronger form of restyling than showing it.

### Both concerns resolve at once

**The macro colour is printed ink. Live is emission.** A flat swatch with no
glow and a lit collar with a halo are categorically different objects, so even a
red or orange macro swatch cannot be mistaken for the live signal. Same
distinction that lets the section markers glow without spending an emitter,
applied in reverse.

### Form

Faithful to what ProPresenter shows, which is a coloured square:

- **~10px square swatch** at the tile's leading edge, on the icon axis, in the
  macro's exact colour. Flat: no gradient, no bevel, and **never a glow**.
- **1px `--rf-hairline` rim**, so a very pale or very dark macro still reads
  against the panel. The rim does not alter the colour, it gives it an edge —
  the same trick as the light-theme lamp's hollow ring.
- **The icon stays.** ProPresenter shows both; the icon is structural, the
  swatch is identity.
- **No colour means no swatch.** Never substitute grey: an absent swatch is
  honest, an invented one is a colour the operator did not choose.
- Applies to macros. Looks do not carry a colour in the API — leave them alone
  rather than inventing parity.

### Server change

`propresenter-client.js` currently maps `{ id, name, icon }` and discards
`entry.color`. Add it, and **update that comment** — it records the opposite
decision and will otherwise read as an instruction to whoever sees the field
being passed through.

Check the shape ProPresenter returns before assuming hex; it may be a
components object rather than a string, and a malformed colour must degrade to
no swatch rather than to black.

---

## 8. CRAFT — Make the latched nav key present, without a fifth emitter

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

## 9. CRAFT — Every screen is a destination with no onward path — DONE 2026-09-02

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

## 10. CRAFT — Finish the semantic colour sweep — DONE 2026-09-02

Raw DaisyUI semantic colours by file: `health.js` 44, `arrangement.js` 19,
`library-sync.js` 8, `setup.js` 6, `search.js` 2, `live.js` 2,
`error-boundary.js` 2.

**These are grep counts, so they are a starting point for looking, not
findings.** Health's are largely the migrated fault/status vocabulary doing its
job — resolve values before changing anything.

Sweep **by concept, not by screen.** Doing it screen by screen is what left the
inverted performance-mode dot in place while Health looked finished.

---

## 11. CRAFT — Arrangement: the list-and-compare pattern

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

## 22. POLISH — `--rf-muted` and `--rf-fault` have no light-theme value — DONE 2026-09-02

Found while verifying item 11 in light theme, and it is not an Arrangement
problem — it is app-wide, so it belongs to item 10's sweep rather than to any
one screen.

Both tokens are declared once, on `:root`, with dark-theme values and no light
override. Measured against a booted light theme (not a runtime `data-theme`
flip, which reads stale — see the note below):

- `.rf-silkscreen`, which sets `color: var(--rf-muted)` unscoped: **2.52:1** on
  the light card surface. Every silkscreen label on every screen.
- `.rf-flag`, which sets `color: var(--rf-fault)` unscoped: **2.46:1**. Every
  fault mark outside Health, including Health's own strip.

The parts of the codebase that got this right dark-scope the declaration and
let light inherit — `.rf-field > label` is the model — which is consistent with
the palette's own note beside `--rf-dim`: when something must read quieter,
use size and tracking, not a fainter ink. Arrangement's three new muted rules
now follow that pattern. The two base classes above still do not.

Either give both tokens a light value, or dark-scope the two base rules the way
`.rf-field > label` does. The second is smaller and matches what is already
there.

**Instrument note, because it cost time twice.** Light theme cannot be checked
by setting `data-theme="light"` from the console: the vendored Tailwind JIT
resolves theme values at boot and does not regenerate them, so `main` keeps a
near-white inherited colour and every reading below it is fiction. Boot the
server with the theme actually set. And `canvas.fillStyle` does **not** convert
`oklch()` — it hands back the components unchanged, which silently turns every
contrast ratio into a made-up number. Paint one pixel and read it back with
`getImageData` instead, and sanity-check the instrument against white-on-black
returning 21 before trusting anything it says.

## 12. POLISH — Disabled controls give no reason — DONE 2026-09-02

`Check spelling` on Spell Check, `PNG` and `SVG` on QR Codes. All `title: null`.
A `title` is the minimum; helper text near the control is better, since a
tooltip on a disabled button is unreliable on touch.

---

## 13. Only Brandon can close this: the keyboard tab-through

Three authored `:focus-visible` rules exist. **Neither session can verify them** —
`:focus-visible` is a heuristic about input modality, not a media query, and no
synthetic focus satisfies it.

The check: tab from Search through to Go Live and back, in a dark room at low
brightness. If focus disappears anywhere on that path, the Fluent Regular's
keyboard-speed premise is broken and nothing either session can screenshot would
reveal it. Five minutes for a person, impossible for us.

---


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

## ProPresenter surface review — 2026-09-02

A review of every surface that touches ProPresenter, for production use in a
real booth. Ranked. What held up is recorded at the end, because "the guard
works" is a review result too.

### 14. MEDIUM — a stale-schema index degrades Go Live silently — FIXED 2026-09-02

`loadIndexFromDisk` (`server/search-index.js:92`) parses the cache and returns
it without checking `schemaVersion`. `shouldAutoRebuild` does catch a mismatch,
but at boot, if `frozen()`, the rebuild is deferred and the log says "The
existing index still works."

It does work for *finding*. What it does not do is carry `groupId`/`groupOffset`
per slide, so `resolveTriggerIndex` loses its primary anchor.

**Precise severity, because it is easy to overstate.** The correction does not
switch off — the guard is `!anchor.groupId && !anchor.slideText`, and
`slideText` comes from the query-time snippet, which an older index still
produces. So correction degrades from (group, offset) matching to text
matching. Text matching then picks the candidate `nearest` the *stale* stored
index, which for a repeated chorus in a re-lengthened arrangement can select
the wrong repetition. Degraded and silent, not catastrophic.

The realistic path: upgrade on a Saturday, Sunday morning ProPresenter is live
or slow, performance mode arms, the rebuild is deferred for the whole service.

Nothing surfaces it — `schemaVersion` appears nowhere in `server/index.js` or
`public/`. Fix: put `anchorsAvailable` in `indexStatusPayload()` and say it on
Search in accuracy terms, not staleness terms.

### 15. MEDIUM — the library guard is checked once, for a job that runs minutes — FIXED 2026-09-02

`/api/library-sync/run` calls `checkLibrarySafeToTouch` before starting, and
then `syncLibrary` copies files sequentially with no re-check. If ProPresenter
launches mid-sync — a shared booth machine, someone starting the service — the
remaining writes land under a running ProPresenter, which is the exact
condition that cost three workspaces.

Mitigating: sync is operator-initiated only. There is no scheduler (verified).

Fix: pass an abort predicate into `syncLibrary`, re-check every N files, abort
and report a partial run. Safe to abort by construction — each file is
temp-then-rename and every replacement is backed up first.

### 16. MEDIUM — worst-case Go Live is ~40s with no feedback — FIXED 2026-09-02

`resolveTriggerIndex` fetches the presentation at `LIVE_TIMEOUT_MS` (20s),
`Promise.all`-ed with `getCurrentSlide` (8s), then `triggerSlide` at 20s. A
ProPresenter that accepts connections but never answers gives 40s before a 502,
with the button disabled throughout.

Not hypothetical: measured on this rig on 2026-09-02, where `/v1/version`
returned in 14ms while `/v1/status/layers`, `/v1/presentation/slide_index` and
`/v1/looks` all hung past 30s.

Fix: bound the whole request. If the anchor resolve has not returned in ~4s,
fire the stored index and report `anchorChecked: false` — the fallback is
already the designed behaviour, it simply is not time-bounded.

### 17. MEDIUM — `propresenter-client.js` has no direct test — DONE 2026-09-02

Eleven of the twelve ProPresenter surfaces have a test file. The client — the
one every other surface depends on — does not. `macroIcon`/`macroColorHex` are
covered by `macro-colour.test.js`; the request layer is not, and neither are
`getCurrentSlide`'s normalisation, `getPlaylistItems`' filtering,
`extractMessageTokens` or `normalizeIdList`.

`getCurrentSlide` matters most: its `index < 0` and non-number rejections feed
the return pin, so a regression there arms a return target that goes somewhere
the operator never was.

These are pure functions of a JSON shape. The file's header comment is
currently the only record of ProPresenter 21.3's response shapes; a test would
make that record enforceable instead of aspirational.

### 18. LOW — URL path segments are interpolated unencoded — FIXED 2026-09-02

`presentationId`, `slideIndex`, look/macro/message `id`, `folder.uuid` all go
into the ProPresenter URL raw. `layer` is correctly allowlisted against
`CLEAR_LAYERS`; nothing else is.

**Not a live vulnerability**, and the reasons are worth writing down so nobody
re-litigates it: the server binds `127.0.0.1` (`server/index.js:2673`), only
`express.json()` is mounted so a cross-origin simple request cannot populate
`req.body`, and there are no side-effecting GET routes. Fix anyway with
`encodeURIComponent` in the client — one file, closes the class.

### 19. LOW — `/api/trigger` does not validate `slideIndex` — FIXED 2026-09-02

`Number(slideIndex)` accepts NaN, floats and negatives. Both current callers
pass an index straight from the index, so it is unreachable today, but the
route is the contract. Require `Number.isInteger(n) && n >= 0`.

### 20. LOW — library folder matching is case-sensitive and silent — FIXED 2026-09-02

`getLibrary` filters with `folderNames.includes(f.name)`, so `"songs"` in
config against `"Songs"` in ProPresenter crawls nothing and the operator gets
an empty index with no explanation. Separately, a folder that throws is
`console.log`-ed and its presentations are simply absent from search — the
crawl circuit breaker catches total collapse, not one folder quietly missing.

Fix: compare case-insensitively, and report both unmatched configured names and
failed folders in index-status.

### 21. NOTE — the disabled-slide assumption — SETTLED 2026-09-10, assumption was correct

`flattenGroups` counts `enabled: false` slides in the flat index; nothing reads
`slide.enabled` anywhere. The original plan flagged this as unverified and said
it would go into `docs/propresenter-verification.md`. It did not — grep finds no
mention of it there.

If ProPresenter skips disabled slides when resolving a trigger index, then for
every song containing one, every slide after it fires one position off.

Could not be settled on 2026-09-02: the read-only census failed because the API
was wedged, and settling it properly requires actually firing a slide, which
puts content on real screens. This needs a rig test on a throwaway workspace
with outputs off, not a code change.

### What held up

Recorded deliberately. Every safety mechanism was tested against a genuinely
half-dead ProPresenter and each failed in the safe direction:

- The library guard refuses, and an unreachable API is explicitly not treated
  as permission — it falls through to `ps`, finds ProPresenter, and says no.
- Performance mode *arms* on unknown layers rather than standing down, so a
  wedged ProPresenter freezes Refrain instead of freeing it to crawl.
- The heartbeat reschedules after each beat completes, so a 20s hang cannot
  pile beats up behind it.
- The crawl aborts after ten consecutive read failures.
- Sync never deletes and never mirrors, refuses a source below the floor,
  backs up before replacing, snapshots the read side first.
- `highlightMatch` escapes each slice before joining, so slide text carrying
  markup cannot execute — the one place ProPresenter content reaches innerHTML.
- The trigger correction exists and every failure path falls back to the
  requested index, so it can only improve accuracy, never availability.

## Todoist archive — assessed 2026-09-02, and it is an archive

Checked the **IT › Refrain Feature Request** project against the code, because
CLAUDE.md says to treat it as archive and not to assume a task there is live.
That instruction was right.

**26 tasks, none of them checked off, and 24 describe work already shipped.**
Verified against the code rather than by reading titles: the engraved wordmark,
the segmented LED meter, refresh keeping the current screen, the un-inverted
performance-mode dot, one chip class, display type, the lit-edge section
marker, the form language, the latched nav key, the status cluster, global
grain, reduced-motion handling, focus rings, and labelled inputs are all
present. So is the whole warm-zone copy task — welcome modal, the
"Go coil something" first-index line, and the 404 page all exist. Working from
that list would have meant redoing finished work, which is exactly the failure
the CLAUDE.md note is there to prevent.

Two were genuinely live, and both are now done. One of them had the wrong fix
attached to it.

### 23. The search-acknowledgement task prescribed the wrong fix — DONE 2026-09-02

The task ("CRAFT — Input is not acknowledged") measured the backend at 23ms,
concluded the 200ms debounce was throwing instant away, and prescribed dropping
it to ~90ms.

The backend measurement still holds -- 19-40ms on today's 445-presentation
index, even for a query matching 12,205 slides. The conclusion did not.
Keystroke-to-results was **not** 223ms:

    "grace"  1,072ms    300 rendered rows
    "the"    2,312ms  7,149 rendered rows
    "a"      4,766ms 12,205 rendered rows, in a 3.75-million-pixel document

The cost was rendering an unbounded result list, not waiting. Dropping the
debounce as prescribed would have made it worse, by triggering more of a
multi-second render while someone types.

Fixed in the order that actually helps: cap the render at whole songs up to
`MAX_RENDERED_SLIDES` (250), which took "a" from 4,766ms to ~1,200ms and says
plainly how many songs are not shown; then acknowledge the keystroke
**synchronously in the handler**, measured at 0.2ms, so acknowledgement cannot
be late whatever the render costs; then lower the debounce to 90ms, which is
now safe because the render is bounded.

The acknowledgement is a mono line where the count goes -- no spinner, nothing
animated, and it deliberately leaves the previous results on screen, because
mid-service the old list is the best thing available until a better one exists.

### 24. NOTE — a residual ~1s render on large result sets

Uncovered by the above and **not fixed**. With the cap in place, a broad query
still takes roughly a second from keystroke to painted results, and it is not
the debounce (90ms), the fetch (16ms), the HTML string (1ms), layout (42ms),
icons (43ms), or Tailwind generating new rules (the stylesheet does not grow).
It is the cost of tearing down and rebuilding a few hundred cards in a document
tens of thousands of pixels tall.

Two things follow. Each slide row is about 450px of document height, which is
worth questioning on its own -- 250 rows should not be 115,000px. And a real
fix is windowing (render what is near the viewport), which is a bigger change
than this item and should be its own piece of work.

The acknowledgement means the operator is no longer left wondering, so this is
a performance finding rather than a usability one now.

### 25. Health tooltips are on a diet — DONE 2026-09-02

Fourteen rewritten. Mean length is 18 words against the task's target of about
17, one remains at 29 -- the preferred-arrangements setting, where every clause
changes a decision (order is priority, empty follows ProPresenter, takes effect
next rebuild). Verified as rendered `data-tip` values, not as source literals:
19 tooltips, none empty, no double-escaped entities.

Worth noting for next time: the first pass missed four of them because the scan
only matched double-quoted `infoIcon("...")` calls and these are single-quoted.
A source-literal grep is not the population; the rendered attributes are.

## 26. The search path had no error handling at all — FIXED 2026-09-02

Found by review of the acknowledgement change, and the reported symptom was
the smallest of four problems on one function.

`runSearch` had no `try`, no `catch`, and never checked `res.ok`. That was
survivable while a failed search merely did nothing visible. Adding the
"Searching" acknowledgement turned it into a stuck state: an unreachable
server left that line on screen for the rest of the session, with nothing
saying the search had failed.

Four things, all on the same function:

- **A rejected fetch** left "Searching" up forever. This is the one the review
  caught, and it is mine -- the acknowledgement created it.
- **A non-2xx response** was never checked, so a 500 returning an HTML error
  page threw inside `res.json()`, somewhere much less obvious than the call.
- **Nothing was ever reported to the operator.** `showFailure` was already
  imported for Go Live; search never used it.
- **Responses could land out of order.** Two searches can be in flight at once
  -- the debounce only spaces out their *starts*, and a broad query takes about
  a second to render -- so a slower earlier query could paint over a faster
  later one, leaving results that do not match the box. Pre-existing, but
  lowering the debounce from 200ms to 90ms made it materially more likely, so
  it counts as mine too.

All four fixed with a token guard plus try/catch. The previous results
deliberately stay on screen through a failure: mid-service they are still the
best thing available, and blanking them would punish the operator for a
network blip.

Verified against a running server, including that the race test is meaningful
rather than lucky -- instrumented so the assertion only holds when the earlier
query genuinely resolves after the later one (`["love", "grace"]`), which it
did, while only "love" rendered.

## Concert-eve pass — 2026-09-10, fresh machine

Asked for one more sweep of ways Refrain can break a ProPresenter workspace,
with a concert tomorrow on a machine that has never run this before. A fresh
machine has a different risk profile: first boot does things it never does
again.

### 27. BLOCKER — first-run setup started a full crawl with no live check — FIXED

`POST /api/setup` fired `rebuildIndex` unconditionally the moment config was
saved. The boot path has always had a performance-mode check; this one had
none, and it is the path a fresh machine actually takes.

The concert-day shape: Refrain is installed during load-in, setup finishes, a
full crawl of the whole library begins with nobody choosing it, and it is
already running when doors open. Guarded now, the same way boot is.

### 28. BLOCKER — a running rebuild could not be stopped — FIXED

Performance mode could refuse to *start* index work, but nothing checked it
once a crawl was under way. `rebuildIndex` took no stop signal at all and the
crawl loop never consulted `frozen()`, so a rebuild begun before a service ran
straight through it — making ProPresenter sluggish exactly when it must not be.
The Health screen told operators to quit Refrain, which was the only true
advice available.

`rebuildIndex` now takes an injected `shouldStop` predicate, checked before
each document. Injected rather than imported, because core search must not
depend on the app's performance-mode state. Stopping reuses the abort path the
consecutive-failure breaker already had, so everything not re-read keeps what
it had: a stopped rebuild leaves a usable index. There is a Stop button on
Health and a `POST /api/index/stop`.

**The distinction that nearly went wrong.** My first version stopped on
`frozen()` for every rebuild, which would have broken both Health rebuild
buttons — performance mode also arms when ProPresenter is simply unreachable,
which is precisely when someone is pressing Rebuild to fix things. Performance
mode's promise is that Refrain stops acting *on its own*; an operator pressing
a button is still in charge. Automatic rebuilds stop when something goes live;
operator-initiated ones stop only when the operator says so. Verified live
against an armed performance mode.

### 29. CRAFT — Image Crop moves files out of the folder it watches — FIXED

`processImage` finishes with `rename(filePath, processedDir)`. That is correct
for a drop box and destructive for anything else, and nothing stopped the input
folder being one of ProPresenter's. Pointed at a media folder — a very natural
reading of "crop my images automatically" — it would relocate artwork out from
under every presentation referencing it, one file at a time, silently.

A `.pro` file happens to be safe: `sharp` throws before the rename, so it is
never moved. Media folders are not safe, and they are the ones someone would
point this at. Both folders are now refused if they sit inside a ProPresenter
or RenewedVision path, matched segment-wise so `ProPresenterBackups` still works.

### 30. BLOCKER — the test suite was red, and wrote into the project root — FIXED

Not a workspace risk directly, but it is the guard rail everything else here
depends on, and it was broken.

The Node in this environment is now **v20.14.0**; earlier in this project's
history it was v22.21.1. On Node 20 a top-level `before()` hook does not run
ahead of the test bodies. Two test files used one to `process.chdir` into a
temp directory, so on Node 20 they operated on the **real project root**:

- `search-collapse.test.js` loaded the real 445-presentation index instead of
  its fixture and reported zero matches — three failures that look like a
  search bug and are not.
- `config.test.js` called the real `saveConfig`, leaving `config.json.tmp` in
  the repo and sitting one successful rename away from overwriting a church's
  actual `config.json`. It survived only because the rename happened to fail.

Both now do their setup at module scope with top-level await, which runs at
import on every version. `engines.node` is `>=20.0.0` and there is a `.nvmrc`.
291 tests green on Node 20. **Not cross-checked on 22 or 24 — no other Node is
installed on this machine.**

### What was checked and is sound

- Library Sync refuses in both directions while ProPresenter runs, re-checks
  mid-run, never deletes, never mirrors, refuses a too-small source, backs up
  before replacing. No scheduler — it is operator-initiated only.
- The doctor only ever reads. It hands over a `pkill` command; it never runs it.
- Nothing anywhere reads or writes `.pro` file *contents*. The only access is
  `stat` for dates.
- Every optional module is off by default in `config.example.json`, so a fresh
  machine has Library Sync and Image Crop switched off until someone chooses.
- The only writers to user-configurable paths are Image Crop (now guarded),
  arrangement storage, and Library Sync (guarded).

### Still open for tomorrow, and not fixable in code

- **Build the index before the day**, with ProPresenter open and idle. It is
  the one heavy operation, and on a fresh machine it is unavoidable — the cache
  starts empty. Everything above makes it interruptible; none of it makes it
  free.
- **Item 21 is still unverified**: whether ProPresenter counts disabled slides
  in its flat trigger index. If it does not, songs containing one fire one
  slide off. Unchanged from 2026-09-02 and still needs a rig.
- This machine's ProPresenter API was unreachable again during this pass
  (`localhost:56563` refusing), as it was on 2026-09-02.

## 31. BLOCKER — the first index build had no settle gate — FIXED 2026-09-10

The watcher has always refused to reindex until ProPresenter has been
answering for three minutes, for a measured reason recorded in
library-watch.js: *"Reads fail en masse while ProPresenter is still indexing
its own media after launch — measured at 221 of 445 lost."*

The **first** build had no such gate, on either the boot path or setup. That
is the one build a fresh machine cannot avoid, and its failure is invisible:
an index silently missing half the library looks exactly like a complete one.

Both paths now wait rather than skip — with no index there is no watcher to
come back later, because `startWatching` derives its folders from indexed
presentations, so a skipped first build never happens at all.

It also stops Refrain issuing hundreds of document reads at a just-launched
ProPresenter, which is the heaviest and least necessary load it ever puts on
the app. That matters beyond index quality; see 33.

## 32. NOTE — disabled-slide exposure, and the answer — SETTLED 2026-09-10

Item 21's read-only half, done against a healthy ProPresenter on 2026-09-10.
184 of 184 Songs presentations read, zero failures, 3,284 slides.

**Four songs contain disabled slides (six in total):**

    All Hail King Jesus - [ T ]                    2 disabled, first at flat 22 of 30  (7 after)
    Gratitude - [ Ver 1 ]                          1 disabled, first at flat 36 of 39  (2 after)
    Jireh (FS) - [ Ver 5 ]                         2 disabled, first at flat 12 of 35  (22 after)
    Promises - [ T - Great Is Thy Faithfulness ]   1 disabled, first at flat 37 of 42  (4 after)

If ProPresenter skips disabled slides when resolving a flat trigger index,
every slide after the first disabled one in these four songs fires one
position off — two after the second. Jireh is the worst case at 22 slides.

Still not settled, because settling it needs a slide actually fired. **There
is a read-only way that does not require Refrain to trigger anything:** open
one of these four in ProPresenter, click the slide immediately *after* the
disabled one by hand, and read `GET /v1/presentation/slide_index`. If the
reported index counts the disabled slide, Refrain's assumption is right and
nothing needs changing.

## 33. The bootstrap failure on this machine — what is and is not established

Brandon reports that this machine hit a ProPresenter **bootstrap** failure,
that it was what blocked the Network API (the network settings were correct
throughout), and that Refrain caused it.

**Ruled out with evidence: Library Sync.** It is `enabled: false`, its
`sharedFolder` is the string `"null"`, and there is no
`cache/library-sync-last-run.json` at all — it has never completed a run on
this machine. So whatever happened here is *not* the vector that took the
three earlier workspaces, and not the one library-guard.js was built for.

**No usable record.** ProPresenter keeps no application log directory on this
machine, and the workspace RocksDB's own `LOG` files are all zero bytes.

**What Refrain does that could plausibly bear on it**, ranked, none proven:

1. A full crawl issues `/v1/presentation/{uuid}` for every presentation. Each
   one makes ProPresenter load a document and touch its catalog, so a crawl
   drives a heavy, sustained RocksDB write load the UI would never produce —
   and until item 31 above, the first crawl could land squarely on a
   just-launched app already rebuilding that catalog. A RocksDB left
   mid-write by a quit or a kill is a classic unrecoverable-on-next-open case.
2. `fs.watch` on library folders. Read-only by nature; no mechanism known.
3. Nothing else touches ProPresenter's own directories except the doctor,
   which only reads. It offers a `pkill` command but only when the main app is
   already gone, so it cannot be a kill-during-write.

**Not established.** I could not reproduce it, and I have no direct evidence
tying Refrain to this machine's failure. There is a `Bisect` workspace and a
`test` workspace here, which suggests the cause was investigated separately —
whatever that bisection showed is better evidence than anything above, and
should be written into this file.

## 34. SETTLED — ProPresenter counts disabled slides (and it already was)

**Correction first.** This was already resolved on 2026-08-30 by a trigger test
and written into `docs/propresenter-verification.md`. Item 21 claimed it was
still open, and I repeated that to Brandon as "the last unknown on the live
path". It was not. Before reopening a question, check the verification doc --
that is what it is for, and it had the answer.

What follows is independent corroboration by a different method, which is worth
keeping because it needs nothing on the screens.

The open question since the original arrangement plan: does ProPresenter skip
`enabled: false` slides when resolving a flat trigger index? If it did, every
slide after a disabled one would fire one position off, in four of the 184
songs measured in item 32.

**It counts them.** Settled on 2026-09-10 against the live rig, read-only,
with Refrain firing nothing.

Method, because it is reusable and cost nothing: Brandon opened
`Jireh (FS) - [ Ver 5 ]` and clicked the slide immediately after its disabled
one by hand. Under that arrangement the flat list is 39 slides counting the
disabled one and 38 without it, with the disabled slide at counting-index 28.

    ProPresenter reported index                     29
    Counting disabled, index 29 is                  "That is enough"
    Skipping  disabled, index 29 would be           "You are enough"

`GET /v1/status/slide` — an endpoint we had not used — then reported the live
slide's actual text as **"That is enough"**, and "You are enough" as the
*next* slide. So the reported index counts the disabled slide, and Refrain's
`flattenGroups`, which also counts them, agrees with ProPresenter.

**One residual assumption, stated rather than buried.** This proves the
*reporting* index counts disabled slides. Refrain's correctness depends on the
*trigger* index sharing that space, which propresenter-client.js records as
previously verified ("the pair round-trips straight back through
triggerSlide"). Both halves would have to be wrong in the same direction for
the conclusion to fail. If someone wants it airtight, triggering the index
that is already live is a safe check: it re-fires the slide already on screen
and changes nothing if this is right.

**No code change. `flattenGroups` stays as it is.** Recorded so nobody
re-opens it.

### Opportunity spotted while doing this

`GET /v1/status/slide` returns `{current: {text, notes, uuid}, next: {...}}`.
The live readout currently shows a presentation name and an index; it could
show the words that are actually on the screen, and what is coming next.
Not urgent, not tonight, but it is the single most useful endpoint found in a
while and nothing in the app uses it.

## 35. BLOCKER — Refrain did not know ProPresenter has a launchd service

Found live on 2026-09-11 while walking Brandon through a workspace repair. He
ran the doctor's own remedy three times and the helpers came straight back
each time, with new PIDs.

    launchctl list
    27829  -15  com.renewedvision.propresenter.workspaces-helper

`ProPresenter Helper (Workspaces)` is a **launchd service**. It has PPID 1 by
design, runs whenever ProPresenter is installed — app open or not — and launchd
restarts it within seconds of being killed. `ProPresenter Helper (Snapshots)`
is its child and inherits that legitimacy.

`findOrphanedHelpers` called any helper with PPID 1 orphaned whenever the main
app was absent. So this was not an edge case: it fired on every normal Mac,
every time ProPresenter was closed. Two consequences, and the second is worse
than the first.

### The doctor told operators to kill a service, with a dangerous command

Severity `problem`, the text "Until these are cleared, every launch attempt
fails the same way", and this remedy:

    pkill -f ProPresenter; sleep 2; pgrep -fl ProPresenter || echo "all clear"

That pattern matches `/Applications/ProPresenter.app/Contents/MacOS/
ProPresenter` — **the main app**. An operator who runs it while ProPresenter is
up force-kills it. A RocksDB workspace killed mid-write is precisely the
unopenable-on-next-launch case this screen exists to diagnose, so the doctor's
advice could produce the fault the doctor reports. Brandon ran it with the app
running this morning and ProPresenter went down with the helpers.

Whether that is what cost the workspaces is **not established** — but it is the
first concrete mechanism found by which Refrain could cause one, and it was
being recommended in a `problem`-severity banner.

The remedy is now targeted at the specific orphaned PIDs, never a pattern
kill, and launchd-managed helpers are not reported at all.

### The library guard refused every sync, forever

Worse in practice. `libraryWriteSafety` refused when `rows.length > 0` — any
ProPresenter process at all. The Workspaces helper is always one of them, so
with ProPresenter **fully quit** the guard still said:

    safe: false
    "ProPresenter is not fully closed — 2 of its processes are still running."

Library Sync could therefore never run on any normal machine. A safety check
that blocks the feature in all cases is not a safety check, it is an outage,
and this one hid behind an entirely plausible message. Verified live: the guard
now returns `safe: true` with the app closed, and still refuses when the main
app runs, when a genuine orphan remains, and when the API answers.

**Fail-closed is preserved**: if `launchctl list` cannot be read, nothing is
excused and every helper counts as blocking.

## 36. Persona panel review, 2026-09-24 — for review, not yet a work order

Three reviewers (ProPresenter tech, Creative Director, IT Director) rated the
nav and every screen from headless screenshots at 1280 and 455 wide plus the
source, with ProPresenter closed. The welcome modal covered every screen for
all three, so on-screen ratings are partial. They then each cast 5 votes, plus
at most one veto, on a merged list of 15 proposals.

**Ratings (PP / CD / IT):** Nav 7/7/7 · Search 7/6/8 · Live 6/6/7 ·
Scripture 6/5/6 · Flags 6/7/7 · Spell Check 6/5/5 · Lyrics 6/5/6 ·
Arrangement 7/7/6 · Library Sync 6/3/3 · Image Crop 6/6/7 · QR Codes 6/6/8 ·
Health 8/7/7.

**Ranked by votes:**

1. **BLOCKER — B3 Clear All arms before it fires (3 votes, all three).**
   `live.js:126` clears on one click, and Clear All is the page's only filled
   button. Fix: press once to arm (the label reads "Press again to clear"),
   then it disarms after about 3 seconds. Switch it to the outline style.
2. **BLOCKER — B2 Welcome modal only on first run, and never over Live or Health (2 votes).**
   It opens on any deep link, including `#live` during a service
   (`nav.js:548–556`), and at 455px it spills past both screen edges. The IT
   Director added: never over Health, so a volunteer can read out status.
3. **CRAFT — B1 Rail auto-collapses below ~600px (2 votes).**
   The expanded rail is 144px and clips Live's "Turn off" to "Turn o". Use the
   existing `w-14`/`ml-14` static homes.
4. **CRAFT — B5 One disconnect state on Search (2 votes).**
   The amber banner and the NO LINK readout say the same thing. Amber also
   breaks the brief's rule of no saturated warm colour except live. Put the
   index-age warning in muted text.
5. **CRAFT, CONTESTED — B4 Clear buttons when LINK is down (+2, −1).**
   The PP tech and IT Director want them disabled or labelled offline, and the
   "Clear still works" line dropped. The Creative Director vetoed: disabling
   removes the one control an operator may still need, and the LINK lamp
   should carry the state. A possible middle ground is to leave Clear enabled
   and make its failure loud. **Open decision for Brandon.**
6. **CRAFT — B7 Library Sync stores the string "null" (1 vote, verified).**
   `index.js:1990` runs `String(body.sharedFolder)`, so clearing the field
   saves `"null"`. The dev config has it now: Health reports
   `sharedFolder: "null"`. Fix the input, and treat a stored `"null"` as unset.
7. **CRAFT — B9 A disabled module's route explains itself (1 vote).**
   Right now `#library-sync` silently lands on Search. The Creative Director's
   wording: "Share Library is off. Turn it on in Health." Take the name from
   the module's display name.
8. **POLISH — B12 One shared page header (1 vote).**
   Scripture, Lyrics, Spell Check, Image Crop and QR Codes use a bare `<h1>`.
9. **B6, REFUTED on check (1 vote).**
   The claim was that Arrangement shows "active" with no folder set. In fact
   `storage/local-folder.js:16` defaults to `./data/arrangements`, so active is
   true. Residual POLISH: Health should show the default path instead of
   `null`.

**No votes (keep as POLISH, batch later):** B8 remove the vendor literal
`"planning-center"` at `config.js:78` (this is a real CLAUDE.md rule
violation, so it should probably be fixed regardless of votes). B10 Spell
Check offline copy. B11 label repeated Arrangement songs. B13 move Spell Check
and Lyrics to Prep. B14 shorten the performance-mode line. B15 Health Modules
card.

## 37. PLAN — The service system: checks before, flags during, timeline, close-out after

Issues #3 (playbook), #6 (timeline), #4 (summary delivery), #8 (second-device
flags), #5 (arrangement audit) and #7 (progress feed) describe one system from
six angles. This is the order to build it in, and what each piece reuses. Nothing
here is started. Open decisions are at the end; phases 1 and 2 don't depend on
any of them.

### What already exists and gets reused, not rebuilt

| Need | Already have |
|---|---|
| What is on the screens, when it appeared | heartbeat `liveState` (`slide`, `liveSince`), about every 4s while a browser is open |
| Quiet during a service | performance mode: arms itself on live, stops index work |
| Playlist-scoped checks | Spell Check scan: typos, past dates, missing media (#9) |
| Flags during the service | Live type grid, Search chip, Flags screen (#1, #2) |
| Post-service arrangement check | Arrangement "Compare all songs" |
| Safe shared storage | one-file-per-record, local first then copy (slide-flags.js) |

### The one new idea: a Service Day record

Everything hangs off a **day**: `data/service-days/<date>/`, one file per event,
append-only, on the same pattern as flags (a synced folder works with no
Dropbox conflict copies). A day holds one or more **services** (for example
5PM, 9AM, 11:15AM). Each service has a **service playlist**, picked once at
pre-service. Nothing is rewritten. "Current state" is the events folded in
order, which is also what makes it survive a restart mid-service (#6
acceptance).

Events: `phase-entered`, `check-result`, `service-started`, `item-live`,
`item-left`, `service-ended`, `flag` (a reference to the existing flag id, not
a copy), `day-ended`.

### Phases (config JSON, per #3)

`config.json › serviceModule.phases`: an ordered list, each with steps. A step
is either **automatic** (a check Refrain runs, from a small registry of check
ids), or **manual** (a checkbox with a sentence: "Screens on", "Stage display
showing"). Campuses edit the list and never touch code. A default list ships,
which the steps below describe.

**1. Arrive** (manual plus two automatic)
- ProPresenter answering (heartbeat)
- ProPresenter finished its own startup indexing. Handoff 31 already covers
  "don't crawl a just-launched app", so this waits for it rather than racing it.
- Manual: screens, stage display, audio, confidence monitor

**2. Pre-service: "checks before" (automatic unless noted)**
- **Pick the service playlist(s).** This is the only required input, and every
  check after it is scoped to it.
- Index fresh for those presentations (index staleness already exists)
- Spell Check scan of the playlist: typos, past dates, missing media (#9)
- **Arrangement references that don't resolve (#5).** The .pro decoder from #9
  is the groundwork. This is the next check to build.
- Duplicate names across libraries, limited to the playlist's presentations
- Library Sync backup fresh, if that module is on
- Theme conformance, once "current theme" is defined (section 36 NOTE)
- Each check reports **pass / needs a look / couldn't check**. "Couldn't
  check" is never shown as pass: the same rule as the scan's unreadable
  count.
- All of this runs before the first slide goes live. Once performance mode
  arms, pre-service checks that need ProPresenter refuse to start and say
  why, rather than adding load mid-service.

**3. Service running: "flags in the middle"**
- Deliberately quiet. The playbook screen shows one line per service ("9AM
  running, 42 min, item 6 of 11, 2 flags"), and nothing asks for attention.
- Flags: the Live grid as today, each flag tagged with the service it fell in.
- **Timeline (#6)** records passively; see below.
- Later: **second-device flags (#8)** and the **progress feed (#7)** both read
  the timeline. They come after the timeline exists, not before.

**4. Between services**
- Manual reset list (clear screens, reset stage timer, back to the pre-roll)
- Automatic: "flags from the last service", listed once, not nagging
- The next service starts on its own when its first playlist item goes live,
  or by hand

**5. Post-service: "checks after"**
- Work the flag list (the Flags screen, filtered to today)
- Arrangement drift compare for the songs **actually shown** (from the
  timeline), not the whole plan: the #3 open question, answered by having the
  timeline
- Timeline review: per-service durations side by side

**6. End**
- One press. It stops per-day capture, runs the drift compare without asking
  (results listed, never pushed: pushing stays deliberate, per #3), and writes
  the **day summary**.
- The summary is a rendered file in the day folder: flags by service and type,
  drift found, checks that failed or were skipped, and the timeline table.
  Email or folder delivery (#4) is a plugin that sends this file, later.

### "Run down of timing": the timeline, precisely

**Signal:** the heartbeat's `slide.presentationId` changing. No new
ProPresenter calls, so it's safe under performance mode.

**Mapping a presentation to a playlist item:** the service playlist fetched at
pre-service gives the ordered items, each with its presentation id. A live
presentation that matches item *n* is an `item-live` for *n*. One that is in
no service playlist (an ad-hoc song, a countdown fired by hand) is recorded as
**off-plan**, with its name. That is useful ("we ran an extra song"), and it is
not dropped.

**Recorded per item:** first live, last live (a revisit never overwrites the
first, per #6), total time on screen, and the gap before it (time with
nothing live, or the previous item). Plus, per service: start (first item
live), end (last item left, or End), and overrun against the same service
last week.

**The report** (post-service screen and summary):

```
9AM                         started 9:01:12   ran 1:12:40
  #  item                 live at   on screen   gap before
  1  Countdown            9:01:12     2:00        –
  2  The Joy              9:03:20     4:10       0:08
  3  Wait On You          9:07:40     5:02       0:10
  4  Announcements        9:13:05     6:44       0:23
  5  Message              9:20:02    38:15       0:13
     ↺ The Joy            10:05:30    1:40      (revisit)
  +  Off-plan: Doxology   10:07:18    0:55
```

Plus "11:15AM ran 3:40 longer than 9AM. Most of it in Message (+3:05)."

**Two things this plan changes, and why:**

1. **The heartbeat must stay at active pace for the whole service phase.**
   Today it slows to 30s when no browser is polling (heartbeat-pacing.js).
   That is right when idle, but it would make timeline timestamps ±30s.
   During an active service, the pacing uses the 4s interval whether or not a
   browser is open. It is still the same two calls of about 3ms each, the
   ones that already run during every service where the Live screen is open.
2. **Timestamps are "first seen", not "went live".** With a 4s beat, an item
   is stamped up to 4s late. The report says so once (±4s) rather than
   showing seconds it can't vouch for. An item live for less than one beat
   can be missed entirely. That is acceptable for a rundown, and stated.

### Build order

Each phase ships on its own and is useful without the next.

1. **Service Day record plus the timeline** (#6). Storage, the
   presentation-to-item mapping, first- and last-live, off-plan, heartbeat
   pacing during service, a post-service timeline table. Tests: event folding,
   revisit, off-plan, restart mid-service, pacing rule.
2. **Pre-service checks screen.** Pick playlists, run the existing checks as
   one list with pass / needs a look / couldn't check. Add the #5 arrangement
   audit as its first new check.
3. **Playbook phases from config** (#3). Manual steps, phase screen, the quiet
   service line, the between-services list.
4. **End plus the day summary.** Auto drift compare on songs shown, summary
   file, flags tagged by service.
5. **Delivery plugins** (#4): folder first, then email (the first thing that
   sends data off the machine, so opt-in and reviewed, per the issue).
6. **Second-device flags** (#8) and the **progress feed** (#7). Both read the
   timeline, and both are a separate, narrow, read-mostly route with no path
   to any control.

### Open decisions (owner)

- **What starts a service:** the first item of its playlist going live
  (automatic), or a Start press? Automatic is proposed, with manual override.
- **Several services, one playlist, or one playlist per service?** The 9/20
  plan lists all three times in one plan, but ProPresenter playlists here are
  per service ("SL-09", "SL-11"). Per-service playlists are proposed.
- **End then another service** (a #3 question): proposed that End closes the
  day, and a later service reopens it with a visible "reopened" event rather
  than silently rolling over.
- **Nagging:** an unfinished playbook shows once on Health the next week,
  then stops.
- **Where the playbook lives in the rail:** proposed as a new Service item
  ("Service"), above Search, because it is the day's front door.
- **Theme conformance definition** (still open from section 36).

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
- 2026-08-29 · Dark by default; light theme kept as documented secondary · done · 86c5e0c
- 2026-08-29 · Return history, ten places · done · 35997f7 · verified on the live rig
- 2026-08-29 · Macro icons from ProPresenter's image_type · done · 61ecd60
- 2026-08-30 · Item 1 · partial · Show-only header, Show on slide rows, collar
  lands on the informed action. **The server half is not possible**: ProPresenter
  21.3 exposes no slide-level focus. `/v1/presentation/{id}/focus` returns 204,
  `/{id}/{n}/focus` and `/{id}/focus/{n}` both 404, and `slide_index` is not
  writable (PUT and POST both 404, nothing fired). An index only ever appears
  alongside `trigger`, which is the hazard the item exists to avoid. So Show
  opens the presentation, never the matched slide.
- 2026-08-26 · Icon default, uniform key bank, 100/100 names · done · ae928d4
- 2026-08-26 · Narrow-plus-pointer rule corrected · done · 1b56e5b
- 2026-08-26 · Button spring killed, rail keys stilled · done · 7841005
- 2026-08-26 · Collapsed rail to 3.5rem · done · 66c1a51
- 2026-08-27 · LINKED lamp on the icon axis · done · a97104b
- 2026-08-27 · btn-brand plum in light theme · done · 3b175ce
- 2026-08-27 · Tier heights + touch floor into light theme · done · 6b53a37
- 2026-08-27 · Link lamp printed, not lit, in light theme · done · 14e698e
- 2026-08-27 · Index meter renders in light theme · done · add13de
- 2026-08-30 · Item 1 · partial · Show-only header, Show on slide rows, collar
  lands on the informed action · f10c3e9 · **server half impossible**: no
  slide-level focus in ProPresenter 21.3 (`/{id}/focus` 204, `/{id}/{n}/focus`
  and `/{id}/focus/{n}` 404, `slide_index` not writable). An index appears only
  with `trigger`. Show opens the presentation, never the matched slide.
- 2026-08-30 · Blocking alert() off the live path · done · d630ecf · five sites,
  not three — both of spellcheck.js's were missing from the item. Non-blocking
  overlay: layout does not move, focus not taken, control stays pressable.
- 2026-08-30 · Verification checklist 2b–2d · done · ran against the live rig.
  Arrangement correction proven with a real divergence (stale index 58 re-pointed
  to 19, right slide fired). Performance mode arms itself at 2min, `source: auto`,
  and a manual arm outlasts a clear. Incremental reindex: 445 carried, 0 changed,
  68ms. **Open question resolved**: ProPresenter counts disabled slides, so
  Refrain is right to; and they are common (16 of 45 presentations), not rare.
  Not run: anything needing a slide edited in ProPresenter, a full rebuild the
  night before a service, a 20-minute wait, or quitting the church's ProPresenter.
- 2026-08-30 · Item 2 · done · container cap dropped, measure moved to the text,
  key bank to 4/5 columns, dock nudge re-aimed to the booth path. 1280px:
  368px dead -> 0, main 768 -> 1136. Docked 460px unchanged at 316. Only 15
  distinct prose sites needed measure, not the whole app.
- 2026-08-30 · Item 1d · done · crash report the operator copies. Nothing sent:
  no SMTP, no endpoint, no config, no dependency. `/api/build` exposes the commit
  (read from .git, no subprocess), cached client-side at boot so a report still
  has it when the server is what died. Breadcrumbs record what was pressed, never
  what was found — verified against a real crash: query and presentation names
  absent, trail intact. 19 tests on redaction and on the report surviving
  circular payloads and throwing getters.
- 2026-08-30 · Item 1b(a) · done · index staleness surfaced. `indexStaleness()`
  beside `fullRebuildSuggestion()`, same shape, 2-day threshold with the reasoning
  written down. Text state with a one-press Refresh, not a lamp. Returns null when
  fresh so nothing renders — no all-clear nobody asked for. 6 tests including the
  observed four-day case, clock skew, and unparseable dates.
- 2026-08-30 · Item 3 · done · rail is a butted key bank. gap 0, radius 0, scoped
  to the rail. Verified pinned and collapsed: seams between keys measure 0, the
  only non-zero breaks are the two group grooves, glyphs stay centred at 56px.
  The machined groove was already built to spec and carries the column at gap 0.
  Note for item 8: the latched key does read more present between butted
  neighbours, so re-check whether widening the accent edge is still needed.
- 2026-08-30 · Item 1c(b) · done · Live's tiles set in --rf-sans. My own miss from
  the tile rename: I wrote that `text-transform: none` was load-bearing because
  these are names the operator typed, then set them in mono, which restyles them
  just as surely. "Full Screen/Standard" measures 114px in sans against 154px in
  mono and now fits one line.
- 2026-09-01 · History records from the first item, not the first jump · done ·
  Brandon. The heartbeat now records every presentation that goes live, so the
  panel fills from the first item ProPresenter loads. Item granularity, not slide
  — 30 advances through one song add one entry. Cap 10 -> 30 to cover a service.
  The pin is held separately from the history now: the head is what is on screen,
  so reading the bar off it would have offered to return you where you already are.
- 2026-09-01 · Workspace corruption · done · Library Sync wrote .pro files into a
  live ProPresenter library with no running-check of any kind. Three workspaces
  corrupted; a sync ran the night before the last. Four fixes: (1) refuse to sync
  in either direction while ProPresenter runs, failing closed, plus no more mtime
  back-dating; (2) fingerprint from stat() only — Refrain never opens a library
  file now; (3) heartbeat backs off 4s->30s with no client, 1800->240 calls/hr;
  (4) crawl aborts after 10 consecutive read failures instead of asking 221 more
  times. Measured: the heartbeat was NOT hammering (3ms, 0 failures) — said so
  rather than confirming the theory.
- 2026-09-01 · Item 4 · done · status cluster replaces the orphaned LINKED row.
  LINK / LIVE / PERF, recessed sub-panel, score line above, not interactive.
  Index deliberately has no lamp. Verified on-axis both states: 20 expanded,
  28 collapsed (exact rail centre), legends drop. I first used the bare 7px
  .rf-led and it centred at 15.5 against a 20 column — the spec said keep the
  16px construction and it was right.
- 2026-09-01 · Items 1c(a), 1c(c), 5 · done · all three were one root cause.
  Live, Image Crop and QR Codes got real <h2>s — and immediately rendered at 17px,
  because `main h2:not(.card-title)` was putting the badge face on any heading
  that had not opted out. That same rule was item 5 (Health's 17px "Settings"
  beside 10px card titles) and item 1c(c) (12px vs 9px). Blanket rule deleted;
  headings now take a treatment by name. Verified across eight screens: exactly
  two treatments, card-title 10px and subhead 9px, no unclassed headings.
- 2026-09-01 · Item 7 · done · macro tiles carry the macro's colour. Reverses my
  earlier decision, correctly: dropping it was a stronger form of restyling than
  showing it. Flat 10px swatch, hairline rim, never a glow — printed ink cannot
  be read as the live emitter. Malformed colour degrades to no swatch, never to
  black (6 tests). 26/26 macros, 15 distinct colours, Looks untouched.
- 2026-09-01 · Item 8 · done · and NOT moot, correcting my own earlier flag. The
  butting did make the latched key structurally more present, but its legend and
  icon measured identical to all eight unlatched ones (#A295AC) — so the screen
  you were on was the hardest label to pick out. Legend to --rf-text (16.25:1 vs
  6.53:1), edge 2px->3px with the section-marker bleed. My "light never brightens
  on press" ruling was wrong: occlusion applies to emitted light, not printed ink.
- 2026-09-01 · Item 11 · done · Arrangement rebuilt to the list-and-compare
  spec. Rows are no longer keys: flush at chassis level, hairline grooves,
  hover as the affordance, two lines — which takes the song name from ~150px of
  a 316px column to the full width (measured 432px at a 640px viewport, geometry
  independently checked as 16+8+432+16 = 472). Status is a lit/unlit lamp on the
  16px column, not green versus amber; that construction was lifted out of
  `#status-cluster` into `.rf-led-col` rather than copied, and the cluster
  re-verified unchanged. Filter has a visible label and a live count. The detail
  view's comparison is now the hero: both sequences in the same type on the same
  axis, with genuinely extra or missing sections marked by multiset difference
  (a positional diff paints everything after one insertion and says nothing).
  Editing is one press away and puts itself back.
  Two corrections to my own work along the way. The song name was sitting in the
  `.card-title` slot, which in dark theme is mono, uppercase, letterspaced plum —
  so the hero was restyling a name the user wrote. The heading now says
  "Comparison" and the name is content beneath it in ordinary type.
  And a real bug the spec did not ask about: both save handlers read
  `e.currentTarget` after an await, where it is null. The catch block threw on
  it, so a failed save re-enabled nothing and showed no notice at all — a
  rejected write looked exactly like a successful one. Captured synchronously;
  both failure paths now report and keep the operator's typing.
  Verified against a running server in both themes: reader/logger split intact,
  stale-response guard intact under a 600ms/0ms race, marked and unmarked rows
  share a left axis in both lists, 44px touch floor engages. Light-theme gaps in
  `--rf-muted`/`--rf-fault` are pre-existing and app-wide — logged as item 22.
- 2026-09-02 · ProPresenter surface review · items 14, 15, 16 fixed; 17 partly.
  Item 14: `anchorsAvailable`/`indexAccuracyNotice` in search-index, surfaced
  through index-status and rendered on Search, where accuracy outranks age —
  a week-old index is annoying, a stale-schema one can put the wrong words on
  the screen, and the two must not read alike. Verified by actually setting the
  cache to schema 2 and aging it seven days: both notices true, the wrong-slide
  one shown, one message and one button. Cache restored, shasum verified.
  Item 15: `syncLibrary` takes `safeToContinue` and re-asks on a throttle, over
  the backup loop as well as the copy loops, because in `send` direction the
  folder being read for backups IS the live library. Aborts and reports what it
  managed. The route re-checks between the snapshot and the first write too, and
  the initial check and the re-check are now provably the same question — one
  `librarySafety()` closure feeds both.
  Item 16: the anchor lookup was on the 20s live budget on top of the trigger's
  own 20s, so a wedged ProPresenter took ~40s to report a failure with the
  button disabled. Optional pre-work now gets 4s (anchor) and 3s (return-pin
  read); the trigger keeps its full 20s, because a slow-but-working
  ProPresenter must not fail to go live. Response carries `anchorChecked`, which
  is a different claim from `corrected` and the only honest one on a timeout.
  Item 17: `test/propresenter-client.test.js` added — the timeout budgets both
  ways, `getCurrentSlide`'s validation including the slide-0 falsy-zero trap,
  non-2xx throwing rather than resolving null, and 204 not being parsed as JSON.
  The rest of the client (playlist filtering, message tokens, normalizeIdList)
  is still untested.
  Found and fixed while measuring: this rig's ProPresenter was wedged all
  session — TCP alive, `/v1/version` in 14ms, every real endpoint hanging past
  30s. That turned into the test case for the whole review, and every safety
  mechanism was observed failing safe on it, including performance mode arming
  itself on unknown layers and correctly deferring the rebuild.
  254 tests, lint clean.
- 2026-09-02 · Review items 18, 19, 20 fixed. Also renumbered my own light-theme
  finding from 13 to 22 — 13 was already "Only Brandon can close this".
  Item 18: a `seg()` helper encodes every interpolated path segment in the
  client. A no-op for a real uuid, which is the point and what the test asserts;
  the traversal test asserts path SHAPE rather than the absence of dots, because
  `encodeURIComponent` leaves `..` alone and encodes the slashes — my first
  version of that assertion was wrong about its own mechanism.
  Item 19: `parseSlideIndex` checks the type before coercing. Running it against
  a live server caught a hole in my own first fix: `slideIndex: null` passed,
  because `Number(null)` is 0, so a caller with a missing index would have
  quietly fired the first slide of the song. Same for "", [] and true. All
  rejected now, verified against the route. It lives in `arrangements.js`
  because `server/index.js` calls `app.listen` at module scope, so importing it
  to test one function boots a server — which is also why the routes have no
  unit tests, worth fixing some day.
  Item 20: folder matching is case- and whitespace-insensitive, iterating
  ProPresenter's folder order so a twice-matching config entry cannot crawl the
  same folder twice. `getLibraryDetailed` reports unmatched names, failed
  folders and what names were actually available; `getLibrary` still returns a
  bare array so callers are untouched. Carried onto the index so a restart does
  not make a missing folder look resolved, and rendered on Health — together
  with `crawlAborted`, which turned out to be surfaced nowhere either, so the
  circuit-breaker abort was equally invisible. Verified end to end by injecting
  the issue into the cache: the screen says "Configured folder not found: songs.
  This library has: Songs, Hymns, Liturgy." Cache restored, shasum verified.
  267 tests, lint clean.
- 2026-09-02 · Items 6, 9, 10, 12 and 22 done. Remaining: 21 (blocked on a
  healthy ProPresenter), 13 (Brandon's), and the rest of 17.
  Item 22 fixed at the token, not per rule: `[data-theme="light"]` gives
  `--rf-muted` #685F72 (6.05:1) and `--rf-fault` #8A5A00 (5.93:1), so ~20
  unscoped `var(--rf-muted)` rules became correct at once and Arrangement's
  three dark-scopings could be reverted. The fault override had to be
  co-located directly under its `:root` declaration — placed with the other
  light tokens 1,070 lines earlier it read correctly, lost the cascade at equal
  specificity, and still measured 2.75:1. Exactly the trap in this repo's own
  CLAUDE.md, walked into anyway.
  Item 10 done by resolved value, and grep would have been actively wrong:
  `text-warning` already resolved to phosphor, `badge-success`/`badge-info` to
  the muted LED, `alert-warning`/`alert-info` to plum tints, Health's
  `badge-error` to the fault dot. The genuinely raw ones were green #00A96E,
  red #FF5861, cyan #00B5FF and amber #FFBE00. Status dots became `.rf-led`,
  transient results `.rf-flag`/`.rf-nominal`, and the utilities themselves were
  given palette values so a future `text-error` cannot land back on stock
  DaisyUI. The search highlight was the worst of them — raw #FFBE00, the
  saturated warm reserved for live output, behind lyrics on every result. Now a
  plum wash plus a 2px inset underline, which is what actually marks it: the
  wash alone measured 1.35:1 against the card, the underline 4.79:1 dark and
  5.07:1 light.
  Item 9: scroll persists per screen, and two things had to be fixed to make it
  work. `focusSearchInput` called `q.focus()`, which scrolls a 31,000px view
  back to the top and silently undid every restore — it takes `preventScroll`
  now. And the restore ran its first attempt on `requestAnimationFrame`, which
  never fires in the preview pane, so the one step I could not observe was the
  one that mattered; it runs on the same timer as its own retry loop now.
  Verified 900->900 and 2400->2400 across two hops, with a screen that has no
  saved position still landing at top. Onward actions: Spell Check walks flagged
  slides, Arrangement walks divergent songs, Lyrics ends on "Find it in Search"
  carrying the song title. Both walks are focus-only, never trigger.
  Item 6: history rows are role=button, tabindex=0, labelled, Enter-operable,
  and call `/api/focus` only — verified that Ignore posts its own call without
  opening the editor.
  One bug worth remembering: `querySelectorAll("[data-slide-index]")` also
  matched the Go Live button nested in each card, so "next" walked 6 slides
  where there were 3 and landed every other step on a button. Both walks now
  select an explicit class. A bare attribute selector is not a hook.
  267 tests, lint clean. config.json and the index cache were each swapped for
  verification and restored, shasum verified.
- 2026-09-02 · Item 17 closed. All twenty public methods on the client now have
  a direct test (281 total, up from 267). The ones worth having: the macro
  alignment regression, where a single entry without a uuid used to shift every
  icon after it and mislabel the whole bank; `getMessages` accepting both token
  shapes ProPresenter has used; `triggerMessage` turning a missing value into an
  empty string rather than letting "undefined" reach a screen; `getPlaylistItems`
  dropping headers, which have no uuid to trigger; and `getFileDates` returning
  nulls on a remote ProPresenter instead of a guess that would narrow every
  date-filtered search. The two list endpoints are pinned by path, because the
  two-step library crawl was recorded only in a comment.
  Remaining on the review: 21 only, and it is blocked rather than pending.
- 2026-09-02 · Todoist archive assessed and the two live items closed. 24 of 26
  tasks were already shipped, verified against the code -- the project is an
  archive with nothing checked off, as CLAUDE.md says. Search now acknowledges a
  keystroke in 0.2ms and caps its render at whole songs, which took the worst
  case from 4.8s to ~1.2s; the task's own prescription (drop the debounce) would
  have made it worse and was not followed. Health's tooltips are down to a mean
  of 18 words. New finding 24 records the residual ~1s render, which needs
  windowing and is deliberately left open. 281 tests, lint clean.
- 2026-09-02 · Review finding fixed, and it was the visible corner of a larger
  one: `runSearch` had no error handling of any kind. A rejected fetch left the
  new "Searching" line up permanently (mine), a 500 threw inside `res.json()`
  because `res.ok` was never checked, failures were never reported despite
  `showFailure` already being imported, and two in-flight searches could render
  out of order -- pre-existing, but the 200ms-to-90ms debounce change made it
  much more likely. All four fixed and exercised against a running server.
  281 tests, lint clean.
- 2026-09-10 · Concert-eve pass on ProPresenter workspace risk. Four fixed:
  first-run setup crawling with no live check (the fresh-machine one), a
  rebuild that could not be stopped once started, Image Crop moving files out
  of a folder that could be ProPresenter's, and a test suite that was red on
  Node 20 while writing into the real project root. The stop mechanism nearly
  shipped with a bug of its own -- stopping on `frozen()` for every rebuild
  would have broken the Health rebuild buttons, since performance mode arms
  when ProPresenter is merely unreachable. 291 tests green on Node 20.
- 2026-09-10 · ProPresenter came back (its Network API had been off, then the
  app settled). First build now waits for ProPresenter to settle, on both boot
  and setup — the watcher always had that gate and the one build a fresh
  machine cannot avoid did not. Disabled-slide exposure measured at last: 4 of
  184 songs, worst case 22 slides behind the first disabled one. On the
  bootstrap failure Brandon attributes to Refrain: Library Sync is ruled out
  with evidence (never ran here), no logs survive, and nothing else is proven —
  recorded honestly in item 33 rather than guessed at. 291 tests, lint clean.
- 2026-09-10 · Item 21 settled after standing open since the original plan:
  ProPresenter COUNTS disabled slides in its flat index, so Refrain's
  flattenGroups was right all along and no change is needed. Proved read-only
  against the live rig — Brandon clicked the slide after the disabled one, and
  `/v1/status/slide` (an endpoint nothing in the app uses) confirmed the live
  text matched the counting interpretation. Four songs that looked at risk are
  not. Also noted: that endpoint reports current AND next slide text, which the
  live readout could use.
- 2026-09-11 · Refrain did not know `ProPresenter Helper (Workspaces)` is a
  launchd service. It was reported as an orphan on every machine whenever
  ProPresenter was closed, with a `pkill -f ProPresenter` remedy that also
  matches the main app — so the doctor could talk an operator into force-killing
  ProPresenter mid-write. And the library guard, counting the same helper,
  refused every sync forever while claiming ProPresenter was "not fully closed".
  Both fixed, launchd-aware, fail-closed preserved. 303 tests.
- 2026-09-13 · Search forgives a dropped apostrophe · done · b2f0e06 · "dont"
  matched 0 slides and now matches 192; "youre" 150, "cant" 95. The fold runs
  ONE way on purpose: folding the query too made "i've" match "give" and
  "important", 1,599 results against a 445-presentation library where 56 were
  wanted. Curly/straight is unified on both sides (encoding, not meaning);
  removing the mark applies to slide text only. Doing it per keystroke doubled
  search time (4.5ms → 9.3ms), so the lowercased and folded forms are now
  derived once per index load and dropped whenever the index is replaced —
  2.7ms, faster than before the feature existed. Verified through a real
  incremental reindex: same counts, same speed, no stale text. Fuzzed with 593
  real phrases from the 3,808 apostrophe-bearing slides in four forms each,
  zero misses; every result from 27 queries proven justified.
- 2026-09-13 · Three ways out of a stale query · done · b2f0e06 · a clear button
  inside the field, Esc while the field has focus, Alt+X from any screen, all
  through one clearSearch(). Alt+X matches on `e.code`: Option+X on macOS
  produces "≈", so an `e.key === "x"` check does nothing on exactly the machines
  this runs on. Asked about double-click-to-clear and declined it — double-click
  already selects the word under the cursor, which is the better gesture for
  refining a query, and binding it to clear would destroy a half-typed search on
  the reflexive double-click of a rushing operator.
- 2026-09-13 · Click-to-select-all in the search box · done · b2f0e06 · one click
  and type replaces the query, address-bar style. **The obvious implementation
  does not work**: a click on an unfocused field fires `focus` BEFORE
  `mousedown` (so "was it focused at mousedown?" always reads true) and places
  its caret AFTER `mouseup` (so anything selected in those handlers is
  collapsed). Measured, not guessed. The flag is raised on `focus` and the
  selection made from a timeout after `mouseup`, skipped when the click left a
  selection of its own so click-and-drag survives.
- 2026-09-13 · Highlighter re-synced to the matcher · done · b2f0e06 · it mirrors
  both apostrophe rules through an index map back to the original string, and
  now collapses whitespace the way normalizeText does — a doubled space returned
  four results and marked none of them, which predates this work. The standing
  check is "every result the server returns must be highlighted": 46 queries,
  4,544 rendered rows, zero unmarked.
- 2026-09-13 · Todoist "Refrain App" triaged against the code · 25 of 27 already
  shipped, including the too-wide callout (`maybeShowDockNudge`, 900px, once per
  session, Search only). The render-cost finding no longer reproduces: 124–219ms
  including the 90ms debounce, bounded by MAX_RENDERED_SLIDES. Two left, both
  needing Brandon: the ambiguous "History allows going back to a song but not
  then going forward into an item just used", and whether to close the 25.
- 2026-09-13 · Start at login, as a button · done · the LaunchAgent scripts
  existed but asked the operator to find a file in a folder and trust it, which
  is the step that does not happen. Health now has a **Start at login** card
  that installs and removes it. The plist is generated by `server/autostart.js`
  — one generator, used by the button and by the scripts, because a second copy
  of that XML in bash is how the two drift. `process.execPath` is the
  interpreter written into it, which is strictly better than the shell hunting
  for Node. **The failure a button makes easy** is enabling it while Refrain is
  already running in a Terminal: a second copy cannot bind the port, dies, and
  a `KeepAlive: true` agent restarts it forever. So the plist uses
  `KeepAlive: {SuccessfulExit: false}` and the server exits 0 on EADDRINUSE
  with a line saying which copy is live. Proven on this machine end to end:
  launchd loaded it, the second copy stood down, `LastExitStatus = 0`, no PID,
  no restart — then removed, and `~/Library/LaunchAgents` left clean.
- 2026-09-13 · NOTE · ~~`npm test` is flaky while a dev server runs against the
  same checkout~~ — **CORRECTED 2026-09-15.** That diagnosis was wrong. The
  flake reproduced with no server running. The real cause was
  `library-watch.test.js`'s "a real .pro file change triggers a debounced
  reindex", which used a 40ms debounce: creating and writing one file can
  surface as two fsevents more than 40ms apart on macOS, so one save landed in
  two debounce windows and reported two reindexes. Raised to 120ms, matching
  the sibling burst test that has never flaked; the assertion is still exactly
  one, because collapsing events is the property under test. 8 clean runs of
  that file, 5 clean full suites.
- 2026-09-13 · NOTE · on this machine a Next.js dev server also binds port
  3000. Refrain binds `127.0.0.1` explicitly and Next appears to take the IPv6
  localhost, so `http://localhost:3000` can reach the wrong one while
  `http://127.0.0.1:3000` reliably reaches Refrain. Worth knowing before
  debugging a "Refrain is serving someone else's site" report.
- 2026-09-15 · The index could not finish on the 973-presentation library, and
  the reason was not load · done · bcae100 + this change. Probing ProPresenter
  directly: HTTP 500 on 25 of 120 documents, and **all 25 succeeded when asked
  again**. Reads were already sequential (concurrency 1), so nothing was going
  too fast, and nothing is corrupt — it stops answering in bursts and recovers.
  Refrain had no retry at all, those failures cluster, and a run of ten ended
  the crawl: two operator-initiated attempts stopped at 25 and 38 of 864,
  leaving 826 presentations on four-day-old slide text.
  **Two fixes, and the second matters more than the first.** A read is retried
  once after 750ms; and everything that still failed is swept once at the END
  of the crawl, when the burst is over. The sweep is the one that catches the
  hard case — a burst can outlast both the read and its retry, which is exactly
  how 7 presentations (734 slides, whole message decks) were dropped from
  search while reading perfectly a minute later. Retrying harder inline is the
  wrong shape: it lengthens every failure during a genuine outage, which is
  precisely when the crawl should be ending.
  First complete crawl of that library: **843 of 843, no abort, 41.7 min,
  37,899 slides, anchors on all 952 non-empty presentations.** The other 21 are
  genuinely empty in ProPresenter (outlines, notes, "Temp") — verified by
  probing each one twice, not assumed.
- 2026-09-16 · DaisyUI responsive audit · done · a8b3349 · nothing overflows the
  viewport on any of the nine screens at 380px or 455px — the `.alert` and
  radius fixes did generalise. What it caught was the wide info tooltips: at
  380px, 10 of Health's 20 ran off the right edge (worst 91px) and
  `body { overflow-x: hidden }` was swallowing it, so the operator read a
  sentence that stopped. The per-field `direction` argument was the wrong
  altitude and had already fallen behind the layout — its four hand-placed
  `tooltip-left` ones ran off the OTHER edge. One measurement replaces it.
  **Two traps worth keeping.** `transform: translateX(calc(-50% + shift))`
  LOSES to DaisyUI's own transform on `.tooltip:before` even at higher
  specificity, because the vendored Tailwind JIT injects its sheet at runtime
  after the page's own — the property was set, ignored, and everything read as
  fixed while still clipping. The shift is a `margin-left`, which DaisyUI never
  sets here, so it composes instead of competing. And **I verified a model
  rather than the render**: it reported 0 off-screen while 17 were, because the
  box is not always centred on its icon (`tooltip-left` places it entirely to
  one side) and because collapsed `<details>` return meaningless computed
  values. Measure the used `left` + `margin-left` + transform, and filter to
  elements with an `offsetParent`.
  Not changed, worth an eye someday: Arrangement's 53 "clipped" elements are
  all deliberate `text-overflow: ellipsis`, but a song name truncated by 368px
  at docked width shows very little.
- 2026-09-16 · Default port is now 9999 · done · fbd4226 · 3000 is the busiest
  port on any machine that has run a dev server, and this one proved it: a
  Next.js server already held 3000 on the booth Mac, so `localhost:3000`
  reached the wrong app while Refrain answered on 127.0.0.1. 9999 is quiet and
  a volunteer can remember it. Everything downstream reads the port rather than
  hardcoding it. **Existing installs move on their next restart**, so a
  bookmark or Chrome app-mode window pinned to 3000 needs repointing once.
- 2026-09-16 · Forward into the item just used · done · 004be30 · the last of
  the three "Important Feature requests" bullets. The heartbeat records
  everything on the screens, but every 4 seconds — and "find it, send it, go
  back" fits inside that window, so the song just used left no trace and there
  was no way forward to it. Intermittent by nature, which is why it was hard to
  describe. The trigger now records its own destination, pushed after the pin
  so it lands in front of it. **Not verified end to end**: that means putting a
  slide on the church's screens. One minute at the booth settles it.
- 2026-09-23 · Share Library runs on its own once ProPresenter is closed · done ·
  5e0d2a8 · opt-in (`librarySyncModule.autoWhenClosed`), fires once per close.
  **Deliberately not gated on performance mode**: it arms defensively the
  instant ProPresenter's API goes quiet, which is exactly when a sync becomes
  possible — gating on it would mean the feature almost never fires. The
  process-level check in library-guard is the authority. Verified live.
- 2026-09-23 · "Is the backup current" on Health · done · b108167, 99a1a52 ·
  age plus a live content-hash match. The second commit fixes a bug code
  review caught: Health's compact card re-derived "stale" from the clock and
  showed a minute-old FAILURE as calm. It now calls describeBackupStatus like
  the Library Sync screen — one function, so the two cannot disagree.
- 2026-09-23 · Duplicate names across folders · done · daf911b · this library
  has none; the positive path was proven on an edited copy of the cache,
  restored byte-identical by SHA-256.
- 2026-09-24 · Unused media report · done · Health, as a button, never deletes.
  The booth's Media folder is 37 GB / 2,189 files; 91 files (121 MB) are
  referenced by nothing. **Three traps, each now a test that fails if the bug
  comes back (checked by mutation):**
  1. References are stored twice — an absolute `file://` URL and a relative
     `Media/Assets/<name>`. The absolute URLs are from OTHER Macs
     (two different users on two different machines). Matching them reports all 2,189 files.
     Match the bare filename anywhere instead.
  2. `Playlists/Media` is a FILE — the Media bin. Skipping "anything named
     Media" threw it away and reported 522 in-use files as orphans. Skip the
     Media folder by exact directory path only.
  3. A swallowed read error made references vanish and orphans appear. One
     unreadable reference file now fails the whole scan.
  `manage_media = false` in `media-manager.toml` here, so ProPresenter does not
  copy media into its folder — worth knowing before assuming it does. The state
  database is derived from the files and changed nothing when included. A naive
  matcher took 30s; the extension-indexed one is 27x faster and was checked
  identical to it on the real 94 MB corpus. Found by reading ProPresenter's
  files with it CLOSED, since the API was unreachable all day — reading is safe
  then, and it answered what guessing at the API would have got wrong.
- 2026-09-24 · Past dates in Spell Check's playlist scan · done · the loop is
  where a stale announcement actually hurts, and Spell Check already scans a
  playlist before a service, so this is a second kind of finding there rather
  than a new screen. Library-wide, 356 of 38,561 slides mention a date that
  has passed -- noise without the playlist scoping. **Decisions, each measured:**
  numeric dates left out (the only six N/N matches in the library were
  "Hindsight is 20/20"); a stated weekday picks the year, because "nearest
  occurrence" calls "Sunday, March 23" upcoming in late September when it was a
  2025 slide; ranges judged by their end; an explicit year before last year is
  history ("October 31, 1517") and stays quiet. Every finding shows the date it
  resolved to, so a mistyped weekday is visible rather than just "347 days ago".
  **Bug avoided:** ignoring a word dropped every slide with no words left,
  which would have silently thrown away a slide whose other finding was a date.
  Verified in the real UI with a real announcement deck's slides run through the
  real parser (ProPresenter was closed, so the playlist fetch was stubbed).
- 2026-09-24 · Unused-media scan gets a memory ceiling · done · the corpus is
  held in memory on the machine that also runs ProPresenter, and the button is
  not gated on a service being over. 187 MB here, nothing over 5 MB; past 1 GB
  it now refuses with a reason. Refusing can never give a wrong list.
- 2026-09-24 · BLOCKED on a reachable ProPresenter · #9 (missing media before
  the service) and theme conformance. Groundwork, so nobody redoes it:
  **#9** -- the `availability` Ready/Missing data the issue cites lives in the
  RocksDB state database (`Workspaces/<name>-<id>/Database/*.sst`), not in any
  plain file. Do not read .sst files by string matching: blocks can be
  compressed, and this workspace's live DB was rebuilt after the 11 September
  repair (32 KB), so it is not the store the 26,740 / 8,454 count came from.
  The acceptance criteria also need the API (playlist scoping, naming the
  slide). The reference format IS settled: see the unused-media entry above --
  bare filename, relative `Media/...` path, and absolute URLs from other Macs.
  **Theme conformance** -- a theme's own UUID appears in zero `.pro` files,
  and the name matches decks for the wrong reason ("Announcements" is also a
  deck title). ProPresenter appears to copy a theme's layouts into a deck when
  applied rather than keep a link, so "which theme does this deck use" is not
  answerable from disk without a protobuf schema. Probe the API first.
- 2026-09-24 · Flag this slide (issue #1, capture half) · done · a chip under
  the Search readout and on the Live screen, and a Flagged slides list at the
  bottom of Live. Reads the heartbeat's cache only -- no ProPresenter traffic,
  so it is fine under performance mode. **The text snapshot is the INDEXED
  text**, not a fresh read of the screen: `getCurrentSlide` returns no text,
  and getting it would mean calling `/v1/status/slide` on every press, which
  the issue rules out. Saving a deck reindexes it within seconds, so it is
  normally current. Not on the storage backends: those are arrangement-history
  storage, off on production, so flags have their own `slideFlagsModule.folder`
  (local by default). **One file per flag** -- two machines appending to one
  list in a synced folder is how Dropbox and Drive make conflict copies and
  lose writes. Written here first and copied after, so an unreachable shared
  folder means "waiting", never lost. **Verified live**: the refusal with
  ProPresenter closed (409, nothing written), and a real flag built from a real
  indexed slide read back through the real route onto both screens. **Not yet
  verified**: capturing a genuinely live slide -- needs ProPresenter open.
  One test bug worth knowing: a fixture helper built flags that buildFlag
  (correctly) refused as stale, and one test passed by comparing against
  "undefined.json". saveFlag now refuses id-less flags outright. Left for #2:
  problem types, and marking flags done.

- 2026-09-24 — **#2 flag types + Flags review screen** (editing session). Live screen gets an 11-type grid (uniform 64px chips, static rules in refrain.css per the JIT note) under "Flag the live slide", with an open-count summary linking to the new **Flags** nav screen (prep group). Review groups by day, then presentation in service order; type/note/resolve/reopen are append-only update files (`updates/<flagId>~<updateId>.json`) merged oldest-first, so two machines editing one flag never conflict. Resolved flags hide after `keepResolvedDays`, never deleted. Verified against a dev server with seeded flags: routes (400/409 paths), note save, type change, reopen, grid at 455px. **Not verified:** capture of a genuinely live slide — ProPresenter was closed all session. NOTE: live workspace is "Bisect"; "ZZ Sync Demo" duplicates Songs (61 duplicate name groups on production).

- 2026-09-24 — Persona panel review recorded as section 36 (ranked findings, one open decision on B4). Nothing implemented yet.
- 2026-09-24 — Section 36 work landed (editing session): B3 Clear All arms (outline at rest, "Press again to clear", brand collar while armed, disarms after 3s); B2 welcome opens at most once a day per browser and never on Live or Health (localStorage day stamp; "Don't show" still permanent); B1 a stored full rail shows as icons below 600px without changing the saved preference; B5 Search's amber banner is now one muted line under the NO LINK readout, and the index-age notice is muted; B7 `cleanFolderSetting` stops `"null"` being saved as a folder path and treats an existing stored one as unset; B8 providers declare `static requiredEnv`, so `server/config.js` no longer names Planning Center. Verified at 455 and 1280 against a dev server. B4 (Clear while LINK is down) still open.
- 2026-09-24 — Section 36 POLISH batch landed: B9 a link to a switched-off module shows "<navLabel> is off. Turn it on in Health." (name read from the module) instead of silently landing on Search; B10 Spell Check says "ProPresenter isn't answering" with a Health link on a 502 instead of "No playlists found"; B12 Scripture, Spell Check, Lyrics, Image Crop and QR Codes use the shared icon header; B14 the performance-mode line is one short sentence ("ProPresenter not answering, so it can't see what's live; last checked 6:09 PM."). Left for a decision: B4 (Clear while offline), B13 (moving Spell Check and Lyrics to Prep changes muscle memory, so it's the owner's call). Still not started: B11 (repeated Arrangement songs: needs a live plan to check), B15 (Health Modules card).
- 2026-09-24 — B15 landed: Health's top strip has a fourth Modules tile (gated modules worst-first, plus uploads still waiting), lit when something needs a look; grid breakpoints have static homes in refrain.css and CLAUDE.md's list is updated. Tested (summarizeModules) and checked at 1280 (4 across) and 700 (2 across).
- 2026-09-24 — B11 landed: a plan that runs several services repeats its set per service time, separated only by header items the provider was discarding. `songItemsWithSections` keeps the latest worded header on each song (spacer headers skipped), the server passes `section` through, and This weekend's plan prints the heading wherever it changes. Verified against the real plan read-only (5 headings over 15 songs). Compare-all still compares each copy; deduping it is a possible follow-up. B4 and B13 remain the owner's call.
- 2026-09-24 — Owner decisions applied: B4 → an OFFLINE banner across the top of Live's Clear bank whenever the LINK lamp is dark (keys stay pressable; fed by the same poll as the lamp via `lastKnownConnected`/`refrain:link`, so they can't disagree; "Clear still works" copy removed). B13 → Spell Check and Lyrics moved to Prep; Service is now Search, Live, Scripture. Verified on a dev server.
- 2026-09-24 — v0.18.0 released and deployed. ProPresenter was opened but its Network API never came up (process running, networkEnabled=1 on port 56563, nothing listening after 5+ min); not restarted, given section 33. Still blocked on a reachable ProPresenter: live-capture check for #1/#2, #9, theme conformance. Groundwork for #9: .pro files carry absolute file:/// media URLs, so 'missing on this machine' can be checked from disk; playlist scoping and naming the slide still need the API.
- 2026-09-24 — ProPresenter reachable (after the Network API was toggled). #1/#2 verified live and closed: with a song slide live, a flag captured presentation, slide, arrangement and text via the route and via a Live-grid tap; the OFFLINE banner stayed hidden while connected. **#9 landed** in Spell Check's playlist scan: `server/pro-media.js` reads the .pro the API names (the API reports no media), decodes just cue_groups/cues/URL (field numbers verified against the API's group order, counts and UUIDs), and checks each reference against its absolute path and then the relative path under ~/Documents/ProPresenter and the workspace roots. Keyed by groupId/groupOffset, so only slides the arrangement plays are checked. Guards: a field-count cap and a per-slide decode budget, because a thumbnail decodes as millions of fake fields and an unguarded walk ran out of memory. Across 30 playlists: mostly zero, 44/12/2/1/1 on old event playlists, spot-checked as genuinely absent. Theme conformance: not started.
- 2026-09-24 — Theme conformance groundwork, correcting the earlier note: a theme's own UUID is in no .pro, but its **slide layouts' UUIDs are**. `/v1/themes` lists 254 layouts; 237 of 973 presentations reference at least one (message decks mostly: the top layouts are Message / Speaker Intro, Homework, Quote). So 'which theme does this deck use' IS answerable from disk. Blocked on a definition, not on data: nothing says which theme is 'current' (per library? newest by name?). Needs the owner's call before building.
- 2026-09-24 — Owner: Scripture moved to Prep, Flags moved to Service. Rail is now Service: Search, Live, Flags · Prep: Spell Check, Lyrics, Scripture, Arrangement, Image Crop, QR Codes · System: Health.
- 2026-09-24 — Section 37 written: the plan for the service system (Service Day record, timeline from the heartbeat, pre-service checks, playbook phases, End summary, then delivery/second device/feed). Nothing built; open decisions listed there.
