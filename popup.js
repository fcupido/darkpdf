// The control panel. All decisions live in background.js; this only reflects
// them and sends messages.

const fileRow = document.getElementById('file-row');
const fileToggle = document.getElementById('file-toggle');
const fileHint = document.getElementById('file-hint');
const defaultToggle = document.getElementById('default-toggle');
const nameEl = document.getElementById('name');
const forget = document.getElementById('forget');
const shortcutEl = document.getElementById('shortcut');

const send = (message) => chrome.runtime.sendMessage(message);

function render(state) {
    const hasFile = Boolean(state.fileURL);

    // The name is elided from the left, so the file name stays visible.
    nameEl.textContent = hasFile ? state.name : 'No PDF in this tab';
    nameEl.title = hasFile ? decodeURIComponent(state.fileURL) : '';

    fileRow.classList.toggle('disabled', !hasFile);
    fileToggle.disabled = !hasFile;
    fileToggle.checked = state.inverted;

    fileHint.textContent = !hasFile ? ''
        : state.hasOverride ? 'Remembered for this file.'
        : 'Following the default below.';

    defaultToggle.checked = state.invertByDefault;

    forget.hidden = state.overrideCount === 0;
    forget.textContent = state.overrideCount === 1
        ? 'Forget 1 saved choice'
        : `Forget ${state.overrideCount} saved choices`;
}

fileToggle.addEventListener('change', async () => {
    await send({type: 'toggle'});
    window.close(); // the tab is navigating; nothing left to show
});

defaultToggle.addEventListener('change', async () => {
    render(await send({type: 'setDefault', value: defaultToggle.checked}));
});

forget.addEventListener('click', async () => {
    render(await send({type: 'forgetChoices'}));
});

(async () => {
    render(await send({type: 'state'}));

    const commands = await chrome.commands.getAll();
    const toggle = commands.find((c) => c.name === 'toggle-inversion');
    shortcutEl.textContent = toggle && toggle.shortcut ? toggle.shortcut : '';
})();
