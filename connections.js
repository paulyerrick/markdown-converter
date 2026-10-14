const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');

const activeCommands = new Set();

const TOOLKITS = { 'google-drive': 'googledrive', notion: 'notion' };

function parseDestination(value, provider) {
  let candidate = (value || '').trim();
  if (!candidate && provider === 'google-drive') return '';
  if (/^https?:\/\//.test(candidate)) {
    const url = new URL(candidate);
    if (provider === 'google-drive') candidate = url.pathname.match(/\/folders\/([\w-]+)/)?.[1] || '';
    else candidate = url.pathname.split('/').pop();
  }
  if (provider === 'google-drive' && /^[\w-]{10,}$/.test(candidate)) return candidate;
  if (provider === 'notion') {
    const match = candidate.match(/([a-f0-9]{32}|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/i);
    if (match) return match[1];
  }
  throw new Error(provider === 'notion' ? 'Paste a Notion parent page URL or page ID.' : 'Paste a Google Drive folder URL or folder ID, or leave it blank for My Drive.');
}

async function findComposio() {
  for (const candidate of [path.join(os.homedir(), '.composio/composio'), '/opt/homebrew/bin/composio', '/usr/local/bin/composio']) {
    try { await fs.access(candidate, fs.constants.X_OK); return candidate; } catch { /* Try the next installation location. */ }
  }
  return 'composio';
}

async function readComposioResult(result, cacheDir) {
  if (result.storedInFile) {
    if (typeof result.outputFilePath !== 'string') throw new Error('Composio did not return its result file.');
    const file = await fs.realpath(result.outputFilePath);
    const roots = [cacheDir, path.join(os.tmpdir(), 'composio'), path.join(os.homedir(), '.composio')].filter(Boolean);
    const allowed = (await Promise.all(roots.map(async root => {
      try { const relative = path.relative(await fs.realpath(root), file); return relative && !relative.startsWith('..') && !path.isAbsolute(relative); }
      catch { return false; }
    }))).some(Boolean);
    if (!allowed || !/^[A-Z][A-Z0-9_]+_OUTPUT_[a-zA-Z0-9-]+\.json$/.test(path.basename(file))) throw new Error('Composio returned an invalid result file.');
    if ((await fs.stat(file)).size > 16 * 1024 * 1024) throw new Error('Too many results. Narrow the destination search.');
    result = JSON.parse(await fs.readFile(file, 'utf8'));
  }
  if (result.successful === false || result.success === false || result.error) throw new Error(typeof result.error === 'string' ? result.error : JSON.stringify(result.error || 'Service request failed.'));
  return result;
}

async function runComposio(args, { input, timeout = 60000, executable, cacheDir, json = true, signal } = {}) {
  executable ||= await findComposio();
  if (cacheDir) await fs.mkdir(cacheDir, { recursive: true, mode: 0o700 });
  if (signal?.aborted) throw new Error('Sign-in canceled.');
  return new Promise((resolve, reject) => {
    // Never invoke a shell or put document text in command-line arguments.
    const env = { ...process.env, NO_COLOR: '1' };
    if (cacheDir) {
      for (const key of Object.keys(env)) if (key.startsWith('COMPOSIO_')) delete env[key];
      env.COMPOSIO_CACHE_DIR = cacheDir;
      env.COMPOSIO_SESSION_DIR = path.join(cacheDir, 'sessions');
    }
    const child = spawn(executable, args, { stdio: ['pipe', 'pipe', 'pipe'], cwd: cacheDir || os.tmpdir(), env });
    activeCommands.add(child);
    const abort = () => child.kill('SIGKILL');
    signal?.addEventListener('abort', abort, { once: true });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let oversized = false;
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, timeout);
    child.stdout.on('data', chunk => {
      stdout += chunk.toString();
      if (stdout.length > 4 * 1024 * 1024) { oversized = true; child.kill('SIGKILL'); }
    });
    child.stderr.on('data', chunk => { stderr = (stderr + chunk.toString()).slice(-4000); });
    child.once('error', error => {
      activeCommands.delete(child);
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      reject(new Error(error.code === 'ENOENT' ? 'The bundled Composio helper is missing. Reinstall Markdown Converter, then try again.' : error.message));
    });
    child.once('close', async code => {
      activeCommands.delete(child);
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      if (signal?.aborted) return reject(new Error('Sign-in canceled.'));
      if (timedOut) return reject(new Error('Composio timed out. If you were saving, check the destination before retrying; the save may have completed.'));
      if (oversized) return reject(new Error('Composio returned too much data. Narrow the search and try again.'));
      if (code !== 0) return reject(new Error(`Composio could not complete the request. ${stderr.trim() || 'Check your login and account connection, then try again.'}`));
      if (!json) return resolve(stdout.trim());
      try {
        const result = JSON.parse(stdout.trim());
        resolve(await readComposioResult(result, cacheDir));
      } catch (error) {
        reject(new Error(error instanceof SyntaxError ? 'Composio returned an unexpected response. Refresh connections and try again.' : error.message));
      }
    });
    child.stdin.on('error', () => {});
    child.stdin.end(input || '');
  });
}

