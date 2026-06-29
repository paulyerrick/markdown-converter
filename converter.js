const fs = require("fs");
const path = require("path");
const mammoth = require("mammoth");
const pdfParse = require("pdf-parse");
const TurndownService = require("turndown");
const { net } = require("electron");

const td = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced" });

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    const request = net.request(url);
    let body = "";
    request.on("response", (response) => {
      response.on("data", (chunk) => { body += chunk.toString(); });
      response.on("end", () => resolve(body));
    });
    request.on("error", reject);
    request.end();
  });
}

async function convertUrl(url) {
  const html = await fetchUrl(url);
  // Strip script/style tags before converting
  const cleaned = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<nav[\s\S]*?<\/nav>/gi, "")
    .replace(/<footer[\s\S]*?<\/footer>/gi, "");
  return td.turndown(cleaned);
}

async function convert(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const buf = fs.readFileSync(filePath);

  switch (ext) {
    case ".pdf": {
      const data = await pdfParse(buf);
      return data.text.replace(/\n{3,}/g, "\n\n").trim();
    }
    case ".docx": {
      const result = await mammoth.convertToHtml({ buffer: buf });
      return td.turndown(result.value);
    }
    case ".html":
    case ".htm": {
      return td.turndown(buf.toString("utf-8"));
    }
    case ".txt":
    case ".md":
    case ".text":
    case ".csv":
    case ".json":
    case ".xml": {
      return buf.toString("utf-8");
    }
    default:
      throw new Error(`Unsupported file type: ${ext}`);
  }
}

module.exports = { convert, convertUrl };
