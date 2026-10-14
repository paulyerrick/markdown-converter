const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { startConversion } = require('../conversion-runner');
const { makeDocx } = require('./fixtures');

test('real workers convert Word, HTML, and plain text and report invalid inputs', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'converter-test-'));
  try {
    await makeDocx(path.join(dir, 'sample.docx'));
    await fs.writeFile(path.join(dir, 'sample.txt'), '# Already Markdown\n\nSome text.');
    await fs.writeFile(path.join(dir, 'broken.docx'), 'not a ZIP archive');
    assert.match((await startConversion('file', path.join(dir, 'sample.docx')).promise).markdown, /\*\*Word import test\*\*/);
    assert.equal((await startConversion('file', path.join(dir, 'sample.txt')).promise).markdown, '# Already Markdown\n\nSome text.');
    assert.equal((await startConversion('html', '<h1>Heading</h1><p>Hello <strong>world</strong>.</p><script>alert(1)</script>').promise).markdown, '# Heading\n\nHello **world**.');
    assert.match((await startConversion('file', path.join(dir, 'broken.docx')).promise).error, /Could not read this Word document/);
    assert.match((await startConversion('file', path.join(dir, 'old.doc')).promise).error, /save it as .docx/);
    assert.equal((await startConversion('file', path.join(dir, 'missing.pdf')).promise).ok, false);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test('conversion can be canceled and a hung conversion times out', async () => {
  const canceled = startConversion('html', '<p>test</p>');
  canceled.cancel();
  assert.deepEqual(await canceled.promise, { ok: false, canceled: true });
  const timedOut = await startConversion('html', '<p>test</p>', { timeoutMs: 1 }).promise;
  assert.equal(timedOut.ok, false);
  assert.match(timedOut.error, /took too long/);
  assert.equal((await startConversion('html', '<p>Next import</p>').promise).markdown, 'Next import');
});

test('PDF import extracts selectable text in the background worker', async () => {
  const result = await startConversion('file', path.join(__dirname, 'fixtures/sample.pdf')).promise;
  assert.equal(result.ok, true, result.error);
  assert.match(result.markdown, /PDF import test/);
});
