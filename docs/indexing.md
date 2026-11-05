# The search index

Refrain searches its own index of your slides, not ProPresenter directly. This
page explains how that index is built, when it is refreshed, and the two
safeguards that keep Refrain from slowing ProPresenter down: performance mode
and Protect ProPresenter.

## How Refrain reads your library

Refrain asks ProPresenter **which presentations each library holds**, then
reads each presentation **from its own `.pro` file** in ProPresenter's library
folder. It never writes to those files.

It reads files rather than asking ProPresenter for each presentation because
every presentation read through ProPresenter's API makes ProPresenter write to
its own workspace database, about 13 KB each. Reading the file writes nothing,
and it is much faster.

It can't read files when:

- ProPresenter runs on another computer (the host isn't `localhost`,
  `127.0.0.1` or `::1`),
- the `propresenter-bundle` package isn't installed, or
- `indexFromFiles` is `false` in `config.json`.

In those cases, with [Protect ProPresenter](#protect-propresenter) on (the
default), no index runs at all. With protection off, Refrain reads every
presentation through the API instead. Through the API, a full build reads one presentation at a time and can take
from several minutes to over an hour on a large library, and ProPresenter is
sluggish the whole time. Go Live, Clear and macros may be slow to respond.

So two things are worth getting the right way round:

- **ProPresenter has to be open for the index to be built**, because it is what
  says which presentations each library holds.
- **What holds Refrain back is something being on the screens**, not
  ProPresenter being open. ProPresenter open with clear screens is the ideal time
  to index.

Two checks keep the file reading honest. Each build compares what ProPresenter
lists with what is on disk, library by library. And when a presentation goes
live, the words and slide count ProPresenter is playing are compared with the
same presentation read from its file (at most once an hour per presentation and
arrangement).
Both show on **Settings › Search** in the Search index card.

The index lives in `cache/search-index.json`. It is held in memory while
Refrain runs and written to disk atomically. A long build saves its progress
every 50 presentations, so a restart picks up where it left off.

## Which libraries and which arrangement

**Settings › Search › Libraries to search** chooses the library folders to
index. Folder names are matched ignoring case and spaces at either end, and the
card says if
a name you chose doesn't exist. In `config.json` this is `librarySync.folders`
(`null` means every library).

A song with several arrangements is indexed in **one** arrangement: the first of
your **Preferred arrangements** it has (for example `FS`, then `T`), else the
one selected in ProPresenter. Set them in **Settings › Features › Options ›
Search & indexing** (up to 10). A slide that only another arrangement plays is
not in the main index, which is what [Deep Search](search.md#deep-search) is for.

**Crawl playlists (not recommended)**, on the same card, also records which
playlist each presentation is in. It is the slowest part of a build and it stops
automatic reindexing, so it is off by default.

## Keeping the index up to date

### Reindex changed only

Refrain fingerprints every presentation file by its size and modified time.
**Reindex changed only** (Settings › Search) and **Refresh** (Settings › Status,
or the notice on Settings › System) re-read only the presentations that are new,
changed or missing, and keep everything else. On a normal week that is a
handful.

A **full rebuild** happens instead when there is no index yet, when your
preferred arrangements or the crawl playlists setting changed, when the index
was built by an older index format, or when ProPresenter is on another
computer. **Rebuild everything** is under "Rebuild everything instead" on the
Search index card if you want one anyway.

### Automatically, after you save

Refrain watches the library folders it indexes. About ten seconds after you save
a presentation it re-reads that presentation on its own, and a burst of saves
becomes one reindex. A check every 30 minutes catches anything the watch missed.
It deliberately holds back:

- It never starts a full rebuild. If one is needed, Settings says "Waiting on a
  full rebuild" and leaves it to you.
- With more than 25 changed presentations it asks instead. A bulk import shows
  as "N presentations have changed. Too many to reindex without asking."
- It waits until ProPresenter has been answering for three minutes.
- It does nothing while performance mode is on, from a service's lead time until
  it ends, or during a lock-in. Search says a presentation changed and when the
  index will catch up.
- It is off while Crawl playlists is on.

`"autoReindex": false` in `config.json` turns the watch off.

### Catching up when nothing is happening

An index that is more than a day old, unfinished, or built in an older format is
**not** rebuilt when Refrain starts. Instead it catches up quietly once
performance mode has been off for an hour (so at least 80 minutes after a
service's screens clear), with nothing live, outside any service window, and
with ProPresenter settled. If that run
doesn't finish, it waits three hours before trying again.

With Day switched on, Refrain also refreshes the index once in the hour before a
timed service, unless the service's lead time (15 minutes by default) has
already begun.

### Notices

- "Index is N days old. Refresh." appears after two days, on Settings › System,
  with a dot on Settings in the rail.
- An index built in an older format warns that Go Live may fire the wrong slide
  until it is rebuilt.
- After 90 days without a full rebuild, the Search index card suggests one. It
  never starts one for you.

## Running and stopping a build yourself

The index buttons refuse while something is on the screens, while performance
mode is on, while Protect ProPresenter blocks the run, or in the first three
minutes after ProPresenter starts. Inside a scheduled service's window they ask
"Run anyway?" first.

While any build runs, a bar along the bottom of every screen shows its progress
and time left. **Stop** on that bar, or **Stop indexing** on the Search index
card, stops it at the next presentation. Everything already read is kept and the
rest keeps its previous entry, so search goes on working.

**Deep reindex (slower)** reads every presentation again through the API,
slowly and with patient retries. It only appears when Refrain reads through the
API, and it is for when Deep Search says it couldn't read some presentations.

## Performance mode

While performance mode is on, Refrain does nothing of its own accord: no
indexing, no reindexing, no picture drawing, no fresh update checks once one has
been made. It keeps a
small heartbeat (two light requests every few seconds) so the link lamp and the
live readout stay honest.

- It turns itself **on** once something has been on the screens for two minutes,
  and **off** again 20 minutes after they go clear.
- It turns on when ProPresenter can't be reached, and off as soon as Refrain can
  see the screens again, unless something has already been on them for two
  minutes.
- **Turn on** on **Settings › Status** holds it on until you turn it off by hand.
  A lock-in on Day turns it on the same way.
- The **PERF** lamp at the top of the rail shows it.

Go Live, Show, safe slides and messages all work as normal. What performance
mode refuses is the heavy work: index runs, Quality Control scans, pre-service
checks, the theme and unused media reports, and Get slide pictures. Each says
why.

## Protect ProPresenter

**Settings › Search › Advanced** chooses between **Protect ProPresenter** (the
default) and **Allow library reads**. It is `protectProPresenter` in
`config.json`.

While protection is on, Refrain never reads presentations from ProPresenter's API
in bulk:

- The index still runs, from the library files only. A presentation it can't
  find on disk keeps its previous entry. If the files can't be read at all
  (ProPresenter on another computer, the `propresenter-bundle` package missing,
  or `indexFromFiles` off), no index runs.
- Quality Control scans, the pre-service checks and Get slide pictures refuse.

Search, Go Live, Now and everything else keep working. Turn protection off on a
machine where that is safe, away from a service, and restart ProPresenter
afterwards.
