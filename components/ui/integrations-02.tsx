import type { ReactNode } from 'react';
import { ArrowUpRight, Check, ChevronDown, LoaderCircle, Plug, type LucideIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export interface Integration {
  id: string;
  title: string;
  description: string;
  icon?: LucideIcon;
  status?: 'connected' | 'pending';
  actionLabel?: string;
  disabled?: boolean;
  local?: boolean;
}
interface Props {
  integrations?: Integration[];
  title?: string;
  description?: string;
  expanded?: string;
  onConnect?: (id: string) => void;
  renderDetails?: (id: string) => ReactNode;
  children?: ReactNode;
}

// The supplied 21st.dev card layout, with data/actions supplied by the desktop
// app. Icons are bundled locally so the screen also works without a network.
export default function Integrations({ integrations = examples, title = 'Our Integrations', description = 'Connect your favorite tools and services to your account and start using them in your app.', expanded, onConnect, renderDetails, children }: Props) {
  return (
    <div className="mx-auto flex w-full flex-col rounded-2xl border bg-muted p-1 shadow-lg/2">
      <div className="rounded-xl border bg-card p-5 sm:p-6">
        <h2 className="text-2xl font-medium tracking-tight">{title}</h2>
        <p className="mt-1.5 text-pretty text-sm leading-relaxed text-muted-foreground">{description}</p>
        {children}
        <div className="mx-auto mt-6 flex w-full flex-col gap-3">
          {integrations.map(integration => {
            const Icon = integration.icon || Plug;
            return <div className="overflow-hidden rounded-xl border bg-card" key={integration.id}>
              <div className="flex items-center gap-3 p-3.5">
                <div className={cn('flex size-10 shrink-0 items-center justify-center rounded-xl border', integration.local ? 'bg-muted text-muted-foreground' : 'bg-primary/8 text-primary')}><Icon className="size-5" aria-hidden="true" /></div>
                <div className="min-w-0 flex-1"><h3 className="text-sm font-semibold">{integration.title}</h3><p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{integration.description}</p></div>
                <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
                  {integration.status === 'connected' && <Badge className="connection-badge h-7 gap-1 rounded-lg bg-emerald-600/10 px-2 text-emerald-700 hover:bg-emerald-600/10"><Check className="size-3" />Connected</Badge>}
                  <Button className="h-8" size="sm" variant="outline" disabled={integration.disabled} data-connect={integration.id} aria-expanded={renderDetails && integration.status === 'connected' ? expanded === integration.id : undefined} onClick={() => onConnect?.(integration.id)}>
                    {integration.status === 'pending' ? <><LoaderCircle className="animate-spin" />Connecting</> : <>{integration.actionLabel || (integration.status === 'connected' ? 'Manage' : 'Connect')}{integration.status === 'connected' || integration.local ? <ChevronDown /> : <ArrowUpRight />}</>}
                  </Button>
                </div>
              </div>
              {expanded === integration.id && <div className="border-t bg-muted/40 p-4">{renderDetails?.(integration.id)}</div>}
            </div>;
          })}
        </div>
      </div>
    </div>
  );
}
const examples: Integration[] = [
  { id: 'posthog', title: 'PostHog', description: 'Open-source product analytics.', status: 'connected' },
  { id: 'mailchimp', title: 'Mailchimp', description: 'Email marketing and automation.' },
  { id: 'webflow', title: 'Webflow', description: 'Build and manage websites.', status: 'pending' },
  { id: 'stripe', title: 'Stripe', description: 'Online payments.' },
  { id: 'sanity', title: 'Sanity', description: 'Content management.', status: 'pending' },
  { id: 'zapier', title: 'Zapier', description: 'Connect and automate your tools.' },
];
