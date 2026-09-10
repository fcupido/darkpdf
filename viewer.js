// Rewrites a local PDF so its own colors are inverted, then displays it with
// Chrome's PDF viewer. The inversion is one full-page rectangle per page drawn
// with the Difference blend mode: Difference against white is |backdrop - 1|,
// which inverts whatever the page already painted. No color parsing needed,
// and the text stays real text, so selection and search keep working.

// 'embed' keeps this page in the tab, so reload re-runs the transform.
// 'navigate' replaces the tab with the blob URL, which gives the full-size
// viewer toolbar but loses the source path from the address bar.
const MODE = 'embed';

// Passed to invertPDF(); see invert.js for what it does.
const ENSURE_PAGE_GROUP = true;

// A small button in the corner that switches back to the original. The toolbar
// popup and the keyboard shortcut do the same thing; set this to false if you
// would rather nothing floated over the page.
const SHOW_INLINE_TOGGLE = true;

const status = document.getElementById('status');
const frame = document.getElementById('frame');
const toggle = document.getElementById('toggle');
const src = new URLSearchParams(location.search).get('src');

function show(html) {
    status.innerHTML = html;
    status.classList.remove('hidden');
}

function openOriginal() {
    chrome.runtime.sendMessage({type: 'openOriginal', url: src});
}

function readLocalFile(url) {
    // fetch() does not implement the file: scheme, so this has to be XHR, and
    // it only works when "Allow access to file URLs" is enabled for this
    // extension on chrome://extensions.
    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('GET', url);
        xhr.responseType = 'arraybuffer';
        xhr.onload = () => {
            if (xhr.response && xhr.response.byteLength > 0) {
                resolve(new Uint8Array(xhr.response));
            } else {
                reject(new Error('The file is empty or unreadable.'));
            }
        };
        xhr.onerror = () => reject(new Error(
            'Could not read the file. Enable "Allow access to file URLs" for this extension.'));
        xhr.send();
    });
}

async function main() {
    if (!src) {
        show('No file given.');
        return;
    }
    const name = decodeURIComponent(src).split('/').pop();
    document.title = name;
    try {
        const inverted = await invertPDF(await readLocalFile(src), {ensurePageGroup: ENSURE_PAGE_GROUP});
        const url = URL.createObjectURL(new Blob([inverted], {type: 'application/pdf'}));
        if (MODE === 'navigate') {
            location.replace(url);
            return;
        }
        frame.src = url;
        frame.classList.remove('hidden');
        status.classList.add('hidden');

        if (SHOW_INLINE_TOGGLE) {
            const shortcut = (await chrome.commands.getAll())
                .find((c) => c.name === 'toggle-inversion');
            toggle.title = shortcut && shortcut.shortcut
                ? `Show the original (${shortcut.shortcut})`
                : 'Show the original';
            toggle.addEventListener('click', () => chrome.runtime.sendMessage({type: 'toggle'}));
            toggle.classList.remove('hidden');
        }
    } catch (err) {
        show(`Could not invert <b>${name}</b>.<br><br>${err.message}` +
             `<br><br><a href="#" id="original">Open the original instead</a>`);
        document.getElementById('original').addEventListener('click', (e) => {
            e.preventDefault();
            openOriginal();
        });
    }
}

main();
