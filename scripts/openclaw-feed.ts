import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import {
  getBlogPostsSeenAt,
  getBuilderFeedsSeenAt,
  getLatestDigest,
  getPodcastEpisodesSeenAt
} from '../lib/db';
import { runSync } from '../lib/sync';

type CliOptions = {
  json: boolean;
};

function parseArgs(argv: string[]): CliOptions {
  return {
    json: argv.includes('--json')
  };
}

async function saveArtifacts(rootDir: string, payload: unknown, text: string) {
  const dataDir = resolve(rootDir, 'data');
  await mkdir(dataDir, { recursive: true });
  await Promise.all([
    writeFile(resolve(dataDir, 'latest-openclaw-feed.json'), JSON.stringify(payload, null, 2), 'utf-8'),
    writeFile(resolve(dataDir, 'latest-openclaw-message.txt'), text, 'utf-8')
  ]);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const syncResult = await runSync({ announce: false });
  const [builders, podcasts, blogs, latestDigest] = await Promise.all([
    getBuilderFeedsSeenAt(syncResult.fetchedAt, 25),
    getPodcastEpisodesSeenAt(syncResult.fetchedAt, 20),
    getBlogPostsSeenAt(syncResult.fetchedAt, 20),
    getLatestDigest()
  ]);

  const payload = {
    generatedAt: new Date().toISOString(),
    sync: syncResult,
    x: builders,
    podcasts,
    blogs,
    latestDigest
  };

  const message = latestDigest?.content ?? '本次没有生成 digest。';
  await saveArtifacts(process.cwd(), payload, message);

  if (options.json) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  console.log(message);
}

process.stdout.on('error', (error) => {
  if ((error as NodeJS.ErrnoException).code === 'EPIPE') {
    process.exit(0);
  }

  throw error;
});

void main();
