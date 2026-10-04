import { useCallback, useEffect, useRef, useState } from 'react';
import {
  fetchCampaignNames,
  fetchCampaignStats,
  fetchConversationsForAdmin,
  fetchDashboardStats,
} from '../services/admins';
import { ADMIN_PAGE_SIZE, POLL } from '../types/chat';
import type {
  AdminConversationSummary,
  CampaignStats,
  ConversationFilter,
  DashboardStats,
} from '../types/chat';
import { usePolling } from './usePolling';

/**
 * Admin inbox state: the conversation list (with search/filter/campaign),
 * dashboard metrics and the campaign breakdown.
 *
 * Polls every ~7s for the list and ~10s for metrics — light enough for a
 * small database, and each call is a single indexed query.
 */
export function useAdminInbox(enabled: boolean) {
  const [filter, setFilter] = useState<ConversationFilter>('all');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [campaign, setCampaign] = useState<string | null>(null);
  const [campaigns, setCampaigns] = useState<string[]>([]);

  const [conversations, setConversations] = useState<AdminConversationSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [campaignStats, setCampaignStats] = useState<CampaignStats | null>(null);

  const offsetRef = useRef(0);

  // Debounce the search box so typing does not spam the database.
  useEffect(() => {
    const id = setTimeout(() => setDebouncedSearch(search), 350);
    return () => clearTimeout(id);
  }, [search]);

  const load = useCallback(
    async (append: boolean) => {
      const offset = append ? offsetRef.current : 0;
      const page = await fetchConversationsForAdmin({
        filter,
        search: debouncedSearch,
        campaign,
        limit: ADMIN_PAGE_SIZE,
        offset,
      });

      if (page.error) {
        setError(page.error);
        return;
      }
      setError(null);
      setTotal(page.count);
      setConversations((current) => {
        const next = append ? [...current, ...page.rows] : page.rows;
        offsetRef.current = next.length;
        return next;
      });
    },
    [filter, debouncedSearch, campaign],
  );

  // Reset pagination whenever the query changes.
  useEffect(() => {
    if (!enabled) return;
    setLoading(true);
    offsetRef.current = 0;
    void load(false).finally(() => setLoading(false));
  }, [enabled, load]);

  const loadMore = useCallback(() => {
    void load(true);
  }, [load]);

  const loadStats = useCallback(async () => {
    const [nextStats, nextCampaigns] = await Promise.all([
      fetchDashboardStats(),
      fetchCampaignStats(),
    ]);
    if (nextStats) setStats(nextStats);
    if (nextCampaigns) setCampaignStats(nextCampaigns);
  }, []);

  // Campaign names populate the filter dropdown once.
  useEffect(() => {
    if (!enabled) return;
    void fetchCampaignNames().then(setCampaigns);
  }, [enabled]);

  usePolling(
    useCallback(async () => {
      // Inbox list only. Metrics have their own slower cadence below -- fetching
      // them here too meant two timers refreshed the same stats RPCs.
      await load(false);
    }, [load]),
    POLL.conversationList,
    enabled && !loading,
  );

  // Metrics poll on a slower cadence than the list so the dashboard stays cheap.
  usePolling(loadStats, POLL.stats, enabled);

  return {
    conversations,
    total,
    loading,
    error,
    stats,
    campaignStats,
    campaigns,
    filter,
    setFilter,
    search,
    setSearch,
    campaign,
    setCampaign,
    loadMore,
    hasMore: conversations.length < total,
    refresh: () => load(false),
  };
}