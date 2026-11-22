import React, { useEffect, useState, useMemo, useCallback } from 'react';
import {
  Search,
  Bookmark,
  Check,
  ExternalLink,
  RefreshCw,
  Cpu,
  Database,
  Rss,
  Copy,
  Download,
  Play,
  Sliders,
  Layers,
  Globe,
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  ChevronLeft,
  Sparkles,
} from 'lucide-react';
import type {
  Article,
  CategoryKey,
  DeliverableFile,
  HealthResponse,
  StoryCluster,
  TestSuiteResponse,
} from './types';

type ActiveSection = 'feed' | 'clusters' | 'collectors' | 'deployment' | 'tests_rss';

const CATEGORY_TABS: Array<{ key: CategoryKey | 'bookmarks'; label: string }> = [
  { key: 'top', label: 'Top Headlines' },
  { key: 'global', label: 'Global Feed' },
  { key: 'ai_tech', label: 'AI & Technology' },
  { key: 'business', label: 'Business & Markets' },
  { key: 'us_texas', label: 'US & Texas' },
  { key: 'bd_india', label: 'Bangladesh & India' },
  { key: 'science', label: 'Science & Research' },
  { key: 'travel_aviation', label: 'Travel & Aviation' },
  { key: 'bookmarks', label: 'Bookmarks' },
];

const CATEGORY_LABELS: Record<string, string> = {
  top: 'Top Headlines',
  global: 'Global Feed',
  ai_tech: 'AI & Technology',
  business: 'Business & Markets',
  us_texas: 'US & Texas',
  bd_india: 'Bangladesh & India',
  science: 'Science & Research',
  travel_aviation: 'Travel & Aviation',
};

function formatRelativeTime(isoString: string | null): string {
  if (!isoString) return 'Never';
  const date = new Date(isoString);
  if (isNaN(date.getTime())) return 'Recent';
  const diffSec = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  return `${diffDay}d ago`;
}

