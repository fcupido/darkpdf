# Dark PDF (local files)

A Chrome extension that inverts the colors **inside** a local PDF and hands the
result to Chrome's own PDF viewer, instead of laying an inversion filter over
the screen.

## Why

Chrome renders PDFs with a plugin. Extensions cannot style anything inside it,
so the usual approach — Dark Reader included — is to apply a filter over the
whole viewer surface. That inverts the document, but it also inverts the solid
color the viewer paints around the pages, turning it light. The color is a
constant in Chromium and does not follow the browser theme:

```
// chrome/browser/resources/pdf/pdf_viewer.ts
const BACKGROUND_COLOR: number = 0xff282828;
```

Inverted, `#282828` becomes a light gray, and you end up reading a dark page
surrounded by a bright field. No pixel filter can fix that, because after
inversion the background is indistinguishable from dark page content.

If the *document* is dark, no filter is needed at all, so the viewer's
background stays at its native dark value. Text also stays text: selection,
search and links keep working.

## Install

1. `chrome://extensions` → enable **Developer mode** → **Load unpacked** → pick
   this folder.
2. On the extension's card, enable **Allow access to file URLs**. Nothing works
   without it — that permission is what lets the viewer read the file.
3. Open any local PDF.

Turn off Dark Reader's "Enable for PDF files" as well. It is not strictly
required, since Dark Reader cannot inject into extension pages and so leaves
this viewer alone, but leaving it on means any PDF this extension misses still
gets the old treatment.

## How it works

`background.js` catches top-level navigations to `file://….pdf` and redirects
them to `viewer.html`, which reads the bytes over `XMLHttpRequest` (`fetch` does
not implement the `file:` scheme), runs the transform in `invert.js`, and
displays the result from a blob URL.

The transform does two things to every page:

1. **Prepends an opaque white rectangle** covering the MediaBox. A page's paper
   is not painted content, it is blank, and blending against nothing leaves the
   source color unchanged. Without this the marks invert but the paper stays
   white, giving white-on-white.
2. **Appends a white rectangle drawn with `/BM /Difference`.** Difference
   against white is `|backdrop - 1|`, an inversion of everything painted below
   it. No content-stream color rewriting is needed.

It also adds a transparency group to pages that lack one, since most real PDFs
have none and whether a viewer honors a blend mode without one varies.

## Testing

Three levels, cheapest first.

### 1. Automated: does the transform produce a correct file?

Needs `node` and `gs` (Ghostscript) on PATH. Chrome is not involved — this
checks that the file we produce is correct, not how Chrome treats it.

```
python3 test/make-fixtures.py          # writes test/fixtures/
node test/verify.js test/fixtures/*.pdf
```

Expected: `all checks passed`. Per file it runs the shipped transform, then
renders the original and the result with Ghostscript and compares them:

| Check | What a failure means |
|---|---|
| transform runs | pdf-lib rejected the file, or an API changed |
| output re-parses | the rewrite corrupted the document structure |
| every page has a transparency group | `ENSURE_PAGE_GROUP` is not doing its job |
| every page has a Difference ExtGState | the blend mode never reached the file — the usual silent no-op |
| page count / size unchanged | pages were dropped or resized |
| paper inverts on every page | **the important one.** White paper must become black. If this fails while the others pass, the white backdrop is not being painted, and real documents will render white-on-white |
| pixels are the complement | some content did not invert |

Run it against your own PDFs too, which is where the interesting failures live:

```
node test/verify.js ~/Documents/*.pdf
```

The fixtures are hand-written by `test/make-fixtures.py`, with no dependencies.
None of them paint their own white background, because real PDFs do not, and
that is exactly the case that breaks a naive implementation. They cover a plain
text page, a page with a raster image, a three-page document, a non-zero
MediaBox origin (`[20 30 432 522]`), and a `/Rotate 90` page.

