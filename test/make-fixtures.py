#!/usr/bin/env python3
"""Generates the PDFs used to test this extension, into test/fixtures/.

Everything here is hand-written, so there are no dependencies: no Ghostscript,
no Python packages. The point of hand-writing them is control -- notably, none
of the "realistic" fixtures paint their own white background, because real PDFs
do not, and that is precisely the case that breaks a naive implementation.
"""

import os

WHITE_PAPER = b"q 1 1 1 rg %d %d %d %d re f Q\n"


class PDF:
    """Just enough PDF writer for fixtures: objects, xref table, trailer."""

    def __init__(self):
        self.objs = []

    def add(self, body):
        self.objs.append(body)
        return len(self.objs)

    def reserve(self):
        return self.add(b"")

    def fill(self, num, body):
        self.objs[num - 1] = body

    def stream(self, data, extra=b""):
        return self.add(b"<< " + extra + b"/Length %d >>\nstream\n" % len(data)
                        + data + b"\nendstream")

    def save(self, path, root):
        out = bytearray(b"%PDF-1.7\n%\xe2\xe3\xcf\xd3\n")
        offsets = []
        for i, body in enumerate(self.objs, start=1):
            offsets.append(len(out))
            out += b"%d 0 obj\n" % i + body + b"\nendobj\n"
        xref = len(out)
        out += b"xref\n0 %d\n0000000000 65535 f \n" % (len(self.objs) + 1)
        for off in offsets:
            out += b"%010d 00000 n \n" % off
        out += (b"trailer\n<< /Size %d /Root %d 0 R >>\nstartxref\n%d\n%%%%EOF\n"
                % (len(self.objs) + 1, root, xref))
        with open(path, "wb") as f:
            f.write(out)
        print("  ", os.path.basename(path), len(out), "bytes")


def esc(text):
    return text.replace("\\", r"\\").replace("(", r"\(").replace(")", r"\)").encode("latin-1")


def sample_content(box, title, extra=b""):
    """Text and colored boxes on blank paper -- no white background painted."""
    x, y, right, top = box
    return (
        b"0 0 0 rg BT /F1 16 Tf %d %d Td (" % (x + 40, top - 60) + esc(title) + b") Tj ET\n"
        b"0 0 0 rg BT /F1 11 Tf %d %d Td (Body text, for legibility and antialiasing.) Tj ET\n"
        % (x + 40, top - 90) +
        b"0.5 0.5 0.5 rg %d %d 140 70 re f\n" % (x + 40, y + 120) +
        b"0.8 0.1 0.1 rg %d %d 140 70 re f\n" % (x + 200, y + 120) +
        extra
    )


