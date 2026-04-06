import { describe, expect, it } from 'vitest';

import {
  buildBlogSummaryPrompts,
  buildBuilderSummaryPrompts,
  buildDigestPrompts,
  buildPodcastSummaryPrompts,
  loadPromptTemplate
} from '@/lib/summarizer';

describe('summarizer prompts', () => {
  it('loads the upstream tweet prompt template', async () => {
    const prompt = await loadPromptTemplate('summarize-tweets.md');

    expect(prompt).toContain('# X/Twitter Summary Prompt');
    expect(prompt).toContain('No notable posts');
  });

  it('builds builder summary prompts with local feed adaptation', async () => {
    const prompts = await buildBuilderSummaryPrompts(
      {
        handle: 'amasad',
        name: 'Amjad Masad',
        bio: 'Replit CEO',
        tweets: [
          {
            id: '1',
            builderHandle: 'amasad',
            builderName: 'Amjad Masad',
            text: 'We shipped a new Replit Agent workflow today.',
            createdAt: '2026-03-24T00:00:00.000Z',
            url: 'https://x.com/amasad/status/1',
            likes: 10,
            retweets: 2,
            replies: 1,
            isQuote: false,
            quotedTweetId: null
          }
        ]
      },
      1800
    );

    expect(prompts.systemPrompt).toContain('# X/Twitter Summary Prompt');
    expect(prompts.systemPrompt).toContain('one builder feed entry');
    expect(prompts.userPrompt).toContain('Builder: Amjad Masad');
    expect(prompts.userPrompt).toContain('Recent posts:');
  });

  it('builds podcast summary prompts with remix structure', async () => {
    const prompts = await buildPodcastSummaryPrompts(
      {
        videoId: 'abc123',
        podcastName: 'No Priors',
        title: 'Andrej Karpathy on Code Agents',
        url: 'https://youtube.com/watch?v=abc123',
        publishedAt: '2026-03-24T00:00:00.000Z',
        transcript: 'The future is about code agents doing more of the work.'
      },
      'The future is about code agents doing more of the work.'
    );

    expect(prompts.systemPrompt).toContain('# Podcast Remix Prompt');
    expect(prompts.systemPrompt).toContain('Write the remix in natural Simplified Chinese');
    expect(prompts.userPrompt).toContain('Transcript excerpt');
  });

  it('builds blog summary prompts from upstream template', async () => {
    const prompts = await buildBlogSummaryPrompts(
      {
        blogName: 'Anthropic Engineering',
        title: 'Harness Design for Long-Running Apps',
        url: 'https://www.anthropic.com/engineering/harness-design',
        publishedAt: '2026-03-24T00:00:00.000Z',
        author: 'Anthropic',
        description: 'Long-running apps',
        content: 'This post explains harness design.'
      },
      'This post explains harness design.'
    );

    expect(prompts.systemPrompt).toContain('# Blog Post Summary Prompt');
    expect(prompts.userPrompt).toContain('Blog: Anthropic Engineering');
    expect(prompts.userPrompt).toContain('Original URL');
  });

  it('builds digest prompts from upstream template', async () => {
    const prompts = await buildDigestPrompts({
      dateLabel: '2026-03-25',
      timeLabel: '16:00',
      topLine: '今天最值得看的是 agent-native 工作流和安全自动化。',
      feedGeneratedAt: '2026-03-25T08:00:00.000Z',
      stats: {
        xBuilders: 12,
        totalTweets: 23,
        blogPosts: 1,
        podcastEpisodes: 1
      },
      builders: [
        {
          title: 'Garry Tan',
          summaryZh: '分享了 GStack 在大型遗留代码库里的实践。',
          url: 'https://x.com/garrytan/status/1'
        }
      ],
      podcasts: [],
      blogs: []
    });

    expect(prompts.systemPrompt).toContain('# Digest Intro Prompt');
    expect(prompts.systemPrompt).toContain('Cluster related builder summaries into thematic bullets');
    expect(prompts.userPrompt).toContain('OFFICIAL BLOGS');
    expect(prompts.userPrompt).toContain('X / TWITTER');
    expect(prompts.userPrompt).toContain('Time: 16:00');
  });
});
