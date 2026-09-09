// Runs the shipped transform outside the browser and checks the result by
// rendering it with Ghostscript and sampling pixels. Chrome is not involved:
// this verifies the file we produce is correct, not how PDFium treats it.
//
//   node test/verify.js <input.pdf> [...]

const {execFileSync} = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PDFLib = require('../vendor/pdf-lib.min.js');
const {invertPDF} = require('../invert.js');

// Renders every page, returning one PPM path per page.
function render(pdf, dir, prefix) {
    execFileSync('gs', ['-q', '-dNOPAUSE', '-dBATCH', '-sDEVICE=ppmraw', '-r72',
        `-sOutputFile=${path.join(dir, prefix)}-%d.ppm`, pdf],
        {stdio: ['ignore', 'ignore', 'pipe']});
    const out = [];
    for (let n = 1; ; n++) {
        const file = path.join(dir, `${prefix}-${n}.ppm`);
        if (!fs.existsSync(file)) break;
        out.push(file);
    }
    return out;
}

function readPPM(file) {
    const d = fs.readFileSync(file);
    const toks = [];
    let i = 2;
    while (toks.length < 3) {
        while (/\s/.test(String.fromCharCode(d[i]))) i++;
        if (d[i] === 0x23) { while (d[i] !== 0x0a) i++; continue; }
        const s = i;
        while (!/\s/.test(String.fromCharCode(d[i]))) i++;
        toks.push(parseInt(d.slice(s, i).toString(), 10));
    }
    return {w: toks[0], h: toks[1], px: d.slice(i + 1)};
}

const px = (img, x, y) => {
    const i = (y * img.w + x) * 3;
    return [img.px[i], img.px[i + 1], img.px[i + 2]];
};

let failures = 0;
function check(name, ok, detail) {
    console.log(`  ${ok ? 'pass' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
    if (!ok) failures++;
}

(async () => {
    const inputs = process.argv.slice(2);
    if (inputs.length === 0) {
        console.error('usage: node test/verify.js <input.pdf> [...]');
        process.exit(2);
    }
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'darkpdf-'));

    for (const [index, input] of inputs.entries()) {
        console.log(`\n${input}`);
        // A directory per input, so one file's page renders cannot be mistaken
        // for the next one's.
        const tmp = path.join(root, String(index));
        fs.mkdirSync(tmp);
        const src = fs.readFileSync(input);
        let out;
        try {
            out = await invertPDF(new Uint8Array(src), {PDFLib});
        } catch (err) {
            check('transform runs', false, err.message);
            continue;
        }
        check('transform runs', true, `${src.length} -> ${out.length} bytes`);

        const dst = path.join(tmp, path.basename(input));
        fs.writeFileSync(dst, out);

        // Structural checks go through the parser: pdf-lib packs objects into
        // compressed object streams, so grepping the bytes proves nothing.
        const reloaded = await PDFLib.PDFDocument.load(out, {ignoreEncryption: true});
        check('output re-parses', true);

        const {PDFName} = PDFLib;
        let groups = 0;
        let blends = 0;
        for (const page of reloaded.getPages()) {
            const group = page.node.lookupMaybe(PDFName.of('Group'), PDFLib.PDFDict);
            if (group && String(group.get(PDFName.of('S'))) === '/Transparency') groups++;
            const res = page.node.lookupMaybe(PDFName.of('Resources'), PDFLib.PDFDict);
            const gs = res && res.lookupMaybe(PDFName.of('ExtGState'), PDFLib.PDFDict);
            if (gs && gs.entries().some(([, v]) => {
                const d = v instanceof PDFLib.PDFDict ? v : reloaded.context.lookup(v);
                return d && String(d.get(PDFName.of('BM'))) === '/Difference';
            })) blends++;
        }
        const pages = reloaded.getPageCount();
        check('every page has a transparency group', groups === pages, `${groups}/${pages}`);
        check('every page has a Difference ExtGState', blends === pages, `${blends}/${pages}`);

        const beforePages = render(input, tmp, 'a');
        const afterPages = render(dst, tmp, 'b');
        check('page count unchanged', beforePages.length === afterPages.length,
            `${beforePages.length} page(s)`);

        let sizesMatch = true;
        let paperInverts = true;
        let paperDetail = '';

        // Every pixel should be the complement of the original. Glyph edges
        // are allowed to differ: antialiasing white-on-black is not the exact
        // mirror of black-on-white, so a few edge pixels legitimately drift.
        let samples = 0;
        let outliers = 0;
        for (let i = 0; i < Math.min(beforePages.length, afterPages.length); i++) {
            const A = readPPM(beforePages[i]);
            const B = readPPM(afterPages[i]);
            if (A.w !== B.w || A.h !== B.h) sizesMatch = false;

            // Sample the paper in a corner, well away from any content.
            const pa = px(A, A.w - 3, 3);
            const pb = px(B, B.w - 3, 3);
            if (!(pa.every((v) => v > 240) && pb.every((v) => v < 15))) paperInverts = false;
            if (i === 0) paperDetail = `${pa} -> ${pb}`;

            for (let y = 0; y < A.h; y += 2) {
                for (let x = 0; x < A.w; x += 2) {
                    const a = px(A, x, y);
                    const b = px(B, x, y);
                    let err = 0;
                    for (let c = 0; c < 3; c++) {
                        err = Math.max(err, Math.abs(255 - a[c] - b[c]));
                    }
                    samples++;
                    if (err > 24) outliers++;
                }
            }
        }
        check('page size unchanged on every page', sizesMatch);
        check('paper inverts on every page', paperInverts, paperDetail);
        const pct = (100 * outliers / samples).toFixed(3);
        check('pixels are the complement of the original', outliers / samples < 0.005,
            `${pct}% off by more than 24/255, ${samples} samples`);
    }

    console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`);
    process.exit(failures === 0 ? 0 : 1);
})();
