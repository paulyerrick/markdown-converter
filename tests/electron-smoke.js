const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { makeDocx } = require('./fixtures');

(async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'markdown-electron-'));
  const docx = path.join(dir, 'Word sample.docx');
  const savePath = path.join(dir, 'edited.md');
  await makeDocx(docx, 10000);
  let app;
  try {
    app = await electron.launch({ args: [path.join(__dirname, 'electron-launcher.js')], env: { ...process.env, MARKDOWN_TEST_USER_DATA: dir } });
    await app.evaluate(({ dialog, ipcMain }, paths) => {
      global.saveDialogs = 0;
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [paths.docx] });
      dialog.showSaveDialog = async () => { global.saveDialogs++; return { canceled: false, filePath: paths.savePath }; };
      // Only remote account responses are mocked; renderer, preload, workers, and filesystem saves are real.
      ipcMain.removeHandler('connection-status');
      ipcMain.handle('connection-status', () => ({ ok: true, connections: { signedIn: false, 'google-drive': { accounts: [], connected: false }, notion: { accounts: [], connected: false } } }));
      ipcMain.removeHandler('login-composio');
      ipcMain.handle('login-composio', () => ({ ok: false, error: 'Test sign-in unavailable. Try again.' }));
    }, { docx, savePath });
    const page = await app.firstWindow();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.waitForSelector('#drop-zone');
    assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()), true, 'Normal launch must show the editor without --show');
    const dimensions = await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; return { size: w.getSize(), resizable: w.isResizable() }; });
    assert.ok(dimensions.size[0] >= 900);
    assert.equal(dimensions.resizable, true);
    await app.evaluate(({ clipboard }) => clipboard.write({ html: '<h1>Review first</h1><p>Some <strong>bold</strong> text.</p>', text: 'Review first\nSome bold text.' }));
    await page.locator('h1').click();
    await page.keyboard.press('Meta+V');
    await page.waitForFunction(() => document.getElementById('output').value.includes('# Review first'));
    assert.equal(await app.evaluate(() => global.saveDialogs), 0, 'Paste should not open Save As');
    await page.locator('#output').fill('# Edited\n\nReady to save.');
    await page.locator('#btn-copy').click();
    assert.equal(await app.evaluate(({ clipboard }) => clipboard.readText()), '# Edited\n\nReady to save.');
    await page.locator('#btn-save').click();
    await page.waitForFunction(() => document.getElementById('status').textContent.startsWith('Saved to'));
    assert.equal(await fs.readFile(savePath, 'utf8'), '# Edited\n\nReady to save.');
    // Pasting a URL into its field must not replace the current document.
    await app.evaluate(({ clipboard }) => clipboard.writeText('https://example.com'));
    await page.locator('#url-input').focus();
    await page.keyboard.press('Meta+V');
    assert.equal(await page.locator('#url-input').inputValue(), 'https://example.com');
    assert.equal(await page.locator('#output').inputValue(), '# Edited\n\nReady to save.');
    // Exercise a real native-file drag through Chromium to webUtils.getPathForFile.
    const box = await page.locator('#drop-zone').boundingBox();
    const cdp = await page.context().newCDPSession(page);
    const data = { items: [], files: [docx], dragOperationsMask: 1 };
    for (const type of ['dragEnter', 'dragOver', 'drop']) await cdp.send('Input.dispatchDragEvent', { type, x: box.x + 30, y: box.y + 30, data });
    await page.waitForFunction(() => document.getElementById('output').value.includes('**Word import test**'), { timeout: 15000 });
    assert.equal(await app.evaluate(() => global.saveDialogs), 1, 'Word drop should stop at preview');
    assert.equal(await page.locator('#filename').inputValue(), 'Word sample.md');
    // Finder reopens the same document instead of leaving a running app hidden.
    await app.evaluate(({ app, BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].hide();
      app.emit('activate');
    });
    assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()), true);
    assert.match(await page.locator('#output').inputValue(), /\*\*Word import test\*\*/);
    // Losing focus no longer hides the preview.
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].emit('blur'));
    assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()), true);
    await page.locator('#output').fill('# Project notes\n\n## Decisions\n\n- Review the document before saving\n- Connect a destination when you need it\n\n**Everything is ready for Markdown.**');
    await page.screenshot({ path: path.join(__dirname, '../dist/preview.png') });
    await page.locator('#btn-connections').click();
    await page.waitForSelector('#connections-dialog[open]');
    await page.screenshot({ path: path.join(__dirname, '../dist/connections.png') });
    await page.locator('#btn-login-composio').click();
    await page.waitForFunction(() => document.getElementById('connection-status').textContent.includes('Test sign-in unavailable'));
    assert.equal(await page.locator('#btn-login-composio').isEnabled(), true, 'Sign-in failures must allow retry');
    await page.locator('#btn-close-connections').click();
    await page.locator('#btn-clear').click();
    await page.locator('#drop-zone').click();
    await page.waitForFunction(() => document.getElementById('output').value.includes('**Word import test**'));
    assert.equal(await app.evaluate(() => global.saveDialogs), 1, 'Finder import should stop at preview');
    assert.deepEqual(errors, []);
    console.log('PASS: native paste, edited copy/save, URL paste, DOCX drag/drop and Finder import, window sizing/focus, and Connections UI.');
  } finally {
    if (app) await app.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
