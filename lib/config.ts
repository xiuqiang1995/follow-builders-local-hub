import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';

import { z } from 'zod';

import type { Config } from './types';

const configSchema = z.object({
  databasePath: z.string().default('./data/follow-builders.db'),
  feeds: z.object({
    xUrl: z.string().url(),
    podcastsUrl: z.string().url(),
    blogsUrl: z.string().url()
  }),
  summaries: z.object({
    enabled: z.boolean().default(true),
    locale: z.string().default('zh-CN'),
    summaryKind: z.string().default('brief'),
    promptVersion: z.string().default('2026-03-25-zara-aligned-v1'),
    tweetModel: z.string().default('gpt-5-nano'),
    podcastModel: z.string().default('gpt-5-mini'),
    blogModel: z.string().default('gpt-5-mini'),
    digestModel: z.string().default('gpt-5-mini'),
    maxTweetChars: z.number().int().positive().default(1800),
    maxPodcastChars: z.number().int().positive().default(40000),
    maxBlogChars: z.number().int().positive().default(30000),
    maxDigestChars: z.number().int().positive().default(12000)
  }).default({
    enabled: true,
    locale: 'zh-CN',
    summaryKind: 'brief',
    promptVersion: '2026-03-25-zara-aligned-v1',
    tweetModel: 'gpt-5-nano',
    podcastModel: 'gpt-5-mini',
    blogModel: 'gpt-5-mini',
    digestModel: 'gpt-5-mini',
    maxTweetChars: 1800,
    maxPodcastChars: 40000,
    maxBlogChars: 30000,
    maxDigestChars: 12000
  }),
  openclaw: z.object({
    mode: z.enum(['none', 'message']).default('none'),
    channel: z.string().default('telegram'),
    target: z.string().default(''),
    account: z.string().default(''),
    enabled: z.boolean().default(false)
  })
});

function resolveMaybeRelative(rootDir: string, targetPath: string) {
  return isAbsolute(targetPath) ? targetPath : resolve(rootDir, targetPath);
}

export async function loadConfig(): Promise<Config> {
  const rootDir = process.cwd();
  const configPath = resolve(rootDir, 'config/config.json');
  const fallbackPath = resolve(rootDir, 'config/config.example.json');
  const sourcePath = existsSync(configPath) ? configPath : fallbackPath;
  const raw = JSON.parse(await readFile(sourcePath, 'utf-8'));
  const parsed = configSchema.parse(raw);

  return {
    ...parsed,
    databasePath: resolveMaybeRelative(rootDir, parsed.databasePath),
    rootDir,
    configPath: sourcePath
  };
}
