import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { loadConfig } from './config';
import {
  blogPostExists,
  completeSyncRun,
  getContentSummary,
  getLatestFeedSnapshot,
  insertDigest,
  podcastEpisodeExists,
  saveFeedSnapshot,
  startSyncRun,
  tweetExists,
  upsertBlogPost,
  upsertBuilder,
  upsertContentSummary,
  upsertPodcastEpisode,
  upsertTweet
} from './db';
import { sendToOpenClaw } from './openclaw';
import { sendTelegram } from './telegram';
import {
  composeDigest,
  createSourceHash,
  summarizeBlogPost,
  summarizeBuilderFeed,
  summarizePodcastEpisode
} from './summarizer';
import type {
  BlogPostRecord,
  BuilderFeedEntry,
  ContentSummaryRecord,
  DigestRecord,
  PodcastEpisodeRecord,
  SyncResult,
  SyncSummary,
  TweetRecord
} from './types';

type FeedXPayload = {
  generatedAt?: string;
  x?: Array<{
    source?: string;
    handle: string;
    name: string;
    bio?: string;
    tweets?: Array<{
      id: string;
      text: string;
      createdAt: string;
      url: string;
      likes?: number;
      retweets?: number;
      replies?: number;
      isQuote?: boolean;
      quotedTweetId?: string | null;
    }>;
  }>;
};

type FeedPodcastPayload = {
  generatedAt?: string;
  podcasts?: Array<{
    source?: string;
    videoId?: string;
    guid?: string;
    name: string;
    title: string;
    url: string;
    publishedAt: string;
    transcript?: string;
  }>;
};

type FeedBlogsPayload = {
  generatedAt?: string;
  blogs?: Array<{
    source?: string;
    name: string;
    title: string;
    url: string;
    publishedAt?: string | null;
    author?: string;
    description?: string;
    content?: string;
  }>;
};

type FeedType = 'x' | 'podcasts' | 'blogs';

type FeedLoadResult<TPayload> = {
  payload: TPayload;
  usedSnapshot: boolean;
  note: string | null;
};

function wait(ms: number) {
  return new Promise((resolvePromise) => {
    setTimeout(resolvePromise, ms);
  });
}

async function fetchJson<T>(url: string): Promise<T> {
  const attempts = 3;
  const errors: string[] = [];

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: {
          Accept: 'application/json'
        },
        signal: AbortSignal.timeout(15_000)
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      return response.json() as Promise<T>;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`第 ${attempt} 次: ${message}`);

      if (attempt < attempts) {
        await wait(attempt * 1500);
      }
    }
  }

  throw new Error(`拉取失败: ${url} (${errors.join('；')})`);
}

function formatDigestDate(value: string | null) {
  if (!value) {
    return 'unknown';
  }

  return new Date(value).toLocaleString('zh-CN', {
    hour12: false
  });
}

function formatDigestTime(value: string) {
  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Asia/Shanghai'
  }).format(new Date(value));
}

function getFeedLabel(feedType: FeedType) {
  if (feedType === 'x') {
    return 'X feed';
  }

  if (feedType === 'podcasts') {
    return 'podcast feed';
  }

  return 'blog feed';
}

export function buildSnapshotFallbackNote(feedType: FeedType, snapshotFetchedAt: string) {
  return `${getFeedLabel(feedType)} 远端拉取失败，已回退到 ${formatDigestDate(snapshotFetchedAt)} 的本地快照`;
}

export function buildSyncMessage(baseMessage: string, notes: string[]) {
  return [baseMessage, ...notes.filter(Boolean)].join('；');
}

export async function loadFeedPayload<TPayload>(params: {
  feedType: FeedType;
  url: string;
  fetchJsonImpl?: (url: string) => Promise<TPayload>;
  getLatestFeedSnapshotImpl?: (
    feedType: FeedType
  ) => Promise<{
    fetchedAt: string;
    payload: TPayload;
  } | null>;
}): Promise<FeedLoadResult<TPayload>> {
  const fetchJsonImpl = params.fetchJsonImpl ?? fetchJson<TPayload>;
  const getLatestFeedSnapshotImpl =
    params.getLatestFeedSnapshotImpl ??
    ((feedType: FeedType) => getLatestFeedSnapshot<TPayload>(feedType));

  try {
    const payload = await fetchJsonImpl(params.url);
    return {
      payload,
      usedSnapshot: false,
      note: null
    };
  } catch (error) {
    const snapshot = await getLatestFeedSnapshotImpl(params.feedType);
    if (!snapshot) {
      throw error;
    }

    const note = buildSnapshotFallbackNote(params.feedType, snapshot.fetchedAt);
    const detail = error instanceof Error ? error.message : String(error);
    console.warn(`[sync] ${note}; 原因: ${detail}`);

    return {
      payload: snapshot.payload,
      usedSnapshot: true,
      note
    };
  }
}

