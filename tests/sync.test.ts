import { describe, expect, it } from 'vitest';

import { buildAnnouncement } from '@/lib/openclaw';
import {
  buildSnapshotFallbackNote,
  buildSyncMessage,
  loadFeedPayload,
  normalizeBlogFeed,
  normalizePodcastFeed,
  normalizeXFeed
} from '@/lib/sync';

describe('sync helpers', () => {
  it('normalizes x feed entries', () => {
    const normalized = normalizeXFeed({
      x: [
        {
          handle: 'karpathy',
          name: 'Andrej Karpathy',
          bio: 'builder',
          tweets: [
            {
              id: '1',
              text: 'hello',
              createdAt: '2026-03-21T00:00:00.000Z',
              url: 'https://x.com/karpathy/status/1',
              likes: 3,
              retweets: 1,
              replies: 0,
              isQuote: false
            }
          ]
        }
      ]
    });

    expect(normalized).toHaveLength(1);
    expect(normalized[0]?.tweets[0]?.builderHandle).toBe('karpathy');
    expect(normalized[0]?.tweets[0]?.likes).toBe(3);
  });

  it('normalizes podcast feed entries', () => {
    const normalized = normalizePodcastFeed({
      podcasts: [
        {
          name: 'No Priors',
          title: 'Andrej Karpathy on Code Agents',
          videoId: 'abc123',
          url: 'https://youtube.com/watch?v=abc123',
          publishedAt: '2026-03-21T00:00:00.000Z',
          transcript: 'hello'
        }
      ]
    });

    expect(normalized[0]?.podcastName).toBe('No Priors');
    expect(normalized[0]?.videoId).toBe('abc123');
  });

  it('normalizes blog feed entries', () => {
    const normalized = normalizeBlogFeed({
      blogs: [
        {
          name: 'Anthropic Engineering',
          title: 'Harness Design for Long-Running Apps',
          url: 'https://www.anthropic.com/engineering/harness-design',
          publishedAt: '2026-03-21T00:00:00.000Z',
          author: 'Anthropic',
          description: 'desc',
          content: 'content'
        }
      ]
    });

    expect(normalized[0]?.blogName).toBe('Anthropic Engineering');
    expect(normalized[0]?.title).toContain('Harness Design');
  });

  it('builds announcement text with blog counts', () => {
    const announcement = buildAnnouncement({
      finishedAt: '2026-03-21T12:00:00.000Z',
      feedGeneratedAt: '2026-03-21T06:40:00.981Z',
      xBuilders: 16,
      totalTweets: 32,
      newTweets: 2,
      podcastEpisodes: 1,
      newPodcastEpisodes: 1,
      blogPosts: 1,
      newBlogPosts: 1,
      blogTitles: ['Anthropic Engineering: Harness Design'],
      podcastTitles: ['Latent Space: Dreamer'],
      topBuilderSummaries: ['Andrej Karpathy (2)']
    });

    expect(announcement).toContain('新增 blog posts: 1');
    expect(announcement).toContain('Anthropic Engineering: Harness Design');
  });

  it('falls back to cached feed snapshot when remote fetch fails', async () => {
    const result = await loadFeedPayload({
      feedType: 'x',
      url: 'https://example.com/feed-x.json',
      fetchJsonImpl: async () => {
        throw new Error('fetch failed');
      },
      getLatestFeedSnapshotImpl: async () => ({
        fetchedAt: '2026-03-21T06:40:00.981Z',
        payload: {
          generatedAt: '2026-03-21T06:39:00.000Z',
          x: []
        }
      })
    });

    expect(result.usedSnapshot).toBe(true);
    expect(result.payload).toEqual({
      generatedAt: '2026-03-21T06:39:00.000Z',
      x: []
    });
    expect(result.note).toContain('X feed 远端拉取失败');
    expect(result.note).toContain('本地快照');
  });

  it('builds sync message with fallback notes', () => {
    const note = buildSnapshotFallbackNote('blogs', '2026-03-21T06:40:00.981Z');
    const message = buildSyncMessage('未推送到 OpenClaw', [note]);

    expect(message).toContain('未推送到 OpenClaw');
    expect(message).toContain('blog feed 远端拉取失败');
  });
});
