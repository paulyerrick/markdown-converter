const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const os = require('node:os');

const RELEASE = '@composio/cli@0.3.1';
const bundles = {
  arm64: { asset: 'composio-darwin-aarch64', sha256: '66a5d66416d4049fc1f87789bcdb7d39d5bb0bffbee1da54d14eb1e32c94908f' },
  x64: { asset: 'composio-darwin-x64', sha256: 'd02d645bfc5be277119bde5ad0528c3c52479eb0c182a0e3488512b8589dc316' },
};

async function prepare(arch) {
  const bundle = bundles[arch];
  if (!bundle) throw new Error(`Unsupported macOS architecture: ${arch}`);
  const destination = path.resolve(__dirname, '..', 'vendor', `composio-darwin-${arch}`);
  try {
    const version = execFileSync(path.join(destination, 'composio'), ['--version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    if (version === '0.3.1') return;
  } catch { /* Download a verified complete bundle. */ }
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'markdown-composio-'));
  try {
    const archive = path.join(temporary, 'bundle.zip');
    const tag = encodeURIComponent(RELEASE);
    execFileSync('curl', ['-fLsS', '--retry', '2', '--max-time', '300', '-o', archive, `https://github.com/ComposioHQ/composio/releases/download/${tag}/${bundle.asset}.zip`], { stdio: 'inherit' });
    const digest = crypto.createHash('sha256').update(await fs.readFile(archive)).digest('hex');
    if (digest !== bundle.sha256) throw new Error('Composio release checksum did not match.');
    execFileSync('unzip', ['-q', archive, '-d', temporary]);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.cp(path.join(temporary, bundle.asset), destination, { recursive: true });
  } finally { await fs.rm(temporary, { recursive: true, force: true }); }
}
if (require.main === module) prepare(process.argv[2] || process.arch).catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = async context => prepare(context.arch === 3 ? 'arm64' : context.arch === 1 ? 'x64' : 'unsupported');
