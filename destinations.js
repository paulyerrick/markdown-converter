const fs = require('node:fs/promises');
const path = require('node:path');

const DESTINATIONS = {
  local: 'Choose any folder',
  obsidian: 'Obsidian vault',
  icloud: 'iCloud Drive',
  dropbox: 'Dropbox',
  custom: 'Other saved folder',
};

function createDestinations({ settingsPath, home, documents, dialog, getWindow }) {
  let folders;
  async function load() {
    if (folders) return;
    try { folders = JSON.parse(await fs.readFile(settingsPath, 'utf8')); }
    catch { folders = {}; }
    if (!folders || typeof folders !== 'object' || Array.isArray(folders)) folders = {};
  }
  async function existingFolder(candidate) {
    if (typeof candidate !== 'string') return null;
    try { return (await fs.stat(candidate)).isDirectory() ? candidate : null; }
    catch { return null; }
  }
  async function suggest(id) {
    if (id === 'icloud') return await existingFolder(path.join(home, 'Library/Mobile Documents/com~apple~CloudDocs')) || documents;
    if (id === 'dropbox') {
      const cloudRoot = path.join(home, 'Library/CloudStorage');
      try {
        const entries = await fs.readdir(cloudRoot);
        const match = entries.find(name => name.startsWith('Dropbox'));
        if (match) return path.join(cloudRoot, match);
      } catch { /* The provider might not be installed. Let the user choose. */ }
      if (id === 'dropbox') return await existingFolder(path.join(home, 'Dropbox')) || documents;
    }
    return documents;
  }
  async function list() {
    await load();
    return Promise.all(Object.entries(DESTINATIONS).map(async ([id, label]) => ({ id, label, folder: await existingFolder(folders[id]) })));
  }
  async function choose(id) {
    if (!Object.hasOwn(DESTINATIONS, id) || id === 'local') throw new Error('Choose a folder destination first.');
    await load();
    const result = await dialog.showOpenDialog(getWindow(), {
      title: `Choose your ${DESTINATIONS[id]} folder`,
      message: id === 'obsidian' ? 'Choose a vault folder or a folder inside your vault.' : 'Choose the local folder where these Markdown files should be saved. Cloud folders sync through their desktop app.',
      defaultPath: await existingFolder(folders[id]) || await suggest(id),
      properties: ['openDirectory', 'createDirectory'],
    });
    if (result.canceled || !result.filePaths.length) return { ok: false, canceled: true };
    folders[id] = result.filePaths[0];
    await fs.mkdir(path.dirname(settingsPath), { recursive: true });
    await fs.writeFile(settingsPath, JSON.stringify(folders, null, 2), 'utf8');
    return { ok: true, folder: folders[id] };
  }
  async function save(content, defaultName, id = 'local') {
    if (!Object.hasOwn(DESTINATIONS, id)) throw new Error('Unknown save destination.');
    await load();
    let folder = documents;
    if (id !== 'local') {
      folder = await existingFolder(folders[id]);
      if (!folder) {
        const selected = await choose(id);
        if (!selected.ok) return selected;
        folder = selected.folder;
      }
    }
    const safeName = path.basename(defaultName || 'converted.md').replace(/[\x00-\x1f:]/g, '-');
    const result = await dialog.showSaveDialog(getWindow(), {
      title: `Save Markdown — ${DESTINATIONS[id]}`,
      defaultPath: path.join(folder, safeName),
      filters: [{ name: 'Markdown', extensions: ['md'] }],
      properties: ['createDirectory', 'showOverwriteConfirmation'],
    });
    if (result.canceled || !result.filePath) return { ok: false, canceled: true };
    await fs.writeFile(result.filePath, content, 'utf8');
    return { ok: true, filePath: result.filePath, destination: id };
  }
  return { list, choose, save };
}
module.exports = { createDestinations };
