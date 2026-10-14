import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, Cloud, Copy, FolderOpen, HardDrive, LoaderCircle, NotebookPen, RefreshCw, Search, ShieldCheck, X } from 'lucide-react';
import Integrations, { type Integration } from '@/components/ui/integrations-02';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { errorMessage, type Connections, type Destination, type Provider, type ProviderConnection, type Account } from './api';

interface Props {
  open: boolean; onClose(): void; connections: Connections; folders: Destination[];
  refresh(): Promise<Connections>; refreshFolders(): Promise<void>;
}
export default function ConnectionsDialog({ open, onClose, connections, folders, refresh, refreshFolders }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState(false);
  const [working, setWorking] = useState('');
  const [expanded, setExpanded] = useState('');
  const [pendingProvider, setPendingProvider] = useState<Provider | null>(null);
  const [loginUrl, setLoginUrl] = useState('');
  const loginPending = connections.login?.phase === 'pending';
  const signedIn = connections.signedIn;
  function notify(text: string, failed = false) { setMessage(text); setError(failed); }
  useEffect(() => {
    if (open) {
      dialog.current?.showModal();
      void refresh().catch(e => notify(errorMessage(e), true));
    } else dialog.current?.close();
  }, [open, refresh]);
  useEffect(() => {
    if (connections.login?.phase === 'error') { setLoginUrl(''); notify(connections.login.error || 'Sign-in expired. Try again.', true); }
    if (signedIn) { setLoginUrl(''); if (!pendingProvider) notify('Signed in. Choose an integration below.'); }
    if (connections.login?.url) setLoginUrl(connections.login.url);
  }, [signedIn, connections.login?.phase, connections.login?.url, connections.login?.error, pendingProvider]);
  useEffect(() => {
    if (!open || (!loginPending && !pendingProvider)) return;
    let stopped = false, checking = false, remaining = 120;
    const timer = setInterval(async () => {
      if (checking || stopped) return;
      if (--remaining <= 0) { clearInterval(timer); setPendingProvider(null); notify('Authorization is still pending. Finish in your browser, then refresh.', true); return; }
      checking = true;
      try {
        const next = await refresh();
        if (!stopped && pendingProvider && next[pendingProvider].accounts.length) {
          setExpanded(pendingProvider); setPendingProvider(null); notify('Connected. Choose where to save below.');
        }
      } catch (e) { if (!stopped) notify(errorMessage(e), true); }
      finally { checking = false; }
    }, 3000);
    return () => { stopped = true; clearInterval(timer); };
  }, [open, loginPending, pendingProvider, refresh]);
  async function signIn(reopen = false) {
    if (working) return;
    setWorking('login'); notify('Opening your browser…');
    try {
      const result = await (reopen ? window.api.reopenComposioLogin() : window.api.loginComposio());
      if (!result.ok) throw new Error(result.error);
      setLoginUrl(result.url || '');
      await refresh();
      notify(result.pending ? result.browserError || 'Finish signing in in your browser. This screen will update automatically.' : 'Signed in. Choose an integration below.', result.browserOpened === false);
    } catch (e) { notify(errorMessage(e), true); }
    finally { setWorking(''); }
  }
  async function connect(id: string) {
    if (working) return;
    if (id !== 'google-drive' && id !== 'notion') {
      setWorking(id);
      try { const result = await window.api.chooseDestination(id); if (result.error) throw new Error(result.error); await refreshFolders(); if (!result.canceled) notify('Folder saved. Choose it from the editor’s save destinations.'); }
      catch (e) { notify(errorMessage(e), true); }
      finally { setWorking(''); }
      return;
    }
    if (connections[id].accounts.length) { setExpanded(expanded === id ? '' : id); return; }
    if (!signedIn) { await signIn(); return; }
    setWorking(id); notify('Opening account authorization…');
    try {
      const result = await window.api.connectAccount(id);
      if (!result.ok) throw new Error(result.error);
      setPendingProvider(id); notify('Finish connecting in your browser. Your account will appear here automatically.');
    } catch (e) { notify(errorMessage(e), true); }
    finally { setWorking(''); }
  }
  const items: Integration[] = [
    { id: 'google-drive', title: 'Google Drive', description: connections['google-drive'].targetLabel || 'Save a Markdown file to your Drive.', icon: HardDrive },
    { id: 'notion', title: 'Notion', description: connections.notion.targetLabel || 'Turn your Markdown into a new page.', icon: NotebookPen },
  ].map(item => {
    const id = item.id as Provider;
    return { ...item, status: pendingProvider === id ? 'pending' : connections[id].accounts.length ? 'connected' : undefined, disabled: Boolean(working) || pendingProvider === id, actionLabel: connections[id].accounts.length ? 'Manage' : 'Connect' };
  });
  for (const [id, title, description, icon] of [
    ['obsidian', 'Obsidian', 'Save straight to a vault on this Mac.', NotebookPen],
    ['icloud', 'iCloud Drive', 'Use a folder synced by iCloud.', Cloud],
    ['dropbox', 'Dropbox', 'Use a folder synced by Dropbox.', FolderOpen],
    ['custom', 'Any folder', 'Keep another favorite save location.', FolderOpen],
  ] as const) {
    const folder = folders.find(item => item.id === id)?.folder;
    items.push({ id, title, description: folder || description, icon, local: true, actionLabel: folder ? 'Change folder' : 'Choose folder', disabled: Boolean(working) });
  }
  return <dialog ref={dialog} id="connections-dialog" aria-labelledby="connections-title" onCancel={onClose} onClose={onClose}>
    <div className="flex items-center justify-between px-1 pb-4"><span className="eyebrow" id="connections-title">Your workspace, connected</span><Button id="btn-close-connections" variant="ghost" size="icon" aria-label="Close connections" onClick={onClose}><X /></Button></div>
    <Integrations title="A home for your Markdown." description="Connect your tools. Choose a destination. Save without the extra steps." integrations={items} expanded={expanded} onConnect={connect} renderDetails={id => <DestinationPicker provider={id as Provider} connection={connections[id as Provider]} notify={notify} refresh={refresh} />}>
      <div className="mt-5 rounded-xl border border-primary/15 bg-primary/5 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5"><ShieldCheck className="size-5 text-primary" /><div><h3 className="text-sm font-semibold">Your Composio account</h3><p className="mt-0.5 text-xs text-muted-foreground">One sign-in for Drive and Notion.</p></div></div>
          {signedIn ? <Badge className="bg-emerald-600/10 text-emerald-700">Signed in</Badge> : <Button id="btn-login-composio" size="sm" disabled={Boolean(working)} onClick={() => signIn(loginPending)}>{working === 'login' ? <><LoaderCircle className="animate-spin" />Opening…</> : loginPending ? <>Reopen browser <ArrowUpRight /></> : <>Sign in to Composio <ArrowUpRight /></>}</Button>}
        </div>
        {(loginPending || loginUrl) && !signedIn && <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-primary/10 pt-3">
          <span className="mr-auto flex items-center gap-2 text-xs text-muted-foreground"><LoaderCircle className="size-3.5 animate-spin" />Waiting for browser sign-in</span>
          <Button id="btn-copy-login" size="sm" variant="ghost" onClick={async () => { try { await navigator.clipboard.writeText(loginUrl); notify('Sign-in link copied. Paste it into your browser.'); } catch (e) { notify(errorMessage(e), true); } }}><Copy />Copy link</Button>
          <Button id="btn-cancel-login" size="sm" variant="ghost" onClick={async () => { try { await window.api.cancelComposioLogin(); setLoginUrl(''); await refresh(); notify('Sign-in canceled. You can still save to folders.'); } catch (e) { notify(errorMessage(e), true); } }}>Cancel</Button>
        </div>}
      </div>
      <div id="connection-status" role="status" aria-live="polite" className={`mt-3 text-xs leading-relaxed ${error ? 'text-destructive' : 'text-muted-foreground'}`}>{message || 'Sign in for cloud saves, or choose a local folder below.'}</div>
    </Integrations>
    <div className="flex items-start justify-between gap-4 px-1 pt-4"><p className="max-w-sm text-xs leading-relaxed text-muted-foreground">Accounts are yours. Nothing is uploaded until you choose Save. Folder destinations work without Composio.</p><Button id="btn-refresh-connections" variant="ghost" size="sm" disabled={Boolean(working)} onClick={async () => { setWorking('refresh'); try { await refresh(); notify('Connections refreshed.'); } catch(e) { notify(errorMessage(e), true); } finally { setWorking(''); } }}><RefreshCw />Refresh</Button></div>
  </dialog>;
}

