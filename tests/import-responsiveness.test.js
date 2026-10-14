const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const { makeDocx } = require('./fixtures');

// Exercise the production IPC handler while stubbing only native window/dialog APIs.
function loadHandlers() {
  const handlers = new Map();
  const originalLoad = Module._load;
  Module._load = function (id, ...args) {
    if (id === 'electron') return {
      app: { setLoginItemSettings() {}, whenReady: () => ({ then() {} }), on() {}, getPath: () => os.tmpdir() },
      ipcMain: { handle: (name, fn) => handlers.set(name, fn), on() {} },
      dialog: {},
    };
    return originalLoad.call(this, id, ...args);
  };
  try { require('../main'); } finally { Module._load = originalLoad; }
  return handlers;
}
const handlers = loadHandlers();

test('Word import preserves content without blocking the main event loop', { timeout: 20000 }, async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'markdown-import-'));
  try {
    const filePath = path.join(dir, 'word.docx');
    await makeDocx(filePath, Number(process.env.IMPORT_PARAGRAPHS || 10000));
    let previous = performance.now();
    let longestPause = 0;
    const heartbeat = setInterval(() => {
      const now = performance.now();
      longestPause = Math.max(longestPause, now - previous);
      previous = now;
    }, 10);
    let result;
    try {
      result = await handlers.get('convert-file')({}, filePath);
      await new Promise(resolve => setTimeout(resolve, 20));
    } finally { clearInterval(heartbeat); }
    assert.equal(result.ok, true, result.error);
    assert.match(result.markdown, /\*\*Word import test\*\*/);
    console.log(`Longest main-thread pause: ${Math.round(longestPause)}ms`);
    assert.ok(longestPause < 200, `Word import froze the main event loop for ${Math.round(longestPause)}ms (limit: 200ms)`);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});