def simple(path, title, box=(0, 0, 612, 792), rotate=0, pages=1, image=False):
    pdf = PDF()
    font = pdf.add(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")
    pages_ref = pdf.reserve()

    xobject = b""
    extra = b""
    if image:
        # A 4x4 raw RGB image, scaled up. Uncompressed so it stays readable.
        px = bytes([
            255, 0, 0,    0, 255, 0,    0, 0, 255,   255, 255, 255,
            0, 0, 0,      128, 128, 128, 255, 0, 255, 0, 255, 255,
            255, 255, 0,  64, 0, 0,     0, 64, 0,    0, 0, 64,
            192, 192, 192, 32, 32, 32,  255, 128, 0, 0, 128, 255,
        ])
        img = pdf.stream(px, b"/Type /XObject /Subtype /Image /Width 4 /Height 4 "
                             b"/ColorSpace /DeviceRGB /BitsPerComponent 8 ")
        xobject = b"/XObject << /Im0 %d 0 R >> " % img
        extra = b"q 160 0 0 160 %d %d cm /Im0 Do Q\n" % (box[0] + 40, box[1] + 240)

    kids = []
    for n in range(pages):
        label = title if pages == 1 else "%s - page %d of %d" % (title, n + 1, pages)
        content = pdf.stream(sample_content(box, label, extra))
        rot = b"/Rotate %d " % rotate if rotate else b""
        kids.append(pdf.add(
            b"<< /Type /Page /Parent %d 0 R /MediaBox [%d %d %d %d] " % (pages_ref, *box) + rot +
            b"/Resources << /Font << /F1 %d 0 R >> " % font + xobject + b">> "
            b"/Contents %d 0 R >>" % content))

    pdf.fill(pages_ref, b"<< /Type /Pages /Kids [" +
             b" ".join(b"%d 0 R" % k for k in kids) + b"] /Count %d >>" % len(kids))
    pdf.save(path, pdf.add(b"<< /Type /Catalog /Pages %d 0 R >>" % pages_ref))


def blend_pages(path, variants):
    """Pages that invert themselves, mirroring what the extension produces:
    white paper painted first, content, then a blend-mode overlay on top."""
    pdf = PDF()
    font = pdf.add(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")
    xc = b"1 1 1 rg 0 0 612 792 re f\n"
    xov = pdf.stream(xc, b"/Type /XObject /Subtype /Form /BBox [0 0 612 792] "
                         b"/Group << /S /Transparency /CS /DeviceRGB /I false /K false >> "
                         b"/Resources << >> ")
    pages_ref = pdf.reserve()
    kids = []
    for title, note, group, overlay in variants:
        content = pdf.stream(
            WHITE_PAPER % (0, 0, 612, 792) +
            b"0 0 0 rg BT /F1 15 Tf 50 720 Td (" + esc(title) + b") Tj ET\n"
            b"0 0 0 rg BT /F1 10 Tf 50 698 Td (" + esc(note) + b") Tj ET\n" +
            sample_content((0, 0, 612, 792), "Sample content") + overlay)
        grp = b"/Group << /S /Transparency /CS /DeviceRGB >> " if group else b""
        kids.append(pdf.add(
            b"<< /Type /Page /Parent %d 0 R /MediaBox [0 0 612 792] " % pages_ref + grp +
            b"/Resources << /Font << /F1 %d 0 R >> /XObject << /XOv %d 0 R >> "
            b"/ExtGState << "
            b"/GSDiff << /Type /ExtGState /BM /Difference /CA 1 /ca 1 >> "
            b"/GSExcl << /Type /ExtGState /BM /Exclusion /CA 1 /ca 1 >> "
            b"/GSMul << /Type /ExtGState /BM /Multiply /CA 1 /ca 1 >> >> >> "
            b"/Contents %d 0 R >>" % (font, xov, content)))
    pdf.fill(pages_ref, b"<< /Type /Pages /Kids [" +
             b" ".join(b"%d 0 R" % k for k in kids) + b"] /Count %d >>" % len(kids))
    pdf.save(path, pdf.add(b"<< /Type /Catalog /Pages %d 0 R >>" % pages_ref))


DIFF = b"q /GSDiff gs 1 1 1 rg 0 0 612 792 re f Q\n"

here = os.path.dirname(os.path.abspath(__file__))
out = os.path.join(here, "fixtures")
os.makedirs(out, exist_ok=True)
p = lambda name: os.path.join(out, name)

print("fixtures for the automated harness (node test/verify.js):")
simple(p("plain-text.pdf"), "Plain text page")
simple(p("image.pdf"), "Page with a raster image", image=True)
simple(p("multipage.pdf"), "Multi-page document", pages=3)
simple(p("edge-origin.pdf"), "Non-zero MediaBox origin", box=(20, 30, 432, 522))
simple(p("edge-rotate.pdf"), "Rotated page", rotate=90)

manual = os.path.join(out, "manual")
os.makedirs(manual, exist_ok=True)
p = lambda name: os.path.join(manual, name)

print("fixtures to open by hand in the browser (test/fixtures/manual/):")
blend_pages(p("browser-check.pdf"), [
    ("1 - CONTROL, no overlay",
     "Must look normal: white paper, black text. If this page is dark, a screen filter is still on.",
     True, b""),
    ("2 - Difference overlay, direct",
     "Correct = inverted. Blank white = the blend mode was ignored.",
     True, DIFF),
    ("3 - Difference overlay inside a Form XObject group",
     "Correct = inverted. Blank white = the blend mode was ignored.",
     True, b"q /GSDiff gs /XOv Do Q\n"),
    ("4 - Exclusion overlay, direct",
     "Correct = inverted. Blank white = the blend mode was ignored.",
     True, b"q /GSExcl gs 1 1 1 rg 0 0 612 792 re f Q\n"),
    ("5 - Multiply 50% gray - THE DIAGNOSTIC",
     "Dimmed but readable = blend modes work. Flat gray slab = they are ignored.",
     True, b"q /GSMul gs 0.5 0.5 0.5 rg 0 0 612 792 re f Q\n"),
])
blend_pages(p("group-test.pdf"), [
    ("1 - page HAS a transparency group", "Known good. Correct = inverted.", True, DIFF),
    ("2 - page has NO transparency group",
     "If this is inverted too, ENSURE_PAGE_GROUP can be turned off.", False, DIFF),
    ("3 - no page group, overlay inside a Form XObject group",
     "Fallback construction, in case a bare page group is not enough.", False,
     b"q /GSDiff gs /XOv Do Q\n"),
])
