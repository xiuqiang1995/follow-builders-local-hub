import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';

import { loadConfig } from './config';
import type {
  BlogPostRecord,
  BlogPostViewRecord,
  BuilderFeedEntry,
  BuilderFeedViewRecord,
  ContentSummaryRecord,
  DashboardData,
  DashboardOverview,
  DigestRecord,
  FeedSnapshotRecord,
  PodcastEpisodeRecord,
  PodcastEpisodeViewRecord,
  SummaryContentType,
  SyncRunRecord,
  TopBuilderRecord,
  TweetRecord,
  TweetViewRecord
} from './types';

type DatabaseSync = Database.Database;

type SyncRunUpdate = {
  finishedAt: string;
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
};

type SummaryRow = {
  summaryZh: string | null;
  summaryStatus: string | null;
  summaryUpdatedAt: string | null;
};

const HIDDEN_SUMMARY_TEXT = '暂无值得记录的更新。';

function sanitizeUserVisibleSummary<T extends SummaryRow>(summary: T | undefined) {
  if (!summary) {
    return {
      summaryZh: null,
      summaryStatus: null,
      summaryUpdatedAt: null
    };
  }

  if (summary.summaryZh?.trim() === HIDDEN_SUMMARY_TEXT) {
    return {
      ...summary,
      summaryZh: null
    };
  }

  return summary;
}

declare global {
  var __followBuildersDb: DatabaseSync | undefined;
}

function hasColumn(db: DatabaseSync, table: string, column: string) {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return rows.some((row) => row.name === column);
}

function ensureColumn(db: DatabaseSync, table: string, column: string, definition: string) {
  if (!hasColumn(db, table, column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition};`);
  }
}

function initSchema(db: DatabaseSync) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sync_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      status TEXT NOT NULL,
      feed_generated_at TEXT,
      x_builders INTEGER DEFAULT 0,
      total_tweets INTEGER DEFAULT 0,
      podcast_episodes INTEGER DEFAULT 0,
      blog_posts INTEGER DEFAULT 0,
      new_tweets INTEGER DEFAULT 0,
      new_podcast_episodes INTEGER DEFAULT 0,
      new_blog_posts INTEGER DEFAULT 0,
      message TEXT,
      digest_id INTEGER
    );

    CREATE TABLE IF NOT EXISTS feed_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      feed_type TEXT NOT NULL,
      generated_at TEXT,
      fetched_at TEXT NOT NULL,
      payload TEXT NOT NULL,
      UNIQUE(feed_type, generated_at)
    );

    CREATE TABLE IF NOT EXISTS builders (
      handle TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      bio TEXT,
      first_seen_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tweets (
      id TEXT PRIMARY KEY,
      builder_handle TEXT NOT NULL,
      builder_name TEXT NOT NULL,
      text TEXT NOT NULL,
      created_at TEXT NOT NULL,
      url TEXT NOT NULL,
      likes INTEGER DEFAULT 0,
      retweets INTEGER DEFAULT 0,
      replies INTEGER DEFAULT 0,
      is_quote INTEGER DEFAULT 0,
      quoted_tweet_id TEXT,
      first_seen_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      FOREIGN KEY (builder_handle) REFERENCES builders(handle)
    );

    CREATE INDEX IF NOT EXISTS idx_tweets_created_at ON tweets(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_tweets_builder_handle ON tweets(builder_handle);

    CREATE TABLE IF NOT EXISTS podcast_episodes (
      video_id TEXT PRIMARY KEY,
      podcast_name TEXT NOT NULL,
      title TEXT NOT NULL,
      url TEXT NOT NULL,
      published_at TEXT NOT NULL,
      transcript TEXT NOT NULL,
      first_seen_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_podcast_episodes_published_at
      ON podcast_episodes(published_at DESC);

    CREATE TABLE IF NOT EXISTS blog_posts (
      url TEXT PRIMARY KEY,
      blog_name TEXT NOT NULL,
      title TEXT NOT NULL,
      published_at TEXT,
      author TEXT NOT NULL,
      description TEXT NOT NULL,
      content TEXT NOT NULL,
      first_seen_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_blog_posts_published_at
      ON blog_posts(published_at DESC);

    CREATE TABLE IF NOT EXISTS digests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sync_run_id INTEGER,
      kind TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (sync_run_id) REFERENCES sync_runs(id)
    );

    CREATE TABLE IF NOT EXISTS content_summaries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      content_type TEXT NOT NULL,
      content_key TEXT NOT NULL,
      locale TEXT NOT NULL,
      summary_kind TEXT NOT NULL,
      summary_en TEXT,
      summary_zh TEXT,
      source_hash TEXT NOT NULL,
      model_provider TEXT,
      model_name TEXT,
      prompt_version TEXT,
      status TEXT NOT NULL,
      tokens_in INTEGER,
      tokens_out INTEGER,
      estimated_cost_usd REAL,
      error_message TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(content_type, content_key, locale, summary_kind)
    );

    CREATE INDEX IF NOT EXISTS idx_content_summaries_lookup
      ON content_summaries(content_type, content_key, locale, summary_kind);
  `);

  ensureColumn(db, 'sync_runs', 'blog_posts', 'INTEGER DEFAULT 0');
  ensureColumn(db, 'sync_runs', 'new_blog_posts', 'INTEGER DEFAULT 0');
  ensureColumn(db, 'content_summaries', 'summary_en', 'TEXT');
}

