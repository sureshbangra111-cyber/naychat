import { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  CalendarDays,
  CheckCircle2,
  Inbox,
  Loader2,
  MessagesSquare,
  Search,
} from 'lucide-react';
import { Button } from '../components/ui/Button';
import { EmptyState, ErrorBanner } from '../components/ui/Badge';
import { BarList, StatCard } from '../components/admin/StatCards';
import {
  ConversationList,
  ConversationListSkeleton,
} from '../components/admin/ConversationList';
import { useAdminInbox } from '../hooks/useAdminInbox';
import { cn } from '../lib/utils';
import type { ConversationFilter } from '../types/chat';

const filters: Array<{ id: ConversationFilter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'unread', label: 'Unread' },
  { id: 'open', label: 'Open' },
  { id: 'waiting', label: 'Waiting' },
  { id: 'closed', label: 'Closed' },
  { id: 'today', label: 'Today' },
];

export function AdminDashboardPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const inbox = useAdminInbox(true);

  // Sidebar links drive the filter through the URL (?filter=open).
  const urlFilter = searchParams.get('filter') as ConversationFilter | null;
  const { setFilter } = inbox;
  useEffect(() => {
    if (urlFilter && filters.some((f) => f.id === urlFilter)) {
      setFilter(urlFilter);
    }
  }, [urlFilter, setFilter]);

  const stats = inbox.stats;

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-6 lg:px-8">
      <header className="mb-6">
        <h1 className="text-xl font-semibold text-slate-900">Dashboard</h1>
        <p className="mt-0.5 text-sm text-slate-500">
          Live overview of customer conversations. Updates automatically.
        </p>
      </header>

      <section className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-5">
        <StatCard
          label="Total"
          value={stats?.total ?? '—'}
          icon={<Inbox className="h-4 w-4" aria-hidden="true" />}
          tone="brand"
          hint="All time"
        />
        <StatCard
          label="Open"
          value={stats?.open ?? '—'}
          icon={<MessagesSquare className="h-4 w-4" aria-hidden="true" />}
          tone="success"
        />
        <StatCard
          label="Waiting"
          value={stats?.waiting ?? '—'}
          icon={<Loader2 className="h-4 w-4" aria-hidden="true" />}
          tone="warning"
        />
        <StatCard
          label="Closed"
          value={stats?.closed ?? '—'}
          icon={<CheckCircle2 className="h-4 w-4" aria-hidden="true" />}
        />
        <StatCard
          label="Today"
          value={stats?.today ?? '—'}
          icon={<CalendarDays className="h-4 w-4" aria-hidden="true" />}
          hint="New conversations"
        />
      </section>

      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-200 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-sm font-semibold text-slate-900">Conversations</h2>
                <div className="relative w-full sm:w-64">
                  <Search
                    className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
                    aria-hidden="true"
                  />
                  <label htmlFor="admin-search" className="sr-only">
                    Search conversations
                  </label>
                  <input
                    id="admin-search"
                    type="search"
                    value={inbox.search}
                    onChange={(event) => inbox.setSearch(event.target.value)}
                    placeholder="Search name, phone, ID, message…"
                    className="w-full rounded-lg border border-slate-200 py-2 pl-9 pr-3 text-sm placeholder:text-slate-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100"
                  />
                </div>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <div className="flex flex-wrap gap-1">
                  {filters.map((filter) => (
                    <button
                      key={filter.id}
                      type="button"
                      aria-pressed={inbox.filter === filter.id}
                      onClick={() => {
                        inbox.setFilter(filter.id);
                        setSearchParams({});
                      }}
                      className={cn(
                        'rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
                        inbox.filter === filter.id
                          ? 'bg-slate-900 text-white'
                          : 'bg-slate-100 text-slate-600 hover:bg-slate-200',
                      )}
                    >
                      {filter.label}
                    </button>
                  ))}
                </div>

                <label htmlFor="campaign-filter" className="sr-only">
                  Filter by campaign
                </label>
                <select
                  id="campaign-filter"
                  value={inbox.campaign ?? ''}
                  onChange={(event) => inbox.setCampaign(event.target.value || null)}
                  className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100"
                >
                  <option value="">All campaigns</option>
                  {inbox.campaigns.map((campaign) => (
                    <option key={campaign} value={campaign}>
                      {campaign}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {inbox.error ? (
              <div className="p-4">
                <ErrorBanner message={inbox.error} onRetry={() => inbox.refresh()} />
              </div>
            ) : inbox.loading ? (
              <ConversationListSkeleton />
            ) : inbox.conversations.length === 0 ? (
              <EmptyState
                icon={<Inbox className="h-5 w-5" aria-hidden="true" />}
                title="No conversations found"
                description={
                  inbox.search || inbox.filter !== 'all'
                    ? 'Try a different search or filter.'
                    : 'New customer chats will appear here automatically.'
                }
              />
            ) : (
              <>
                <div className="max-h-[640px] overflow-y-auto scroll-slim">
                  <ConversationList conversations={inbox.conversations} />
                </div>
                {inbox.hasMore ? (
                  <div className="border-t border-slate-200 p-3 text-center">
                    <Button variant="secondary" size="sm" onClick={inbox.loadMore}>
                      Load more ({inbox.conversations.length} of {inbox.total})
                    </Button>
                  </div>
                ) : null}
              </>
            )}
          </div>
        </div>

        <div className="space-y-4">
          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-sm font-semibold text-slate-900">By campaign</h2>
            <div className="mt-3">
              <BarList
                items={(inbox.campaignStats?.by_campaign ?? []).map((row) => ({
                  label: row.campaign,
                  count: row.count,
                }))}
              />
            </div>
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-sm font-semibold text-slate-900">By source</h2>
            <div className="mt-3">
              <BarList
                items={(inbox.campaignStats?.by_source ?? []).map((row) => ({
                  label: row.source,
                  count: row.count,
                }))}
              />
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}