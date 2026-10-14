const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createDestinations } = require('../destinations');

test('saving remembers an Obsidian folder, writes edited content, and handles cancellation', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'destinations-test-'));
  const savedPath = path.join(dir, 'note.md');
  let folderPrompts = 0;
  let cancel = false;
  const settings = { settingsPath: path.join(dir, 'preferences.json'), home: dir, documents: dir, getWindow: () => null,
    dialog: {
      async showOpenDialog() { folderPrompts++; return { canceled: false, filePaths: [dir] }; },
      async showSaveDialog(_window, options) { assert.equal(options.defaultPath, savedPath); return { canceled: cancel, filePath: savedPath }; },
    } };
  try {
    let destinations = createDestinations(settings);
    assert.equal((await destinations.save('Edited Markdown', 'note.md', 'obsidian')).ok, true);
    assert.equal(await fs.readFile(savedPath, 'utf8'), 'Edited Markdown');
    destinations = createDestinations(settings);
    await destinations.save('Second edit', 'note.md', 'obsidian');
    assert.equal(folderPrompts, 1);
    cancel = true;
    assert.equal((await destinations.save('Canceled edit', 'note.md', 'obsidian')).canceled, true);
    assert.equal(await fs.readFile(savedPath, 'utf8'), 'Second edit');
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});
