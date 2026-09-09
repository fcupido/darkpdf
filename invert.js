// The transform, kept apart from the viewer so it can be exercised outside the
// browser (see test/verify.js).
//
// One full-page white rectangle per page drawn with the Difference blend mode.
// Difference against white is |backdrop - 1|, i.e. an inversion of whatever the
// page already painted. No content-stream color rewriting, and the text stays
// real text, so selection and search keep working.

async function invertPDF(bytes, options) {
    const opts = options || {};
    const lib = opts.PDFLib || (typeof PDFLib !== 'undefined' ? PDFLib : null);
    if (!lib) {
        throw new Error('pdf-lib is not loaded.');
    }
    // Most real PDFs carry no transparency group on their pages, and whether a
    // viewer honors the blend mode without one is viewer-dependent, so add one
    // where it is missing unless the caller opts out.
    const ensurePageGroup = opts.ensurePageGroup !== false;

    const {PDFDocument, PDFName, BlendMode, rgb} = lib;
    const doc = await PDFDocument.load(bytes, {ignoreEncryption: true, updateMetadata: false});
    for (const page of doc.getPages()) {
        if (ensurePageGroup && !page.node.get(PDFName.of('Group'))) {
            page.node.set(PDFName.of('Group'), doc.context.obj({
                Type: 'Group',
                S: 'Transparency',
                CS: 'DeviceRGB',
            }));
        }
        const box = page.getMediaBox();

        // A PDF page's paper is not painted content, it is blank. Blending
        // against nothing leaves the source color unchanged, so without an
        // opaque backdrop only the drawn marks would invert and the page would
        // end up white-on-white. Paint the paper first, behind everything.
        page.node.normalizedEntries().Contents.insert(0, doc.context.register(
            doc.context.stream(
                `q 1 1 1 rg ${box.x} ${box.y} ${box.width} ${box.height} re f Q\n`)));

        page.drawRectangle({
            x: box.x,
            y: box.y,
            width: box.width,
            height: box.height,
            color: rgb(1, 1, 1),
            blendMode: BlendMode.Difference,
        });
    }
    return doc.save();
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {invertPDF};
}