export async function getDatabase(): Promise<DatabaseSync> {
  if (!globalThis.__followBuildersDb) {
    const config = await loadConfig();
    mkdirSync(dirname(config.databasePath), { recursive: true });
    const db = new Database(config.databasePath);
    db.exec('PRAGMA foreign_keys = ON;');
    initSchema(db);
    globalThis.__followBuildersDb = db;
  }

  return globalThis.__followBuildersDb as DatabaseSync;
}

export async function startSyncRun(startedAt: string) {
  const db = await getDatabase();
  const result = db.prepare(`
    INSERT INTO sync_runs (started_at, status)
    VALUES (?, ?)
  `).run(startedAt, 'running');

  return Number(result.lastInsertRowid);
}

export async function completeSyncRun(syncRunId: number, values: SyncRunUpdate) {
  const db = await getDatabase();
  db.prepare(`
    UPDATE sync_runs
    SET
      finished_at = ?,
      status = ?,
      feed_generated_at = ?,
      x_builders = ?,
      total_tweets = ?,
      podcast_episodes = ?,
      blog_posts = ?,
      new_tweets = ?,
      new_podcast_episodes = ?,
      new_blog_posts = ?,
      message = ?,
      digest_id = ?
    WHERE id = ?
  `).run(
    values.finishedAt,
    values.status,
    values.feedGeneratedAt,
    values.xBuilders,
    values.totalTweets,
    values.podcastEpisodes,
    values.blogPosts,
    values.newTweets,
    values.newPodcastEpisodes,
    values.newBlogPosts,
    values.message,
    values.digestId,
    syncRunId
  );
}

export async function saveFeedSnapshot(
  feedType: string,
  generatedAt: string | null,
  fetchedAt: string,
  payload: unknown
) {
  const db = await getDatabase();
  db.prepare(`
    INSERT INTO feed_snapshots (feed_type, generated_at, fetched_at, payload)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(feed_type, generated_at) DO UPDATE SET
      fetched_at = excluded.fetched_at,
      payload = excluded.payload
  `).run(feedType, generatedAt, fetchedAt, JSON.stringify(payload));
}

export async function getLatestFeedSnapshot<TPayload = unknown>(
  feedType: string
): Promise<FeedSnapshotRecord<TPayload> | null> {
  const db = await getDatabase();
  const row = db.prepare(`
    SELECT
      id,
      feed_type AS feedType,
      generated_at AS generatedAt,
      fetched_at AS fetchedAt,
      payload
    FROM feed_snapshots
    WHERE feed_type = ?
    ORDER BY datetime(fetched_at) DESC, id DESC
    LIMIT 1
  `).get(feedType) as
    | (Omit<FeedSnapshotRecord<TPayload>, 'payload'> & {
        payload: string;
      })
    | undefined;

  if (!row) {
    return null;
  }

  return {
    ...row,
    payload: JSON.parse(row.payload) as TPayload
  };
}

