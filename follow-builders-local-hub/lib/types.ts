export interface DashboardOverview {
  builders: number;
  tweets: number;
  podcastEpisodes: number;
  blogPosts: number;
  digests: number;
  summaries: number;
  syncRuns: number;
}

export interface TweetRecord {
  id: string;
  builderHandle: string;
  builderName: string;
  text: string;
  createdAt: string;
  url: string;
  likes: number;
  retweets: number;
  replies: number;
  isQuote: boolean;
  quotedTweetId: string | null;
}

export interface TweetViewRecord extends TweetRecord {
  summaryZh: string | null;
  summaryStatus: SummaryStatus | null;
  summaryUpdatedAt: string | null;
}

export interface BuilderFeedEntry {
  handle: string;
  name: string;
  bio: string;
  tweets: TweetRecord[];
}

export interface BuilderFeedViewRecord {
  handle: string;
  name: string;
  bio: string;
  tweetCount: number;
  tweets: TweetRecord[];
  summaryZh: string | null;
  summaryStatus: SummaryStatus | null;
}

export interface BlogPostViewRecord {
  url: string;
  blogName: string;
  title: string;
  author: string | null;
  publishedAt: string | null;
  content: string;
  description: string;
  summaryZh: string | null;
  summaryStatus: SummaryStatus | null;
}

export interface PodcastEpisodeRecord {
  videoId: string;
  podcastName: string;
  title: string;
  url: string;
  publishedAt: string;
  transcript: string;
}

export interface PodcastEpisodeViewRecord extends PodcastEpisodeRecord {
  summaryZh: string | null;
  summaryStatus: SummaryStatus | null;
  summaryUpdatedAt: string | null;
}

export interface DigestRecord {
  id: number;
  syncRunId: number | null;
  kind: string;
  title: string;
  content: string;
  createdAt: string;
}

export interface SyncRunRecord {
  id: number;
  startedAt: string;
  finishedAt: string | null;
  status: string;
  feedGeneratedAt: string | null;
  xBuilders: number;
  totalTweets: number;
  podcastEpisodes: number;
  newTweets: number;
  newPodcastEpisodes: number;
  newBlogPosts?: number;
  message: string | null;
  digestId: number | null;
}

export interface TopBuilderRecord {
  handle: string;
  name: string;
  tweetCount: number;
  lastTweetAt: string;
}

export type SummaryStatus = 'done' | 'failed' | 'pending';

export type SummaryContentType = 'tweet' | 'podcast_episode';

export interface ContentSummaryRecord {
  id: number;
  contentType: SummaryContentType;
  contentKey: string;
  locale: string;
  summaryKind: string;
  summaryZh: string | null;
  sourceHash: string;
  modelProvider: string | null;
  modelName: string | null;
  promptVersion: string | null;
  status: SummaryStatus;
  tokensIn: number | null;
  tokensOut: number | null;
  estimatedCostUsd: number | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Config {
  databasePath: string;
  feeds: {
    xUrl: string;
    podcastsUrl: string;
  };
  summaries: {
    enabled: boolean;
    locale: string;
    summaryKind: string;
    promptVersion: string;
    tweetModel: string;
    podcastModel: string;
    maxTweetChars: number;
    maxPodcastChars: number;
  };
  openclaw: {
    mode: 'none' | 'message';
    channel: string;
    target: string;
    account: string;
    enabled: boolean;
  };
  rootDir: string;
  configPath: string;
}

export interface SyncSummary {
  finishedAt: string;
  feedGeneratedAt: string | null;
  xBuilders: number;
  totalTweets: number;
  newTweets: number;
  podcastEpisodes: number;
  newPodcastEpisodes: number;
  podcastTitles: string[];
  topBuilderSummaries: string[];
}

export interface SyncResult extends SyncSummary {
  syncRunId: number;
  digestId: number;
  message: string;
  databasePath: string;
}

export interface DashboardData {
  overview: DashboardOverview;
  latestSync: SyncRunRecord | null;
  latestDigest: DigestRecord | null;
  recentTweets: TweetViewRecord[];
  recentBuilders: BuilderFeedViewRecord[];
  recentPodcasts: PodcastEpisodeViewRecord[];
  recentBlogs: BlogPostViewRecord[];
  recentDigests: DigestRecord[];
  topBuilders: TopBuilderRecord[];
  recentSyncRuns: SyncRunRecord[];
}