export function normalizeXFeed(feed: FeedXPayload): BuilderFeedEntry[] {
  return (feed.x ?? []).map((builder) => ({
    source: builder.source ?? 'x',
    handle: builder.handle,
    name: builder.name,
    bio: builder.bio ?? '',
    tweets: (builder.tweets ?? []).map((tweet): TweetRecord => ({
      id: tweet.id,
      builderHandle: builder.handle,
      builderName: builder.name,
      text: tweet.text,
      createdAt: tweet.createdAt,
      url: tweet.url,
      likes: tweet.likes ?? 0,
      retweets: tweet.retweets ?? 0,
      replies: tweet.replies ?? 0,
      isQuote: Boolean(tweet.isQuote),
      quotedTweetId: tweet.quotedTweetId ?? null
    }))
  }));
}

export function normalizePodcastFeed(feed: FeedPodcastPayload): PodcastEpisodeRecord[] {
  return (feed.podcasts ?? [])
    .filter((episode) => episode.videoId ?? episode.guid)
    .map((episode) => ({
      source: episode.source ?? 'podcast',
      videoId: (episode.videoId ?? episode.guid) as string,
      podcastName: episode.name,
      title: episode.title,
      url: episode.url,
      publishedAt: episode.publishedAt,
      transcript: episode.transcript ?? ''
    }));
}

export function normalizeBlogFeed(feed: FeedBlogsPayload): BlogPostRecord[] {
  return (feed.blogs ?? []).map((post) => ({
    source: post.source ?? 'blog',
    blogName: post.name,
    title: post.title,
    url: post.url,
    publishedAt: post.publishedAt ?? null,
    author: post.author ?? '',
    description: post.description ?? '',
    content: post.content ?? ''
  }));
}

async function saveSummaryFailure(
  existing: ContentSummaryRecord | null,
  values: {
    contentType: 'builder_feed' | 'podcast_episode' | 'blog_post';
    contentKey: string;
    locale: string;
    summaryKind: string;
    sourceHash: string;
    promptVersion: string;
    modelName: string;
    errorMessage: string;
  }
) {
  const now = new Date().toISOString();
  await upsertContentSummary({
    contentType: values.contentType,
    contentKey: values.contentKey,
    locale: values.locale,
    summaryKind: values.summaryKind,
    summaryEn: existing?.summaryEn ?? null,
    summaryZh: existing?.summaryZh ?? null,
    sourceHash: values.sourceHash,
    modelProvider: 'openai-compatible',
    modelName: values.modelName,
    promptVersion: values.promptVersion,
    status: 'failed',
    tokensIn: existing?.tokensIn ?? null,
    tokensOut: existing?.tokensOut ?? null,
    estimatedCostUsd: existing?.estimatedCostUsd ?? null,
    errorMessage: values.errorMessage,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now
  });
}

