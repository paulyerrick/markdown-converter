const fs = require('node:fs/promises');
const path = require('node:path');
const mammoth = require('mammoth');
const pdfParse = require('pdf-parse/lib/pdf-parse');
const TurndownService = require('turndown');

const MAX_INPUT_BYTES = 50 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 10 * 1024 * 1024;
const td = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' });

function checkOutput(markdown) {
  if (Buffer.byteLength(markdown, 'utf8') > MAX_OUTPUT_BYTES) {
    throw new Error('The converted document is too large to preview. Try splitting it into smaller documents.');
  }
  return markdown;
}

function convertHtml(html) {
  if (Buffer.byteLength(html, 'utf8') > MAX_INPUT_BYTES) throw new Error('Content exceeds the 50 MB import limit.');
  return checkOutput(td.turndown(html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '')));
}

async function convertUrl(url) {
  if (!/^https?:\/\//i.test(url)) throw new Error('Enter an http:// or https:// URL.');
  const response = await fetch(url, { signal: AbortSignal.timeout(25000) });
  if (!response.ok) throw new Error(`The website returned HTTP ${response.status}.`);
  const type = response.headers.get('content-type') || '';
  if (type && !/text\/|application\/xhtml\+xml/i.test(type)) throw new Error('This URL is not a web page. Download the document and import the file instead.');
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > MAX_INPUT_BYTES) {
      throw new Error('This web page exceeds the 50 MB import limit.');
    }
    chunks.push(Buffer.from(chunk));
  }
  return convertHtml(Buffer.concat(chunks).toString('utf8').replace(/<nav[\s\S]*?<\/nav>/gi, '').replace(/<footer[\s\S]*?<\/footer>/gi, ''));
}

async function convert(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.doc') throw new Error('Older .doc files are not supported. Open the file in Word and save it as .docx, then try again.');
  if (!['.pdf', '.docx', '.html', '.htm', '.txt', '.md', '.markdown', '.text', '.csv', '.json', '.xml'].includes(ext)) {
    throw new Error(`Unsupported file type: ${ext || '(no extension)'}. Try DOCX, PDF, HTML, or plain text.`);
  }
  const stat = await fs.stat(filePath);
  if (!stat.isFile()) throw new Error('Choose a document, not a folder.');
  if (stat.size > MAX_INPUT_BYTES) throw new Error('This file exceeds the 50 MB import limit. Try a smaller document.');
  const buf = await fs.readFile(filePath);
  let markdown;
  switch (ext) {
    case '.pdf': {
      const data = await pdfParse(buf);
      markdown = data.text.replace(/\n{3,}/g, '\n\n').trim();
      if (!markdown) throw new Error('This PDF has no extractable text. Scanned PDFs need OCR before importing.');
      break;
    }
    case '.docx': {
      try {
        const result = await mammoth.convertToHtml({ buffer: buf });
        markdown = convertHtml(result.value);
      } catch (error) {
        throw new Error(`Could not read this Word document. Try opening it in Word and saving a new .docx copy. ${error.message}`);
      }
      break;
    }
    case '.html':
    case '.htm':
      markdown = convertHtml(buf.toString('utf8'));
      break;
    default:
      markdown = buf.toString('utf8');
  }
  return checkOutput(markdown);
}

module.exports = { convert, convertHtml, convertUrl };
