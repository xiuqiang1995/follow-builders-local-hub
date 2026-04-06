import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { URL } from 'node:url';

import { z } from 'zod';

import { loadCaowoFallbackConfig, loadOpenAIConnectionConfig } from './model-config';
import type {
  BlogPostRecord,
  BuilderFeedEntry,
  Config,
  PodcastEpisodeRecord,
  SummaryContentType
} from './types';

const BROWSER_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36';

const UPSTREAM_PROMPTS_BASE =
  'https://raw.githubusercontent.com/zarazhangrui/follow-builders/main/prompts';

type SummaryUsage = {
  inputTokens: number | null;
  outputTokens: number | null;
};

export type SummaryResult = {
  summaryZh: string;
  inputTokens: number | null;
  outputTokens: number | null;
  modelName: string;
  modelProvider: string;
};

type PromptBundle = {
  systemPrompt: string;
  userPrompt: string;
};

type DigestSourceSummary = {
  title: string;
  summaryZh: string;
  url: string;
};

const promptTemplateCache = new Map<string, Promise<string>>();


function buildHeaders(baseUrl: string, apiKey: string) {
  const origin = new URL(baseUrl).origin;

  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
    'User-Agent': BROWSER_USER_AGENT,
    Accept: 'application/json',
    Origin: origin,
    Referer: `${origin}/`
  };
}

function normalizeText(text: string) {
  return text
    .trim()
    .replace(/^```[\s\S]*?\n/, '')
    .replace(/```$/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+\n/g, '\n')
    .trim();
}

function joinPromptSections(sections: string[]) {
  return sections
    .map((section) => section.trim())
    .filter(Boolean)
    .join('\n\n');
}

