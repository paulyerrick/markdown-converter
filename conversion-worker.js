const { parentPort, workerData } = require('node:worker_threads');
const { convert, convertHtml, convertUrl } = require('./converter');

(async () => {
  try {
    const converters = { file: convert, html: convertHtml, url: convertUrl };
    const markdown = await converters[workerData.kind](workerData.input);
    parentPort.postMessage({ ok: true, markdown });
  } catch (error) {
    parentPort.postMessage({ ok: false, error: error.message });
  }
})();