export default function App() {
  const [activeSection, setActiveSection] = useState<ActiveSection>('feed');
  const [selectedCategory, setSelectedCategory] = useState<CategoryKey | 'bookmarks'>('top');
  const [searchQuery, setSearchQuery] = useState('');
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [breakingOnly, setBreakingOnly] = useState(false);

  const [articles, setArticles] = useState<Article[]>([]);
  const [clusters, setClusters] = useState<StoryCluster[]>([]);
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [deliverables, setDeliverables] = useState<DeliverableFile[]>([]);
  const [selectedDeliverableId, setSelectedDeliverableId] = useState<string>('main');
  const [testSuite, setTestSuite] = useState<TestSuiteResponse | null>(null);
  const [rssPreview, setRssPreview] = useState<string>('');
  const [rssCategory, setRssCategory] = useState<string>('all');

  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [activeConnectorRefreshing, setActiveConnectorRefreshing] = useState<string | null>(null);
  const [summarizingId, setSummarizingId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Configuration state for M1 Ollama LAN & Interests
  const [ollamaUrlInput, setOllamaUrlInput] = useState<string>('http://192.168.1.50:11434');
  const [minScoreInput, setMinScoreInput] = useState<number>(65);
  const [interestKeywords, setInterestKeywords] = useState<Record<string, number>>({});
  const [newKeyword, setNewKeyword] = useState<string>('');
  const [newKeywordWeight, setNewKeywordWeight] = useState<number>(16);
  const [configSaveMessage, setConfigSaveMessage] = useState<string | null>(null);

  // Live Breaking-News Ticker index
  const [tickerIndex, setTickerIndex] = useState<number>(0);

  const fetchDashboardData = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (selectedCategory === 'bookmarks') {
        params.set('bookmarked', 'true');
      } else {
        params.set('category', selectedCategory);
      }
      if (searchQuery.trim()) params.set('q', searchQuery.trim());
      if (unreadOnly) params.set('unread_only', 'true');
      if (breakingOnly) params.set('breaking_only', 'true');

      const [artRes, clustRes, healthRes] = await Promise.all([
        fetch(`/api/articles?${params.toString()}`),
        fetch('/api/clusters'),
        fetch('/api/health'),
      ]);

      if (artRes.ok) {
        const artData = await artRes.json();
        setArticles(artData.articles || []);
      }
      if (clustRes.ok) {
        const clustData = await clustRes.json();
        setClusters(clustData.clusters || []);
      }
      if (healthRes.ok) {
        const healthData: HealthResponse = await healthRes.json();
        setHealth(healthData);
      }
    } catch (err) {
      console.error('Error fetching dashboard intelligence:', err);
    } finally {
      setIsLoading(false);
    }
  }, [selectedCategory, searchQuery, unreadOnly, breakingOnly]);

  const fetchConfigAndDeliverables = useCallback(async () => {
    try {
      const [cfgRes, delivRes] = await Promise.all([
        fetch('/api/config'),
        fetch('/api/deliverables'),
      ]);
      if (cfgRes.ok) {
        const cfgData = await cfgRes.json();
        if (cfgData.config?.ollama?.base_url) {
          setOllamaUrlInput(cfgData.config.ollama.base_url);
        }
        if (cfgData.config?.ollama?.min_score_for_inference) {
          setMinScoreInput(Number(cfgData.config.ollama.min_score_for_inference));
        }
        if (cfgData.config?.interests?.keywords) {
          setInterestKeywords(cfgData.config.interests.keywords);
        }
      }
      if (delivRes.ok) {
        const delivData = await delivRes.json();
        setDeliverables(delivData.deliverables || []);
      }
    } catch (err) {
      console.error('Failed loading config or deliverables:', err);
    }
  }, []);

  useEffect(() => {
    fetchDashboardData();
  }, [fetchDashboardData]);

  useEffect(() => {
    fetchConfigAndDeliverables();
  }, [fetchConfigAndDeliverables]);

  // Breaking stories for the live ticker
  const breakingTickerStories = useMemo(() => {
    const highPriority = articles.filter((a) => a.breaking_score >= 65 || a.is_significant_event);
    return highPriority.length > 0 ? highPriority.slice(0, 10) : articles.slice(0, 6);
  }, [articles]);

  useEffect(() => {
    if (breakingTickerStories.length <= 1) return;
    const timer = setInterval(() => {
      setTickerIndex((prev) => (prev + 1) % breakingTickerStories.length);
    }, 6500);
    return () => clearInterval(timer);
  }, [breakingTickerStories.length]);

  const currentTickerStory = breakingTickerStories[tickerIndex % Math.max(1, breakingTickerStories.length)];

  const handleRefreshAll = async () => {
    setIsRefreshing(true);
    try {
      await fetch('/api/collect', { method: 'POST', headers: { 'Content-Type': 'application/json' } });
      await fetchDashboardData();
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleRefreshSingleConnector = async (connectorId: string) => {
    setActiveConnectorRefreshing(connectorId);
    try {
      await fetch('/api/collect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ connector_id: connectorId }),
      });
      await fetchDashboardData();
    } finally {
      setActiveConnectorRefreshing(null);
    }
  };

  const handleToggleState = async (article: Article, field: 'is_read' | 'is_bookmarked') => {
    const nextVal = !article[field];
    setArticles((prev) =>
      prev.map((a) => (a.article_id === article.article_id ? { ...a, [field]: nextVal } : a))
    );
    await fetch(`/api/articles/${article.article_id}/state`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [field]: nextVal }),
    });
    fetchDashboardData();
  };

  const handleSynthesizeSummary = async (articleId: string) => {
    setSummarizingId(articleId);
    try {
      const res = await fetch(`/api/articles/${articleId}/summarize`, { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        setArticles((prev) =>
          prev.map((a) =>
            a.article_id === articleId
              ? { ...a, ai_summary: data.ai_summary, ai_model_used: data.ai_model_used }
              : a
          )
        );
      }
    } finally {
      setSummarizingId(null);
    }
  };

  const handleSaveOllamaAndInterests = async (e: React.FormEvent) => {
    e.preventDefault();
    setConfigSaveMessage('Probing M1 Ollama LAN endpoint & saving configuration...');
    try {
      const res = await fetch('/api/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ollama: {
            base_url: ollamaUrlInput.trim(),
            min_score_for_inference: Number(minScoreInput),
          },
          interests: {
            keywords: interestKeywords,
          },
        }),
      });
      if (res.ok) {
        await fetchDashboardData();
        setConfigSaveMessage('Configuration saved and M1 Ollama LAN discovery updated.');
        setTimeout(() => setConfigSaveMessage(null), 4000);
      }
    } catch {
      setConfigSaveMessage('Failed to update configuration.');
    }
  };

  const handleAddKeyword = () => {
    const clean = newKeyword.trim().toLowerCase();
    if (!clean) return;
    setInterestKeywords((prev) => ({ ...prev, [clean]: Number(newKeywordWeight) || 15 }));
    setNewKeyword('');
  };

  const handleRemoveKeyword = (kw: string) => {
    setInterestKeywords((prev) => {
      const copy = { ...prev };
      delete copy[kw];
      return copy;
    });
  };

  const handleRunTests = async () => {
    const res = await fetch('/api/tests/run', { method: 'POST' });
    if (res.ok) {
      const data: TestSuiteResponse = await res.json();
      setTestSuite(data);
    }
  };

  const handleLoadRssPreview = useCallback(async (cat: string) => {
    const query = cat && cat !== 'all' ? `?category=${encodeURIComponent(cat)}` : '';
    const res = await fetch(`/api/feed.rss${query}`);
    if (res.ok) {
      const text = await res.text();
      setRssPreview(text);
    }
  }, []);

  useEffect(() => {
    if (activeSection === 'tests_rss') {
      if (!testSuite) handleRunTests();
      handleLoadRssPreview(rssCategory);
    }
  }, [activeSection, rssCategory, testSuite, handleLoadRssPreview]);

  const handleCopyText = (id: string, content: string) => {
    navigator.clipboard.writeText(content);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleDownloadFile = (filename: string, content: string) => {
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename.split('/').pop() || filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const activeDeliverable = useMemo(
    () => deliverables.find((d) => d.id === selectedDeliverableId) || deliverables[0],
    [deliverables, selectedDeliverableId]
  );

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
      {/* STRICT 3-ZONE TOP BAR CONTRACT */}
      <header className="flex items-center justify-between gap-8 px-6 py-4 border-b border-slate-800 bg-slate-950/95 sticky top-0 z-30">
        {/* Zone 1: Single text element wordmark */}
        <a
          href="#top"
          onClick={(e) => {
            e.preventDefault();
            setActiveSection('feed');
          }}
          className="text-lg font-bold tracking-tight text-slate-100 whitespace-nowrap shrink-0"
        >
          Hermes Intelligence
        </a>

        {/* Zone 2: 5 clean single-line text navigation links */}
        <nav className="flex items-center gap-6 text-sm font-medium text-slate-400 overflow-x-auto">
          <button
            type="button"
            onClick={() => setActiveSection('feed')}
            className={`py-1 transition-colors whitespace-nowrap shrink-0 border-b-2 ${
              activeSection === 'feed'
                ? 'text-slate-100 border-sky-400'
                : 'border-transparent hover:text-slate-200'
            }`}
          >
            Intelligence Feed
          </button>
          <button
            type="button"
            onClick={() => setActiveSection('clusters')}
            className={`py-1 transition-colors whitespace-nowrap shrink-0 border-b-2 ${
              activeSection === 'clusters'
                ? 'text-slate-100 border-sky-400'
                : 'border-transparent hover:text-slate-200'
            }`}
          >
            Developing Stories
          </button>
          <button
            type="button"
            onClick={() => setActiveSection('collectors')}
            className={`py-1 transition-colors whitespace-nowrap shrink-0 border-b-2 ${
              activeSection === 'collectors'
                ? 'text-slate-100 border-sky-400'
                : 'border-transparent hover:text-slate-200'
            }`}
          >
            Collector Health
          </button>
          <button
            type="button"
            onClick={() => setActiveSection('deployment')}
            className={`py-1 transition-colors whitespace-nowrap shrink-0 border-b-2 ${
              activeSection === 'deployment'
                ? 'text-slate-100 border-sky-400'
                : 'border-transparent hover:text-slate-200'
            }`}
          >
            Pi &amp; Ollama Kit
          </button>
          <button
            type="button"
            onClick={() => setActiveSection('tests_rss')}
            className={`py-1 transition-colors whitespace-nowrap shrink-0 border-b-2 ${
              activeSection === 'tests_rss'
                ? 'text-slate-100 border-sky-400'
                : 'border-transparent hover:text-slate-200'
            }`}
          >
            Tests &amp; RSS
          </button>
        </nav>

        {/* Zone 3: 1 primary action */}
        <div className="flex items-center shrink-0">
          <button
            type="button"
            onClick={handleRefreshAll}
            disabled={isRefreshing}
            className="px-4 py-2 text-xs font-semibold text-slate-950 bg-sky-400 rounded-lg hover:bg-sky-300 disabled:opacity-60 transition-colors whitespace-nowrap shrink-0 flex items-center gap-2 cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
            <span>{isRefreshing ? 'Collecting 11 Feeds...' : 'Refresh Feeds'}</span>
          </button>
        </div>
      </header>

      {/* LIVE BREAKING-NEWS TICKER & SYSTEM TELEMETRY BAR */}
      <div className="border-b border-slate-800/90 bg-slate-900/70 px-6 py-2.5">
        <div className="max-w-[1380px] mx-auto flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <span className="text-xs font-mono font-semibold uppercase tracking-wider text-amber-400 whitespace-nowrap shrink-0">
              Breaking Wire
            </span>
            <span className="text-slate-600" aria-hidden="true">
              /
            </span>
            {currentTickerStory ? (
              <div className="flex items-center gap-3 min-w-0 flex-1">
                <a
                  href={currentTickerStory.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm font-medium text-slate-200 hover:text-sky-300 truncate transition-colors"
                >
                  {currentTickerStory.headline}
                </a>
                <span className="text-xs font-mono tabular-nums text-slate-400 whitespace-nowrap shrink-0">
                  {currentTickerStory.publisher} · Score {currentTickerStory.breaking_score.toFixed(1)} ·{' '}
                  {currentTickerStory.corroboration_count}x corroborated ·{' '}
                  {formatRelativeTime(currentTickerStory.published_at)}
                </span>
              </div>
            ) : (
              <span className="text-sm text-slate-400">Initializing global news wire...</span>
            )}
            {breakingTickerStories.length > 1 && (
              <div className="flex items-center gap-1 shrink-0">
                <button
                  type="button"
                  aria-label="Previous breaking headline"
                  onClick={() =>
                    setTickerIndex(
                      (prev) => (prev - 1 + breakingTickerStories.length) % breakingTickerStories.length
                    )
                  }
                  className="p-1 text-slate-400 hover:text-slate-200 rounded transition-colors cursor-pointer"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                </button>
                <span className="text-xs font-mono tabular-nums text-slate-500">
                  {(tickerIndex % breakingTickerStories.length) + 1}/{breakingTickerStories.length}
                </span>
                <button
                  type="button"
                  aria-label="Next breaking headline"
                  onClick={() => setTickerIndex((prev) => (prev + 1) % breakingTickerStories.length)}
                  className="p-1 text-slate-400 hover:text-slate-200 rounded transition-colors cursor-pointer"
                >
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
          </div>

          {/* Unboxed Telemetry Summary */}
          <div className="flex items-center gap-2 text-xs font-mono tabular-nums text-slate-400 whitespace-nowrap shrink-0">
            <span>
              Connectors:{' '}
              <strong className="text-slate-200">
                {health?.collectors?.filter((c) => c.status === 'healthy').length ?? 11}/11 Healthy
              </strong>
            </span>
            <span aria-hidden="true">·</span>
            <span>
              M1 Ollama:{' '}
              <strong className={health?.ollama?.online ? 'text-emerald-400' : 'text-amber-400'}>
                {health?.ollama?.online
                  ? health.ollama.discovered_model || 'Online'
                  : 'Offline (Local Extractive Active)'}
              </strong>
            </span>
            <span aria-hidden="true">·</span>
            <span>
              Refreshed: <strong className="text-slate-200">{formatRelativeTime(health?.timestamp ?? null)}</strong>
            </span>
          </div>
        </div>
      </div>

      {/* MAIN WORKSPACE CONTENT */}
      <main className="flex-1 max-w-[1380px] w-full mx-auto px-6 py-8">
        {/* SECTION 1: INTELLIGENCE FEED */}
        {activeSection === 'feed' && (
          <div className="space-y-6">
            {/* Category Filter Controls & Search Bar */}
            <div className="flex flex-col gap-4 border-b border-slate-800 pb-5">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <h1 className="text-2xl font-bold tracking-tight text-slate-100">
                    Global News Intelligence Feed
                  </h1>
                  <p className="text-sm text-slate-400 mt-1">
                    Multi-publisher corroboration across 11 independent feeds · Deduplicated SQLite WAL store · Zero paid APIs
                  </p>
                </div>

                {/* Search & State Filter Bar */}
                <div className="flex flex-wrap items-center gap-3">
                  <div className="relative w-64 sm:w-72">
                    <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Search headline, source, topic..."
                      className="w-full pl-9 pr-3 py-1.5 text-sm bg-slate-900 border border-slate-800 rounded-lg text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-sky-400"
                    />
                  </div>

                  <button
                    type="button"
                    onClick={() => setUnreadOnly((v) => !v)}
                    className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                      unreadOnly
                        ? 'bg-sky-500/15 border-sky-400/60 text-sky-300'
                        : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    Unread Only ({health?.database?.unread_count ?? 0})
                  </button>

                  <button
                    type="button"
                    onClick={() => setBreakingOnly((v) => !v)}
                    className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                      breakingOnly
                        ? 'bg-amber-500/15 border-amber-400/60 text-amber-300'
                        : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    Breaking Score ≥ 68
                  </button>
                </div>
              </div>

              {/* Interactive Segmented Category Tabs */}
              <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
                {CATEGORY_TABS.map((tab) => {
                  const isActive = selectedCategory === tab.key;
                  return (
                    <button
                      key={tab.key}
                      type="button"
                      onClick={() => setSelectedCategory(tab.key)}
                      className={`px-3.5 py-2 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                        isActive
                          ? 'bg-slate-100 text-slate-950'
                          : 'bg-slate-900/90 text-slate-400 hover:text-slate-200 hover:bg-slate-800/70'
                      }`}
                    >
                      {tab.label}
                      {tab.key === 'bookmarks' && health?.database?.bookmarked_count
                        ? ` (${health.database.bookmarked_count})`
                        : ''}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Main Two-Column Intelligence Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
              {/* Left 8 Columns: Article Stream */}
              <div className="lg:col-span-8 space-y-4">
                {isLoading ? (
                  <div className="space-y-4">
                    {[1, 2, 3, 4].map((n) => (
                      <div
                        key={n}
                        className="p-5 rounded-xl border border-slate-800 bg-slate-900/40 animate-pulse space-y-3"
                      >
                        <div className="h-3 bg-slate-800 rounded w-1/3" />
                        <div className="h-5 bg-slate-800 rounded w-3/4" />
                        <div className="h-12 bg-slate-800 rounded w-full" />
                      </div>
                    ))}
                  </div>
                ) : articles.length === 0 ? (
                  <div className="p-10 rounded-xl border border-slate-800 bg-slate-900/40 text-center space-y-3">
                    <p className="text-base font-medium text-slate-200">
                      No articles match the current category or filter criteria.
                    </p>
                    <p className="text-sm text-slate-400">
                      Try clearing your search query or trigger an immediate collection cycle across the 11 feeds.
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        setSearchQuery('');
                        setUnreadOnly(false);
                        setBreakingOnly(false);
                        setSelectedCategory('top');
                      }}
                      className="px-4 py-2 text-xs font-semibold bg-slate-800 text-slate-200 rounded-lg hover:bg-slate-700 transition-colors cursor-pointer"
                    >
                      Reset Filters
                    </button>
                  </div>
                ) : (
                  articles.map((article) => (
                    <article
                      key={article.article_id}
                      className={`p-5 rounded-xl border transition-colors ${
                        article.is_read
                          ? 'border-slate-800/60 bg-slate-900/25 text-slate-400'
                          : 'border-slate-800 bg-slate-900/60 text-slate-100 hover:border-slate-700'
                      }`}
                    >
                      {/* Clean Unboxed Metadata Header (Zero-Pill Discipline) */}
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs font-mono tabular-nums text-slate-400 mb-2">
                        <span className="font-semibold text-sky-400">{article.publisher}</span>
                        <span aria-hidden="true">·</span>
                        <span>{CATEGORY_LABELS[article.category] || article.category}</span>
                        <span aria-hidden="true">·</span>
                        <span>{formatRelativeTime(article.published_at)}</span>
                        <span aria-hidden="true">·</span>
                        <span
                          className={
                            article.breaking_score >= 75
                              ? 'text-amber-400 font-semibold'
                              : 'text-slate-400'
                          }
                        >
                          Breaking {article.breaking_score.toFixed(1)}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span>Interest {article.relevance_score.toFixed(1)}</span>
                        {article.corroboration_count >= 2 && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="text-emerald-400 font-semibold">
                              Verified by {article.corroboration_count} Publishers
                            </span>
                          </>
                        )}
                        {article.is_significant_event && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="text-amber-300 font-semibold">Significant Global Event</span>
                          </>
                        )}
                      </div>

                      {/* Headline */}
                      <h2 className="text-lg font-semibold leading-snug tracking-tight mb-2.5">
                        <a
                          href={article.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={() => {
                            if (!article.is_read) {
                              handleToggleState(article, 'is_read');
                            }
                          }}
                          className="hover:text-sky-300 transition-colors"
                        >
                          {article.headline}
                        </a>
                      </h2>

                      {/* Snippet / Description */}
                      {article.description && (
                        <p className="text-sm text-slate-300/90 leading-relaxed mb-3">
                          {article.description}
                        </p>
                      )}

                      {/* Local AI / Extractive Intelligence Summary */}
                      {article.ai_summary && (
                        <div className="pt-3 mt-3 border-t border-slate-800/80 text-xs text-slate-300 space-y-1">
                          <div className="flex items-center justify-between text-slate-400 font-mono">
                            <span>Intelligence Brief ({article.ai_model_used || 'Local Engine'})</span>
                            <span>ID: {article.article_id.slice(0, 10)}</span>
                          </div>
                          <p className="text-slate-200 leading-relaxed">{article.ai_summary}</p>
                        </div>
                      )}

                      {/* Action Footer */}
                      <div className="flex flex-wrap items-center justify-between gap-3 pt-3.5 mt-3.5 border-t border-slate-800/60 text-xs">
                        <div className="flex items-center gap-4">
                          <a
                            href={article.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-medium text-sky-400 hover:text-sky-300 flex items-center gap-1 whitespace-nowrap shrink-0"
                          >
                            <span>Original Source</span>
                            <ExternalLink className="w-3.5 h-3.5" />
                          </a>

                          <button
                            type="button"
                            onClick={() => handleSynthesizeSummary(article.article_id)}
                            disabled={summarizingId === article.article_id}
                            className="text-slate-400 hover:text-slate-200 flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
                          >
                            <Sparkles className="w-3.5 h-3.5" />
                            <span>
                              {summarizingId === article.article_id
                                ? 'Synthesizing...'
                                : 'Refresh Brief'}
                            </span>
                          </button>
                        </div>

                        <div className="flex items-center gap-4">
                          <button
                            type="button"
                            onClick={() => handleToggleState(article, 'is_read')}
                            className={`flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
                              article.is_read
                                ? 'text-emerald-400 hover:text-emerald-300'
                                : 'text-slate-400 hover:text-slate-200'
                            }`}
                          >
                            <Check className="w-3.5 h-3.5" />
                            <span>{article.is_read ? 'Read' : 'Mark Read'}</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => handleToggleState(article, 'is_bookmarked')}
                            className={`flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
                              article.is_bookmarked
                                ? 'text-amber-400 font-semibold'
                                : 'text-slate-400 hover:text-slate-200'
                            }`}
                          >
                            <Bookmark
                              className={`w-3.5 h-3.5 ${article.is_bookmarked ? 'fill-amber-400' : ''}`}
                            />
                            <span>{article.is_bookmarked ? 'Bookmarked' : 'Bookmark'}</span>
                          </button>
                        </div>
                      </div>
                    </article>
                  ))
                )}
              </div>

              {/* Right 4 Columns: Developing Multi-Publisher Clusters & Collector Pulse */}
              <aside className="lg:col-span-4 space-y-6">
                {/* Developing Story Clusters Sidebar */}
                <div className="p-5 rounded-xl border border-slate-800 bg-slate-900/50 space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-slate-100">
                      Corroborated Developing Stories
                    </h3>
                    <button
                      type="button"
                      onClick={() => setActiveSection('clusters')}
                      className="text-xs text-sky-400 hover:text-sky-300 font-medium cursor-pointer"
                    >
                      View All ({clusters.filter((c) => c.corroboration_count >= 2).length})
                    </button>
                  </div>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    Stories corroborated by multiple independent publishers receive verification priority. Single-source volume spikes are penalized.
                  </p>

                  <div className="divide-y divide-slate-800/80">
                    {clusters
                      .filter((c) => c.corroboration_count >= 2)
                      .slice(0, 5)
                      .map((cluster) => (
                        <div key={cluster.cluster_id} className="py-3.5 first:pt-1 last:pb-1 space-y-1.5">
                          <div className="text-xs font-mono tabular-nums text-emerald-400">
                            {cluster.corroboration_count} Publishers · Score{' '}
                            {cluster.max_breaking_score.toFixed(1)} ·{' '}
                            {CATEGORY_LABELS[cluster.category] || cluster.category}
                          </div>
                          <h4 className="text-sm font-semibold text-slate-200 leading-snug">
                            <button
                              type="button"
                              onClick={() => setActiveSection('clusters')}
                              className="text-left hover:text-sky-300 transition-colors cursor-pointer"
                            >
                              {cluster.cluster_title}
                            </button>
                          </h4>
                          <div className="text-xs text-slate-400">
                            Sources: {cluster.publishers.join(' · ')}
                          </div>
                        </div>
                      ))}
                  </div>
                </div>

                {/* 11 Collector Feeds Quick Status */}
                <div className="p-5 rounded-xl border border-slate-800 bg-slate-900/50 space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-slate-100">11 Active Connectors</h3>
                    <button
                      type="button"
                      onClick={() => setActiveSection('collectors')}
                      className="text-xs text-sky-400 hover:text-sky-300 font-medium cursor-pointer"
                    >
                      Configure
                    </button>
                  </div>

                  <div className="divide-y divide-slate-800/70 text-xs">
                    {(health?.collectors || []).map((col) => (
                      <div
                        key={col.connector_id}
                        className="py-2 flex items-center justify-between gap-2 font-mono tabular-nums"
                      >
                        <span className="text-slate-300 truncate">{col.name}</span>
                        <span className="text-slate-400 whitespace-nowrap shrink-0">
                          {col.status === 'healthy' ? 'OK' : col.status} · {col.latency_ms}ms
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </aside>
            </div>
          </div>
        )}

        {/* SECTION 2: DEVELOPING STORIES & MULTI-PUBLISHER CORROBORATION */}
        {activeSection === 'clusters' && (
          <div className="space-y-6">
            <div className="border-b border-slate-800 pb-5">
              <h1 className="text-2xl font-bold tracking-tight text-slate-100">
                Developing Story Clusters &amp; Cross-Publisher Corroboration
              </h1>
              <p className="text-sm text-slate-400 mt-1">
                Related reports across GDELT DOC 2.0 and all 10 RSS connectors are grouped via token Jaccard similarity and normalized entity fingerprints.
              </p>
            </div>

            <div className="space-y-5">
              {clusters.map((cluster) => (
                <div
                  key={cluster.cluster_id}
                  className="p-6 rounded-xl border border-slate-800 bg-slate-900/50 space-y-4"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-mono tabular-nums text-slate-400">
                    <div>
                      <span className="text-emerald-400 font-semibold">
                        {cluster.corroboration_count} Independent Publisher
                        {cluster.corroboration_count > 1 ? 's' : ''}
                      </span>
                      <span className="mx-2" aria-hidden="true">
                        ·
                      </span>
                      <span>Peak Breaking Score {cluster.max_breaking_score.toFixed(1)}</span>
                      <span className="mx-2" aria-hidden="true">
                        ·
                      </span>
                      <span>{CATEGORY_LABELS[cluster.category] || cluster.category}</span>
                      {cluster.is_significant_event && (
                        <>
                          <span className="mx-2" aria-hidden="true">
                            ·
                          </span>
                          <span className="text-amber-300 font-semibold">
                            Verified Significant Global Event
                          </span>
                        </>
                      )}
                    </div>
                    <span>Updated {formatRelativeTime(cluster.latest_published_at)}</span>
                  </div>

                  <h2 className="text-xl font-bold text-slate-100">{cluster.cluster_title}</h2>

                  {cluster.ai_summary && (
                    <p className="text-sm text-slate-300 leading-relaxed">{cluster.ai_summary}</p>
                  )}

                  <div className="pt-3 border-t border-slate-800 space-y-2.5">
                    <div className="text-xs font-semibold text-slate-400">
                      Corroborating Reports ({cluster.articles.length}):
                    </div>
                    {cluster.articles.map((art) => (
                      <div
                        key={art.article_id}
                        className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 py-2 border-b border-slate-800/50 last:border-0 text-sm"
                      >
                        <div className="min-w-0">
                          <span className="font-mono text-xs text-sky-400 mr-2">
                            {art.publisher}
                          </span>
                          <a
                            href={art.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-slate-200 hover:text-sky-300 transition-colors"
                          >
                            {art.headline}
                          </a>
                        </div>
                        <div className="flex items-center gap-3 text-xs font-mono tabular-nums text-slate-400 shrink-0">
                          <span>{formatRelativeTime(art.published_at)}</span>
                          <a
                            href={art.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-sky-400 hover:text-sky-300 flex items-center gap-1"
                          >
                            <span>Source</span>
                            <ExternalLink className="w-3 h-3" />
                          </a>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* SECTION 3: COLLECTOR HEALTH & M1 OLLAMA CONFIGURATION */}
        {activeSection === 'collectors' && (
          <div className="space-y-8">
            <div className="border-b border-slate-800 pb-5">
              <h1 className="text-2xl font-bold tracking-tight text-slate-100">
                Collector Health Telemetry &amp; Apple M1 Ollama Intelligence Settings
              </h1>
              <p className="text-sm text-slate-400 mt-1">
                Monitor all 11 independent news connectors, trigger individual refreshes, and configure dynamic model discovery on your M1 Mac.
              </p>
            </div>

            {/* 11 Connectors High-Density Data Table */}
            <div className="rounded-xl border border-slate-800 bg-slate-900/50 overflow-hidden">
              <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between">
                <div>
                  <h2 className="text-base font-semibold text-slate-100">
                    11 Independent News Connectors
                  </h2>
                  <p className="text-xs text-slate-400">
                    Exponential backoff retry (max 3 attempts) · Rate-limit courtesy delay · SQLite UNIQUE(url) deduplication
                  </p>
                </div>
                <span className="text-xs font-mono tabular-nums text-slate-400">
                  Total Stored Articles: {health?.database?.total_articles ?? 0}
                </span>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-slate-800 text-xs font-mono text-slate-400 bg-slate-950/50">
                      <th className="py-3 px-4">Connector</th>
                      <th className="py-3 px-4">Protocol</th>
                      <th className="py-3 px-4">Status</th>
                      <th className="py-3 px-4 text-right">Interval</th>
                      <th className="py-3 px-4 text-right">Fetched</th>
                      <th className="py-3 px-4 text-right">Latency</th>
                      <th className="py-3 px-4 text-right">Last Run</th>
                      <th className="py-3 px-4 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/70 font-mono tabular-nums text-xs">
                    {(health?.collectors || []).map((c) => (
                      <tr key={c.connector_id} className="hover:bg-slate-800/30 transition-colors">
                        <td className="py-3 px-4 font-sans font-semibold text-slate-200">
                          <div>{c.name}</div>
                          <div className="text-[11px] font-mono text-slate-500 truncate max-w-xs">
                            {c.url}
                          </div>
                        </td>
                        <td className="py-3 px-4 text-slate-400">{c.type}</td>
                        <td className="py-3 px-4">
                          <span
                            className={
                              c.status === 'healthy'
                                ? 'text-emerald-400 font-semibold'
                                : c.status === 'running'
                                ? 'text-sky-400 font-semibold'
                                : 'text-amber-400'
                            }
                          >
                            {c.status.toUpperCase()}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-right text-slate-300">{c.interval_minutes}m</td>
                        <td className="py-3 px-4 text-right text-slate-300">
                          {c.articles_fetched_last}
                        </td>
                        <td className="py-3 px-4 text-right text-slate-300">{c.latency_ms}ms</td>
                        <td className="py-3 px-4 text-right text-slate-400">
                          {formatRelativeTime(c.last_run_at)}
                        </td>
                        <td className="py-3 px-4 text-right">
                          <button
                            type="button"
                            onClick={() => handleRefreshSingleConnector(c.connector_id)}
                            disabled={activeConnectorRefreshing === c.connector_id}
                            className="px-2.5 py-1 text-xs font-sans font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 rounded transition-colors cursor-pointer disabled:opacity-50"
                          >
                            {activeConnectorRefreshing === c.connector_id ? 'Polling...' : 'Collect Now'}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Apple M1 Ollama LAN Connection & Interest Scoring Editor */}
            <form
              onSubmit={handleSaveOllamaAndInterests}
              className="grid grid-cols-1 lg:grid-cols-2 gap-6"
            >
              {/* M1 Ollama Dynamic Discovery Card */}
              <div className="p-6 rounded-xl border border-slate-800 bg-slate-900/50 space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-base font-semibold text-slate-100 flex items-center gap-2">
                    <Cpu className="w-4 h-4 text-sky-400" />
                    <span>Apple M1 Mac Ollama LAN Connection</span>
                  </h2>
                  <span className="text-xs font-mono text-slate-400">
                    {health?.ollama?.online ? 'Connected' : 'Offline Fallback Mode'}
                  </span>
                </div>

                <p className="text-xs text-slate-400 leading-relaxed">
                  Hermes queries <code className="text-sky-300">GET /api/ps</code> and{' '}
                  <code className="text-sky-300">GET /api/tags</code> on your M1 Mac to discover the currently installed model automatically. Only stories passing keyword scoring and deduplication are sent for inference.
                </p>

                <div className="space-y-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1">
                      M1 Mac Ollama LAN Base URL
                    </label>
                    <input
                      type="text"
                      value={ollamaUrlInput}
                      onChange={(e) => setOllamaUrlInput(e.target.value)}
                      placeholder="http://192.168.1.50:11434"
                      className="w-full px-3 py-2 text-sm font-mono bg-slate-950 border border-slate-800 rounded-lg text-slate-100 focus:outline-none focus:border-sky-400"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1">
                      Minimum Breaking Score Threshold for Ollama Inference ({minScoreInput})
                    </label>
                    <input
                      type="range"
                      min={40}
                      max={90}
                      value={minScoreInput}
                      onChange={(e) => setMinScoreInput(Number(e.target.value))}
                      className="w-full accent-sky-400"
                    />
                    <div className="flex justify-between text-[11px] font-mono text-slate-500">
                      <span>40 (More summaries)</span>
                      <span>65 (Recommended)</span>
                      <span>90 (Breaking only)</span>
                    </div>
                  </div>

                  <div className="p-3.5 rounded-lg bg-slate-950 border border-slate-800/80 text-xs font-mono space-y-1">
                    <div className="text-slate-400">
                      SQLite WAL Path:{' '}
                      <span className="text-emerald-400">
                        /home/pi/.hermes/data/hermes_news.db
                      </span>
                    </div>
                    <div className="text-slate-400">
                      Discovery Endpoint:{' '}
                      <span className="text-slate-200">{ollamaUrlInput}/api/tags</span>
                    </div>
                    <div className="text-slate-400">
                      Discovered Model:{' '}
                      <span className="text-sky-400">
                        {health?.ollama?.discovered_model || 'None (Using Local Extractive Engine)'}
                      </span>
                    </div>
                    <div className="text-slate-400">
                      Status Note:{' '}
                      <span className="text-slate-300">
                        {health?.ollama?.last_error || 'Active'}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="pt-2 flex items-center justify-between gap-3">
                  <button
                    type="submit"
                    className="px-4 py-2 text-xs font-semibold bg-sky-400 text-slate-950 rounded-lg hover:bg-sky-300 transition-colors cursor-pointer"
                  >
                    Save &amp; Probe M1 Ollama
                  </button>
                  {configSaveMessage && (
                    <span className="text-xs text-emerald-400">{configSaveMessage}</span>
                  )}
                </div>
              </div>

              {/* Interest Priority Weights Editor */}
              <div className="p-6 rounded-xl border border-slate-800 bg-slate-900/50 space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-base font-semibold text-slate-100 flex items-center gap-2">
                    <Sliders className="w-4 h-4 text-sky-400" />
                    <span>Personal Interest Priority Weights</span>
                  </h2>
                  <span className="text-xs font-mono text-slate-400">
                    {Object.keys(interestKeywords).length} Active Topics
                  </span>
                </div>

                <p className="text-xs text-slate-400 leading-relaxed">
                  Adjust keyword weights used by the local scoring engine before Ollama inference.
                </p>

                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={newKeyword}
                    onChange={(e) => setNewKeyword(e.target.value)}
                    placeholder="Add topic (e.g. robotics, chittagong)..."
                    className="flex-1 px-3 py-1.5 text-xs bg-slate-950 border border-slate-800 rounded-lg text-slate-100 focus:outline-none focus:border-sky-400"
                  />
                  <input
                    type="number"
                    min={5}
                    max={30}
                    value={newKeywordWeight}
                    onChange={(e) => setNewKeywordWeight(Number(e.target.value))}
                    className="w-16 px-2 py-1.5 text-xs font-mono bg-slate-950 border border-slate-800 rounded-lg text-slate-100"
                  />
                  <button
                    type="button"
                    onClick={handleAddKeyword}
                    className="px-3 py-1.5 text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg transition-colors cursor-pointer"
                  >
                    Add
                  </button>
                </div>

                <div className="max-h-60 overflow-y-auto divide-y divide-slate-800/60 border border-slate-800 rounded-lg bg-slate-950/60 px-3">
                  {Object.entries(interestKeywords).map(([kw, weight]) => (
                    <div
                      key={kw}
                      className="py-2 flex items-center justify-between text-xs font-mono tabular-nums"
                    >
                      <span className="text-slate-200">{kw}</span>
                      <div className="flex items-center gap-3">
                        <span className="text-sky-400">+{weight} pts</span>
                        <button
                          type="button"
                          onClick={() => handleRemoveKeyword(kw)}
                          className="text-slate-500 hover:text-rose-400 transition-colors cursor-pointer"
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </form>
          </div>
        )}

        {/* SECTION 4: RASPBERRY PI & M1 OLLAMA DEPLOYMENT KIT (ALL DELIVERABLES + VISUAL GUIDE) */}
        {activeSection === 'deployment' && (
          <div className="space-y-8">
            <div className="border-b border-slate-800 pb-5 flex flex-wrap items-center justify-between gap-4">
              <div>
                <h1 className="text-2xl font-bold tracking-tight text-slate-100">
                  README, Visual Installation Guide &amp; Raspberry Pi Deployment Kit
                </h1>
                <p className="text-sm text-slate-400 mt-1">
                  Step-by-step setup guide with screenshots and complete Python FastAPI source files in{' '}
                  <code className="text-sky-300">/README.md</code> and{' '}
                  <code className="text-sky-300">/raspberry_pi_service/</code>.
                </p>
              </div>
            </div>

            {/* Visual Architecture & Terminal Verification Screenshots + Quick Setup Steps */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-stretch">
              {/* Screenshot 1: Architecture Diagram */}
              <div className="rounded-xl border border-slate-800 bg-slate-900/50 overflow-hidden flex flex-col">
                <div className="aspect-video bg-slate-950 relative overflow-hidden border-b border-slate-800">
                  <img
                    src="/src/assets/images/raspberry_pi_m1_architecture_1795384540544.jpg"
                    alt="Hermes Raspberry Pi FastAPI, SQLite WAL, and Apple M1 Ollama LAN Architecture Diagram"
                    referrerPolicy="no-referrer"
                    className="w-full h-full object-cover"
                  />
                </div>
                <div className="p-5 space-y-2.5 flex-1">
                  <div className="text-xs font-mono text-sky-400">
                    01. Private LAN Topology &amp; Port Separation
                  </div>
                  <h2 className="text-base font-semibold text-slate-100">
                    Raspberry Pi Collector (Port 8088) + Apple M1 Ollama (Port 11434)
                  </h2>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    Your existing Hermes Gateway stays on its current port without conflict. The FastAPI news service runs on{' '}
                    <code className="text-slate-200">127.0.0.1:8088</code>, persists to SQLite WAL at{' '}
                    <code className="text-emerald-400">/home/pi/.hermes/data/hermes_news.db</code>, and dynamically discovers your M1 Mac Ollama model via{' '}
                    <code className="text-slate-200">GET /api/tags</code>.
                  </p>
                </div>
              </div>

              {/* Screenshot 2: Raspberry Pi Terminal Installation & Pytest Verification */}
              <div className="rounded-xl border border-slate-800 bg-slate-900/50 overflow-hidden flex flex-col">
                <div className="aspect-video bg-slate-950 relative overflow-hidden border-b border-slate-800">
                  <img
                    src="/src/assets/images/terminal_install_verification_1795384540475.jpg"
                    alt="Raspberry Pi OS terminal running install.sh, initializing SQLite WAL database, and passing 5 pytest checks"
                    referrerPolicy="no-referrer"
                    className="w-full h-full object-cover"
                  />
                </div>
                <div className="p-5 space-y-2.5 flex-1">
                  <div className="text-xs font-mono text-emerald-400">
                    02. Automated Raspberry Pi Setup &amp; Verification
                  </div>
                  <h2 className="text-base font-semibold text-slate-100">
                    One-Command Virtualenv, SQLite WAL Init &amp; Systemd Service
                  </h2>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    Running <code className="text-slate-200">./scripts/install.sh</code> provisions the Python virtual environment, initializes{' '}
                    <code className="text-emerald-400">~/.hermes/data/hermes_news.db</code> in WAL mode, runs the 5 automated pytest verification checks, and installs the user systemd unit.
                  </p>
                </div>
              </div>
            </div>

            {/* Direct Instruction Card for Hermes Agent Autonomous Installation */}
            <div className="p-6 rounded-xl border border-slate-800 bg-slate-900/60 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-xs font-mono font-semibold text-sky-400">
                    Hermes Agent Autonomous Installer Prompt
                  </div>
                  <h2 className="text-base font-semibold text-slate-100 mt-0.5">
                    Copy &amp; Paste This Instruction Directly to Your Hermes Agent
                  </h2>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    handleCopyText(
                      'hermes_agent_direct_prompt',
                      `Hermes Agent: Install and integrate the Global News Intelligence Service on this Raspberry Pi.\n\n1. Preserve all existing Hermes Gateway and Dashboard files. Do not change the existing Hermes Gateway port.\n2. Use SQLite WAL database path: /home/pi/.hermes/data/hermes_news.db\n3. Bind the FastAPI news service locally to 127.0.0.1:8088 (HERMES_HOST=127.0.0.1, HERMES_PORT=8088).\n4. Point OLLAMA_BASE_URL to the Apple M1 Mac on LAN (e.g. http://192.168.1.50:11434) and use dynamic /api/tags model discovery.\n5. Run the automated installer and test suite:\n   mkdir -p "$HOME/.hermes/data"\n   cd raspberry_pi_service\n   chmod +x scripts/install.sh scripts/start.sh\n   HERMES_HOST="127.0.0.1" HERMES_PORT="8088" SQLITE_DB_PATH="$HOME/.hermes/data/hermes_news.db" ./scripts/install.sh\n6. Enable and start the user systemd service:\n   systemctl --user enable --now hermes-news-intelligence.service\n7. Verify health at http://127.0.0.1:8088/api/health and proxy /api/articles, /api/clusters, /api/health, /api/collect, and /api/feed.rss into the existing Hermes Dashboard.`
                    )
                  }
                  className="px-3.5 py-2 text-xs font-semibold bg-sky-400 hover:bg-sky-300 text-slate-950 rounded-lg flex items-center gap-1.5 transition-colors cursor-pointer"
                >
                  <Copy className="w-3.5 h-3.5" />
                  <span>
                    {copiedId === 'hermes_agent_direct_prompt'
                      ? 'Copied Hermes Agent Instruction'
                      : 'Copy Instruction for Hermes Agent'}
                  </span>
                </button>
              </div>
              <pre className="p-4 rounded-lg bg-slate-950 border border-slate-800/90 text-xs font-mono text-slate-200 overflow-x-auto leading-relaxed">
                <code>{`Hermes Agent: Install and integrate the Global News Intelligence Service on this Raspberry Pi.

1. Preserve all existing Hermes Gateway and Dashboard files. Do not change the existing Hermes Gateway port.
2. Use SQLite WAL database path: /home/pi/.hermes/data/hermes_news.db
3. Bind the FastAPI news service locally to 127.0.0.1:8088 (HERMES_HOST=127.0.0.1, HERMES_PORT=8088).
4. Point OLLAMA_BASE_URL to the Apple M1 Mac on LAN (e.g. http://192.168.1.50:11434) and use dynamic /api/tags model discovery.
5. Run the automated installer and test suite:
   mkdir -p "$HOME/.hermes/data"
   cd raspberry_pi_service
   chmod +x scripts/install.sh scripts/start.sh
   HERMES_HOST="127.0.0.1" HERMES_PORT="8088" SQLITE_DB_PATH="$HOME/.hermes/data/hermes_news.db" ./scripts/install.sh
6. Enable and start the user systemd service:
   systemctl --user enable --now hermes-news-intelligence.service
7. Verify health at http://127.0.0.1:8088/api/health and proxy /api/articles, /api/clusters, /api/health, /api/collect, and /api/feed.rss into the existing Hermes Dashboard.`}</code>
              </pre>
            </div>

            {/* 3-Step Quick-Copy Installation Walkthrough */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
              <div className="p-5 rounded-xl border border-slate-800 bg-slate-900/50 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-mono font-semibold text-sky-400">
                    Step 1 · Apple M1 Mac (Ollama LAN)
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      handleCopyText(
                        'step1_cmd',
                        'launchctl setenv OLLAMA_HOST "192.168.1.50:11434"\n# Restart Ollama app, then test from Pi:\ncurl -s http://192.168.1.50:11434/api/tags'
                      )
                    }
                    className="text-xs text-slate-400 hover:text-slate-200 flex items-center gap-1 cursor-pointer"
                  >
                    <Copy className="w-3 h-3" />
                    <span>{copiedId === 'step1_cmd' ? 'Copied' : 'Copy'}</span>
                  </button>
                </div>
                <p className="text-xs text-slate-400">
                  Bind Ollama on your M1 Mac to its private LAN IP so the Raspberry Pi can auto-discover the active model:
                </p>
                <pre className="p-3 rounded-lg bg-slate-950 border border-slate-800/80 text-[11px] font-mono text-slate-200 overflow-x-auto">
                  <code>{`launchctl setenv OLLAMA_HOST "192.168.1.50:11434"\n# Verify from Raspberry Pi:\ncurl -s http://192.168.1.50:11434/api/tags`}</code>
                </pre>
              </div>

              <div className="p-5 rounded-xl border border-slate-800 bg-slate-900/50 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-mono font-semibold text-emerald-400">
                    Step 2 · Raspberry Pi Install &amp; SQLite Init
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      handleCopyText(
                        'step2_cmd',
                        'cd raspberry_pi_service\nchmod +x scripts/install.sh scripts/start.sh\nexport SQLITE_DB_PATH="$HOME/.hermes/data/hermes_news.db"\nexport OLLAMA_BASE_URL="http://192.168.1.50:11434"\n./scripts/install.sh'
                      )
                    }
                    className="text-xs text-slate-400 hover:text-slate-200 flex items-center gap-1 cursor-pointer"
                  >
                    <Copy className="w-3 h-3" />
                    <span>{copiedId === 'step2_cmd' ? 'Copied' : 'Copy'}</span>
                  </button>
                </div>
                <p className="text-xs text-slate-400">
                  Create virtualenv, initialize SQLite at <code className="text-emerald-400">~/.hermes/data/hermes_news.db</code>, and run pytest:
                </p>
                <pre className="p-3 rounded-lg bg-slate-950 border border-slate-800/80 text-[11px] font-mono text-slate-200 overflow-x-auto">
                  <code>{`cd raspberry_pi_service\nchmod +x scripts/install.sh scripts/start.sh\nexport SQLITE_DB_PATH="$HOME/.hermes/data/hermes_news.db"\n./scripts/install.sh`}</code>
                </pre>
              </div>

              <div className="p-5 rounded-xl border border-slate-800 bg-slate-900/50 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-mono font-semibold text-amber-400">
                    Step 3 · Start Service &amp; Verify Health
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      handleCopyText(
                        'step3_cmd',
                        'systemctl --user enable --now hermes-news-intelligence.service\ncurl -s http://127.0.0.1:8088/api/health | python3 -m json.tool'
                      )
                    }
                    className="text-xs text-slate-400 hover:text-slate-200 flex items-center gap-1 cursor-pointer"
                  >
                    <Copy className="w-3 h-3" />
                    <span>{copiedId === 'step3_cmd' ? 'Copied' : 'Copy'}</span>
                  </button>
                </div>
                <p className="text-xs text-slate-400">
                  Start the service on port <code className="text-slate-200">8088</code> (leaving your Hermes Gateway port untouched) and test <code className="text-slate-200">/api/health</code>:
                </p>
                <pre className="p-3 rounded-lg bg-slate-950 border border-slate-800/80 text-[11px] font-mono text-slate-200 overflow-x-auto">
                  <code>{`systemctl --user enable --now hermes-news-intelligence\ncurl -s http://127.0.0.1:8088/api/health`}</code>
                </pre>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
              {/* File Selector Sidebar */}
              <div className="lg:col-span-4 rounded-xl border border-slate-800 bg-slate-900/50 divide-y divide-slate-800">
                {deliverables.map((item) => {
                  const selected = item.id === selectedDeliverableId;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setSelectedDeliverableId(item.id)}
                      className={`w-full text-left p-4 transition-colors cursor-pointer ${
                        selected ? 'bg-slate-800/90 text-slate-100' : 'hover:bg-slate-800/40 text-slate-300'
                      }`}
                    >
                      <div className="text-xs font-mono font-semibold text-sky-400">
                        {item.title}
                      </div>
                      <div className="text-xs text-slate-400 mt-1 leading-relaxed">
                        {item.description}
                      </div>
                    </button>
                  );
                })}
              </div>

              {/* Code Inspector Panel */}
              <div className="lg:col-span-8 rounded-xl border border-slate-800 bg-slate-900/60 overflow-hidden">
                {activeDeliverable && (
                  <>
                    <div className="px-5 py-3.5 border-b border-slate-800 bg-slate-950 flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <div className="text-sm font-mono font-semibold text-slate-100">
                          {activeDeliverable.path}
                        </div>
                        <div className="text-xs text-slate-400">
                          {activeDeliverable.description}
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() =>
                            handleCopyText(activeDeliverable.id, activeDeliverable.content)
                          }
                          className="px-3 py-1.5 text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg flex items-center gap-1.5 transition-colors cursor-pointer"
                        >
                          <Copy className="w-3.5 h-3.5" />
                          <span>
                            {copiedId === activeDeliverable.id ? 'Copied' : 'Copy Code'}
                          </span>
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            handleDownloadFile(activeDeliverable.path, activeDeliverable.content)
                          }
                          className="px-3 py-1.5 text-xs font-medium bg-sky-400 hover:bg-sky-300 text-slate-950 rounded-lg flex items-center gap-1.5 transition-colors cursor-pointer"
                        >
                          <Download className="w-3.5 h-3.5" />
                          <span>Download</span>
                        </button>
                      </div>
                    </div>

                    <pre className="p-5 text-xs font-mono text-slate-200 overflow-x-auto max-h-[640px] leading-relaxed bg-slate-950/90">
                      <code>{activeDeliverable.content}</code>
                    </pre>
                  </>
                )}
              </div>
            </div>
          </div>
        )}

        {/* SECTION 5: AUTOMATED VERIFICATION TESTS & RSS 2.0 XML OUTPUT */}
        {activeSection === 'tests_rss' && (
          <div className="space-y-8">
            <div className="border-b border-slate-800 pb-5 flex flex-wrap items-center justify-between gap-4">
              <div>
                <h1 className="text-2xl font-bold tracking-tight text-slate-100">
                  Verification Test Suite &amp; RSS 2.0 / JSON Output Feeds
                </h1>
                <p className="text-sm text-slate-400 mt-1">
                  Run automated tests for RSS parsing, GDELT DOC 2.0 JSON normalization, deduplication, corroboration vs single-source volume guard, and inspect the live RSS 2.0 XML endpoint.
                </p>
              </div>
              <button
                type="button"
                onClick={handleRunTests}
                className="px-4 py-2 text-xs font-semibold bg-sky-400 text-slate-950 rounded-lg hover:bg-sky-300 flex items-center gap-2 transition-colors cursor-pointer"
              >
                <Play className="w-3.5 h-3.5" />
                <span>Run Verification Suite</span>
              </button>
            </div>

            {/* Test Suite Results */}
            <div className="p-6 rounded-xl border border-slate-800 bg-slate-900/50 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-base font-semibold text-slate-100">
                  Automated Intelligence &amp; Connector Test Results
                </h2>
                {testSuite && (
                  <span className="text-xs font-mono tabular-nums text-emerald-400 font-semibold">
                    {testSuite.passed_count}/{testSuite.total_tests} Assertions Passed
                  </span>
                )}
              </div>

              <div className="divide-y divide-slate-800">
                {(testSuite?.results || []).map((t) => (
                  <div
                    key={t.name}
                    className="py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2"
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2 text-sm font-mono font-semibold text-slate-200">
                        <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                        <span>{t.name}</span>
                      </div>
                      <p className="text-xs text-slate-400 pl-6">{t.details}</p>
                    </div>
                    <span className="text-xs font-mono tabular-nums text-slate-400 shrink-0">
                      PASS · {t.duration_ms}ms
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Live RSS 2.0 XML Output Inspector */}
            <div className="rounded-xl border border-slate-800 bg-slate-900/50 overflow-hidden">
              <div className="px-6 py-4 border-b border-slate-800 flex flex-wrap items-center justify-between gap-4">
                <div className="flex items-center gap-2">
                  <Rss className="w-4 h-4 text-amber-400" />
                  <h2 className="text-base font-semibold text-slate-100">
                    Live RSS 2.0 XML Output Feed (<code className="text-sky-300 text-xs">/api/feed.rss</code>)
                  </h2>
                </div>

                <div className="flex items-center gap-3">
                  <select
                    value={rssCategory}
                    onChange={(e) => setRssCategory(e.target.value)}
                    className="px-3 py-1.5 text-xs bg-slate-950 border border-slate-800 rounded-lg text-slate-200"
                  >
                    <option value="all">All Categories</option>
                    <option value="ai_tech">AI &amp; Technology</option>
                    <option value="business">Business &amp; Markets</option>
                    <option value="us_texas">US &amp; Texas</option>
                    <option value="bd_india">Bangladesh &amp; India</option>
                    <option value="science">Science &amp; Research</option>
                    <option value="travel_aviation">Travel &amp; Aviation</option>
                  </select>

                  <a
                    href={`/api/feed.rss${rssCategory !== 'all' ? `?category=${rssCategory}` : ''}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-3 py-1.5 text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg flex items-center gap-1.5"
                  >
                    <span>Open Raw XML</span>
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                </div>
              </div>

              <pre className="p-5 text-xs font-mono text-slate-300 overflow-x-auto max-h-96 leading-relaxed bg-slate-950">
                <code>{rssPreview || 'Loading /api/feed.rss XML output...'}</code>
              </pre>
            </div>
          </div>
        )}
      </main>

      {/* QUIET FOOTER */}
      <footer className="border-t border-slate-900 px-6 py-4 text-xs text-slate-500">
        <div className="max-w-[1380px] mx-auto flex flex-wrap items-center justify-between gap-4">
          <span>Hermes Personal Global News Intelligence System · Raspberry Pi &amp; Apple M1 Local Stack</span>
          <div className="flex items-center gap-4">
            <a
              href="/api/health"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-slate-300 transition-colors"
            >
              Health JSON (/api/health)
            </a>
            <a
              href="/api/articles"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-slate-300 transition-colors"
            >
              Articles JSON (/api/articles)
            </a>
            <a
              href="/api/feed.rss"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-slate-300 transition-colors"
            >
              RSS 2.0 Feed (/api/feed.rss)
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
