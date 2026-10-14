import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowDownToLine, ArrowRight, Check, Copy, FileText, FolderOpen, Link, LoaderCircle, Plug, RotateCcw, UploadCloud } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import ConnectionsDialog from './ConnectionsDialog';
import { emptyConnections, errorMessage, type Connections, type Destination, type Result } from './api';

export default function App() {
  const [markdown, setMarkdown] = useState('');
  const [hasDocument, setHasDocument] = useState(false);
  const [filename, setFilename] = useState('converted.md');
  const [destination, setDestination] = useState('local');
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [canCancel, setCanCancel] = useState(false);
  const [message, setMessage] = useState('Ready when you are. Paste content anywhere outside a text field.');
  const [failed, setFailed] = useState(false);
  const [folders, setFolders] = useState<Destination[]>([]);
  const [connections, setConnections] = useState<Connections>(emptyConnections);
  const [connectionsOpen, setConnectionsOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [savedUrl, setSavedUrl] = useState('');
  const connectionRequest = useRef<Promise<Connections> | null>(null);
  function status(text: string, error = false) { setMessage(text); setFailed(error); }
  function setWorking(value: boolean, cancel = false) { busyRef.current = value; setBusy(value); setCanCancel(value && cancel); }
  const refreshFolders = useCallback(async () => { const result = await window.api.listDestinations(); if (!result.ok) throw new Error(result.error); setFolders(result.destinations); }, []);
  const refreshConnections = useCallback(() => {
    if (!connectionRequest.current) connectionRequest.current = window.api.connectionStatus().then(result => {
      if (!result.ok) throw new Error(result.error);
      setConnections(result.connections); return result.connections;
    }).finally(() => { connectionRequest.current = null; });
    return connectionRequest.current;
  }, []);
  useEffect(() => { void refreshFolders().catch(e => status(errorMessage(e), true)); void refreshConnections().catch(() => {}); }, [refreshFolders, refreshConnections]);
  function showResult(content: string, name: string) { setMarkdown(content); setFilename(`${name}.md`); setHasDocument(true); setSavedUrl(''); }
  const convert = useCallback(async (action: () => Promise<Result<{ markdown: string }>>, name: string, message: string) => {
    if (busyRef.current) return;
    setWorking(true, true); status(message);
    try {
      const result = await action();
      if (result.ok) { showResult(result.markdown, name); status('Ready to review. Edit your Markdown, then choose where it belongs.'); }
      else if (result.canceled) status('Import canceled.');
      else status(result.error || 'Could not convert this content.', true);
    } catch (e) { status(errorMessage(e), true); }
    finally { setWorking(false); }
  }, []);
  const handleFile = useCallback((path: string) => {
    if (!path) { status('Could not read the dropped file. Try opening it from Finder.', true); return; }
    const name = path.replace(/\\/g, '/').split('/').pop()?.replace(/\.[^.]+$/, '') || 'converted';
    return convert(() => window.api.convertFile(path), name, 'Converting your document…');
  }, [convert]);
  useEffect(() => {
    function dragOver(e: DragEvent) { e.preventDefault(); }
    function drop(e: DragEvent) { e.preventDefault(); setDragging(false); if (busyRef.current || connectionsOpen) return; const file = e.dataTransfer?.files[0]; if (file) { try { void handleFile(window.api.getFilePath(file)); } catch (error) { status(errorMessage(error), true); } } }
    function paste(e: ClipboardEvent) {
      if ((e.target as Element)?.closest('input, textarea, [contenteditable="true"]') || connectionsOpen) return;
      const html = e.clipboardData?.getData('text/html'), plain = e.clipboardData?.getData('text/plain');
      if (!html && !plain) return;
      e.preventDefault(); if (busyRef.current) return;
      if (html) void convert(() => window.api.convertHtml(html), 'pasted-content', 'Converting pasted content…');
      else { showResult(plain || '', 'pasted-text'); status('Ready to review. Nothing has been saved yet.'); }
    }
    document.addEventListener('dragover', dragOver); document.addEventListener('drop', drop); document.addEventListener('paste', paste);
    return () => { document.removeEventListener('dragover', dragOver); document.removeEventListener('drop', drop); document.removeEventListener('paste', paste); };
  }, [connectionsOpen, convert, handleFile]);
  async function browseFile() {
    if (busyRef.current) return;
    setWorking(true);
    try { const result = await window.api.openFile(); setWorking(false); if (result.ok) await handleFile(result.filePath); else if (result.error) status(result.error, true); }
    catch (e) { status(errorMessage(e), true); }
    finally { setWorking(false); }
  }
  async function fetchUrl() {
    if (!url.trim() || busyRef.current) return;
    try { const parsed = new URL(url.trim()); if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error(); await convert(() => window.api.convertUrl(parsed.toString()), parsed.hostname.replace(/\./g, '-'), 'Fetching your web page…'); }
    catch { status('Enter a full URL starting with http:// or https://.', true); }
  }
  async function chooseFolder() {
    setWorking(true);
    try { const result = await window.api.chooseDestination(destination); if (result.error) throw new Error(result.error); await refreshFolders(); }
    catch(e) { status(errorMessage(e), true); }
    finally { setWorking(false); }
  }
  async function save() {
    if (busyRef.current || !hasDocument) return;
    const name = filename.trim();
    if (!name || /[\\/\x00-\x1f:]/.test(name) || /^\.+$/.test(name)) { status('Enter a file name without slashes or colons.', true); return; }
    const finalName = /\.md$/i.test(name) ? name : `${name}.md`;
    setFilename(finalName); setWorking(true); status(cloud ? 'Saving through Composio…' : 'Choose where to save your Markdown.');
    try {
      const result = await window.api.saveFile(markdown, finalName, destination);
      if (result.ok) { setSavedUrl(result.url || ''); status(result.filePath ? `Saved to ${result.filePath}` : result.destination === 'notion' ? 'Created a new Notion page.' : 'Uploaded to Google Drive.'); await refreshFolders(); }
      else if (result.canceled) status('Save canceled. Your Markdown is still here.');
      else status(result.error || 'Could not save. Your Markdown is still here.', true);
    } catch(e) { status(errorMessage(e), true); }
    finally { setWorking(false); }
  }
  const cloud = destination === 'google-drive' || destination === 'notion';
  const connection = cloud ? connections[destination] : undefined;
  const savedFolder = folders.find(item => item.id === destination)?.folder;
  const destinationHint = cloud
    ? connection?.connected && (destination === 'google-drive' || connection.target)
      ? `${destination === 'notion' ? 'Create a new page inside' : 'Upload a new Markdown file to'} ${connection.targetLabel || 'My Drive'}.`
      : 'Open Connections to choose your account and destination.'
    : destination === 'local' ? 'Choose any folder when you save.' : savedFolder ? `Save in: ${savedFolder}` : 'Choose a folder once. We’ll remember it for next time.';
  const saveLabel = destination === 'notion' ? 'Create Notion page' : destination === 'google-drive' ? 'Upload to Drive' : 'Save Markdown';
  return <>
    <div className="titlebar"><span>Markdown Converter</span></div>
    <main className="app-shell">
      <header className="app-header">
        <div className="flex items-center gap-3"><div className="brand-mark"><FileText className="size-5" /></div><div><div className="eyebrow">A little less formatting</div><h1>Make it Markdown<span className="text-primary">.</span></h1></div></div>
        <Button id="btn-connections" variant="outline" disabled={busy} onClick={() => setConnectionsOpen(true)}><Plug />Connections{connections.signedIn && <span className="size-1.5 rounded-full bg-emerald-500" />}</Button>
      </header>
      <div className="workspace">
        <section className="import-section" aria-label="Import a document">
          <div className="section-label"><span className="step">01</span>Bring something in<span className="ml-auto text-xs font-normal normal-case tracking-normal text-muted-foreground">Paste with <kbd>⌘ V</kbd></span></div>
          <div className="import-row">
            <button id="drop-zone" disabled={busy} className={dragging ? 'drag-over' : ''} onClick={browseFile} onDragOver={() => setDragging(true)} onDragLeave={() => setDragging(false)}>
              <div className="upload-icon"><UploadCloud className="size-5" /></div><div className="text-left"><span className="block text-sm font-semibold">Drop a document, or <span className="text-primary">browse</span></span><span className="mt-1 block text-xs text-muted-foreground">Word, PDF, HTML & text · up to 50 MB</span></div>
            </button>
            <div className="url-bar"><label htmlFor="url-input">Or bring in a web page</label><div className="flex gap-2"><div className="url-input-wrap"><Link className="size-4 text-muted-foreground" /><input id="url-input" type="url" placeholder="Paste a website URL" value={url} disabled={busy} onChange={e => setUrl(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') void fetchUrl(); }} /></div><Button id="btn-fetch" variant="secondary" disabled={busy || !url.trim()} onClick={fetchUrl}>Fetch <ArrowRight /></Button></div></div>
          </div>
        </section>
        <section className="preview" aria-label="Markdown preview" aria-busy={busy}>
          <div className="preview-heading"><div className="section-label"><span className="step">02</span><label htmlFor="output">Review & make it yours</label></div><span id="document-info">{hasDocument ? `${markdown.length.toLocaleString()} characters · editable` : 'Your next clean document'}</span></div>
          {!hasDocument && <div id="empty-state"><div className="empty-paper"><FileText className="size-9" /><Badge variant="secondary" className="empty-md">.md</Badge></div><h2>Good ideas. Clean Markdown.</h2><p>Drop a file, paste some text, or fetch a page.<br />Your editable document will appear right here.</p><div className="empty-note"><Check className="size-3.5" />Always review before you save</div></div>}
          <textarea id="output" aria-label="Edit converted Markdown" spellCheck={false} hidden={!hasDocument} value={markdown} readOnly={busy} onChange={e => { setMarkdown(e.target.value); setSavedUrl(''); }} />
        </section>
        <div className="status-row"><div id="status" role="status" aria-live="polite" className={failed ? 'error' : ''}>{busy && <LoaderCircle className="size-3.5 shrink-0 animate-spin" />}{message}</div>{canCancel && <Button id="btn-cancel" variant="ghost" size="sm" onClick={async () => { setCanCancel(false); try { await window.api.cancelConversion(); } catch(e) { status(errorMessage(e), true); } }}>Cancel import</Button>}</div>
        {hasDocument && <section id="save-panel" aria-label="Save options">
          <div className="save-settings"><div className="filename-field"><label htmlFor="filename">File name</label><input id="filename" value={filename} disabled={busy} onChange={e => setFilename(e.target.value)} /></div><div className="destination-field"><label htmlFor="destination">Send it somewhere</label><select id="destination" value={destination} disabled={busy} onChange={e => setDestination(e.target.value)}><option value="local">Choose any folder</option><option value="google-drive">Google Drive</option><option value="notion">Notion</option><option value="obsidian">Obsidian vault</option><option value="icloud">iCloud Drive</option><option value="dropbox">Dropbox</option><option value="custom">Other saved folder</option></select></div>{!cloud && destination !== 'local' && <Button id="btn-folder" variant="outline" disabled={busy} onClick={chooseFolder}><FolderOpen />{savedFolder ? 'Change folder' : 'Choose folder'}</Button>}</div>
          <p id="destination-hint">{destinationHint}</p>
          <div id="actions"><Button id="btn-clear" variant="ghost" disabled={busy} onClick={() => { setHasDocument(false); setMarkdown(''); setUrl(''); setSavedUrl(''); status('Ready for your next document.'); }}><RotateCcw />Start over</Button><div className="action-right">{savedUrl && <Button id="btn-open-saved" variant="ghost" onClick={async () => { try { const result = await window.api.openSavedLink(savedUrl); if (!result.ok) throw new Error(result.error); } catch(e) { status(errorMessage(e), true); } }}>Open saved document</Button>}<Button id="btn-copy" variant="outline" disabled={busy} onClick={async () => { try { await navigator.clipboard.writeText(markdown); status('Copied the current Markdown to the clipboard.'); } catch(e) { status(errorMessage(e), true); } }}><Copy />Copy Markdown</Button><Button id="btn-save" disabled={busy} onClick={save}><ArrowDownToLine />{saveLabel}</Button></div></div>
        </section>}
      </div>
      <footer className="app-footer"><span className="flex items-center gap-1.5"><span className="size-1.5 rounded-full bg-emerald-500" />Made for your workflow</span><span>Import. Refine. Save.</span></footer>
    </main>
    <ConnectionsDialog open={connectionsOpen} onClose={() => setConnectionsOpen(false)} connections={connections} folders={folders} refresh={refreshConnections} refreshFolders={refreshFolders} />
  </>;
}
