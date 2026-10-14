const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createConnections, parseDestination } = require('../connections');

test('cloud saves use the selected account, validate targets, and preserve Markdown', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'connections-test-'));
  let uploadedPath;
  const calls = [];
  const notionId = '123456781234123412341234567890ab';
  const run = async (args, options) => {
    calls.push({ args, options });
    if (args[0] === 'whoami') return { email: 'test@example.invalid' };
    if (args[0] === 'link') return { items: [{ id: 'test-account', status: 'ACTIVE', word_id: 'Test account' }] };
    const data = JSON.parse(options.input);
    assert.equal(args[args.indexOf('--account') + 1], 'test-account');
    switch (args[1]) {
      case 'GOOGLEDRIVE_GET_FILE_METADATA':
        assert.equal(data.fileId, 'folder12345678');
        return { data: { id: data.fileId, name: 'Notes', mimeType: 'application/vnd.google-apps.folder' } };
      case 'GOOGLEDRIVE_UPLOAD_FILE':
        uploadedPath = args[args.indexOf('--file') + 1];
        assert.equal(await fs.readFile(uploadedPath, 'utf8'), '# Edited\n\nA **bold** line.');
        assert.equal(data.folder_to_upload_to, 'folder12345678');
        return { data: { id: 'uploaded-file' } };
      case 'NOTION_RETRIEVE_PAGE':
        assert.equal(data.page_id, notionId);
        return { data: { properties: { title: { type: 'title', title: [{ plain_text: 'My notes' }] } } } };
      case 'NOTION_CREATE_NOTION_PAGE':
        assert.equal(data.parent_id, notionId);
        assert.equal(data.markdown, '# Edited\n\nA **bold** line.');
        return { data: { id: 'created-page', url: 'https://www.notion.so/created-page' } };
      default: throw new Error(`Unexpected tool: ${args[1]}`);
    }
  };
  try {
    const connections = createConnections({ settingsPath: path.join(dir, 'settings.json'), run });
    await connections.configure('google-drive', 'test-account', 'https://drive.google.com/drive/folders/folder12345678');
    await connections.configure('notion', 'test-account', `https://www.notion.so/Notes-${notionId}`);
    assert.equal((await connections.save('google-drive', '# Edited\n\nA **bold** line.', 'edited.md')).ok, true);
    await assert.rejects(fs.access(uploadedPath));
    assert.equal((await connections.save('notion', '# Edited\n\nA **bold** line.', 'edited.md')).ok, true);
    assert.ok(calls.every(call => !call.args.some(arg => arg.includes('# Edited'))));
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test('missing or ambiguous connections never silently use another account', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'connections-test-'));
  try {
    const connections = createConnections({ settingsPath: path.join(dir, 'settings.json'), run: async () => ({ items: [{ id: 'a', status: 'ACTIVE' }, { id: 'b', status: 'ACTIVE' }] }) });
    await assert.rejects(connections.save('google-drive', 'hello', 'test.md'), /Choose a connected/);
    assert.throws(() => parseDestination('bad-id', 'notion'), /Notion parent page/);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test('large Composio results are read from their artifact instead of appearing empty', async () => {
  const { readComposioResult } = require('../connections');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'composio-artifact-test-'));
  try {
    const file = path.join(dir, 'NOTION_SEARCH_NOTION_PAGE_OUTPUT_test.json');
    const expected = { successful: true, data: { results: [{ id: 'a-page' }], has_more: false } };
    await fs.writeFile(file, JSON.stringify(expected));
    assert.deepEqual(await readComposioResult({ successful: true, storedInFile: true, outputFilePath: file }, dir), expected);
    const config = path.join(dir, 'user_data.json');
    await fs.writeFile(config, '{}');
    await assert.rejects(readComposioResult({ storedInFile: true, outputFilePath: config }, dir), /invalid result file/);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test('Connect opens Composio browser authorization and login avoids installing agent skills', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'connect-flow-test-'));
  const calls = [];
  const opened = [];
  try {
    const connections = createConnections({ settingsPath: path.join(dir, 'settings.json'),
      run: async (args, options) => { calls.push({ args, options }); return args[0] === 'login' ? 'Open this URL: https://platform.composio.dev/?cliKey=test' : { redirect_url: 'https://connect.composio.dev/link/test' }; },
      openExternal: async url => opened.push(url),
    });
    await connections.connect('notion');
    assert.deepEqual(opened, ['https://connect.composio.dev/link/test']);
    assert.deepEqual(calls[0].args, ['link', 'notion', '--no-wait']);
    await connections.login();
    assert.deepEqual(calls[1].args, ['login', '--no-wait', '--no-skill-install', '--yes']);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test('desktop sign-in opens the non-interactive CLI login URL and starts completion polling', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'desktop-login-test-'));
  const opened = [];
  const calls = [];
  let complete;
  const waiting = new Promise(resolve => { complete = resolve; });
  try {
    const connections = createConnections({ settingsPath: path.join(dir, 'settings.json'),
      run: async (args) => {
        calls.push(args);
        if (args.includes('--poll')) { await waiting; return 'Login complete'; }
        return 'Open this URL in your browser to log in:\n\n  https://platform.composio.dev/?cliKey=test-session\n\nThen run this command to complete login:\n\n  composio login --poll\n';
      },
      openExternal: async url => opened.push(url),
    });
    const result = await connections.login();
    assert.deepEqual(opened, ['https://platform.composio.dev/?cliKey=test-session']);
    assert.equal(result.pending, true);
    assert.ok(calls.some(args => args.includes('--poll')), 'Credentials must be saved after browser authorization');
    assert.ok(calls.every(args => args.includes('--no-skill-install')));
  } finally { complete(); await fs.rm(dir, { recursive: true, force: true }); }
});

test('sign-in retains a usable link if macOS cannot open the browser and supports cancellation', async () => {
  let pollSignal;
  const connections = createConnections({ settingsPath: '/unused',
    run: async (args, options) => {
      if (args.includes('--poll')) {
        pollSignal = options.signal;
        await new Promise((resolve, reject) => options.signal.addEventListener('abort', () => reject(new Error('Canceled')), { once: true }));
      }
      return 'Open this URL: https://platform.composio.dev/?cliKey=test';
    },
    openExternal: async () => { throw new Error('No browser'); },
  });
  const result = await connections.login();
  assert.equal(result.pending, true);
  assert.equal(result.browserOpened, false);
  assert.match(result.url, /^https:\/\/platform.composio.dev/);
  assert.match(result.browserError, /Copy the sign-in link/);
  connections.cancelLogin();
  assert.equal(pollSignal.aborted, true);
});

test('sign-in rejects unexpected authorization domains before opening a browser or polling', async () => {
  const calls = [];
  const connections = createConnections({ settingsPath: '/unused',
    run: async args => { calls.push(args); return 'Open this URL: https://composio.dev.evil.example/?cliKey=test'; },
    openExternal: async () => assert.fail('Must not open an untrusted link'),
  });
  await assert.rejects(connections.login(), /invalid sign-in link/);
  assert.equal(calls.length, 1);
});

test('the real subprocess runner preserves login instructions from piped stdout', async () => {
  const { runComposio } = require('../connections');
  const text = 'Open this URL in your browser to log in:\n\n  https://platform.composio.dev/?cliKey=test-session';
  const output = await runComposio(['-e', `process.stdout.write(${JSON.stringify(text)})`], { executable: process.execPath, json: false });
  assert.equal(output, text);
});