async function fetchPromptTemplate(fileName: string) {
  const response = await fetch(`${UPSTREAM_PROMPTS_BASE}/${fileName}`, {
    headers: {
      Accept: 'text/plain'
    },
    signal: AbortSignal.timeout(12_000)
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  return (await response.text()).trim();
}

export async function loadPromptTemplate(fileName: string) {
  const cacheKey = fileName;
  const cached = promptTemplateCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const pending = (async () => {
    try {
      return await fetchPromptTemplate(fileName);
    } catch {
      const localPath = resolve(process.cwd(), 'prompts', fileName);
      return (await readFile(localPath, 'utf-8')).trim();
    }
  })();

  promptTemplateCache.set(cacheKey, pending);
  return pending;
}

function extractChatResponse(payload: Record<string, unknown>) {
  const choices = Array.isArray(payload.choices) ? payload.choices : [];
  const firstChoice = choices[0];
  if (!firstChoice || typeof firstChoice !== 'object') {
    throw new Error('模型返回中缺少 choices');
  }
  const message = (firstChoice as { message?: { content?: string } }).message;
  const text = message?.content;
  if (typeof text !== 'string' || !text) {
    throw new Error('模型返回中缺少 message.content');
  }
  const usage = (payload.usage as Record<string, unknown> | undefined) ?? {};
  return {
    text: normalizeText(text),
    usage: {
      inputTokens: typeof usage.prompt_tokens === 'number' ? usage.prompt_tokens : null,
      outputTokens: typeof usage.completion_tokens === 'number' ? usage.completion_tokens : null
    } satisfies SummaryUsage
  };
}

function extractTextResponse(payload: Record<string, unknown>) {
  const output = Array.isArray(payload.output) ? payload.output : [];
  const firstOutput = output[0];
  if (!firstOutput || typeof firstOutput !== 'object') {
    throw new Error('模型返回中缺少 output');
  }

  const content = Array.isArray((firstOutput as { content?: unknown }).content)
    ? ((firstOutput as { content?: unknown[] }).content ?? [])
    : [];
  const texts = content
    .filter((item): item is { type?: string; text?: string } => typeof item === 'object' && item !== null)
    .filter((item) => item.type === 'output_text' && typeof item.text === 'string')
    .map((item) => item.text as string);

  if (texts.length === 0) {
    throw new Error('模型返回中没有 output_text');
  }

  const usage = (payload.usage as Record<string, unknown> | undefined) ?? {};
  return {
    text: normalizeText(texts.join('\n')),
    usage: {
      inputTokens: typeof usage.input_tokens === 'number' ? usage.input_tokens : null,
      outputTokens: typeof usage.output_tokens === 'number' ? usage.output_tokens : null
    } satisfies SummaryUsage
  };
}

function tryParseEventStreamPayload(text: string) {
  const events = text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice('data:'.length).trim())
    .filter((chunk) => chunk && chunk !== '[DONE]');

  let finalResponse: Record<string, unknown> | null = null;

  for (const chunk of events) {
    try {
      const parsed = JSON.parse(chunk) as Record<string, unknown>;
      const type = typeof parsed.type === 'string' ? parsed.type : '';
      if (
        type === 'response.completed' ||
        type === 'response.output_text.done' ||
        ('response' in parsed && typeof parsed.response === 'object' && parsed.response !== null)
      ) {
        finalResponse = ('response' in parsed
          ? (parsed.response as Record<string, unknown>)
          : parsed) as Record<string, unknown>;
      }
    } catch {
      continue;
    }
  }

  if (finalResponse) {
    return finalResponse;
  }

  throw new Error(`模型返回了无法解析的事件流：${text.slice(0, 300)}`);
}

async function callModelOnce(
  connection: Awaited<ReturnType<typeof loadOpenAIConnectionConfig>>,
  model: string,
  systemPrompt: string,
  userPrompt: string,
  maxOutputTokens: number
) {
  if (connection.wireApi === 'chat') {
    const url = `${connection.baseUrl.replace(/\/$/, '')}/v1/chat/completions`;
    const response = await fetch(url, {
      method: 'POST',
      headers: buildHeaders(connection.baseUrl, connection.apiKey),
      body: JSON.stringify({
        model,
        max_tokens: maxOutputTokens,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ]
      }),
      signal: AbortSignal.timeout(300_000)
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`摘要请求失败 (${response.status}): ${errorText.slice(0, 300)}`);
    }

    const payload = (await response.json()) as Record<string, unknown>;
    return extractChatResponse(payload);
  }

  // responses API (OpenAI)
  const url = `${connection.baseUrl.replace(/\/$/, '')}/v1/responses`;
  const response = await fetch(url, {
    method: 'POST',
    headers: buildHeaders(connection.baseUrl, connection.apiKey),
    body: JSON.stringify({
      model,
      reasoning: { effort: 'minimal' },
      max_output_tokens: maxOutputTokens,
      input: [
        {
          role: 'system',
          content: [{ type: 'input_text', text: systemPrompt }]
        },
        {
          role: 'user',
          content: [{ type: 'input_text', text: userPrompt }]
        }
      ]
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`摘要请求失败 (${response.status}): ${errorText.slice(0, 300)}`);
  }

  const rawText = await response.text();
  const payload = (() => {
    try {
      return JSON.parse(rawText) as Record<string, unknown>;
    } catch {
      return tryParseEventStreamPayload(rawText);
    }
  })();
  return extractTextResponse(payload);
}

async function requestText({
  model,
  systemPrompt,
  userPrompt,
  maxOutputTokens
}: {
  model: string;
  systemPrompt: string;
  userPrompt: string;
  maxOutputTokens: number;
}) {
  const connection = await loadOpenAIConnectionConfig();
  const MAX_RETRIES = 3;
  const RETRY_DELAYS_MS = [15000, 30000, 60000]; // 15s, 30s, 1min

  let lastError: unknown;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const result = await callModelOnce(connection, model, systemPrompt, userPrompt, maxOutputTokens);
      return { ...result, resolvedModel: model };
    } catch (err) {
      lastError = err;
      const msg = err instanceof Error ? err.message : String(err);
      const is429 = msg.includes('429');
      if (is429 && attempt < MAX_RETRIES) {
        const wait = RETRY_DELAYS_MS[attempt];
        console.warn(`[summarizer] ${model} 429，${wait / 1000}s 后重试 (${attempt + 1}/${MAX_RETRIES})...`);
        await new Promise((r) => setTimeout(r, wait));
      } else if (!is429) {
        throw err;
      }
    }
  }

  // Primary exhausted — try caowo.xin fallback
  const caowo = loadCaowoFallbackConfig();
  if (caowo) {
    console.warn(`[summarizer] ${model} 重试耗尽，切换到 caowo fallback (${caowo.defaultModel})...`);
    const result = await callModelOnce(caowo, caowo.defaultModel, systemPrompt, userPrompt, maxOutputTokens);
    return { ...result, resolvedModel: caowo.defaultModel };
  }

  throw lastError;
}

async function requestSummary(params: {
  model: string;
  systemPrompt: string;
  userPrompt: string;
  maxOutputTokens: number;
}): Promise<SummaryResult> {
  const { text, usage, resolvedModel } = await requestText(params);

  return {
    summaryZh: text,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    modelName: resolvedModel,
    modelProvider: 'openai-compatible'
  };
}

function renderBuilderPosts(builder: BuilderFeedEntry, maxTweetChars: number) {
  return builder.tweets
    .slice(0, 8)
    .map((tweet, index) =>
      [
        `Post ${index + 1}`,
        `Created at: ${tweet.createdAt}`,
        `URL: ${tweet.url}`,
        `Quote tweet: ${tweet.isQuote ? 'yes' : 'no'}`,
        tweet.quotedTweetId ? `Quoted tweet id: ${tweet.quotedTweetId}` : 'Quoted tweet id: none',
        tweet.text.slice(0, maxTweetChars)
      ].join('\n')
    )
    .join('\n\n');
}

