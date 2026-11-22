export type CategoryKey =
  | 'top'
  | 'global'
  | 'ai_tech'
  | 'business'
  | 'us_texas'
  | 'bd_india'
  | 'science'
  | 'travel_aviation';

export interface Article {
  article_id: string;
  headline: string;
  publisher: string;
  connector_id: string;
  url: string;
  published_at: string;
  collected_at: string;
  category: CategoryKey;
  language: string;
  description: string;
  breaking_score: number;
  relevance_score: number;
  corroboration_count: number;
  cluster_id: string;
  cluster_title: string;
  is_significant_event: boolean;
  ai_summary: string;
  ai_model_used: string;
  is_read: boolean;
  is_bookmarked: boolean;
}

export interface StoryCluster {
  cluster_id: string;
  cluster_title: string;
  category: CategoryKey;
  corroboration_count: number;
  max_breaking_score: number;
  is_significant_event: boolean;
  latest_published_at: string;
  publishers: string[];
  ai_summary: string;
  articles: Article[];
}

export interface CollectorStatus {
  connector_id: string;
  name: string;
  type: string;
  url: string;
  interval_minutes: number;
  status: string;
  last_run_at: string | null;
  last_success_at: string | null;
  articles_fetched_last: number;
  articles_inserted_last: number;
  consecutive_failures: number;
  last_error: string | null;
  latency_ms: number;
}

export interface OllamaStatus {
  base_url: string;
  online: boolean;
  discovered_model: string | null;
  available_models: string[];
  last_checked: string | null;
  last_error: string | null;
}

export interface HealthResponse {
  status: string;
  timestamp: string;
  is_collecting: boolean;
  database: {
    engine: string;
    path: string;
    total_articles: number;
    corroborated_clusters: number;
    significant_events: number;
    bookmarked_count: number;
    unread_count: number;
  };
  ollama: OllamaStatus;
  collectors: CollectorStatus[];
}

export interface DeliverableFile {
  id: string;
  title: string;
  path: string;
  language: string;
  description: string;
  content: string;
}

export interface TestResultItem {
  name: string;
  passed: boolean;
  duration_ms: number;
  details: string;
}

export interface TestSuiteResponse {
  all_passed: boolean;
  total_tests: number;
  passed_count: number;
  timestamp: string;
  results: TestResultItem[];
}
