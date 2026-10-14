const path = require('node:path');
const { Worker } = require('node:worker_threads');

// Each import gets its own worker so cancellation also stops CPU-bound parsers.
function startConversion(kind, input, { timeoutMs = 30000 } = {}) {
  let worker;
  let finish;
  const promise = new Promise(resolve => {
    let settled = false;
    let timer;
    finish = result => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (worker) void worker.terminate();
      resolve(result);
    };
    try {
      worker = new Worker(path.join(__dirname, 'conversion-worker.js'), {
        workerData: { kind, input },
        resourceLimits: { maxOldGenerationSizeMb: 512 },
      });
      worker.once('message', finish);
      worker.once('error', error => finish({ ok: false, error: `Conversion failed: ${error.message}` }));
      worker.once('exit', () => finish({ ok: false, error: 'The document parser stopped unexpectedly. Try a smaller document or save a new copy.' }));
      timer = setTimeout(() => finish({ ok: false, error: 'Conversion took too long and was stopped. Try a smaller document or save a new copy.' }), timeoutMs);
    } catch (error) {
      finish({ ok: false, error: error.message });
    }
  });
  return { promise, cancel: () => finish({ ok: false, canceled: true }) };
}

module.exports = { startConversion };
