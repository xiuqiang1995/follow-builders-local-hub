import { loadConfig } from '../lib/config';
import {
  getContentSummary,
  getRecentBlogPosts,
  getRecentBuilderFeeds,
  getRecentPodcastEpisodes,
  upsertContentSummary
} from '../lib/db';
import {
  createSourceHash,
  summarizeBlogPost,
  summarizeBuilderFeed,
  summarizePodcastEpisode
} from '../lib/summarizer';

const INTER_REQUEST_DELAY_MS = 2000;

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function refreshBuilders() {
  const config = await loadConfig();
  const builders = await getRecentBuilderFeeds(100);
  let done = 0;
  let failed = 0;

  for (const builder of builders) {
    const now = new Date().toISOString();
    const existing = await getContentSummary(
      'builder_feed',
      builder.handle,
      config.summaries.locale,
      config.summaries.summaryKind
    );
    try {
      const result = await summarizeBuilderFeed(config, {
        handle: builder.handle,
        name: builder.name,
        bio: builder.bio,
        tweets: builder.tweets
      });
      const sourceHash = createSourceHash(
        'builder_feed',
        JSON.stringify({
          handle: builder.handle,
          tweets: builder.tweets.map((tweet) => ({ id: tweet.id, text: tweet.text, url: tweet.url }))
        })
      );
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
      console.log(`[builders] ✓ ${builder.handle} (${result.modelName})`);
      done++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[builders] ✗ ${builder.handle}: ${msg.slice(0, 120)}`);
      await upsertContentSummary({
        contentType: 'builder_feed',
        contentKey: builder.handle,
        locale: config.summaries.locale,
        summaryKind: config.summaries.summaryKind,
        summaryEn: null,
        summaryZh: null,
        sourceHash: '',
        modelProvider: null,
        modelName: null,
        promptVersion: config.summaries.promptVersion,
        status: 'failed',
        tokensIn: null,
        tokensOut: null,
        estimatedCostUsd: null,
        errorMessage: msg.slice(0, 500),
        createdAt: existing?.createdAt ?? now,
        updatedAt: now
      });
      failed++;
    }
    await sleep(INTER_REQUEST_DELAY_MS);
  }

  return { total: builders.length, done, failed };
}

async function refreshPodcasts() {
  const config = await loadConfig();
  const episodes = await getRecentPodcastEpisodes(100);
  let done = 0;
  let failed = 0;

  for (const episode of episodes) {
    const now = new Date().toISOString();
    const existing = await getContentSummary(
      'podcast_episode',
      episode.videoId,
      config.summaries.locale,
      config.summaries.summaryKind
    );
    try {
      const result = await summarizePodcastEpisode(config, episode);
      const sourceHash = createSourceHash('podcast_episode', `${episode.title}\n${episode.transcript}`);
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
      console.log(`[podcasts] ✓ ${episode.videoId} (${result.modelName})`);
      done++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[podcasts] ✗ ${episode.videoId}: ${msg.slice(0, 120)}`);
      await upsertContentSummary({
        contentType: 'podcast_episode',
        contentKey: episode.videoId,
        locale: config.summaries.locale,
        summaryKind: config.summaries.summaryKind,
        summaryEn: null,
        summaryZh: null,
        sourceHash: '',
        modelProvider: null,
        modelName: null,
        promptVersion: config.summaries.promptVersion,
        status: 'failed',
        tokensIn: null,
        tokensOut: null,
        estimatedCostUsd: null,
        errorMessage: msg.slice(0, 500),
        createdAt: existing?.createdAt ?? now,
        updatedAt: now
      });
      failed++;
    }
    await sleep(INTER_REQUEST_DELAY_MS);
  }

  return { total: episodes.length, done, failed };
}

async function refreshBlogs() {
  const config = await loadConfig();
  const posts = await getRecentBlogPosts(100);
  let done = 0;
  let failed = 0;

  for (const post of posts) {
    const now = new Date().toISOString();
    const existing = await getContentSummary(
      'blog_post',
      post.url,
      config.summaries.locale,
      config.summaries.summaryKind
    );
    try {
      const result = await summarizeBlogPost(config, post);
      const sourceHash = createSourceHash(
        'blog_post',
        JSON.stringify({ title: post.title, url: post.url, content: post.content })
      );
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
      console.log(`[blogs] ✓ ${post.url.slice(0, 60)} (${result.modelName})`);
      done++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[blogs] ✗ ${post.url.slice(0, 60)}: ${msg.slice(0, 120)}`);
      await upsertContentSummary({
        contentType: 'blog_post',
        contentKey: post.url,
        locale: config.summaries.locale,
        summaryKind: config.summaries.summaryKind,
        summaryEn: null,
        summaryZh: null,
        sourceHash: '',
        modelProvider: null,
        modelName: null,
        promptVersion: config.summaries.promptVersion,
        status: 'failed',
        tokensIn: null,
        tokensOut: null,
        estimatedCostUsd: null,
        errorMessage: msg.slice(0, 500),
        createdAt: existing?.createdAt ?? now,
        updatedAt: now
      });
      failed++;
    }
    await sleep(INTER_REQUEST_DELAY_MS);
  }

  return { total: posts.length, done, failed };
}

async function main() {
  console.log('[refresh] 开始顺序刷新摘要...');
  const builders = await refreshBuilders();
  console.log(`[refresh] builders: ${builders.done} 成功, ${builders.failed} 失败 / ${builders.total} 总计`);

  const podcasts = await refreshPodcasts();
  console.log(`[refresh] podcasts: ${podcasts.done} 成功, ${podcasts.failed} 失败 / ${podcasts.total} 总计`);

  const blogs = await refreshBlogs();
  console.log(`[refresh] blogs: ${blogs.done} 成功, ${blogs.failed} 失败 / ${blogs.total} 总计`);

  const config = await loadConfig();
  console.log(
    JSON.stringify(
      {
        status: 'ok',
        promptVersion: config.summaries.promptVersion,
        builders,
        podcasts,
        blogs
      },
      null,
      2
    )
  );
}

void main();
