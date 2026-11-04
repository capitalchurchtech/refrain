# Bundles and the MCP server

Both work on ProPresenter's files (`.pro` presentations, `.probundle` bundles and
more), never through the ProPresenter app and never on its database. Both use
the [`propresenter-bundle`](https://github.com/capitalchurchtech/propresenter-bundle)
package, which `npm install` fetches from GitHub. It reads files using the
community ProPresenter schema; it is not supported by Renewed Vision, and a
ProPresenter update can change what these files hold.

## Bundles

Off by default (Settings › Features › Bundles). The first time, it asks for a
**Packs folder**: where your church's own templates and skills live. The default
is `./data/probundle-packs`. It must be under `./data` or outside Refrain's
folder, so nothing of yours can be committed to Refrain by accident.

### Opening a file

- **From the library**: search by name over Refrain's index (files up to 64 MB).
- **From a file**: a `.pro` or `.probundle` on this computer, up to 300 MB.
- **From Claude**: the working copies an assistant is changing through the MCP
  server, and presentations it built with `refrain_build_from` or
  `refrain_workspace_to_presentation`, the newest 20. Script builder bundles
  aren't listed; open them with **From a file**.

Refrain keeps the last six files you opened for an hour, in memory only.

### What you see

- **Slides**: every slide drawn, in a grid grouped as the presentation is, with
  its arrangements above. **Size** sets slides per row. **Rough out** outlines
  the boxes. Slides are drawn with this computer's fonts, so a line can break
  differently on ProPresenter's computer.
- **Click a slide** to see it large, with its layers front to back, its media
  and macros, its notes, and anything Check found. ← and → move between slides,
  Esc goes back.
- **Check** lists what will go wrong on import: missing media, fields the reader
  doesn't understand, and text likely to overflow its box. The line and fit
  checks are a rough guess until there is a font table for your church's fonts.
  The screen opens on Check when a file has a problem.
- **Compare** any two open files, such as a file as imported and the same file
  after someone fixed it by hand: groups, arrangements, slides added and
  removed, and every change per slide.

An open working copy is redrawn within a couple of seconds of each change, on the
same slide.

### What it touches

Bundles never changes a file you open and never talks to ProPresenter. Pictures
come from the bundle itself or, for other files, from ProPresenter's workspace on
this computer. A video shows its first frame if `ffmpeg` or macOS Quick Look can
make one. The only thing it writes is a cache of the pictures it shows, in
`data/probundle-staging/pictures`, cleared of anything unused for a week when
Refrain starts.

It refuses to open files while something is on the screens or performance mode
is on (unless that is only because ProPresenter isn't answering), and each file is read off Refrain's main thread with a 30-second limit,
so a large bundle can't hold up anything live.

## The MCP server

`npm run mcp` starts an [MCP](https://modelcontextprotocol.io) server over stdio,
for Claude or another assistant on the same computer. It never talks to the
ProPresenter app, so it works on a computer without ProPresenter, and it doesn't
need Refrain's web server running. It reads `config.json` on every call, so
changes in Settings apply straight away.

### Connecting an assistant

Point your assistant at Node and `server/mcp/index.js` in your Refrain folder.
For Claude Desktop, add this to `claude_desktop_config.json`, with your own path:

```json
{
  "mcpServers": {
    "refrain": {
      "command": "node",
      "args": ["/Users/you/Refrain/server/mcp/index.js"]
    }
  }
}
```

For Claude Code, run this in any folder:

```bash
claude mcp add refrain -- node ~/Refrain/server/mcp/index.js
```

If Node isn't on the assistant's path, give the full path to `node` instead.

### Ground rules

- It opens only `.pro`, `.probundle`, `.protheme` and `.proplaylist` files, and
  the picture, video or sound files you give it to add, up to 1.5 GB.
- It never opens anything inside ProPresenter's `Workspaces` folder or any folder
  named `Database`, checked again after following links.
- It never changes the file you point it at. Changes happen on a working copy in
  `data/probundle-staging/copies/`, every change is checked before it is saved,
  and a set of changes is saved together or not at all.
- A new file never replaces an existing one; it gets a number ("name 2"). The
  only files it rewrites are its own working copies and a skill's `SKILL.md`,
  whose previous version is kept in `.history`.
- It never writes to ProPresenter's library or workspace. You bring the result in
  with ProPresenter's File › Import.
- A file holding fields the reader doesn't understand can be read but not copied
  for changing.
- Unlike the Bundles screen, it doesn't check whether something is live. It works
  on files, so it never touches the screens.

### Tools

| Tool | Reads or writes | What it does |
|---|---|---|
| `refrain_setup_status` | Reads | What is set up, what is missing, and the setting that fixes each |
| `refrain_open` | Reads | A presentation, bundle, theme or playlist, slide by slide; `inside` opens a presentation a playlist carries |
| `refrain_read_slide` | Reads | One slide in full: boxes, words, fonts, media, macros, actions |
| `refrain_check` | Reads | What will go wrong on import, plus boxes with no name or a shared name |
| `refrain_make_copy` | Writes | A working copy to change |
| `refrain_edit_boxes` | Writes | Box changes on a working copy: words, font, size, colour, alignment, spacing, position, rotation, fill, outline, shadow, hidden, locked, order |
| `refrain_edit_slides` | Writes | Slide changes on a working copy: label, colour, on or off, background, group, order, copy, delete, macros, media, actions, notes, transitions, groups and arrangements |
| `refrain_build_from` | Writes | A new presentation from existing slides, or from a theme's slides as masters, with new words |
| `refrain_read_workspace` | Reads | What your ProPresenter knows by name: macros, Looks, labels, groups, props, messages, timers, stage layouts, clear groups, playlists |
| `refrain_workspace_to_presentation` | Writes | Stage layouts or props as an ordinary presentation you can import |
| `refrain_list_skills`, `refrain_read_skill` | Reads | Your church's skills |
| `refrain_save_skill`, `refrain_file_away` | Writes | Save a skill (the previous version is kept), or file a reference file with one |
| `refrain_list_script_types`, `refrain_preview_script` | Reads | The script builder (below) |
| `refrain_parse_script`, `refrain_update_script_draft`, `refrain_build_script_bundle` | Writes | The script builder (below) |

The workspace is read from ProPresenter's content folder on this Mac (never the
database beside it), or from a copy of a workspace's `Configuration` and
`Playlists` folders kept in your packs folder under `workspace/`.

### Skills

A specific job (a sermon deck, tidying a theme, anything) is a **skill**: written
instructions with reference files, kept in your packs folder as
`skills/<name>/SKILL.md` and `skills/<name>/files/`. The same folder works as a
Claude skill, and each skill is also offered as an MCP prompt. Changing how a job
is done means editing its skill, not Refrain.

### The script builder

Turns a play's script (a skit, a kids' service, a camp night) into a bundle made
from your booth's own slides: one slide per line, labelled with who says it in
their colour; a Scene Notes slide for each stage direction; a slide for each
picture, background, video and sound; and cue slides for the sound desk.

It needs Bundles switched on with a packs folder, and a **pack** for each kind of
show at `<packs folder>/<church>/scripts/<kind>/`, holding a `template.pro` your
booth built (one slide of each kind) and a `recipe.json` naming those slides and
the cast colours. Refrain ships no packs; they are your church's own.

A build waits until a person has chosen the cast's label colours and said whether
the show reuses a title, verse or logo slide. A reused title slide is placed for
you; a reused verse or logo slide is not yet, and the checklist says where to put
it by hand. Built bundles go to `data/probundle-staging/`.