export async function upsertBuilder(builder: BuilderFeedEntry, seenAt: string) {
  const db = await getDatabase();
  db.prepare(`
    INSERT INTO builders (handle, name, bio, first_seen_at, last_seen_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(handle) DO UPDATE SET
      name = excluded.name,
      bio = excluded.bio,
      last_seen_at = excluded.last_seen_at
  `).run(builder.handle, builder.name, builder.bio, seenAt, seenAt);
}

export async function tweetExists(tweetId: string) {
  const db = await getDatabase();
  return Boolean(db.prepare('SELECT 1 FROM tweets WHERE id = ?').get(tweetId));
}

export async function upsertTweet(tweet: TweetRecord, seenAt: string) {
  const db = await getDatabase();
  db.prepare(`
    INSERT INTO tweets (
      id,
      builder_handle,
      builder_name,
      text,
      created_at,
      url,
      likes,
      retweets,
      replies,
      is_quote,
      quoted_tweet_id,
      first_seen_at,
      last_seen_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      builder_handle = excluded.builder_handle,
      builder_name = excluded.builder_name,
      text = excluded.text,
      created_at = excluded.created_at,
      url = excluded.url,
      likes = excluded.likes,
      retweets = excluded.retweets,
      replies = excluded.replies,
      is_quote = excluded.is_quote,
      quoted_tweet_id = excluded.quoted_tweet_id,
      last_seen_at = excluded.last_seen_at
  `).run(
    tweet.id,
    tweet.builderHandle,
    tweet.builderName,
    tweet.text,
    tweet.createdAt,
    tweet.url,
    tweet.likes,
    tweet.retweets,
    tweet.replies,
    tweet.isQuote ? 1 : 0,
    tweet.quotedTweetId,
    seenAt,
    seenAt
  );
}

export async function podcastEpisodeExists(videoId: string) {
  const db = await getDatabase();
  return Boolean(db.prepare('SELECT 1 FROM podcast_episodes WHERE video_id = ?').get(videoId));
}

export async function upsertPodcastEpisode(episode: PodcastEpisodeRecord, seenAt: string) {
  const db = await getDatabase();
  db.prepare(`
    INSERT INTO podcast_episodes (
      video_id,
      podcast_name,
      title,
      url,
      published_at,
      transcript,
      first_seen_at,
      last_seen_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(video_id) DO UPDATE SET
      podcast_name = excluded.podcast_name,
      title = excluded.title,
      url = excluded.url,
      published_at = excluded.published_at,
      transcript = excluded.transcript,
      last_seen_at = excluded.last_seen_at
  `).run(
    episode.videoId,
    episode.podcastName,
    episode.title,
    episode.url,
    episode.publishedAt,
    episode.transcript,
    seenAt,
    seenAt
  );
}

export async function blogPostExists(url: string) {
  const db = await getDatabase();
  return Boolean(db.prepare('SELECT 1 FROM blog_posts WHERE url = ?').get(url));
}

export async function upsertBlogPost(post: BlogPostRecord, seenAt: string) {
  const db = await getDatabase();
  db.prepare(`
    INSERT INTO blog_posts (
      url,
      blog_name,
      title,
      published_at,
      author,
      description,
      content,
      first_seen_at,
      last_seen_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(url) DO UPDATE SET
      blog_name = excluded.blog_name,
      title = excluded.title,
      published_at = excluded.published_at,
      author = excluded.author,
      description = excluded.description,
      content = excluded.content,
      last_seen_at = excluded.last_seen_at
  `).run(
    post.url,
    post.blogName,
    post.title,
    post.publishedAt,
    post.author,
    post.description,
    post.content,
    seenAt,
    seenAt
  );
}