export function createSourceHash(contentType: SummaryContentType, sourceText: string) {
  return createHash('sha256').update(`${contentType}:${sourceText}`).digest('hex');
}

export async function buildBuilderSummaryPrompts(
  builder: BuilderFeedEntry,
  maxTweetChars: number
): Promise<PromptBundle> {
  const basePrompt = await loadPromptTemplate('summarize-tweets.md');

  return {
    systemPrompt: joinPromptSections([
      basePrompt,
      [
        '## Local Hub Adaptation',
        '- CRITICAL: Your entire response MUST be written in Simplified Chinese (简体中文). Do not use English.',
        '- The input is exactly one builder feed entry containing that builder\'s recent posts.',
        '- Keep the output to 2-4 Chinese sentences total.',
        '- Summarize the builder\'s notable ideas, launches, contrarian takes, or useful resources across the provided posts.',
        '- Do not merge in any posts not present in the input.',
        '- If the provided posts are all low-signal, output exactly: 暂无值得记录的更新。',
        '- Do not use markdown headings or code fences.'
      ].join('\n')
    ]),
    userPrompt: [
      `Builder: ${builder.name}`,
      `Handle: ${builder.handle}`,
      `Bio: ${builder.bio || 'N/A'}`,
      `Post count in this feed entry: ${builder.tweets.length}`,
      '',
      'Recent posts:',
      renderBuilderPosts(builder, maxTweetChars)
    ].join('\n')
  };
}

export async function summarizeBuilderFeed(
  config: Config,
  builder: BuilderFeedEntry
): Promise<SummaryResult> {
  const prompts = await buildBuilderSummaryPrompts(builder, config.summaries.maxTweetChars);
  return requestSummary({
    model: config.summaries.tweetModel,
    maxOutputTokens: 700,
    systemPrompt: prompts.systemPrompt,
    userPrompt: prompts.userPrompt
  });
}

export async function buildPodcastSummaryPrompts(
  episode: PodcastEpisodeRecord,
  transcript: string
): Promise<PromptBundle> {
  const basePrompt = await loadPromptTemplate('summarize-podcast.md');

  return {
    systemPrompt: joinPromptSections([
      basePrompt,
      [
        '## Local Hub Adaptation',
        '- CRITICAL: Your entire response MUST be written in Simplified Chinese (简体中文). Do not use English.',
        '- Write the remix in natural Simplified Chinese.',
        '- Use one opening takeaway sentence, then 2-4 bullet points with "- " prefixes.',
        '- Keep the summary sharp, concrete, and phone-readable.',
        '- Avoid filler like “在这期节目中” or “主持人和嘉宾讨论了”.',
        '- Do not use markdown headings or code fences.'
      ].join('\n')
    ]),
    userPrompt: [
      `Podcast: ${episode.podcastName}`,
      `Title: ${episode.title}`,
      `Published at: ${episode.publishedAt}`,
      `Original URL: ${episode.url}`,
      '',
      'Transcript excerpt:',
      transcript
    ].join('\n')
  };
}

export async function summarizePodcastEpisode(
  config: Config,
  episode: PodcastEpisodeRecord
): Promise<SummaryResult> {
  const transcript = episode.transcript.slice(0, config.summaries.maxPodcastChars);
  const prompts = await buildPodcastSummaryPrompts(episode, transcript);

  return requestSummary({
    model: config.summaries.podcastModel,
    maxOutputTokens: 800,
    systemPrompt: prompts.systemPrompt,
    userPrompt: prompts.userPrompt
  });
}

export async function buildBlogSummaryPrompts(
  post: BlogPostRecord,
  content: string
): Promise<PromptBundle> {
  const basePrompt = await loadPromptTemplate('summarize-blogs.md');

  return {
    systemPrompt: joinPromptSections([
      basePrompt,
      [
        '## Local Hub Adaptation',
        '- CRITICAL: Your entire response MUST be written in Simplified Chinese (简体中文). Do not use English.',
        '- Write the summary in natural Simplified Chinese.',
        '- Keep it concise but complete enough for a busy reader to decide whether the article matters.',
        '- Include the article link explicitly when it is useful context.',
        '- Do not use markdown headings or code fences.'
      ].join('\n')
    ]),
    userPrompt: [
      `Blog: ${post.blogName}`,
      `Title: ${post.title}`,
      `Author: ${post.author || 'Unknown'}`,
      `Published at: ${post.publishedAt ?? 'Unknown'}`,
      `Original URL: ${post.url}`,
      post.description ? `Description: ${post.description}` : 'Description: N/A',
      '',
      'Article content excerpt:',
      content
    ].join('\n')
  };
}

