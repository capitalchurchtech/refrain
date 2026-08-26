# Vendored assets

Refrain has no build step (see CLAUDE.md), and a booth machine with no internet
used to render the app completely unstyled during a service. These files are
therefore committed rather than fetched from a CDN.

Fetched 2026-08-26. To update, re-download from the URL and re-check the
hash below.

| file | source | version | licence |
|---|---|---|---|
| `tailwind-cdn.js` | https://cdn.tailwindcss.com | Tailwind browser build | MIT |
| `daisyui-4.12.24-styled.min.css` | https://cdn.jsdelivr.net/npm/daisyui@4.12.24/dist/styled.min.css | 4.12.24 | MIT |
| `lucide-1.34.0.min.js` | https://unpkg.com/lucide@1.34.0/dist/umd/lucide.min.js | 1.34.0 | ISC |
| `daisyui-themes-light-dark.css` | https://cdn.jsdelivr.net/npm/daisyui@4.12.24/dist/themes.css | 4.12.24 | MIT |
| `fonts/archivo-latin.woff2` | Google Fonts, Archivo variable (wdth 62-125, wght 400-900), latin subset | v25 | OFL 1.1 |
| `../img/textures/black_linen_v2.png` | Subtle Patterns, "Black Linen 2" by **Atle Mo** — https://www.toptal.com/designers/subtlepatterns/black-linen-2/ | — | **CC BY-SA 3.0** |
| `../img/textures/dark_leather.png` | Subtle Patterns, "Dark Leather" by **Atle Mo** — https://www.toptal.com/designers/subtlepatterns/black-leather/ | — | **CC BY-SA 3.0** |
| `fonts/martian-mono-latin.woff2` | Google Fonts, Martian Mono variable (wght 300-800), latin subset | v6 | OFL 1.1 |

The icon library was previously loaded as `lucide@latest`, unpinned. Every icon
in the app came from it, so offline meant no icons at all, and an upstream
release could change them without any change here. Now pinned and vendored.

## Two deliberate trims

**Themes.** `themes.css` ships 32 DaisyUI themes at 64KB. Refrain uses `light`
and `dark`; Blackroom is a Refrain class defined in `index.html`, not a DaisyUI
theme. `daisyui-themes-light-dark.css` is lines 1-194 of the original: the
`:root` light defaults, the `prefers-color-scheme: dark` block, and the two
themes. Verified brace-balanced, and cupcake onward is simply absent.

**Components.** `styled.min.css` (139KB) rather than `full.min.css` (2.9MB).
The full build is the same components plus all 32 themes. Total vendored weight
is 548KB instead of 3.3MB.

## A trap worth knowing about

`styled.min.css` omits DaisyUI's base layer, which is the single rule that
paints the page. Missing it, `:root` computed to transparent and light theme had
no background at all; dark and Blackroom only looked right because
`refrain.css` sets `body` explicitly. `daisyui-4.12.24-base.css` restores it.

That file's `@supports not (color: oklch(...))` guard is load-bearing. The paint
rule reads `--fallback-b1` FIRST and only then the theme's own `--b1`, so
defining the fallbacks unconditionally pins every theme to the fallback colour
and theming silently stops working. A first version did exactly that and painted
light, dark and Blackroom all the same grey.

Related, in `refrain.css`: `--b1`/`--b2`/`--b3`/`--bc` are raw oklch
*components*, not colours. They get spliced into `oklch(var(--b1) / 1)`, so a
hex value makes the function invalid and takes the whole declaration with it.

## Known limitation

`tailwind-cdn.js` is Tailwind's *browser* build, which generates classes at
runtime. Its own documentation excludes it from production, and it still causes
a brief flash of unstyled content. Vendoring removes the network dependency but
not the JIT.

The alternative is generating a static stylesheet with the Tailwind CLI, which
means either a build step (excluded by CLAUDE.md) or a committed artifact that
must be regenerated whenever a class is added. That second option fails
silently: add `mt-7` to a template, forget to regenerate, and the style is just
missing. Keeping the JIT is the lesser evil for a repo whose stated value is
that you can clone it and run it.

## Hashes

```
176e894661aa9cdc9a5cba6c720044cbbf7b8bd80d1c9a142a7c24b1b6c50d15  tailwind-cdn.js
381de5c07d1fa81c3430b04d66a3d710b622c1d702fadd0a0448470d9493b6f1  lucide-1.34.0.min.js
97d6d0f71a13c613a37c80d34dc56256911fbab02b84e63d937fa29119f64135  daisyui-4.12.24-styled.min.css
6588eaa966baf0b4ec3094447797de3f4f3d230b8241903ef2ec9bcc6f3cb4fb  daisyui-themes-light-dark.css
4c98b9d490d1698ec95f2ff17a6c7d0e72691864c0c5d7bc2a2c161b45afe5ad  fonts/archivo-latin.woff2
29bf2691317290c0693d305d51abd52ddc027c93207f528f7efa8cf0f8b504ca  fonts/martian-mono-latin.woff2
```


## Texture tiles: ShareAlike, not plain Attribution

The two panel tiles are the only assets here that are not MIT or OFL. They are
**CC BY-SA 3.0 Unported**, which is a share-alike licence.

Where that version comes from matters, because the sources disagree. Toptal's
current pattern pages say only "licensed under Creative Commons" with no version
and no licence link. The collection's own repository,
https://github.com/atlemo/SubtlePatterns, states "Creative Commons
Attribution-ShareAlike 3.0 Unported License" and links
https://creativecommons.org/licenses/by-sa/3.0/. The repository is the more
specific statement, so it is the one recorded.

Attribution is discharged in two places, because a source comment alone is not
attribution "reasonable to the medium" for something a user only ever sees
rendered: the comment at the top of the texture section in `public/refrain.css`,
and a visible credit in the Health screen footer naming Atle Mo and linking the
licence.

**The share-alike obligation is separate from attribution and is not discharged
by either of those.** Whether embedding a tile as a background image in a
stylesheet creates a derivative work of the tile, and what that would mean for
an MIT-licensed repository, is genuinely arguable. It is recorded here rather
than resolved so that a later reader knows it was a decision and not an
oversight. If it ever needs to go away, the two custom properties at the top of
the texture section are the only place to change.
