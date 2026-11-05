# Prep tools

Quality Control is always on. The others live under the **Prep** key on the rail
and are each off until you switch them on in **Settings › Features**.

## Quality Control

Pick a playlist and press **Check spelling**. On a service day, today's playlist
is chosen for you. Refrain reads every slide in the playlist (up to 120
presentations) and lists three kinds of finding, slide by slide, each with a
picture of the slide. With ProPresenter on this Mac, Refrain draws that picture
itself from the presentation's file, so it asks nothing of ProPresenter; it uses
this Mac's fonts and says when a slide uses a font this Mac doesn't have. A slide
it can't draw gets ProPresenter's picture of that one slide, asked for once. The
three kinds are:

- **Spelling.** A word is flagged only when the dictionary doesn't know it
  **and** it appears in fewer than two presentations in your library. The names
  and worship words your church uses every week count as correct, so what's left
  is mostly real mistakes. Each comes with up to four suggestions.
- **Old date.** A written date that has already passed, like last month's event
  still in this weekend's loop: "June 27", "Sept 9th", "March 23, 2025". Numeric
  dates are ignored. A date with a weekday ("Sunday, June 27") is placed in the
  year that weekday fits.
- **Missing media.** A background, video or picture a slide uses that isn't on
  this Mac, with a note when it was saved on another Mac and never copied here.

Refrain can't edit slides, so each finding has **Fix in ProPresenter**, which
opens the presentation in the editor; find the slide by its number and picture.
Nothing goes to the screens. **Ignore word** puts
a word on the **Ignored words** list, which you can see and edit on the same
screen, so a mis-click never hides a typo for good. **Check again** re-reads one
presentation after you fix it, and **Next flagged slide** walks through them.

Quality Control reads the playlist from ProPresenter, so it refuses during
performance mode and while **Protect ProPresenter** is on (the default). The
screen offers **Turn protection off**. See [Protect
ProPresenter](indexing.md#protect-propresenter).

## Lyrics

For a song your library doesn't have yet.

1. Type the **Song title** and **Artist**, then **Search lyrics**. Refrain opens
   a Google search limited to your lyrics sites, in a new tab, or **Copy link**
   copies it. Refrain never fetches a lyrics page itself.
2. Paste the words into **Paste and split into slides**. **Clean up** strips the
   hidden characters and odd spacing a web copy brings with it, and (with
   Straighten quotes ticked) turns curly quotes and long dashes into plain ones.
3. Choose how to split (**Blank lines** or **Section labels**) and press
   **Preview slides**. Each slide has a copy button.

**Group repeats** collapses blocks that repeat word for word, such as a chorus
written out every time, into one slide each, labelled A, B, C, with the play
order laid out so you can build the arrangement.

ProPresenter's API can't create slides, so you copy each one into a new
presentation. **Find it in Search** carries the title over to check you don't
already have it.

The lyrics sites (up to five) and the default splitter are in **Settings ›
Features › Options › Lyrics**.

## Scripture

Type a **Reference** ("John 3:16", "Romans 8") and pick a **Version**, then open
it in **Bible Gateway** or **Blue Letter Bible** (or copy either link). Enter
opens Bible Gateway. Refrain never fetches or stores scripture text, so there is
no bundled Bible to keep up to date and no licensing problem.

Blue Letter Bible is the one for original-language study, but it doesn't carry
every version. When you pick one it doesn't have, its link opens your fallback
translation and the screen says so. Set the defaults in `config.json`:
`scriptureModule.biblegatewayVersion` (default NIV, and one of the versions in
the picker) and `scriptureModule.blueletterTranslation` (default KJV).

Below that is a **Paste and split into slides** like the one on Lyrics, without
Group repeats, for a passage you copied.

## Image Crop

Drop a picture in a folder and get it back cropped to every size you need.

Refrain keeps an input and an output folder in `data/image-crop/`, and when you
switch Image Crop on it points at them and fills them in on the screen. You can
choose other folders there. **Open** shows a
folder in Finder. For a one-drag habit, drag the input folder into Finder's
sidebar, or make an alias of it on the Desktop.

Drop pictures (JPEG, PNG, WebP or TIFF) in the input folder and, a few seconds
later, the output folder has one cropped copy per preset. The original moves to
`processed/` inside the output folder, so the input stays empty. Nothing is
deleted. Files go through one at a time, so a folder of hundreds can't swamp the
machine. A lit dot on the Image Crop key shows the folder is being watched.

Cropping keeps the most eye-catching part of the picture in frame rather than
cutting the middle: the area with the most detail, colour and skin tone (the
image library's own "attention" crop).

**Presets.** A new install starts with sizes for the screens:

| Preset | Size | File name tag |
|---|---|---|
| 1080p (16:9) | 1920×1080 | `hd` |
| Thirds square | 693×693 | `thirds-sq` |
| Thirds wide | 777×502 | `thirds-wide` |
| Thirds tall | 605×808 | `thirds-tall` |
| Book graphic | 515×787 | `book` |

**Add common size** offers 4K, 1440p, YouTube thumbnail, Facebook share, the
Instagram shapes, X, LinkedIn, Pinterest, Facebook cover and ultrawide, and **Add
custom** covers anything else (up to 25 presets, 8000 pixels a side). Outputs keep
the original name plus the tag: `photo.jpg` becomes `photo_thirds-sq.jpg`. Edit
the tag on each row.

The input and output folders can't overlap, and Refrain refuses folders inside
ProPresenter's own.

## QR Codes

Pick a type and a code renders as you type: a website, plain text, a Wi-Fi
network (scanning it joins the network), a contact card, an email, a phone
number or a text message. Set the size, margin, error correction and colours,
and download a **PNG** or an **SVG** (better for print).

A **Center logo** forces the highest error correction so the code still scans.
It is PNG only; SVG can't carry a logo.

Every code you download goes on the **Recent codes** strip. Click one to load it
again. **Clear** empties it.

The codes are made on your own machine and hold your content directly. Many free
online generators encode a link through their own site instead, which leaves
them able to expire, track or charge for a code you already printed.

Defaults are in **Settings › Features › Options › QR codes**: a default base URL,
a default logo (a path such as `img/logo.png`, or a full URL), a default size,
and how many recent codes to keep (0 to 100, default 20).