function DestinationPicker({ provider, connection, notify, refresh }: { provider: Provider; connection: ProviderConnection; notify(text: string, error?: boolean): void; refresh(): Promise<Connections> }) {
  const [account, setAccount] = useState(connection.account || '');
  const [target, setTarget] = useState(connection.target || '');
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<Account[]>(connection.target ? [{ id: connection.target, label: connection.targetLabel || 'Saved destination' }] : []);
  const [cursor, setCursor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const request = useRef(0);
  useEffect(() => { setAccount(connection.account || ''); setTarget(connection.target || ''); setItems(connection.target ? [{ id: connection.target, label: connection.targetLabel || 'Saved destination' }] : []); setCursor(null); }, [connection.account, connection.target, connection.targetLabel]);
  useEffect(() => () => { request.current++; }, []);
  async function browse(more = false) {
    const token = ++request.current;
    setBusy(true); notify('Loading destinations…');
    try {
      const result = await window.api.listAccountLocations(provider, account, query, more ? cursor : null);
      if (token !== request.current) return;
      if (!result.ok) throw new Error(result.error);
      setItems(previous => { const all = more ? [...previous, ...result.items] : result.items; return Array.from(new Map(all.map(item => [item.id, item])).values()); });
      if (!more) setTarget('');
      setCursor(result.cursor);
      notify(result.items.length ? 'Choose a destination and save your preference below.' : 'No matches. Try another name or share the Notion page with your connection.');
    } catch(e) { if (token === request.current) notify(errorMessage(e), true); }
    finally { if (token === request.current) setBusy(false); }
  }
  async function configure() {
    setBusy(true); notify('Checking your destination…');
    try { const result = await window.api.configureAccount(provider, account, target); if (!result.ok) throw new Error(result.error); await refresh(); notify(`Destination saved: ${result.targetLabel}`); }
    catch (e) { notify(errorMessage(e), true); }
    finally { setBusy(false); }
  }
  return <div className="space-y-3">
    {connection.error && <p className="text-xs text-destructive">{connection.error}</p>}
    <div><label htmlFor={`${provider}-account`}>Connected account</label><select id={`${provider}-account`} value={account} disabled={busy} onChange={e => { request.current++; setAccount(e.target.value); setTarget(''); setItems([]); setCursor(null); }}><option value="">Choose an account</option>{connection.accounts.map(a => <option key={a.id} value={a.id}>{a.label}</option>)}</select></div>
    <div><label htmlFor={`${provider}-search`}>{provider === 'notion' ? 'Find a parent page' : 'Find a folder'}</label><div className="flex gap-2"><input id={`${provider}-search`} placeholder="Search by name" value={query} disabled={busy} onChange={e => { setQuery(e.target.value); setCursor(null); }} onKeyDown={e => { if (e.key === 'Enter' && account && !busy) void browse(); }} /><Button data-search={provider} variant="outline" disabled={!account || busy} onClick={() => browse()}><Search />Browse</Button></div></div>
    <div><label htmlFor={`${provider}-target`}>Save destination</label><select id={`${provider}-target`} value={target} disabled={busy || !account} onChange={e => setTarget(e.target.value)}><option value="">{provider === 'notion' ? 'Choose a parent page' : 'My Drive'}</option>{items.map(item => <option value={item.id} key={item.id}>{item.label}</option>)}</select></div>
    {cursor && <Button data-more={provider} variant="ghost" size="sm" disabled={busy} onClick={() => browse(true)}>More results</Button>}
    <p className="text-xs leading-relaxed text-muted-foreground">{provider === 'notion' ? 'Creates a new page inside this parent. Share the parent page with your Composio connection first.' : 'Uploads a new .md file. Existing files are kept.'}</p>
    <Button data-configure={provider} disabled={busy || !account || (provider === 'notion' && !target)} onClick={configure}>{busy && <LoaderCircle className="animate-spin" />}Use this {provider === 'notion' ? 'Notion' : 'Drive'} destination</Button>
  </div>;
}
