// Redirect top-level navigations to local PDFs into viewer.html, which rewrites
// the document and hands the result to Chrome's own PDF viewer.

const VIEWER = chrome.runtime.getURL('viewer.html');

// URLs the viewer asked us to let through untouched (transform failed, or the
// user chose to see the original).
const bypass = new Set();

function isLocalPDF(url) {
    if (!url.startsWith('file:///')) {
        return false;
    }
    const path = url.split('#')[0].split('?')[0];
    return path.toLowerCase().endsWith('.pdf');
}

chrome.webNavigation.onBeforeNavigate.addListener((details) => {
    if (details.frameId !== 0 || !isLocalPDF(details.url)) {
        return;
    }
    if (bypass.delete(details.url)) {
        return;
    }
    chrome.tabs.update(details.tabId, {
        url: `${VIEWER}?src=${encodeURIComponent(details.url)}`,
    });
});

chrome.runtime.onMessage.addListener((message, sender) => {
    if (message && message.type === 'openOriginal' && message.url && sender.tab) {
        bypass.add(message.url);
        chrome.tabs.update(sender.tab.id, {url: message.url});
    }
});