export async function summarizeBlogPost(config: Config, post: BlogPostRecord): Promise<SummaryResult> {
  const content = post.content.slice(0, config.summaries.maxBlogChars);
  const prompts = await buildBlogSummaryPrompts(post, content);

  return requestSummary({
    model: config.summaries.blogModel,
    maxOutputTokens: 700,
    systemPrompt: prompts.systemPrompt,
    userPrompt: prompts.userPrompt
  });
}

export async function buildDigestPrompts(input: {
  dateLabel: string;
  timeLabel: string;
  topLine: string;
  feedGeneratedAt: string | null;
  stats: {
    xBuilders: number;
    totalTweets: number;
    blogPosts: number;
    podcastEpisodes: number;
  };
  builders: DigestSourceSummary[];
  podcasts: DigestSourceSummary[];
  blogs: DigestSourceSummary[];
}): Promise<PromptBundle> {
  const basePrompt = await loadPromptTemplate('digest-intro.md');

  const renderSection = (title: string, items: DigestSourceSummary[]) => {
    if (items.length === 0) {
      return `${title}\n- none`;
    }

    return [
      title,
      ...items.map((item, index) =>
        [
          `${index + 1}. ${item.title}`,
          item.summaryZh,
          item.url
        ].join('\n')
      )
    ].join('\n\n');
  };

  return {
    systemPrompt: joinPromptSections([
      basePrompt,
      [
        '## Local Hub Adaptation',
        '- Output the final digest in natural Simplified Chinese.',
        '- Keep all original links unchanged.',
        '- You are assembling from already-prepared Chinese summaries. Do not re-interpret the source material.',
        '- Use this exact opening style: `AI Builders Digest｜HH:mm` on the first line.',
        '- The second paragraph should feel like the sample style: `今天最值得看的是...` and should point out 1-2 main lines.',
        '- Use numbered section titles exactly like `1）官方内容` `2）X / Twitter builders` `3）播客`.',
        '- In `2）X / Twitter builders`, do NOT output one builder per bullet by default. Cluster related builder summaries into thematic bullets so the reader can quickly see what people are collectively discussing.',
        '- Each X bullet may mention one or several builders. If several builders obviously belong to the same discussion line, merge them into one bullet.',
        '- Start the X section with exactly `这轮讨论密度挺高，但能归成几类：` unless there is only one clear theme.',
        '- Use `•` bullets in the official content, X, and podcast sections.',
        '- For each X bullet, keep the prose tight and then list the relevant original links on separate lines right after that bullet.',
        '- If there is no official content, say `本轮暂无新的官方博客更新。`',
        '- If there are no new podcasts, say `本轮没有新的播客更新。`',
        '- End with one short closing paragraph that starts with `结论：`.',
        '- Do not use code fences.'
      ].join('\n')
    ]),
    userPrompt: [
      `Date: ${input.dateLabel}`,
      `Time: ${input.timeLabel}`,
      `Top line: ${input.topLine}`,
      `Feed generated at: ${input.feedGeneratedAt ?? 'unknown'}`,
      `Stats: xBuilders=${input.stats.xBuilders}, totalTweets=${input.stats.totalTweets}, blogPosts=${input.stats.blogPosts}, podcastEpisodes=${input.stats.podcastEpisodes}`,
      '',
      renderSection('OFFICIAL BLOGS', input.blogs),
      '',
      renderSection('X / TWITTER', input.builders),
      '',
      renderSection('PODCASTS', input.podcasts)
    ].join('\n')
  };
}

export async function composeDigest(
  config: Config,
  input: {
    dateLabel: string;
    timeLabel: string;
    topLine: string;
    feedGeneratedAt: string | null;
    stats: {
      xBuilders: number;
      totalTweets: number;
      blogPosts: number;
      podcastEpisodes: number;
    };
    builders: DigestSourceSummary[];
    podcasts: DigestSourceSummary[];
    blogs: DigestSourceSummary[];
  }
) {
  const prompts = await buildDigestPrompts(input);
  const { text } = await requestText({
    model: config.summaries.digestModel,
    maxOutputTokens: 1400,
    systemPrompt: prompts.systemPrompt,
    userPrompt: prompts.userPrompt
  });

  return text.slice(0, config.summaries.maxDigestChars).trim();
}

export async function buildTranslatePrompt(text: string) {
  const basePrompt = await loadPromptTemplate('translate.md');
  return {
    systemPrompt: basePrompt,
    userPrompt: text
  };
}

export const promptSchemas = {
  promptBundle: z.object({
    systemPrompt: z.string().min(1),
    userPrompt: z.string().min(1)
  })
};