export async function insertDigest(syncRunId: number, digest: Omit<DigestRecord, 'id'>) {
  const db = await getDatabase();
  const result = db.prepare(`
    INSERT INTO digests (sync_run_id, kind, title, content, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(syncRunId, digest.kind, digest.title, digest.content, digest.createdAt);

  return Number(result.lastInsertRowid);
}

export async function getContentSummary(
  contentType: SummaryContentType,
  contentKey: string,
  locale: string,
  summaryKind: string
): Promise<ContentSummaryRecord | null> {
  const db = await getDatabase();
  return (
    (db.prepare(`
      SELECT
        id,
        content_type AS contentType,
        content_key AS contentKey,
        locale,
        summary_kind AS summaryKind,
        summary_en AS summaryEn,
        summary_zh AS summaryZh,
        source_hash AS sourceHash,
        model_provider AS modelProvider,
        model_name AS modelName,
        prompt_version AS promptVersion,
        status,
        tokens_in AS tokensIn,
        tokens_out AS tokensOut,
        estimated_cost_usd AS estimatedCostUsd,
        error_message AS errorMessage,
        created_at AS createdAt,
        updated_at AS updatedAt
      FROM content_summaries
      WHERE content_type = ? AND content_key = ? AND locale = ? AND summary_kind = ?
      LIMIT 1
    `).get(contentType, contentKey, locale, summaryKind) as ContentSummaryRecord | undefined) ?? null
  );
}

export async function upsertContentSummary(summary: Omit<ContentSummaryRecord, 'id'>): Promise<void> {
  const db = await getDatabase();
  db.prepare(`
    INSERT INTO content_summaries (
      content_type,
      content_key,
      locale,
      summary_kind,
      summary_en,
      summary_zh,
      source_hash,
      model_provider,
      model_name,
      prompt_version,
      status,
      tokens_in,
      tokens_out,
      estimated_cost_usd,
      error_message,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(content_type, content_key, locale, summary_kind) DO UPDATE SET
      summary_en = excluded.summary_en,
      summary_zh = excluded.summary_zh,
      source_hash = excluded.source_hash,
      model_provider = excluded.model_provider,
      model_name = excluded.model_name,
      prompt_version = excluded.prompt_version,
      status = excluded.status,
      tokens_in = excluded.tokens_in,
      tokens_out = excluded.tokens_out,
      estimated_cost_usd = excluded.estimated_cost_usd,
      error_message = excluded.error_message,
      updated_at = excluded.updated_at
  `).run(
    summary.contentType,
    summary.contentKey,
    summary.locale,
    summary.summaryKind,
    summary.summaryEn,
    summary.summaryZh,
    summary.sourceHash,
    summary.modelProvider,
    summary.modelName,
    summary.promptVersion,
    summary.status,
    summary.tokensIn,
    summary.tokensOut,
    summary.estimatedCostUsd,
    summary.errorMessage,
    summary.createdAt,
    summary.updatedAt
  );
}

export async function getOverview(): Promise<DashboardOverview> {
  const db = await getDatabase();
  return db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM builders) AS builders,
      (SELECT COUNT(*) FROM tweets) AS tweets,
      (SELECT COUNT(*) FROM podcast_episodes) AS podcastEpisodes,
      (SELECT COUNT(*) FROM blog_posts) AS blogPosts,
      (SELECT COUNT(*) FROM digests) AS digests,
      (SELECT COUNT(*) FROM content_summaries WHERE status = 'done') AS summaries,
      (SELECT COUNT(*) FROM sync_runs) AS syncRuns
  `).get() as unknown as DashboardOverview;
}

export async function getLatestSyncRun(): Promise<SyncRunRecord | null> {
  const db = await getDatabase();
  return (
    (db.prepare(`
      SELECT
        id,
        started_at AS startedAt,
        finished_at AS finishedAt,
        status,
        feed_generated_at AS feedGeneratedAt,
        x_builders AS xBuilders,
        total_tweets AS totalTweets,
        podcast_episodes AS podcastEpisodes,
        blog_posts AS blogPosts,
        new_tweets AS newTweets,
        new_podcast_episodes AS newPodcastEpisodes,
        new_blog_posts AS newBlogPosts,
        message,
        digest_id AS digestId
      FROM sync_runs
      ORDER BY id DESC
      LIMIT 1
    `).get() as SyncRunRecord | undefined) ?? null
  );
}

export async function getLatestDigest(): Promise<DigestRecord | null> {
  const db = await getDatabase();
  return (
    (db.prepare(`
      SELECT
        id,
        sync_run_id AS syncRunId,
        kind,
        title,
        content,
        created_at AS createdAt
      FROM digests
      ORDER BY id DESC
      LIMIT 1
    `).get() as DigestRecord | undefined) ?? null
  );
}

export async function getRecentDigests(limit = 10): Promise<DigestRecord[]> {
  const db = await getDatabase();
  return db.prepare(`
    SELECT
      id,
      sync_run_id AS syncRunId,
      kind,
      title,
      content,
      created_at AS createdAt
    FROM digests
    ORDER BY id DESC
    LIMIT ?
  `).all(limit) as unknown as DigestRecord[];
}

function normalizeTweetRows(rows: Array<Omit<TweetViewRecord, 'isQuote'> & { isQuote: number }>) {
  return rows.map((row) => ({
    ...row,
    builderSummaryZh:
      row.builderSummaryZh?.trim() === HIDDEN_SUMMARY_TEXT ? null : row.builderSummaryZh,
    isQuote: Boolean(row.isQuote)
  }));
}

export async function getRecentTweets(limit = 50, handle = ''): Promise<TweetViewRecord[]> {
  const db = await getDatabase();
  const config = await loadConfig();
  const rows = handle
    ? db.prepare(`
        SELECT
          tweets.id AS id,
          tweets.builder_handle AS builderHandle,
          tweets.builder_name AS builderName,
          tweets.text AS text,
          tweets.created_at AS createdAt,
          tweets.url AS url,
          tweets.likes AS likes,
          tweets.retweets AS retweets,
          tweets.replies AS replies,
          tweets.is_quote AS isQuote,
          tweets.quoted_tweet_id AS quotedTweetId,
          summary.summary_zh AS builderSummaryZh,
          summary.status AS builderSummaryStatus,
          summary.updated_at AS builderSummaryUpdatedAt
        FROM tweets
        LEFT JOIN content_summaries AS summary
          ON summary.content_type = 'builder_feed'
          AND summary.content_key = tweets.builder_handle
          AND summary.locale = ?
          AND summary.summary_kind = ?
        WHERE tweets.builder_handle = ?
        ORDER BY datetime(tweets.created_at) DESC
        LIMIT ?
      `).all(config.summaries.locale, config.summaries.summaryKind, handle, limit)
    : db.prepare(`
        SELECT
          tweets.id AS id,
          tweets.builder_handle AS builderHandle,
          tweets.builder_name AS builderName,
          tweets.text AS text,
          tweets.created_at AS createdAt,
          tweets.url AS url,
          tweets.likes AS likes,
          tweets.retweets AS retweets,
          tweets.replies AS replies,
          tweets.is_quote AS isQuote,
          tweets.quoted_tweet_id AS quotedTweetId,
          summary.summary_zh AS builderSummaryZh,
          summary.status AS builderSummaryStatus,
          summary.updated_at AS builderSummaryUpdatedAt
        FROM tweets
        LEFT JOIN content_summaries AS summary
          ON summary.content_type = 'builder_feed'
          AND summary.content_key = tweets.builder_handle
          AND summary.locale = ?
          AND summary.summary_kind = ?
        ORDER BY datetime(tweets.created_at) DESC
        LIMIT ?
      `).all(config.summaries.locale, config.summaries.summaryKind, limit);

  return normalizeTweetRows(
    rows as Array<Omit<TweetViewRecord, 'isQuote'> & { isQuote: number }>
  ) as TweetViewRecord[];
}

async function getBuilderSummaryMap(handles: string[]) {
  if (handles.length === 0) {
    return new Map<string, SummaryRow>();
  }

  const db = await getDatabase();
  const config = await loadConfig();
  const placeholders = handles.map(() => '?').join(', ');
  const rows = db.prepare(`
    SELECT
      content_key AS contentKey,
      summary_zh AS summaryZh,
      status AS summaryStatus,
      updated_at AS summaryUpdatedAt
    FROM content_summaries
    WHERE content_type = 'builder_feed'
      AND locale = ?
      AND summary_kind = ?
      AND content_key IN (${placeholders})
  `).all(config.summaries.locale, config.summaries.summaryKind, ...handles) as Array<
    SummaryRow & { contentKey: string }
  >;

  return new Map(rows.map((row) => [row.contentKey, row]));
}

async function getTweetsByBuilderHandles(handles: string[]) {
  if (handles.length === 0) {
    return new Map<string, TweetRecord[]>();
  }

  const db = await getDatabase();
  const placeholders = handles.map(() => '?').join(', ');
  const rows = db.prepare(`
    SELECT
      id,
      builder_handle AS builderHandle,
      builder_name AS builderName,
      text,
      created_at AS createdAt,
      url,
      likes,
      retweets,
      replies,
      is_quote AS isQuote,
      quoted_tweet_id AS quotedTweetId
    FROM tweets
    WHERE builder_handle IN (${placeholders})
    ORDER BY datetime(created_at) DESC
  `).all(...handles) as Array<Omit<TweetRecord, 'isQuote'> & { isQuote: number }>;

  const grouped = new Map<string, TweetRecord[]>();
  for (const row of rows) {
    const tweets = grouped.get(row.builderHandle) ?? [];
    tweets.push({
      ...row,
      isQuote: Boolean(row.isQuote)
    });
    grouped.set(row.builderHandle, tweets);
  }

  return grouped;
}

async function loadBuilderFeedsByHandles(handles: string[]): Promise<BuilderFeedViewRecord[]> {
  if (handles.length === 0) {
    return [];
  }

  const db = await getDatabase();
  const placeholders = handles.map(() => '?').join(', ');
  const summaryMap = await getBuilderSummaryMap(handles);
  const tweetMap = await getTweetsByBuilderHandles(handles);
  const rows = db.prepare(`
    SELECT
      builders.handle AS handle,
      builders.name AS name,
      builders.bio AS bio,
      COUNT(tweets.id) AS tweetCount,
      MAX(tweets.created_at) AS latestTweetAt
    FROM builders
    JOIN tweets ON tweets.builder_handle = builders.handle
    WHERE builders.handle IN (${placeholders})
    GROUP BY builders.handle, builders.name, builders.bio
    ORDER BY datetime(latestTweetAt) DESC
  `).all(...handles) as Array<{
    handle: string;
    name: string;
    bio: string;
    tweetCount: number;
    latestTweetAt: string;
  }>;

  return rows.map((row) => {
    const summary = sanitizeUserVisibleSummary(summaryMap.get(row.handle));
    return {
      ...row,
      tweets: tweetMap.get(row.handle) ?? [],
      summaryZh: summary?.summaryZh ?? null,
      summaryStatus: (summary?.summaryStatus as BuilderFeedViewRecord['summaryStatus']) ?? null,
      summaryUpdatedAt: summary?.summaryUpdatedAt ?? null
    };
  });
}

export async function getRecentBuilderFeeds(limit = 20): Promise<BuilderFeedViewRecord[]> {
  const db = await getDatabase();
  const rows = db.prepare(`
    SELECT
      builder_handle AS handle,
      MAX(created_at) AS latestTweetAt
    FROM tweets
    GROUP BY builder_handle
    ORDER BY datetime(latestTweetAt) DESC
    LIMIT ?
  `).all(limit) as Array<{ handle: string }>;

  return loadBuilderFeedsByHandles(rows.map((row) => row.handle));
}

export async function getBuilderFeedsSeenAt(
  seenAt: string,
  limit = 20
): Promise<BuilderFeedViewRecord[]> {
  const db = await getDatabase();
  const rows = db.prepare(`
    SELECT
      builder_handle AS handle,
      MAX(created_at) AS latestTweetAt
    FROM tweets
    WHERE last_seen_at = ?
    GROUP BY builder_handle
    ORDER BY datetime(latestTweetAt) DESC
    LIMIT ?
  `).all(seenAt, limit) as Array<{ handle: string }>;

  return loadBuilderFeedsByHandles(rows.map((row) => row.handle));
}

export async function getRecentPodcastEpisodes(limit = 20): Promise<PodcastEpisodeViewRecord[]> {
  const db = await getDatabase();
  const config = await loadConfig();
  return db.prepare(`
    SELECT
      video_id AS videoId,
      podcast_name AS podcastName,
      title,
      url,
      published_at AS publishedAt,
      transcript,
      summary.summary_zh AS summaryZh,
      summary.status AS summaryStatus,
      summary.updated_at AS summaryUpdatedAt
    FROM podcast_episodes
    LEFT JOIN content_summaries AS summary
      ON summary.content_type = 'podcast_episode'
      AND summary.content_key = podcast_episodes.video_id
      AND summary.locale = ?
      AND summary.summary_kind = ?
    ORDER BY datetime(published_at) DESC
    LIMIT ?
  `).all(
    config.summaries.locale,
    config.summaries.summaryKind,
    limit
  ) as unknown as PodcastEpisodeViewRecord[];
}

export async function getRecentBlogPosts(limit = 20): Promise<BlogPostViewRecord[]> {
  const db = await getDatabase();
  const config = await loadConfig();
  return db.prepare(`
    SELECT
      blog_name AS blogName,
      title,
      url,
      published_at AS publishedAt,
      author,
      description,
      content,
      summary.summary_zh AS summaryZh,
      summary.status AS summaryStatus,
      summary.updated_at AS summaryUpdatedAt
    FROM blog_posts
    LEFT JOIN content_summaries AS summary
      ON summary.content_type = 'blog_post'
      AND summary.content_key = blog_posts.url
      AND summary.locale = ?
      AND summary.summary_kind = ?
    ORDER BY datetime(COALESCE(published_at, first_seen_at)) DESC
    LIMIT ?
  `).all(
    config.summaries.locale,
    config.summaries.summaryKind,
    limit
  ) as unknown as BlogPostViewRecord[];
}

export async function getTweetsSeenAt(seenAt: string, limit = 200): Promise<TweetViewRecord[]> {
  const db = await getDatabase();
  const config = await loadConfig();
  const rows = db.prepare(`
    SELECT
      tweets.id AS id,
      tweets.builder_handle AS builderHandle,
      tweets.builder_name AS builderName,
      tweets.text AS text,
      tweets.created_at AS createdAt,
      tweets.url AS url,
      tweets.likes AS likes,
      tweets.retweets AS retweets,
      tweets.replies AS replies,
      tweets.is_quote AS isQuote,
      tweets.quoted_tweet_id AS quotedTweetId,
      summary.summary_zh AS builderSummaryZh,
      summary.status AS builderSummaryStatus,
      summary.updated_at AS builderSummaryUpdatedAt
    FROM tweets
    LEFT JOIN content_summaries AS summary
      ON summary.content_type = 'builder_feed'
      AND summary.content_key = tweets.builder_handle
      AND summary.locale = ?
      AND summary.summary_kind = ?
    WHERE tweets.last_seen_at = ?
    ORDER BY datetime(tweets.created_at) ASC
    LIMIT ?
  `).all(
    config.summaries.locale,
    config.summaries.summaryKind,
    seenAt,
    limit
  );

  return normalizeTweetRows(
    rows as Array<Omit<TweetViewRecord, 'isQuote'> & { isQuote: number }>
  ) as TweetViewRecord[];
}

export async function getPodcastEpisodesSeenAt(
  seenAt: string,
  limit = 50
): Promise<PodcastEpisodeViewRecord[]> {
  const db = await getDatabase();
  const config = await loadConfig();
  return db.prepare(`
    SELECT
      video_id AS videoId,
      podcast_name AS podcastName,
      title,
      url,
      published_at AS publishedAt,
      transcript,
      summary.summary_zh AS summaryZh,
      summary.status AS summaryStatus,
      summary.updated_at AS summaryUpdatedAt
    FROM podcast_episodes
    LEFT JOIN content_summaries AS summary
      ON summary.content_type = 'podcast_episode'
      AND summary.content_key = podcast_episodes.video_id
      AND summary.locale = ?
      AND summary.summary_kind = ?
    WHERE podcast_episodes.last_seen_at = ?
    ORDER BY datetime(published_at) ASC
    LIMIT ?
  `).all(
    config.summaries.locale,
    config.summaries.summaryKind,
    seenAt,
    limit
  ) as unknown as PodcastEpisodeViewRecord[];
}

export async function getBlogPostsSeenAt(seenAt: string, limit = 50): Promise<BlogPostViewRecord[]> {
  const db = await getDatabase();
  const config = await loadConfig();
  return db.prepare(`
    SELECT
      blog_name AS blogName,
      title,
      url,
      published_at AS publishedAt,
      author,
      description,
      content,
      summary.summary_zh AS summaryZh,
      summary.status AS summaryStatus,
      summary.updated_at AS summaryUpdatedAt
    FROM blog_posts
    LEFT JOIN content_summaries AS summary
      ON summary.content_type = 'blog_post'
      AND summary.content_key = blog_posts.url
      AND summary.locale = ?
      AND summary.summary_kind = ?
    WHERE blog_posts.last_seen_at = ?
    ORDER BY datetime(COALESCE(published_at, first_seen_at)) ASC
    LIMIT ?
  `).all(
    config.summaries.locale,
    config.summaries.summaryKind,
    seenAt,
    limit
  ) as unknown as BlogPostViewRecord[];
}

export async function getTopBuilders(limit = 10): Promise<TopBuilderRecord[]> {
  const db = await getDatabase();
  return db.prepare(`
    SELECT
      builder_handle AS handle,
      builder_name AS name,
      COUNT(*) AS tweetCount,
      MAX(created_at) AS lastTweetAt
    FROM tweets
    GROUP BY builder_handle, builder_name
    ORDER BY tweetCount DESC, datetime(lastTweetAt) DESC
    LIMIT ?
  `).all(limit) as unknown as TopBuilderRecord[];
}

export async function getRecentSyncRuns(limit = 10): Promise<SyncRunRecord[]> {
  const db = await getDatabase();
  return db.prepare(`
    SELECT
      id,
      started_at AS startedAt,
      finished_at AS finishedAt,
      status,
      feed_generated_at AS feedGeneratedAt,
      x_builders AS xBuilders,
      total_tweets AS totalTweets,
      podcast_episodes AS podcastEpisodes,
      blog_posts AS blogPosts,
      new_tweets AS newTweets,
      new_podcast_episodes AS newPodcastEpisodes,
      new_blog_posts AS newBlogPosts,
      message,
      digest_id AS digestId
    FROM sync_runs
    ORDER BY id DESC
    LIMIT ?
  `).all(limit) as unknown as SyncRunRecord[];
}

export async function getDashboardData(): Promise<DashboardData> {
  const [
    overview,
    latestSync,
    latestDigest,
    recentBuilders,
    recentTweets,
    recentPodcasts,
    recentBlogs,
    recentDigests,
    topBuilders,
    recentSyncRuns
  ] = await Promise.all([
    getOverview(),
    getLatestSyncRun(),
    getLatestDigest(),
    getRecentBuilderFeeds(18),
    getRecentTweets(40),
    getRecentPodcastEpisodes(12),
    getRecentBlogPosts(12),
    getRecentDigests(12),
    getTopBuilders(12),
    getRecentSyncRuns(12)
  ]);

  return {
    overview,
    latestSync,
    latestDigest,
    recentBuilders,
    recentTweets,
    recentPodcasts,
    recentBlogs,
    recentDigests,
    topBuilders,
    recentSyncRuns
  };
}
