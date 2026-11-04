# Now, Day and Flags

The **Service** key on the rail holds the three screens you use during and around
a service: **Now**, **Flags** and **Day**.

## Now

Now is the booth panel. Nothing on it fires a slide on its own, and each control
does exactly one thing. From the top:

### Staff requests

Off by default (Settings › Features › Staff requests). Other staff can send a
short line, such as a pager code, from your announcement app. It appears here as
a card with a countdown: **Post it** puts the text into a ProPresenter message
the same way the poster below does (so it needs Messages on), **Decline** posts
nothing. Nothing reaches the screens without that press. A
request is good for eight minutes and is handled once. It needs the service feed
set up first; see [the service feed contract](service-feed.md#staff-requests).

### Message to the screens

For the urgent thing: "Parent of 1234, please come to childcare." Set up a
message with a text token in ProPresenter once, and Now gives you a box for each
token, **Post** and **Clear**. Clear takes only that message off the screens.
If more than one message has a text token, a picker chooses between them. The
text is upper-cased and kept to one line of 60 characters.

**Edit** lets you hide messages you never post from here. A hidden message stays
in ProPresenter and also leaves the phone page.

### Stage message

A line for the stage screens that the audience never sees. Three presets to
start ("Keep going, we're delayed", "Cut short, pressing for time", "Killing
it!"), each one press, plus a box for anything else with **Show**. **Clear stage
message** takes it down. **Edit messages** lets you keep up to eight presets of
80 characters each, drag to reorder them, and add or delete. Presets are saved
on this machine.

### Macros and Looks

Off by default (Settings › Features › Macros, and Looks, are separate
switches). Each lists what you've
set up in ProPresenter, by name, one press each. Macros keep their ProPresenter
colour and icon, and **Edit** hides the ones you never use. The Looks heading
names the Look that is on. Both fold away and stay as you last left them.

### Flags and Day

Two rows link to Flags ("N to fix") and Day ("Checks due", "N services today",
"Day ended").

### Safe slides

Off by default (Settings › Features › Safe slides). Up to four of your own
known-good slides, such as a logo or a blank, to cut to in a hurry. With one of
them on the screens, **Keep current** keeps it. Each is then one press. Refrain
remembers a safe slide by its group and position, so if the presentation has
changed and the slide isn't where it was, it refuses rather than sending
something else. **Edit** renames, reorders and removes them.

There is no whole-screen Clear on Now. ProPresenter's own clear keys are right
beside Refrain.

## Day

Day is on by default (Settings › Features › Service day). It records what went
live in each service, runs the pre-service checks, and closes the day out.

### Today's services

A service comes from one of three places:

- **+ Add a service**: a name, an optional start time and an optional playlist,
  for today only.
- **A weekly schedule** in `config.json`:

  ```json
  "serviceModule": {
    "schedule": [
      { "day": "sun", "time": "09:00", "name": "9am", "playlistMatch": "Sunday" }
    ]
  }
  ```

  `day` can be a list. `playlistMatch` finds the playlist whose name contains
  that text; if several do, the one dated today wins.
- **Lock in for an event**, for things with no set time (below).

A timed service is watched from its lead time (15 minutes before, by default)
until 150 minutes after it starts or until you press **End**. While a service is
watched, Refrain checks the screens every 4 seconds even with no browser open,
so its times are accurate to about 4 seconds. Otherwise it checks every 4
seconds while a browser has Refrain open, and every 30 when none has.

### The rundown

Each service card lists what went live: when it first went up, how long it was
on the screens, and the gap before it. Coming back to something adds a "back
again" row. Anything not in the service's playlist is marked **Off-plan**.
Anything that went live outside a service is listed under "Not in a service".
The card compares the service's length with the first service of the day.

The rundown comes from the same heartbeat as the rail lamps, so it adds no
traffic to ProPresenter and works with performance mode on. Times are when
Refrain first saw each item.

### Lock in

**Lock in for an event** starts a service with no end and turns performance mode
on. Nothing on the screens changes. **Release** ends it and turns off only the
performance mode the lock-in turned on. A lock-in survives a restart. After six
hours, Day asks whether the event is over.

### Pre-service checks

**Run pre-service checks** on a service with a playlist runs eight checks:

1. ProPresenter answering
2. Search index covers the playlist (and isn't stale)
3. Likely typos
4. Dates that have passed
5. Media on this Mac
6. Playlist arrangements exist
7. Entries on a preferred arrangement
8. Presentations with a twin in another library

Each reports **Pass**, **Needs a look** or **Couldn't check**, and "couldn't
check" is never shown as a pass. From 45 minutes before a timed service, Day
reminds you if the checks haven't run.

The checks read every presentation in the playlist from ProPresenter, so during
performance mode, or with **Protect ProPresenter** on (the default), every check
after the first reports Couldn't check. See [Protect
ProPresenter](indexing.md#protect-propresenter).

### Changed songs

Changed songs lists the songs whose arrangement changed in ProPresenter since
someone last looked, with Before and After rows of group chips, the difference marked,
and when ProPresenter last saved it ("10:12 am, 14 min into the service"). Songs
saved during the service come first, then before it, then after.

Refrain learns each song's group order the first time it sees it, from the
arrangement the index reads, and keeps it in `data/known-good.json`. It only
moves on when you press **Dismiss**, so a change nobody has looked at stays on
the list. It asks ProPresenter for nothing. It can't put an arrangement back
(ProPresenter has no way to change one from outside), so **Show in Editor**
opens the song for you to fix.

### Checklist

A checklist in four phases: **Arrive**, **Before the service**, **Between
services** and **After the service**. "Run the pre-service checks" and "End the
day" tick themselves. Replace it with `serviceModule.phases` in `config.json`:
each phase has a `name` and a `scope` of `day`, `service` or `between`, and each
step is a string or `{ "label": "...", "link": "#slide-flags" }`. Add
`"checks": true` to a step to have it tick when the checks run, or `"end": true`
to have it tick when the day ends.

### End the day

**End the day** (press twice) closes every service and any lock-in, compares the
arrangements of the songs actually shown if Arrangement tracking is set up (it
never pushes anything back), and writes a summary in Markdown: each service's
rundown, flags by type, any checks that needed a look, arrangement differences,
and checklist steps not ticked. **View summary** shows it.

The summary is kept with the day's records in `data/service-days/`. If
`serviceModule.summaryFolder` is set, a copy goes there too, as a new file each
time. If anything goes live after you end the day, the day reopens and Day asks
you to end it again. Settings mentions a day in the last week that had services
but was never ended.

### Sending the summary

Turn on **Send the summary by email** in **Settings › Features › Options › Day
summary**, add recipients, and put your mail server in Secrets (`SMTP_HOST` and
`SMTP_FROM`, plus `SMTP_USERNAME` and `SMTP_PASSWORD` if it needs them). After
End, **Send by Email** sends it, and says so beside the button because it leaves
this machine. Refrain refuses to send a password over an unencrypted connection.

To save it to a folder instead, set `reportModule.enabled` to `true`,
`reportModule.deliveryBackend` to `folder` and `reportModule.folder` to the
path.

### Ending the day on its own

**End the day on its own and send the summary** (off by default, same card)
ends the day after two hours with nothing on the screens, or once ProPresenter
has been closed for 15 minutes on this Mac, whichever comes first. It never ends
a day nothing went live, and it holds off during a lock-in, during performance
mode, while something is on the screens, during a service, and while a service
is still to come today. Day says ahead of time when it will.

When it ends the day this way, the summary is sent straight away with nobody
reading it first. A failed send is retried every 15 minutes, eight tries in all.

### Slide pictures and Send log

The **Slide pictures** card has **Update pictures**, which draws pictures for
today's service playlists and keeps any slide whose words and place haven't
changed. See [slide pictures](phones.md#slide-pictures). **Send log** appears
when the service feed is set up.

## Flags

Flags is on by default (Settings › Features › Flags). A flag marks a slide to
fix after the service.

### Flagging a slide

- **Flag** under the search box marks whatever is on the screens.
- **Flag the live slide** on the Flags screen does the same with a type in one
  tap: Background image, Foreground image, Formatting, Missing slide, Note, Slide
  order, Template, Timing or advance, Typo or spelling, Video or audio, Wrong
  verse or lyrics.
- A [phone](phones.md) can flag any slide in the presentation on the screens, or
  any slide it finds in Search.

Flagging reads what Refrain already knows is on the screens, so it adds no
traffic to ProPresenter and works with performance mode on. It refuses if
Refrain can't see a current slide or hasn't heard from ProPresenter in 45
seconds. A slide that was cleared from the screens can still be flagged, and the
flag says it wasn't on the screens.

### Working through them

Flags are grouped by day, then by presentation in service order. Each has a type
you can change, a note, **Show slide N in Editor**, and **Mark resolved**.
Resolved flags drop off the list after 14 days (`slideFlagsModule.keepResolvedDays`)
but are never deleted.

**Get slide pictures** draws a picture for each open flag that has none, up to
40 a press. It refuses during performance mode or with Protect ProPresenter on.

### Your own types, and sharing between machines

- `slideFlagsModule.types` in `config.json` replaces the type list. Each entry is
  a name, or `{ "label": "...", "icon": "lucide-icon-name" }`.
- `slideFlagsModule.folder` points flags at a folder two machines can both see
  (Dropbox, Google Drive, OneDrive). Each flag and each change to it is its own
  small file, so two machines never overwrite each other. A flag that can't reach
  the folder waits locally and copies across later. Flag pictures stay on the
  machine that took them.
