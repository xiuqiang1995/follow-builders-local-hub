import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { loadConfig } from './config';
import {
  completeSyncRun,
  getContentSummary,
  insertDigest,
  podcastEpisodeExists,
  saveFeedSnapshot,
  startSyncRun,
  tweetExists,
  upsertContentSummary,
  upsertBuilder,
  upsertPodcastEpisode,
  upsertTweet
} from './db';
import { buildAnnouncement, sendToOpenClaw } from './openclaw';
import { createSourceHash, summarizePodcastEpisode, summarizeTweet } from './summarizer';
import type {
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
    videoId: string;
    name: string;
    title: string;
    url: string;
    publishedAt: string;
    transcript?: string;
  }>;
};

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    headers: {
      Accept: 'application/json'
    }
  });

  if (!response.ok) {
    throw new Error(`拉取失败: ${url} (${response.status})`);
  }

  return response.json() as Promise<T>;
}

export function normalizeXFeed(feed: FeedXPayload): BuilderFeedEntry[] {
  return (feed.x ?? []).map((builder) => ({
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
  return (feed.podcasts ?? []).map((episode) => ({
    videoId: episode.videoId,
    podcastName: episode.name,
    title: episode.title,
    url: episode.url,
    publishedAt: episode.publishedAt,
    transcript: episode.transcript ?? ''
  }));
}

function formatDigestDate(value: string | null) {
  if (!value) {
    return 'unknown';
  }

  return new Date(value).toLocaleString('zh-CN', {
    hour12: false
  });
}

export function buildDigestContent(summary: SyncSummary) {
  const lines = [
    '# Follow Builders Digest',
    '',
    `- 同步完成: ${formatDigestDate(summary.finishedAt)}`,
    `- Feed 时间: ${formatDigestDate(summary.feedGeneratedAt)}`,
    `- X builders: ${summary.xBuilders}`,
    `- 总 tweets: ${summary.totalTweets}`,
    `- 新增 tweets: ${summary.newTweets}`,
    `- podcast episodes: ${summary.podcastEpisodes}`,
    `- 新增 podcast episodes: ${summary.newPodcastEpisodes}`,
    ''
  ];

  if (summary.podcastTitles.length > 0) {
    lines.push('## 本次播客');
    for (const title of summary.podcastTitles) {
      lines.push(`- ${title}`);
    }
    lines.push('');
  }

  if (summary.topBuilderSummaries.length > 0) {
    lines.push('## 本次活跃 Builders');
    for (const item of summary.topBuilderSummaries) {
      lines.push(`- ${item}`);
    }
  }

  return lines.join('\n').trim();
}

async function saveSummaryFailure(
  existing: ContentSummaryRecord | null,
  values: {
    contentType: 'tweet' | 'podcast_episode';
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

async function ensureTweetSummary(config: Awaited<ReturnType<typeof loadConfig>>, tweet: TweetRecord) {
  const sourceHash = createSourceHash('tweet', tweet.text);
  const existing = await getContentSummary(
    'tweet',
    tweet.id,
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
    return;
  }

  try {
    const result = await summarizeTweet(config, tweet);
    const now = new Date().toISOString();
    await upsertContentSummary({
      contentType: 'tweet',
      contentKey: tweet.id,
      locale: config.summaries.locale,
      summaryKind: config.summaries.summaryKind,
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
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await saveSummaryFailure(existing, {
      contentType: 'tweet',
      contentKey: tweet.id,
      locale: config.summaries.locale,
      summaryKind: config.summaries.summaryKind,
      sourceHash,
      promptVersion: config.summaries.promptVersion,
      modelName: config.summaries.tweetModel,
      errorMessage: message
    });
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
    return;
  }

  try {
    const result = await summarizePodcastEpisode(config, episode);
    const now = new Date().toISOString();
    await upsertContentSummary({
      contentType: 'podcast_episode',
      contentKey: episode.videoId,
      locale: config.summaries.locale,
      summaryKind: config.summaries.summaryKind,
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
  }
}

export async function runSync(options: { announce: boolean }): Promise<SyncResult> {
  const config = await loadConfig();
  const startedAt = new Date().toISOString();
  const syncRunId = await startSyncRun(startedAt);

  try {
    const fetchedAt = new Date().toISOString();
    const [xFeed, podcastFeed] = await Promise.all([
      fetchJson<FeedXPayload>(config.feeds.xUrl),
      fetchJson<FeedPodcastPayload>(config.feeds.podcastsUrl)
    ]);

    await saveFeedSnapshot('x', xFeed.generatedAt ?? null, fetchedAt, xFeed);
    await saveFeedSnapshot('podcasts', podcastFeed.generatedAt ?? null, fetchedAt, podcastFeed);

    const builders = normalizeXFeed(xFeed);
    const episodes = normalizePodcastFeed(podcastFeed);

    let newTweets = 0;
    let totalTweets = 0;
    let newPodcastEpisodes = 0;

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

    if (config.summaries.enabled) {
      for (const builder of builders) {
        for (const tweet of builder.tweets) {
          await ensureTweetSummary(config, tweet);
        }
      }

      for (const episode of episodes) {
        await ensurePodcastSummary(config, episode);
      }
    }

    const summary: SyncSummary = {
      finishedAt: new Date().toISOString(),
      feedGeneratedAt: xFeed.generatedAt ?? podcastFeed.generatedAt ?? null,
      xBuilders: builders.length,
      totalTweets,
      newTweets,
      podcastEpisodes: episodes.length,
      newPodcastEpisodes,
      podcastTitles: episodes.map((episode) => `${episode.podcastName}: ${episode.title}`),
      topBuilderSummaries: builders
        .filter((builder) => builder.tweets.length > 0)
        .sort((left, right) => right.tweets.length - left.tweets.length)
        .slice(0, 5)
        .map((builder) => `${builder.name} (@${builder.handle}) ${builder.tweets.length} 条`)
    };

    const digest: Omit<DigestRecord, 'id'> = {
      syncRunId,
      kind: 'sync-summary',
      title: `Follow Builders Digest ${summary.finishedAt.slice(0, 10)}`,
      content: buildDigestContent(summary),
      createdAt: summary.finishedAt
    };
    const digestId = await insertDigest(syncRunId, digest);

    let message = '未推送到 OpenClaw';
    if (options.announce || config.openclaw.enabled) {
      const announcement = buildAnnouncement(summary);
      const notifyResult = sendToOpenClaw(config, announcement);
      message = notifyResult.skipped ? notifyResult.reason : '已通过 OpenClaw 推送同步摘要';

      const latestAnnouncementPath = resolve(config.rootDir, 'data', 'latest-announcement.txt');
      await mkdir(resolve(config.rootDir, 'data'), { recursive: true });
      await writeFile(latestAnnouncementPath, announcement, 'utf-8');
    }

    await completeSyncRun(syncRunId, {
      finishedAt: summary.finishedAt,
      status: 'success',
      feedGeneratedAt: summary.feedGeneratedAt,
      xBuilders: summary.xBuilders,
      totalTweets: summary.totalTweets,
      podcastEpisodes: summary.podcastEpisodes,
      newTweets: summary.newTweets,
      newPodcastEpisodes: summary.newPodcastEpisodes,
      message,
      digestId
    });

    return {
      ...summary,
      syncRunId,
      digestId,
      message,
      databasePath: config.databasePath
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
      newTweets: 0,
      newPodcastEpisodes: 0,
      message,
      digestId: null
    });
    throw error;
  }
}
