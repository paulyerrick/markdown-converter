const dropZone = document.getElementById("drop-zone");
const output = document.getElementById("output");
const actions = document.getElementById("actions");
const status = document.getElementById("status");
const fileInput = document.getElementById("file-input");

let currentMarkdown = "";
let currentSourceName = "converted";

function showStatus(msg, isError) {
  status.textContent = msg;
  status.className = isError ? "error" : "success";
  if (!isError) setTimeout(() => (status.textContent = ""), 8000);
}

function showResult(md) {
  currentMarkdown = md;
  output.value = md;
  output.style.display = "block";
  actions.style.display = "flex";
}

function baseName(filePath) {
  const parts = filePath.replace(/\\/g, "/").split("/");
  const name = parts[parts.length - 1];
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.substring(0, dot) : name;
}

async function handleFile(filePath) {
  showStatus("Converting...", false);
  const result = await window.api.convertFile(filePath);
  if (!result.ok) {
    showStatus(result.error, true);
    return;
  }
  currentSourceName = baseName(filePath);
  showResult(result.markdown);

  // Prompt where to save
  const saveResult = await window.api.saveFile(result.markdown, `${currentSourceName}.md`);
  if (saveResult.ok) {
    showStatus(`Saved to ${saveResult.filePath}`, false);
  } else {
    showStatus("Converted (not saved yet)", false);
  }
}

// Drag and drop
dropZone.addEventListener("dragover", (e) => {
  e.preventDefault();
  dropZone.classList.add("drag-over");
});

dropZone.addEventListener("dragleave", () => {
  dropZone.classList.remove("drag-over");
});

dropZone.addEventListener("drop", (e) => {
  e.preventDefault();
  dropZone.classList.remove("drag-over");
  const file = e.dataTransfer.files[0];
  if (file) handleFile(window.api.getFilePath(file));
});

// Browse button
document.getElementById("btn-browse").addEventListener("click", async () => {
  const result = await window.api.openFile();
  if (result.ok) handleFile(result.filePath);
});

// Click drop zone also opens finder
dropZone.addEventListener("click", async () => {
  const result = await window.api.openFile();
  if (result.ok) handleFile(result.filePath);
});

// Paste (rich text or plain)
document.addEventListener("paste", async (e) => {
  const html = e.clipboardData.getData("text/html");
  const plain = e.clipboardData.getData("text/plain");

  if (html) {
    showStatus("Converting pasted content...", false);
    const result = await window.api.convertHtml(html);
    if (result.ok) {
      currentSourceName = "pasted-content";
      showResult(result.markdown);
      showStatus("Done", false);
    } else {
      showStatus(result.error, true);
    }
  } else if (plain) {
    currentSourceName = "pasted-text";
    showResult(plain);
    showStatus("Pasted as plain text", false);
  }
});

// URL fetch
const urlInput = document.getElementById("url-input");
const btnFetch = document.getElementById("btn-fetch");

async function handleUrl() {
  const url = urlInput.value.trim();
  if (!url) return;
  if (!/^https?:\/\//i.test(url)) {
    showStatus("Enter a full URL starting with http:// or https://", true);
    return;
  }
  showStatus("Fetching page...", false);
  const result = await window.api.convertUrl(url);
  if (result.ok) {
    try {
      currentSourceName = new URL(url).hostname.replace(/\./g, "-");
    } catch {
      currentSourceName = "webpage";
    }
    showResult(result.markdown);
    showStatus("Done", false);
  } else {
    showStatus(result.error, true);
  }
}

btnFetch.addEventListener("click", handleUrl);
urlInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") handleUrl();
});

// Actions
document.getElementById("btn-copy").addEventListener("click", async () => {
  await navigator.clipboard.writeText(currentMarkdown);
  showStatus("Copied to clipboard", false);
});

document.getElementById("btn-save").addEventListener("click", async () => {
  const result = await window.api.saveFile(currentMarkdown, `${currentSourceName}.md`);
  if (result.ok) showStatus(`Saved to ${result.filePath}`, false);
});

document.getElementById("btn-clear").addEventListener("click", () => {
  currentMarkdown = "";
  currentSourceName = "converted";
  output.value = "";
  output.style.display = "none";
  actions.style.display = "none";
  status.textContent = "";
});