async function ensureBuilderSummary(
  config: Awaited<ReturnType<typeof loadConfig>>,
  builder: BuilderFeedEntry
) {
  const sourceHash = createSourceHash(
    'builder_feed',
    JSON.stringify({
      handle: builder.handle,
      tweets: builder.tweets.map((tweet) => ({
        id: tweet.id,
        text: tweet.text,
        url: tweet.url
      }))
    })
  );
  const existing = await getContentSummary(
    'builder_feed',
    builder.handle,
    config.summaries.locale,
    config.summaries.summaryKind
  );

  if (
    existing?.status === 'done' &&
    existing.sourceHash === sourceHash &&
    existing.summaryZh &&
    existing.promptVersion === config.summaries.promptVersion &&
    existing.modelName === config.summaries.tweetModel
  ) {
    return existing.summaryZh;
  }

  try {
    const result = await summarizeBuilderFeed(config, builder);
    const now = new Date().toISOString();
    await upsertContentSummary({
      contentType: 'builder_feed',
      contentKey: builder.handle,
      locale: config.summaries.locale,
      summaryKind: config.summaries.summaryKind,
      summaryEn: null,
      summaryZh: result.summaryZh,
      sourceHash,
      modelProvider: result.modelProvider,
      modelName: result.modelName,
      promptVersion: config.summaries.promptVersion,
      status: 'done',
      tokensIn: result.inputTokens,
      tokensOut: result.outputTokens,
      estimatedCostUsd: null,
      errorMessage: null,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now
    });
    return result.summaryZh;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await saveSummaryFailure(existing, {
      contentType: 'builder_feed',
      contentKey: builder.handle,
      locale: config.summaries.locale,
      summaryKind: config.summaries.summaryKind,
      sourceHash,
      promptVersion: config.summaries.promptVersion,
      modelName: config.summaries.tweetModel,
      errorMessage: message
    });
    return existing?.summaryZh ?? null;
  }
}

async function ensurePodcastSummary(
  config: Awaited<ReturnType<typeof loadConfig>>,
  episode: PodcastEpisodeRecord
) {
  const sourceHash = createSourceHash('podcast_episode', `${episode.title}\n${episode.transcript}`);
  const existing = await getContentSummary(
    'podcast_episode',
    episode.videoId,
    config.summaries.locale,
    config.summaries.summaryKind
  );

  if (
    existing?.status === 'done' &&
    existing.sourceHash === sourceHash &&
    existing.summaryZh &&
    existing.promptVersion === config.summaries.promptVersion &&
    existing.modelName === config.summaries.podcastModel
  ) {
    return existing.summaryZh;
  }

  try {
    const result = await summarizePodcastEpisode(config, episode);
    const now = new Date().toISOString();
    await upsertContentSummary({
      contentType: 'podcast_episode',
      contentKey: episode.videoId,
      locale: config.summaries.locale,
      summaryKind: config.summaries.summaryKind,
      summaryEn: null,
      summaryZh: result.summaryZh,
      sourceHash,
      modelProvider: result.modelProvider,
      modelName: result.modelName,
      promptVersion: config.summaries.promptVersion,
      status: 'done',
      tokensIn: result.inputTokens,
      tokensOut: result.outputTokens,
      estimatedCostUsd: null,
      errorMessage: null,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now
    });
    return result.summaryZh;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await saveSummaryFailure(existing, {
      contentType: 'podcast_episode',
      contentKey: episode.videoId,
      locale: config.summaries.locale,
      summaryKind: config.summaries.summaryKind,
      sourceHash,
      promptVersion: config.summaries.promptVersion,
      modelName: config.summaries.podcastModel,
      errorMessage: message
    });
    return existing?.summaryZh ?? null;
  }
}

async function ensureBlogSummary(config: Awaited<ReturnType<typeof loadConfig>>, post: BlogPostRecord) {
  const sourceHash = createSourceHash(
    'blog_post',
    JSON.stringify({
      title: post.title,
      url: post.url,
      content: post.content
    })
  );
  const existing = await getContentSummary(
    'blog_post',
    post.url,
    config.summaries.locale,
    config.summaries.summaryKind
  );

  if (
    existing?.status === 'done' &&
    existing.sourceHash === sourceHash &&
    existing.summaryZh &&
    existing.promptVersion === config.summaries.promptVersion &&
    existing.modelName === config.summaries.blogModel
  ) {
    return existing.summaryZh;
  }

  try {
    const result = await summarizeBlogPost(config, post);
    const now = new Date().toISOString();
    await upsertContentSummary({
      contentType: 'blog_post',
      contentKey: post.url,
      locale: config.summaries.locale,
      summaryKind: config.summaries.summaryKind,
      summaryEn: null,
      summaryZh: result.summaryZh,
      sourceHash,
      modelProvider: result.modelProvider,
      modelName: result.modelName,
      promptVersion: config.summaries.promptVersion,
      status: 'done',
      tokensIn: result.inputTokens,
      tokensOut: result.outputTokens,
      estimatedCostUsd: null,
      errorMessage: null,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now
    });
    return result.summaryZh;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await saveSummaryFailure(existing, {
      contentType: 'blog_post',
      contentKey: post.url,
      locale: config.summaries.locale,
      summaryKind: config.summaries.summaryKind,
      sourceHash,
      promptVersion: config.summaries.promptVersion,
      modelName: config.summaries.blogModel,
      errorMessage: message
    });
    return existing?.summaryZh ?? null;
  }
}

