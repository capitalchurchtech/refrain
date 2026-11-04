# Search

Type any word and Refrain lists every slide that says it, in the libraries you
index. It is always on and needs nothing but ProPresenter.

## Searching

- Matching ignores case and extra spaces, and finds what you type, as a phrase,
  anywhere in a slide's words. "grace amazing" won't find "Amazing grace".
- Curly and straight apostrophes count as the same, and a missing apostrophe is
  forgiven, so "ive" finds "I've". Type the apostrophe and it is matched exactly.
- A line that repeats inside one song shows once, marked "sung N×".
- Results show whole songs, up to 250 slides. Past that, "Add a word to narrow
  it."
- The strip under the box shows how many presentations the index holds and when
  it was last updated.

### Typos

When nothing matches exactly, Refrain swaps any word your library doesn't use
for the nearest word it does, or splits a run-together word in two, and tries
again: "ocenas" finds Oceans and "waymaker" finds Way Maker. It says so: "No
exact match. Showing way maker."

## Go Live and Show

Each slide in the results has two buttons:

- **Go Live** puts that slide on the screens. The top match's Go Live is lit.
- **Show** opens the presentation in ProPresenter's editor. Nothing goes to the
  screens.

Go Live finds the slide by its group and its place in the group, then its
words, in whatever arrangement ProPresenter has selected right now, so a song
whose sections have moved since it was indexed still sends the slide you chose.
If ProPresenter can't answer that check within four seconds, Refrain sends the
slide number it indexed.

The **Flag** chip under the search box marks whatever is on the screens as
something to fix later. See [Flags](service.md#flags).

## The library filter

When you index more than one library, a **Filter** chip appears. Each library
has a key; switch one off to leave it out of your searches, or press **Search
all**. A dot on the chip means the search is narrowed. Your choice is
remembered, and a library added later is searched until you switch it off.

## Deep Search

The index holds one arrangement of each song (see [which
arrangement](indexing.md#which-libraries-and-which-arrangement)). A slide that
only another arrangement plays, such as a tag your preferred arrangement leaves
out, won't be found by an ordinary search.

When a search finds nothing, it says which arrangements it looked in and offers
**Deep Search Arrangements**, which looks through every group the indexed
arrangements skip. Its results have **Show** only, never Go Live, because a
slide's number only means something inside one arrangement and Refrain can't
change which one ProPresenter plays. Each result names the group to drag into
the arrangement.

Deep Search reads what the index already holds, so it asks ProPresenter for
nothing. If some presentations can't be read yet it says "Deep search could read
X of Y" and points you to **Deep reindex (slower)** in Settings › Search.

## The Return bar

Services wander. When you jump somewhere from Refrain, the slide that was live
just before is remembered, and a bar appears at the top: "Jumped from
"Song" (slide N)". **Return** opens that presentation in ProPresenter's editor so
you can pick the next slide yourself. It never puts anything on the screens.

Behind the bar, **History** keeps the last 30 presentations that were on the
screens, one entry each, whoever put them there, with Back and Forward. It is
kept in memory, so a restart clears it.

## From the keyboard

| Key | Does |
|---|---|
| `/` or Cmd/Ctrl+K | Jump to Search from any screen |
| Enter (in the box) | Move to the first result |
| ↑ ↓ | Choose a slide |
| Enter (on a slide) | Open it in the editor, never live |
| Esc (on a slide) | Back to the box, query kept |
| Esc (in the box) | Clear it |
| Alt/⌥+X | Clear the search from any screen |
| `1`–`9` | Jump to that key on the rail |
| `?` | All the shortcuts |

Going live is always a press of the Go Live button, never a key.

## What's on the screens

The four small lamps at the top of the rail are on every screen: **LINK**
(Refrain can reach ProPresenter), **LIVE** (something is on the screens),
**PERF** (performance mode) and **FEED** (the service feed is getting through).
**Settings › Status** has the full readout: what is live, its arrangement, the
slide number, how long it has been up, and its words.
