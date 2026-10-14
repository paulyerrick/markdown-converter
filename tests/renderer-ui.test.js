const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const bundle = () => fs.readFileSync(path.join(__dirname, '../renderer-ui/app.js'), 'utf8');

async function mount(overrides = {}) {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'https://markdown.local/', runScripts: 'outside-only', pretendToBeVisual: true });
  const { window } = dom;
  const calls = { save: [], copy: [], configure: [] };
  window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  window.HTMLDialogElement.prototype.close = function () { if (this.open) { this.open = false; this.dispatchEvent(new window.Event('close')); } };
  Object.defineProperty(window.navigator, 'clipboard', { value: { writeText: async text => { calls.copy.push(text); } } });
  window.api = {
    listDestinations: async () => ({ ok: true, destinations: [] }),
    connectionStatus: async () => ({ ok: true, connections: { signedIn: false, login: { phase: 'idle' }, 'google-drive': { accounts: [], connected: false }, notion: { accounts: [], connected: false } } }),
    convertHtml: async () => ({ ok: true, markdown: '# Imported\n\n**Keep this.**' }),
    saveFile: async (...args) => { calls.save.push(args); return { ok: true, filePath: '/chosen/edited.md' }; },
    configureAccount: async (...args) => { calls.configure.push(args); return { ok: true, targetLabel: 'Projects' }; },
    ...overrides,
  };
  window.eval(bundle());
  const $ = selector => window.document.querySelector(selector);
  async function waitFor(predicate, message = 'UI did not update', timeout = 2500) {
    const start = Date.now();
    while (!predicate()) { if (Date.now() - start > timeout) assert.fail(message); await new Promise(resolve => setTimeout(resolve, 10)); }
  }
  function fill(selector, value) {
    const element = $(selector);
    const proto = element.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : element.tagName === 'SELECT' ? window.HTMLSelectElement.prototype : window.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(element, value);
    element.dispatchEvent(new window.Event(element.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
  }
  await waitFor(() => $('#drop-zone'));
  // Let React attach its document-level paste/drop listeners after the first paint.
  await new Promise(resolve => setTimeout(resolve, 20));
  return { dom, window, $, waitFor, fill, calls };
}

test('the bundled React editor imports to preview, keeps edits, and only saves explicitly', async () => {
  const ui = await mount();
  const { dom, window, $, waitFor, fill, calls } = ui;
  try {
    const paste = new window.Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(paste, 'clipboardData', { value: { getData: type => type === 'text/html' ? '<h1>Imported</h1>' : '' } });
    $('h1').dispatchEvent(paste);
    await waitFor(() => $('#output').value.includes('# Imported'));
    assert.equal(calls.save.length, 0);
    assert.equal($('#output').hidden, false);
    fill('#output', '# Edited\n\nReady to save.');
    fill('#filename', 'edited');
    $('#btn-copy').click();
    await waitFor(() => calls.copy.length);
    assert.equal(calls.copy[0], '# Edited\n\nReady to save.');
    $('#btn-save').click();
    await waitFor(() => $('#status').textContent.startsWith('Saved to'));
    assert.deepEqual(calls.save[0], ['# Edited\n\nReady to save.', 'edited.md', 'local']);
    $('#btn-connections').click();
    await waitFor(() => $('#connections-dialog').open);
    $('#btn-close-connections').click();
    await waitFor(() => !$('#connections-dialog').open);
    assert.equal($('#output').value, '# Edited\n\nReady to save.');
  } finally { dom.window.close(); }
});

test('sign-in shows a fallback link, prevents double submission, cancels, and refreshes real card state', async () => {
  let logins = 0, canceled = 0;
  const snapshot = { signedIn: false, login: { phase: 'idle' }, 'google-drive': { accounts: [], connected: false }, notion: { accounts: [], connected: false } };
  const ui = await mount({
    connectionStatus: async () => ({ ok: true, connections: structuredClone(snapshot) }),
    loginComposio: async () => {
      logins++;
      await new Promise(resolve => setTimeout(resolve, 25));
      snapshot.login = { phase: 'pending', url: 'https://platform.composio.dev/?cliKey=test' };
      return { ok: true, pending: true, url: snapshot.login.url, browserOpened: false, browserError: 'Could not open your browser. Copy the sign-in link.' };
    },
    cancelComposioLogin: async () => { canceled++; snapshot.login = { phase: 'idle' }; return { ok: true }; },
    listAccountLocations: async () => ({ ok: true, items: [{ id: 'folder-123456789', label: 'Projects' }], cursor: null }),
  });
  const { $, waitFor, fill, calls, dom } = ui;
  try {
    $('#btn-connections').click();
    await waitFor(() => $('#connections-dialog').open);
    $('#btn-login-composio').click();
    await waitFor(() => $('#btn-login-composio').disabled);
    $('#btn-login-composio').click();
    await waitFor(() => $('#connection-status').textContent.includes('Could not open your browser'));
    assert.equal(logins, 1);
    $('#btn-copy-login').click();
    await waitFor(() => calls.copy.length);
    assert.equal(calls.copy[0], 'https://platform.composio.dev/?cliKey=test');
    $('#btn-cancel-login').click();
    await waitFor(() => !$('#btn-copy-login'));
    assert.equal(canceled, 1);
    $('#btn-login-composio').click();
    await waitFor(() => logins === 2 && $('#btn-copy-login'));
    snapshot.signedIn = true;
    snapshot.login = { phase: 'complete' };
    snapshot['google-drive'] = { accounts: [{ id: 'drive-account', label: 'Work Drive' }], connected: true, account: 'drive-account' };
    await waitFor(() => !$('#btn-login-composio'), 'Browser completion should refresh the card automatically', 5000);
    $('[data-connect="google-drive"]').click();
    await waitFor(() => $('#google-drive-account'));
    assert.equal($('#google-drive-account').value, 'drive-account');
    $('[data-search="google-drive"]').click();
    await waitFor(() => $('#google-drive-target').options.length === 2);
    fill('#google-drive-target', 'folder-123456789');
    $('[data-configure="google-drive"]').click();
    await waitFor(() => calls.configure.length);
    assert.deepEqual(calls.configure[0], ['google-drive', 'drive-account', 'folder-123456789']);
  } finally { dom.window.close(); }
});

test('a failed sign-in gives visible feedback and allows retry without losing the document', async () => {
  const { dom, $, waitFor } = await mount({ loginComposio: async () => ({ ok: false, error: 'Unable to reach Composio. Try again.' }) });
  try {
    $('#btn-connections').click();
    await waitFor(() => $('#connections-dialog').open);
    $('#btn-login-composio').click();
    await waitFor(() => $('#connection-status').textContent.includes('Unable to reach Composio'));
    assert.equal($('#btn-login-composio').disabled, false);
  } finally { dom.window.close(); }
});
