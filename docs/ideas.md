# Ideas

Captured from a working session on 2026-09-20. Issues #1–#9 cover what was filed
properly; this file is the rest — things worth considering, with an honest note on
what each would actually cost and whether the data already exists.

Nothing here is a commitment. Several of these are probably bad ideas that look
good written down, and they are marked where that seems likely.

## Filed already

| # | |
|---|---|
| #1 | Flag the live slide for later editing |
| #2 | Issue-type quick buttons and a post-service review screen |
| #3 | Sunday run-of-show playbook, from arrival to End |
| #4 | Deliver the weekend summary by email |
| #5 | Audit playlists for arrangement references that no longer resolve |
| #6 | Record when each playlist item first went live, plus change tracking |
| #7 | Broadcast live service progress to a feed |
| #8 | Submit flags and notes from a second device |
| #9 | Flag presentations referencing missing media before the service |

## Uses data Refrain already holds

These need no new integration. The parsing and the file watching are already there.

**Built** (on Health, after v0.15.0). **Duplicate document names across libraries.** `Songs/X.pro` and `Songs Archive/X.pro`
having the same document name is how at least one confusing situation arose here. A
list of name collisions across libraries is cheap and would have saved an afternoon.

**Built** (on Health, as a button, after v0.15.0). **Orphaned media.** The inverse of #9 — assets referenced by no presentation at all.
This is disk cleanup, not service safety, and should stay well away from any
pre-service flow so it never dilutes the list that matters.

**Built** (on Health and the Library Sync screen, after v0.15.0). **Backup mirror verification.** Confirm the sync mirror actually matches the live
workspace. We did this by hand with `shasum` and it was genuinely reassuring. A
"your backup is current / your backup is four days stale" line on the Health screen
would be worth more than most features on this list.

**Multi-machine library drift.** Where two machines sync, report presentations that
differ between them. Related to Library Sync, which already moves files but does not
report disagreement.

**Template and theme conformance.** Presentations not using the current theme.
Directly useful given Template is one of the flag types in #2 — the app could
pre-empt the flag the way #9 pre-empts the media ones.

**Built** (in Spell Check's playlist scan, after v0.15.0). **Announcement expiry.** Slides mentioning dates that have passed. Cheap text scan,
catches the "event from three weeks ago still in the loop" problem.

**Slide readability.** Text too long for the slide, font below a threshold, poor
contrast against the background. Plausible, but likely to produce a lot of false
positives on deliberate design choices — worth prototyping before committing.

## Needs new data or an integration

**Song usage history and CCLI reporting.** Which songs ran on which dates. Real
compliance need, and #6's timeline data gets most of the way there as a by-product.
Probably the highest-value item in this section.

**Key and tempo surfaced from Planning Center.** Pull into search results and
potentially onto the stage display. The Planning Center provider already exists.

**Service length estimation.** Once #6 has a few months of timings, predict runtime
for a planned service. Nice, not urgent, and only as good as the history behind it.

**Lyrics diff against an authoritative source.** Tempting and probably a trap — the
lyrics helper deliberately never fetches lyrics pages, and this would undo that
decision. Listed so the reasoning is on record, not because it should be built.

## A different shape of tool

**Stage display preview.** Render what the confidence monitor will show for a given
slide, without being in the room. Would have been useful this weekend — the whole
investigation needed somebody physically watching an SDI output to test anything.

**Rehearsal mode.** Step through an arrangement without going live, to check
ordering and next-slide behaviour safely.

**Text-only playlist export.** Plain text of every slide in order, for interpreters,
transcription, or anyone who needs the words ahead of time.

**Printable run sheet.** The playbook (#3) as paper, for volunteers who would rather
hold a page than watch a screen.

**Search across flag history.** Once #1 and #2 have run for a season, "has this song
ever been flagged before" becomes a real question.

## Considered and not recommended

**A metrics dashboard of raw counts.** "47 edits this week" is a number nobody acts
on by week three, and a screen full of them looks like diligence while going unread.
The value in change tracking is correlation against what actually got flagged
(see #6), not volume.

**Auto-repair of playlist arrangement pointers.** Refrain does not write to
presentations anywhere else and should not start here. Rewriting a pointer on an
inference is unrecoverable if the inference is wrong — and on 2026-09-20 the
inference that looked most convincing turned out to be wrong. Report and jump; let a
human decide.

## Context worth keeping

The session that produced this list was chasing a stage-display "next slide text"
bug. Three hypotheses were tested against the live system and all three were
refuted; no root cause was found. 222 playlist entries do hold arrangement UUIDs
that resolve against nothing (#5), but that anomaly was tested directly and is not
the cause.

The reason it stayed unsolved is worth remembering when prioritising the above:
every previous occurrence was fixed before anyone captured the state, so the only
evidence ever available was post-repair. Several items on this list are valuable
mainly because they capture evidence before somebody's instinct to fix it kicks in.
