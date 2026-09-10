// Redirects top-level navigations to local PDFs into viewer.html, which rewrites
// the document and hands the result to Chrome's own PDF viewer.
//
// Whether a given file is inverted comes from two settings: a global default,
// and a per-file choice that overrides it. Both live in chrome.storage.local.

const VIEWER = chrome.runtime.getURL('viewer.html');

const DEFAULTS = {invertByDefault: true, perFile: {}};

// Files we have been asked to let through untouched exactly once, because we
// are in the middle of navigating a tab to the original on purpose.
const bypass = new Set();

function isLocalPDF(url) {
    if (!url || !url.startsWith('file:///')) {
        return false;
    }
    const path = url.split('#')[0].split('?')[0];
    return path.toLowerCase().endsWith('.pdf');
}

function viewerURLFor(fileURL) {
    return `${VIEWER}?src=${encodeURIComponent(fileURL)}`;
}

// The PDF a tab is showing, whether that is the original or our viewer.
function fileURLOf(tabURL) {
    if (!tabURL) {
        return null;
    }
    if (tabURL.startsWith(VIEWER)) {
        return new URL(tabURL).searchParams.get('src');
    }
    return isLocalPDF(tabURL) ? tabURL : null;
}

async function readSettings() {
    const stored = await chrome.storage.local.get(DEFAULTS);
    return {
        invertByDefault: stored.invertByDefault !== false,
        perFile: stored.perFile || {},
    };
}

async function shouldInvert(fileURL) {
    const {invertByDefault, perFile} = await readSettings();
    return fileURL in perFile ? perFile[fileURL] : invertByDefault;
}

async function remember(fileURL, invert) {
    const {perFile} = await readSettings();
    perFile[fileURL] = invert;
    await chrome.storage.local.set({perFile});
}

function showTab(tabId, fileURL, invert) {
    if (invert) {
        return chrome.tabs.update(tabId, {url: viewerURLFor(fileURL)});
    }
    // Let the next navigation to this file through untouched.
    bypass.add(fileURL);
    return chrome.tabs.update(tabId, {url: fileURL});
}

async function activeTab() {
    const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
    return tab || null;
}

// Toggles what the current tab is showing, and remembers the choice for that
// file. Based on what is actually on screen rather than on the stored setting,
// so it always does the opposite of what you are looking at.
async function toggleTab(tab) {
    const fileURL = fileURLOf(tab.url);
    if (!fileURL) {
        return null;
    }
    const invert = !tab.url.startsWith(VIEWER);
    await remember(fileURL, invert);
    await showTab(tab.id, fileURL, invert);
    return invert;
}

async function state() {
    const tab = await activeTab();
    const fileURL = tab ? fileURLOf(tab.url) : null;
    const {invertByDefault, perFile} = await readSettings();
    return {
        fileURL,
        name: fileURL ? decodeURIComponent(fileURL).split('/').pop() : null,
        inverted: Boolean(tab && tab.url.startsWith(VIEWER)),
        invertByDefault,
        hasOverride: Boolean(fileURL && fileURL in perFile),
        overrideCount: Object.keys(perFile).length,
    };
}

async function handle(message, sender) {
    switch (message && message.type) {
        case 'state':
            return state();

        case 'toggle': {
            const tab = sender.tab && sender.tab.url ? sender.tab : await activeTab();
            return tab ? {inverted: await toggleTab(tab)} : {inverted: null};
        }

        case 'setDefault':
            await chrome.storage.local.set({invertByDefault: Boolean(message.value)});
            return state();

        case 'forgetChoices':
            await chrome.storage.local.set({perFile: {}});
            return state();

        // The viewer asks for this when it cannot transform a file. Remember
        // the choice rather than relying on the in-memory bypass alone: if this
        // worker is torn down before the navigation happens, we would redirect
        // the file straight back into the viewer that just failed on it.
        case 'openOriginal':
            if (message.url && sender.tab) {
                await remember(message.url, false);
                await showTab(sender.tab.id, message.url, false);
            }
            return {};

        default:
            return {};
    }
}

chrome.webNavigation.onBeforeNavigate.addListener(async (details) => {
    if (details.frameId !== 0 || !isLocalPDF(details.url)) {
        return;
    }
    if (bypass.delete(details.url)) {
        return;
    }
    if (!(await shouldInvert(details.url))) {
        return;
    }
    chrome.tabs.update(details.tabId, {url: viewerURLFor(details.url)});
});

chrome.commands.onCommand.addListener(async (command) => {
    if (command !== 'toggle-inversion') {
        return;
    }
    const tab = await activeTab();
    if (tab) {
        await toggleTab(tab);
    }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    handle(message, sender).then(sendResponse, (err) => sendResponse({error: String(err)}));
    return true; // keep the message channel open for the async reply
});
