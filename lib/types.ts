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
  builderSummaryZh: string | null;
  builderSummaryStatus: SummaryStatus | null;
  builderSummaryUpdatedAt: string | null;
}

export interface BuilderFeedEntry {
  source?: string;
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
  latestTweetAt: string;
  tweets: TweetRecord[];
  summaryZh: string | null;
  summaryStatus: SummaryStatus | null;
  summaryUpdatedAt: string | null;
}

export interface PodcastEpisodeRecord {
  source?: string;
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

export interface BlogPostRecord {
  source?: string;
  blogName: string;
  title: string;
  url: string;
  publishedAt: string | null;
  author: string;
  description: string;
  content: string;
}

export interface BlogPostViewRecord extends BlogPostRecord {
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

export interface FeedSnapshotRecord<TPayload = unknown> {
  id: number;
  feedType: string;
  generatedAt: string | null;
  fetchedAt: string;
  payload: TPayload;
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
  blogPosts: number;
  newTweets: number;
  newPodcastEpisodes: number;
  newBlogPosts: number;
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

export type SummaryContentType = 'builder_feed' | 'podcast_episode' | 'blog_post';

export interface ContentSummaryRecord {
  id: number;
  contentType: SummaryContentType;
  contentKey: string;
  locale: string;
  summaryKind: string;
  summaryEn: string | null;
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
    blogsUrl: string;
  };
  summaries: {
    enabled: boolean;
    locale: string;
    summaryKind: string;
    promptVersion: string;
    tweetModel: string;
    podcastModel: string;
    blogModel: string;
    digestModel: string;
    maxTweetChars: number;
    maxPodcastChars: number;
    maxBlogChars: number;
    maxDigestChars: number;
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
  blogPosts: number;
  newBlogPosts: number;
  blogTitles: string[];
  podcastTitles: string[];
  topBuilderSummaries: string[];
}

export interface SyncResult extends SyncSummary {
  syncRunId: number;
  digestId: number;
  message: string;
  databasePath: string;
  fetchedAt: string;
}

export interface DashboardData {
  overview: DashboardOverview;
  latestSync: SyncRunRecord | null;
  latestDigest: DigestRecord | null;
  recentBuilders: BuilderFeedViewRecord[];
  recentTweets: TweetViewRecord[];
  recentPodcasts: PodcastEpisodeViewRecord[];
  recentBlogs: BlogPostViewRecord[];
  recentDigests: DigestRecord[];
  topBuilders: TopBuilderRecord[];
  recentSyncRuns: SyncRunRecord[];
}
