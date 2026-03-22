import { createHash } from 'node:crypto';
import { URL } from 'node:url';

import { z } from 'zod';

import { loadOpenAIConnectionConfig } from './model-config';
import type { Config, PodcastEpisodeRecord, SummaryContentType, TweetRecord } from './types';

const responseSchema = z.object({
  summary_zh: z.string().min(1)
});

const BROWSER_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36';

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

function parseJsonObject(text: string) {
  const trimmed = text.trim().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```$/, '');
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error(`模型没有返回 JSON：${trimmed.slice(0, 200)}`);
  }
  return JSON.parse(trimmed.slice(start, end + 1));
}

function normalizeSummary(text: string) {
  const normalized = text
    .trim()
    .replace(/\n{3,}/g, '\n\n');

  const filteredLines = normalized
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => {
      const compact = line.replace(/^[\-•]\s*/, '');
      return ![
        /更多内容可通过附带链接阅读/,
        /更多内容可通过.*链接.*阅读/,
        /要了解具体内容需要点开链接查看/,
        /要了解.*内容.*点开.*链接/,
        /具体内容需要点开链接查看/,
        /具体内容需要点开链接才能知道/,
        /要了解具体内容.*打开原文/,
        /帖中还附上了.*链接/,
        /文中还附上了.*链接/,
        /还附上了.*链接/,
        /附带了.*链接/,
        /需要点开链接/,
        /更多内容请看链接/,
        /详情见链接/,
        /配图链接大概率/,
        /配图大概率/,
        /附图可能是/,
        /图片可能是/,
        /链接大概展示了/,
        /链接大概率指向/,
        /截图可能是/,
        /配图可能是/,
        /点开链接才能知道/,
        /附上了相关内容的阅读链接/,
        /其余内容主要是转发的链接/,
        /没有进一步说明细节/,
        /没有附加任何文字说明或观点/
      ].some((pattern) => pattern.test(compact));
    });

  const tightened = filteredLines
    .map((line) =>
      line
        .replace(/^这条帖子主要是/, '')
        .replace(/^这条帖主要是/, '')
        .replace(/^这条内容主要是/, '')
        .replace(/^帖子主要是/, '')
        .replace(/^整体来看[，,]?/, '')
        .replace(/^总的来说[，,]?/, '')
        .replace(/^语气是在/, '在')
        .replace(/^主要是在/, '')
        .replace(/^主要介绍了?/, '')
        .replace(/^主要讲的是/, '')
        .replace(/^核心是在/, '')
        .replace(/整体来看[，,]?/g, '')
        .replace(/总的来说[，,]?/g, '')
        .replace(/语气是在/g, '在')
        .replace(/作者没有附加任何文字说明内容。/g, '')
        .replace(/帖子附上了相关内容的阅读链接。/g, '')
        .replace(/其余内容主要是转发的链接，没有进一步说明细节。/g, '')
        .replace(/没有附加任何文字说明或观点。/g, '未补充观点。')
        .replace(/没有进一步说明细节。/g, '')
        .replace(/没有额外观点或评论。/g, '未补充观点。')
        .replace(/只是简单的链接分享/g, '仅分享链接')
        .replace(/仅分享了两个URL链接/g, '仅分享了两个链接')
        .replace(/仅分享了一个URL链接/g, '仅分享了一个链接')
        .replace(/，整体来看[，,]?/g, '，')
        .replace(/\s+/g, ' ')
        .trim()
    )
    .filter(Boolean);

  return tightened.join('\n\n').trim();
}

function ensureQuoteContext(summary: string, tweet: TweetRecord) {
  if (!tweet.isQuote) {
    return summary;
  }

  if (/(引用|转发|评论了|回应了|引用帖|在引用他人推文时|在转发他人推文时)/.test(summary)) {
    return summary;
  }

  if (summary.startsWith('作者')) {
    return summary.replace(/^作者/, '作者在引用他人推文时');
  }

  if (summary.startsWith(tweet.builderName)) {
    return `在引用他人推文时，${summary}`;
  }

  return `作者在引用他人推文时，${summary}`;
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
    text: texts.join('\n').trim(),
    usage: {
      inputTokens: typeof usage.input_tokens === 'number' ? usage.input_tokens : null,
      outputTokens: typeof usage.output_tokens === 'number' ? usage.output_tokens : null
    } satisfies SummaryUsage
  };
}

async function requestSummary({
  model,
  systemPrompt,
  userPrompt,
  maxOutputTokens
}: {
  model: string;
  systemPrompt: string;
  userPrompt: string;
  maxOutputTokens: number;
}): Promise<SummaryResult> {
  const connection = await loadOpenAIConnectionConfig();
  if (connection.wireApi !== 'responses') {
    throw new Error(`当前只实现了 responses API，实际 wire_api=${connection.wireApi}`);
  }

  const url = `${connection.baseUrl.replace(/\/$/, '')}/v1/responses`;
  const response = await fetch(url, {
    method: 'POST',
    headers: buildHeaders(connection.baseUrl, connection.apiKey),
    body: JSON.stringify({
      model,
      reasoning: {
        effort: 'minimal'
      },
      max_output_tokens: maxOutputTokens,
      input: [
        {
          role: 'system',
          content: [
            {
              type: 'input_text',
              text: systemPrompt
            }
          ]
        },
        {
          role: 'user',
          content: [
            {
              type: 'input_text',
              text: userPrompt
            }
          ]
        }
      ]
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`摘要请求失败 (${response.status}): ${errorText.slice(0, 300)}`);
  }

  const payload = (await response.json()) as Record<string, unknown>;
  const { text, usage } = extractTextResponse(payload);
  const parsed = responseSchema.parse(parseJsonObject(text));

  return {
    summaryZh: normalizeSummary(parsed.summary_zh),
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    modelName: model,
    modelProvider: 'openai-compatible'
  };
}

export function createSourceHash(contentType: SummaryContentType, sourceText: string) {
  return createHash('sha256').update(`${contentType}:${sourceText}`).digest('hex');
}

export async function summarizeTweet(config: Config, tweet: TweetRecord): Promise<SummaryResult> {
  const excerpt = tweet.text.slice(0, config.summaries.maxTweetChars);
  const result = await requestSummary({
    model: config.summaries.tweetModel,
    maxOutputTokens: 180,
    systemPrompt: [
      'You summarize one English social post for a Chinese reader.',
      'Return JSON only. No markdown fence. Format: {"summary_zh":"..."}',
      'Write concise Simplified Chinese.',
      'Keep product names and people names in original English when useful.',
      'Do not invent context beyond the original post.',
      'If the post is mostly a link or a reaction, explain that plainly.',
      'Do not tell the reader to open, click, or read the link for more details.',
      'Do not mention that the post contains an attached link unless that is itself the key point.',
      'Do not speculate about linked content, screenshots, or images you cannot inspect.',
      'Never write guesses such as “配图可能是…”, “链接大概率指向…”, or “截图可能展示了…”.',
      'Avoid soft filler phrases like “整体来看”, “主要是在”, “语气是在”, “这条帖子主要是”.',
      'Start with the core action or point directly.',
      'Avoid meta filler like “帖子附上了链接”, “其余内容主要是转发链接”, or “没有进一步说明细节”.',
      'If this is a quote tweet, explicitly say that the author is quoting or commenting on another post.',
      'If quoted content is unavailable, do not invent it. Still make clear that this is a quote tweet.'
    ].join('\n'),
    userPrompt: [
      `Builder: ${tweet.builderName} (@${tweet.builderHandle})`,
      `Created at: ${tweet.createdAt}`,
      `Original URL: ${tweet.url}`,
      `Quote tweet: ${tweet.isQuote ? 'yes' : 'no'}`,
      tweet.quotedTweetId ? `Quoted tweet id: ${tweet.quotedTweetId}` : 'Quoted tweet id: none',
      'English post:',
      excerpt,
      '',
      'Write 1-2 Chinese sentences so the reader can quickly know what this post is about.',
      'Avoid filler like “帖中附了链接”“更多内容见链接”“点开原文可了解更多”。',
      'Do not guess what the image, screenshot, or linked page contains unless the text itself explicitly says so.',
      'Prefer direct wording like “作者宣布… / 作者吐槽… / 仅分享链接，未补充观点。”',
      'Do not add meta sentences about the existence of links, screenshots, or missing details.',
      'If Quote tweet: yes, the summary must mention that the author is quoting or commenting on another post.'
    ].join('\n')
  });

  return {
    ...result,
    summaryZh: ensureQuoteContext(result.summaryZh, tweet)
  };
}

export async function summarizePodcastEpisode(
  config: Config,
  episode: PodcastEpisodeRecord
): Promise<SummaryResult> {
  const transcript = episode.transcript.slice(0, config.summaries.maxPodcastChars);

  return requestSummary({
    model: config.summaries.podcastModel,
    maxOutputTokens: 420,
    systemPrompt: [
      'You summarize one English podcast episode for a Chinese reader.',
      'Return JSON only. No markdown fence. Format: {"summary_zh":"..."}',
      'Write concise Simplified Chinese.',
      'The summary should be highly scannable: one short opening sentence plus 2-4 bullet points using "- " prefixes.',
      'Keep company, product, and person names in original English when useful.',
      'Do not invent claims not present in the source.',
      'Do not waste words telling the reader there is a video link or that they can click through for details.'
    ].join('\n'),
    userPrompt: [
      `Podcast: ${episode.podcastName}`,
      `Title: ${episode.title}`,
      `Published at: ${episode.publishedAt}`,
      `Original URL: ${episode.url}`,
      'English transcript excerpt:',
      transcript,
      '',
      'Write a Chinese summary that helps the reader decide whether to open the original episode.',
      'Avoid filler like “更多内容见原视频链接” or “点开链接查看详情”。'
    ].join('\n')
  });
}
