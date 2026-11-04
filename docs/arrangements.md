# Arrangement tracking

Off by default (Settings › Features › Arrangement tracking).

A worship team often edits a song's planned arrangement every week to match how
they really play it. Arrangement tracking compares the arrangement your planning
system planned with the one you actually ran in ProPresenter, keeps a history,
and (where the planning system allows) pushes the correction back so nobody has
to make the same edit next week.

It only compares what was set up before the service. An extra chorus a leader
adds on the night isn't captured.

## Setting it up

In **Settings › Features › Options › Arrangement tracking**, choose a
**Provider** and a **Storage** backend. Which library folders it tracks is under
**Settings › Search › Arrangement drift tracking**. Until you choose, folders
named like songs, worship or music are picked if you have some, otherwise all of
them.

Comparisons run on one machine: the one you answered "Yes, this machine
(logger)" on during setup, or set to logger later in **Settings › Features ›
Options › ProPresenter › Role**. Other machines (readers) see the history but
can't record it.

### Providers

- **Manual.** You type the planned arrangement in, one section per line. No
  account, no credentials. This is the option for a church with no planning
  software.
- **Planning Center.** Reads the plan from Planning Center Services. Set the
  **Planning Center Service Type ID** (paste the service type's URL and the ID is
  taken from it), and put `PLANNING_CENTER_APP_ID` and `PLANNING_CENTER_SECRET`
  in Secrets on the logger machine. Each lookup uses the most recent plan for
  that service type whose date has passed, and the screen can pick from the last
  five.

Songs are matched between ProPresenter and Planning Center by title, ignoring
case, punctuation and bracketed suffixes. Two songs with the same title can be
mixed up.

### Storage

History is one small JSON file per song.

- **Local Folder**: on this machine, in `data/arrangements` unless you choose
  another folder.
- **Synced Folder**: the same thing in a Google Drive, Dropbox or OneDrive folder
  your desktop sync app already keeps up to date. This is how two machines share
  history with no server and no credentials. **Auto-detect** finds the usual
  sync folders.
- **Firestore** and **SFTP** are not built yet. They appear in the list, but
  once their credentials are set every read and write fails with "Not
  implemented". Don't choose them.

## Using it

The Arrangement screen lists your tracked songs. Open one to see the actual
arrangement (from ProPresenter) beside the planned one, its history, and a
**Section mapping** for when the two systems name a section differently.

On the logger, **Run comparison** for a service date records what ran. If another
machine already logged that date, it asks before overwriting.

On the logger, with Planning Center, **This weekend's plan** shows the plan's songs, which ones
Refrain found in ProPresenter, and **Compare all songs**, which records a
comparison for every matched song at once (without asking about another
machine's record for the same date). Each result can be:

- **Push to Planning Center**: writes your arrangement back. This changes the
  arrangement every future plan uses, so it asks first, and **Undo** puts the
  previous one back. It refuses while any section is still unmapped.
- **Ignore this week**: keeps the record but leaves it out of the suggestions,
  for a one-off. Reversible.
- **Always differs**: for a medley or anything the planning system can't
  represent, so it is always flagged for review.

On the logger with Planning Center, **End the day** on Day also compares and
records the songs actually shown, replacing any record for that date, and lists
the differences in the summary. It never pushes anything.

## Data safety

A comparison is written to a local staging file first, then to the storage
backend. If the backend write fails, for example because a synced folder is
offline, the staged copy stays and is retried on the logger when Refrain next
starts (or when you switch the feature on). Settings shows how many are waiting.