### 2. By hand: does *your* Chrome honor the blend mode?

Ghostscript accepting a file proves nothing about PDFium. Open these directly,
with no extension involved.

**Turn Dark Reader off first** — its overlay inverts the whole viewer surface,
so an inverted document comes back to you looking light and every reading below
is backwards.

`test/fixtures/manual/browser-check.pdf` — five pages, each labeled with what it
should look like:

| Page | Overlay | Correct | Blend modes ignored |
|---|---|---|---|
| 1 | none (control) | white paper, black text | — |
| 2 | Difference, direct | inverted | blank white |
| 3 | Difference inside a Form XObject group | inverted | blank white |
| 4 | Exclusion, direct | inverted | blank white |
| 5 | Multiply 50% gray | dimmed but readable | flat gray slab |

Check page 1 first. If it is dark, a screen filter is still running and the rest
of the readings are inverted. Page 5 is the diagnostic that does not depend on
inversion support at all: it answers "does this viewer do blend modes".

`test/fixtures/manual/group-test.pdf` — three pages, testing whether a page needs
its own transparency group for the blend mode to be honored. If page 2 (no
group) is inverted, `ENSURE_PAGE_GROUP` in `viewer.js` can be set to `false` and
the extension will stop modifying page dictionaries.

### 3. End to end: the extension itself

Open a local PDF, ideally a paper with figures, since that exercises images and
embedded fonts. Then check:

- The page is dark and the text is readable.
- The area around the pages is dark, not light gray. This is the whole point.
- Select some text and copy it. Search with Ctrl+F.
- Scroll to the end: every page inverted, not just the first.
- Zoom in and out; the toolbar behaves normally.

When something goes wrong:

| Symptom | Likely cause |
|---|---|
| PDF opens normally, no redirect | "Allow access to file URLs" is off, or the URL does not end in `.pdf` |
| Redirected, but the error page appears | the file is encrypted, or unreadable — the message says which |
| Page is white with invisible text | the white backdrop is not being painted; run level 1 |
| Everything is light again | Dark Reader is still inverting PDFs on top of this |
| Toolbar looks cut down | switch `MODE` to `'navigate'` in `viewer.js` |

Two consoles are worth checking: the service worker's, from the extension's card
on `chrome://extensions`, for redirect problems; and the viewer page's, via
right-click → Inspect, for transform problems.

## Knobs

Both at the top of `viewer.js`:

- `MODE` — `'embed'` (default) keeps the extension page in the tab, so reload
  re-runs the transform and the source path stays visible in the address bar.
  `'navigate'` replaces the tab with the blob URL, which gives the full-size
  viewer toolbar but loses the path.
- `ENSURE_PAGE_GROUP` — adds a transparency group to pages that lack one.
  Defaults to `true`; see level 2 above for how to find out whether you need it.

## Known limits

- Images are inverted along with everything else, so photos render as negatives.
  That is inherent to inversion and matches what a screen filter does today.
- Encrypted PDFs will usually fail to load; the viewer then offers a link to
  open the original.
- Saving or printing from the tab gives you the **inverted** document.
- The whole file is read and rewritten before anything is shown, so very large
  scans take a moment.
- PDFs with unbalanced `q`/`Q` in their content streams may render oddly, since
  the overlay is appended after the existing content.
- Only local files are touched. PDFs served over http(s) are left alone.

## Contents

```
manifest.json          MV3 manifest
background.js          redirects file:// PDF navigations to the viewer
viewer.html/.js        reads the file, runs the transform, shows the result
invert.js              the transform, kept separate so it can be tested headlessly
vendor/pdf-lib.min.js  pdf-lib 1.17.1, unmodified (MIT)
test/make-fixtures.py  generates the test PDFs, no dependencies
test/verify.js         runs the transform and checks the rendered output
```

pdf-lib is vendored so the folder loads unpacked with no build step. There is
nothing to compile and no package manager involved.