function pickFeedGeneratedAt(
  xFeed: FeedXPayload,
  podcastFeed: FeedPodcastPayload,
  blogFeed: FeedBlogsPayload
) {
  return xFeed.generatedAt ?? podcastFeed.generatedAt ?? blogFeed.generatedAt ?? null;
}

export async function runSync(options: { announce: boolean }): Promise<SyncResult> {
  const config = await loadConfig();
  const startedAt = new Date().toISOString();
  const syncRunId = await startSyncRun(startedAt);

  try {
    const fetchedAt = new Date().toISOString();
    const [xSource, podcastSource, blogSource] = await Promise.all([
      loadFeedPayload<FeedXPayload>({
        feedType: 'x',
        url: config.feeds.xUrl
      }),
      loadFeedPayload<FeedPodcastPayload>({
        feedType: 'podcasts',
        url: config.feeds.podcastsUrl
      }),
      loadFeedPayload<FeedBlogsPayload>({
        feedType: 'blogs',
        url: config.feeds.blogsUrl
      })
    ]);

    const xFeed = xSource.payload;
    const podcastFeed = podcastSource.payload;
    const blogFeed = blogSource.payload;

    if (!xSource.usedSnapshot) {
      await saveFeedSnapshot('x', xFeed.generatedAt ?? null, fetchedAt, xFeed);
    }

    if (!podcastSource.usedSnapshot) {
      await saveFeedSnapshot('podcasts', podcastFeed.generatedAt ?? null, fetchedAt, podcastFeed);
    }

    if (!blogSource.usedSnapshot) {
      await saveFeedSnapshot('blogs', blogFeed.generatedAt ?? null, fetchedAt, blogFeed);
    }

    const builders = normalizeXFeed(xFeed);
    const episodes = normalizePodcastFeed(podcastFeed);
    const blogPosts = normalizeBlogFeed(blogFeed);

    let newTweets = 0;
    let totalTweets = 0;
    let newPodcastEpisodes = 0;
    let newBlogPosts = 0;

    for (const builder of builders) {
      await upsertBuilder(builder, fetchedAt);
      for (const tweet of builder.tweets) {
        totalTweets += 1;
        const existed = await tweetExists(tweet.id);
        await upsertTweet(tweet, fetchedAt);
        if (!existed) {
          newTweets += 1;
        }
      }
    }

    for (const episode of episodes) {
      const existed = await podcastEpisodeExists(episode.videoId);
      await upsertPodcastEpisode(episode, fetchedAt);
      if (!existed) {
        newPodcastEpisodes += 1;
      }
    }

    for (const post of blogPosts) {
      const existed = await blogPostExists(post.url);
      await upsertBlogPost(post, fetchedAt);
      if (!existed) {
        newBlogPosts += 1;
      }
    }

    const builderSummaries: Array<{ title: string; summaryZh: string; url: string }> = [];
    const podcastSummaries: Array<{ title: string; summaryZh: string; url: string }> = [];
    const blogSummaries: Array<{ title: string; summaryZh: string; url: string }> = [];

    if (config.summaries.enabled) {
      const CONCURRENCY = 3;

      async function runConcurrent<T>(
        items: T[],
        fn: (item: T) => Promise<void>
      ) {
        for (let i = 0; i < items.length; i += CONCURRENCY) {
          await Promise.all(items.slice(i, i + CONCURRENCY).map(fn));
        }
      }

      await runConcurrent(builders, async (builder) => {
        const summaryZh = await ensureBuilderSummary(config, builder);
        if (summaryZh && summaryZh !== '暂无值得记录的更新。' && builder.tweets[0]) {
          builderSummaries.push({ title: builder.name, summaryZh, url: builder.tweets[0].url });
        }
      });

      await runConcurrent(episodes, async (episode) => {
        const summaryZh = await ensurePodcastSummary(config, episode);
        if (summaryZh) {
          podcastSummaries.push({
            title: `${episode.podcastName}: ${episode.title}`,
            summaryZh,
            url: episode.url
          });
        }
      });

      await runConcurrent(blogPosts, async (post) => {
        const summaryZh = await ensureBlogSummary(config, post);
        if (summaryZh) {
          blogSummaries.push({ title: `${post.blogName}: ${post.title}`, summaryZh, url: post.url });
        }
      });
    }

    const summary: SyncSummary = {
      finishedAt: new Date().toISOString(),
      feedGeneratedAt: pickFeedGeneratedAt(xFeed, podcastFeed, blogFeed),
      xBuilders: builders.length,
      totalTweets,
      newTweets,
      podcastEpisodes: episodes.length,
      newPodcastEpisodes,
      blogPosts: blogPosts.length,
      newBlogPosts,
      blogTitles: blogPosts.map((post) => `${post.blogName}: ${post.title}`),
      podcastTitles: episodes.map((episode) => `${episode.podcastName}: ${episode.title}`),
      topBuilderSummaries: builders
        .filter((builder) => builder.tweets.length > 0)
        .sort((left, right) => right.tweets.length - left.tweets.length)
        .slice(0, 5)
        .map((builder) => `${builder.name} (${builder.tweets.length})`)
    };

    const digestContent = await composeDigest(config, {
      dateLabel: summary.finishedAt.slice(0, 10),
      timeLabel: formatDigestTime(summary.finishedAt),
      topLine:
        blogSummaries.length > 0
          ? '先看官方更新，再看 builders 今天集体在讨论什么。'
          : '先看 builder 圈今天在集中讨论什么，再决定要不要点开原文。',
      feedGeneratedAt: summary.feedGeneratedAt,
      stats: {
        xBuilders: summary.xBuilders,
        totalTweets: summary.totalTweets,
        blogPosts: summary.blogPosts,
        podcastEpisodes: summary.podcastEpisodes
      },
      builders: builderSummaries,
      podcasts: podcastSummaries,
      blogs: blogSummaries
    });

    const digest: Omit<DigestRecord, 'id'> = {
      syncRunId,
      kind: 'ai-builders-digest',
      title: `AI Builders Digest ${summary.finishedAt.slice(0, 10)}`,
      content: digestContent,
      createdAt: summary.finishedAt
    };
    const digestId = await insertDigest(syncRunId, digest);

    const syncNotes = [xSource.note, podcastSource.note, blogSource.note].filter(
      (note): note is string => Boolean(note)
    );

    let message = '未推送到 OpenClaw';
    if (options.announce || config.openclaw.enabled) {
      const notifyResult = sendToOpenClaw(config, digestContent);
      message = notifyResult.skipped ? notifyResult.reason : '已通过 OpenClaw 推送 digest';

      const latestAnnouncementPath = resolve(config.rootDir, 'data', 'latest-announcement.txt');
      await mkdir(resolve(config.rootDir, 'data'), { recursive: true });
      await writeFile(latestAnnouncementPath, digestContent, 'utf-8');
    }

    await sendTelegram(digestContent);
    message = buildSyncMessage(message, syncNotes);

    await completeSyncRun(syncRunId, {
      finishedAt: summary.finishedAt,
      status: 'success',
      feedGeneratedAt: summary.feedGeneratedAt,
      xBuilders: summary.xBuilders,
      totalTweets: summary.totalTweets,
      podcastEpisodes: summary.podcastEpisodes,
      blogPosts: summary.blogPosts,
      newTweets: summary.newTweets,
      newPodcastEpisodes: summary.newPodcastEpisodes,
      newBlogPosts: summary.newBlogPosts,
      message,
      digestId
    });

    return {
      ...summary,
      syncRunId,
      digestId,
      message,
      databasePath: config.databasePath,
      fetchedAt
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await completeSyncRun(syncRunId, {
      finishedAt: new Date().toISOString(),
      status: 'failed',
      feedGeneratedAt: null,
      xBuilders: 0,
      totalTweets: 0,
      podcastEpisodes: 0,
      blogPosts: 0,
      newTweets: 0,
      newPodcastEpisodes: 0,
      newBlogPosts: 0,
      message,
      digestId: null
    });
    throw error;
  }
}