function createConnections({ settingsPath, run = runComposio, executable, cacheDir, openExternal }) {
  const invoke = run;
  run = (args, options = {}) => invoke(args, { executable, cacheDir, ...options });
  let settings;
  let loginState = { phase: 'idle' };
  let loginController;
  let loginStarting;
  async function load() {
    if (settings) return;
    try { settings = JSON.parse(await fs.readFile(settingsPath, 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw new Error('Could not read connection preferences.'); settings = {}; }
  }
  function toolkit(provider) {
    if (!Object.hasOwn(TOOLKITS, provider)) throw new Error('Unknown account provider.');
    return TOOLKITS[provider];
  }
  async function accounts(provider) {
    const result = await run(['link', toolkit(provider), '--list']);
    return (result.items || []).filter(item => item.status === 'ACTIVE' && !item.is_disabled).map(item => ({
      id: item.id, label: item.alias || item.word_id || item.id,
    }));
  }
  async function status() {
    await load();
    const result = {};
    try { await run(['whoami']); } catch {
      return { signedIn: false, login: { ...loginState }, 'google-drive': { accounts: [], connected: false }, notion: { accounts: [], connected: false } };
    }
    result.signedIn = true;
    result.login = { ...loginState };
    await Promise.all(Object.keys(TOOLKITS).map(async provider => {
      try {
        const items = await accounts(provider);
        const saved = settings[provider] || {};
        const selected = items.find(item => item.id === saved.account) || (!saved.account && items.length === 1 ? items[0] : null);
        result[provider] = { accounts: items, account: selected?.id || '', connected: Boolean(selected), target: saved.target || '', targetLabel: saved.targetLabel || '' };
      } catch (error) { result[provider] = { accounts: [], connected: false, error: error.message }; }
    }));
    return result;
  }
  async function selectedAccount(provider) {
    await load();
    const items = await accounts(provider);
    const saved = settings[provider]?.account;
    const selected = items.find(item => item.id === saved) || (!saved && items.length === 1 ? items[0] : null);
    if (!selected) throw new Error(`Choose a connected ${provider === 'notion' ? 'Notion' : 'Google Drive'} account in Connections first.`);
    return selected.id;
  }
  async function execute(slug, data, account, extra = []) {
    const result = await run(['execute', slug, '--account', account, ...extra, '-d', '-'], { input: JSON.stringify(data), timeout: 120000 });
    return result.data ?? result;
  }
  async function validateTarget(provider, target, account) {
    if (provider === 'google-drive') {
      if (!target) return 'My Drive';
      const file = await execute('GOOGLEDRIVE_GET_FILE_METADATA', { fileId: target, fields: 'id,name,mimeType,trashed,capabilities(canAddChildren)' }, account);
      if (file.mimeType !== 'application/vnd.google-apps.folder' || file.trashed || file.capabilities?.canAddChildren === false) throw new Error('Choose a writable Google Drive folder.');
      return file.name;
    }
    const page = await execute('NOTION_RETRIEVE_PAGE', { page_id: target }, account);
    if (page.archived || page.in_trash) throw new Error('Choose a Notion page that is not in the trash.');
    const title = Object.values(page.properties || {}).find(property => property.type === 'title');
    return title?.title?.map(item => item.plain_text || item.text?.content || '').join('') || 'Selected Notion page';
  }
  async function configure(provider, account, value) {
    toolkit(provider);
    await load();
    const available = await accounts(provider);
    if (!available.some(item => item.id === account)) throw new Error('Select an active connected account.');
    const target = parseDestination(value, provider);
    const targetLabel = await validateTarget(provider, target, account);
    settings[provider] = { account, target, targetLabel };
    await fs.mkdir(path.dirname(settingsPath), { recursive: true });
    await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2), 'utf8');
    return { ok: true, targetLabel };
  }
  async function connect(provider) {
    toolkit(provider);
    const result = await run(['link', TOOLKITS[provider], '--no-wait']);
    const url = new URL(result.redirect_url);
    if (url.protocol !== 'https:' || !(url.hostname === 'composio.dev' || url.hostname.endsWith('.composio.dev'))) throw new Error('Composio returned an invalid authorization link.');
    await openExternal(url.toString());
    return { ok: true, pending: true };
  }
  async function save(provider, markdown, name) {
    toolkit(provider);
    const account = await selectedAccount(provider);
    const target = settings[provider]?.target || '';
    if (provider === 'notion' && !target) throw new Error('Choose a parent page for Notion in Connections first.');
    // The Drive upload tool can silently fall back to root for invalid folders, so validate before writing.
    await validateTarget(provider, target, account);
    if (provider === 'notion') {
      if (Buffer.byteLength(markdown) > 480000) throw new Error('This document is too large for a single Notion page request. Split it into smaller documents or save a Markdown file.');
      const page = await execute('NOTION_CREATE_NOTION_PAGE', { parent_id: target, title: name.replace(/\.md$/i, ''), markdown }, account);
      if (!page.id) throw new Error('Notion did not confirm a new page. Check Notion before retrying.');
      return { ok: true, destination: provider, url: page.url || `https://www.notion.so/${page.id.replace(/-/g, '')}` };
    }
    if (Buffer.byteLength(markdown) > 5 * 1024 * 1024) throw new Error('Composio’s Drive upload supports files up to 5 MB. Split the document or save it to a synced folder.');
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'markdown-upload-'));
    try {
      const filePath = path.join(directory, path.basename(name));
      await fs.writeFile(filePath, markdown, { mode: 0o600 });
      const file = await execute('GOOGLEDRIVE_UPLOAD_FILE', target ? { folder_to_upload_to: target } : {}, account, ['--file', filePath]);
      if (!file.id) throw new Error('Google Drive did not confirm the upload. Check Drive before retrying.');
      return { ok: true, destination: provider, url: file.webViewLink || `https://drive.google.com/file/d/${file.id}/view` };
    } finally { await fs.rm(directory, { recursive: true, force: true }); }
  }
  async function startLogin() {
    if (loginState.phase === 'pending') return reopenLogin();
    const controller = new AbortController();
    loginController = controller;
    loginState = { phase: 'starting' };
    try {
      // With piped stdio the CLI only prints instructions, even without
      // --no-browser. Explicitly open its URL, then complete the cached session.
      const output = await run(['login', '--no-wait', '--no-skill-install', '--yes'], { json: false, signal: controller.signal });
      if (controller.signal.aborted) throw new Error('Sign-in canceled.');
      const match = String(output).match(/https:\/\/[^\s<>"']+/);
      if (!match) {
        await run(['whoami']); // Already signed in: no login URL is emitted.
        loginState = { phase: 'complete' };
        return { ok: true, pending: false };
      }
      const url = new URL(match[0]);
      if (url.protocol !== 'https:' || url.username || url.password || !(url.hostname === 'composio.dev' || url.hostname.endsWith('.composio.dev'))) throw new Error('Composio returned an invalid sign-in link.');
      loginState = { phase: 'pending', url: url.toString() };
      void run(['login', '--poll', '--no-skill-install', '--yes'], { timeout: 610000, json: false, signal: controller.signal })
        .then(() => { if (loginController === controller && !controller.signal.aborted) loginState = { phase: 'complete' }; })
        .catch(error => { if (loginController === controller && !controller.signal.aborted) loginState = { phase: 'error', error: `Sign-in did not finish. ${error.message} Try signing in again.` }; });
      return reopenLogin();
    } catch (error) {
      if (loginController === controller && !controller.signal.aborted) loginState = { phase: 'error', error: error.message };
      throw error;
    }
  }
  function login() {
    if (!loginStarting) loginStarting = startLogin().finally(() => { loginStarting = null; });
    return loginStarting;
  }
  async function reopenLogin() {
    const url = loginState.url;
    if (!url) throw new Error('Start sign-in again to get a new browser link.');
    try {
      await openExternal(url);
      return { ok: true, pending: true, url, browserOpened: true };
    } catch {
      return { ok: true, pending: true, url, browserOpened: false, browserError: 'Could not open your browser. Copy the sign-in link and open it in your browser.' };
    }
  }
  function cancelLogin() {
    loginController?.abort();
    loginState = { phase: 'idle' };
    return { ok: true };
  }
  async function locations(provider, account, query = '', cursor) {
    toolkit(provider);
    if (!(await accounts(provider)).some(item => item.id === account)) throw new Error('Choose a connected account first.');
    if (provider === 'google-drive') {
      const term = query.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
      const result = await execute('GOOGLEDRIVE_FIND_FILE', {
        q: `trashed = false and mimeType = 'application/vnd.google-apps.folder'${term ? ` and name contains '${term}'` : ''}`,
        pageSize: 50, fields: 'nextPageToken,files(id,name)', ...(cursor ? { pageToken: cursor } : {}),
      }, account);
      return { ok: true, items: (result.files || []).map(file => ({ id: file.id, label: file.name })), cursor: result.nextPageToken || null };
    }
    const result = await execute('NOTION_SEARCH_NOTION_PAGE', { query, filter_value: 'page', page_size: 50, ...(cursor ? { start_cursor: cursor } : {}) }, account);
    return { ok: true, items: (result.results || []).filter(page => !page.archived && !page.in_trash).map(page => {
      const title = Object.values(page.properties || {}).find(property => property.type === 'title');
      return { id: page.id, label: title?.title?.map(item => item.plain_text || item.text?.content || '').join('') || 'Untitled page' };
    }), cursor: result.next_cursor || null };
  }
  return { status, configure, connect, save, login, reopenLogin, cancelLogin, locations };
}

module.exports = { readComposioResult, createConnections, parseDestination, runComposio, cancelActiveCommands: () => { for (const child of activeCommands) child.kill('SIGKILL'); } };
