import { describe, expect, it } from 'vitest';

import { buildAnnouncement } from '@/lib/openclaw';
import { buildDigestContent, normalizeXFeed } from '@/lib/sync';

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

  it('builds digest content', () => {
    const digest = buildDigestContent({
      finishedAt: '2026-03-21T12:00:00.000Z',
      feedGeneratedAt: '2026-03-21T06:40:00.981Z',
      xBuilders: 16,
      totalTweets: 32,
      newTweets: 2,
      podcastEpisodes: 1,
      newPodcastEpisodes: 1,
      podcastTitles: ['Latent Space: Dreamer'],
      topBuilderSummaries: ['Andrej Karpathy (@karpathy) 2 条']
    });

    expect(digest).toContain('新增 tweets: 2');
    expect(digest).toContain('Latent Space: Dreamer');
  });

  it('builds announcement text', () => {
    const announcement = buildAnnouncement({
      finishedAt: '2026-03-21T12:00:00.000Z',
      feedGeneratedAt: '2026-03-21T06:40:00.981Z',
      xBuilders: 16,
      totalTweets: 32,
      newTweets: 2,
      podcastEpisodes: 1,
      newPodcastEpisodes: 1,
      podcastTitles: ['Latent Space: Dreamer'],
      topBuilderSummaries: ['Andrej Karpathy (@karpathy) 2 条']
    });

    expect(announcement).toContain('Follow Builders 本地同步完成');
    expect(announcement).toContain('新增 tweets: 2');
  });
});
