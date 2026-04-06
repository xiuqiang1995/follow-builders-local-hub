import {
  getLatestDigest,
  getLatestSyncRun,
  getOverview,
  getRecentBlogPosts,
  getRecentBuilderFeeds,
  getRecentPodcastEpisodes
} from '../lib/db';

type CliOptions = {
  builders: number;
  podcasts: number;
  blogs: number;
  handle: string;
  includeDigest: boolean;
};

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    builders: 25,
    podcasts: 20,
    blogs: 20,
    handle: '',
    includeDigest: true
  };

  for (const arg of argv) {
    if (arg.startsWith('--builders=')) {
      const value = Number(arg.slice('--builders='.length));
      if (Number.isFinite(value) && value > 0) {
        options.builders = Math.floor(value);
      }
      continue;
    }

    if (arg.startsWith('--podcasts=')) {
      const value = Number(arg.slice('--podcasts='.length));
      if (Number.isFinite(value) && value > 0) {
        options.podcasts = Math.floor(value);
      }
      continue;
    }

    if (arg.startsWith('--blogs=')) {
      const value = Number(arg.slice('--blogs='.length));
      if (Number.isFinite(value) && value > 0) {
        options.blogs = Math.floor(value);
      }
      continue;
    }

    if (arg.startsWith('--handle=')) {
      options.handle = arg.slice('--handle='.length).trim();
      continue;
    }

    if (arg === '--no-digest') {
      options.includeDigest = false;
    }
  }

  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const [overview, latestSync, builders, podcasts, blogs, latestDigest] = await Promise.all([
    getOverview(),
    getLatestSyncRun(),
    getRecentBuilderFeeds(options.builders),
    getRecentPodcastEpisodes(options.podcasts),
    getRecentBlogPosts(options.blogs),
    options.includeDigest ? getLatestDigest() : Promise.resolve(null)
  ]);

  const filteredBuilders = options.handle
    ? builders.filter((builder) => builder.handle === options.handle)
    : builders;

  const payload = {
    exportedAt: new Date().toISOString(),
    scope: {
      builders: options.builders,
      podcasts: options.podcasts,
      blogs: options.blogs,
      handle: options.handle || null,
      includeDigest: options.includeDigest
    },
    overview,
    latestSync,
    x: filteredBuilders,
    podcasts,
    blogs,
    latestDigest
  };

  console.log(JSON.stringify(payload, null, 2));
}

process.stdout.on('error', (error) => {
  if ((error as NodeJS.ErrnoException).code === 'EPIPE') {
    process.exit(0);
  }

  throw error;
});

void main();
