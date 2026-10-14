export type Provider = 'google-drive' | 'notion';
export interface Account { id: string; label: string }
export interface ProviderConnection { accounts: Account[]; connected: boolean; account?: string; target?: string; targetLabel?: string; error?: string }
export interface LoginState { phase: 'idle' | 'starting' | 'pending' | 'complete' | 'error'; url?: string; error?: string }
export interface Connections { signedIn: boolean; login?: LoginState; 'google-drive': ProviderConnection; notion: ProviderConnection }
export interface Destination { id: string; folder?: string }
export type Result<T = object> = T & { ok: boolean; error?: string; canceled?: boolean };
export type LoginResult = Result<{ pending?: boolean; url?: string; browserOpened?: boolean; browserError?: string }>;
export interface DesktopAPI {
  openFile(): Promise<Result<{ filePath: string }>>;
  convertFile(path: string): Promise<Result<{ markdown: string }>>;
  convertHtml(html: string): Promise<Result<{ markdown: string }>>;
  convertUrl(url: string): Promise<Result<{ markdown: string }>>;
  cancelConversion(): Promise<Result>;
  listDestinations(): Promise<Result<{ destinations: Destination[] }>>;
  chooseDestination(id: string): Promise<Result>;
  saveFile(content: string, name: string, destination: string): Promise<Result<{ filePath?: string; url?: string; destination?: string }>>;
  loginComposio(): Promise<LoginResult>;
  reopenComposioLogin(): Promise<LoginResult>;
  cancelComposioLogin(): Promise<Result>;
  connectionStatus(): Promise<Result<{ connections: Connections }>>;
  connectAccount(provider: Provider): Promise<Result>;
  configureAccount(provider: Provider, account: string, target: string): Promise<Result<{ targetLabel: string }>>;
  listAccountLocations(provider: Provider, account: string, query: string, cursor?: string | null): Promise<Result<{ items: Account[]; cursor: string | null }>>;
  openSavedLink(url: string): Promise<Result>;
  getFilePath(file: File): string;
}
declare global { interface Window { api: DesktopAPI } }
export const emptyConnections: Connections = { signedIn: false, 'google-drive': { accounts: [], connected: false }, notion: { accounts: [], connected: false } };
export function errorMessage(error: unknown) { return error instanceof Error ? error.message : 'Something went wrong. Please try again.'; }
