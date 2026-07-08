import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

type GitTreeResponse = {
  tree?: Array<{
    path: string;
    type: string;
  }>;
};

type BuilderPulseFeed = {
  source: 'builderpulse';
  repoUrl: string;
  reportUrl: string;
  fetchedAt: string;
  latestDate: string;
  latestPath: string;
  headline: string | null;
  buildIdea: string | null;
  top3: string[];
  archive: string[];
  markdown: string;
};

const REPO_URL = 'https://github.com/BuilderPulse/BuilderPulse';
const TREE_API = 'https://api.github.com/repos/BuilderPulse/BuilderPulse/git/trees/main?recursive=1';
const README_RAW_URL = 'https://raw.githubusercontent.com/BuilderPulse/BuilderPulse/main/README.md';
const RAW_BASE = 'https://raw.githubusercontent.com/BuilderPulse/BuilderPulse/main';

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'follow-builders-local-hub'
    }
  });

  if (!response.ok) {
    throw new Error(`Fetch failed: ${url} (${response.status})`);
  }

  return response.json() as Promise<T>;
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: {
      Accept: 'text/plain',
      'User-Agent': 'follow-builders-local-hub'
    }
  });

  if (!response.ok) {
    throw new Error(`Fetch failed: ${url} (${response.status})`);
  }

  return response.text();
}

function pickLatestChineseReportFromTree(tree: GitTreeResponse) {
  const paths = (tree.tree ?? [])
    .map((entry) => entry.path)
    .filter((path): path is string => Boolean(path))
    .filter((path) => /^zh\/\d{4}\/\d{4}-\d{2}-\d{2}\.md$/.test(path))
    .sort();

  const latestPath = paths.at(-1);
  if (!latestPath) {
    throw new Error('No BuilderPulse Chinese report found');
  }

  return {
    latestPath,
    archive: paths.slice(-14).reverse(),
    latestDate: latestPath.match(/(\d{4}-\d{2}-\d{2})\.md$/)?.[1] ?? 'unknown'
  };
}

function pickLatestChineseReportFromReadme(readme: string) {
  const matches = Array.from(readme.matchAll(/\((zh\/\d{4}\/\d{4}-\d{2}-\d{2}\.md)\)/g)).map(
    (match) => match[1]
  );
  const paths = Array.from(new Set(matches)).sort();
  const latestPath = paths.at(-1);
  if (!latestPath) {
    throw new Error('No BuilderPulse Chinese report link found in README');
  }

  return {
    latestPath,
    archive: paths.slice(-14).reverse(),
    latestDate: latestPath.match(/(\d{4}-\d{2}-\d{2})\.md$/)?.[1] ?? 'unknown'
  };
}

async function discoverLatestReport() {
  try {
    const tree = await fetchJson<GitTreeResponse>(TREE_API);
    return pickLatestChineseReportFromTree(tree);
  } catch {
    const readme = await fetchText(README_RAW_URL);
    return pickLatestChineseReportFromReadme(readme);
  }
}

function extractTop3(markdown: string) {
  const block =
    markdown.match(/> \*\*(?:Today's top 3|今日三大信号)：\*\*[\s\S]*?(?:\n\n|\n(?:Cross-referencing|交叉参考))/)?.[0] ??
    '';
  return Array.from(block.matchAll(/>\s*\d+\.\s+(.+)/g)).map((match) => match[1].trim());
}

function extractHeadline(markdown: string) {
  const top3 = extractTop3(markdown);
  return top3[0] ?? null;
}

function extractBuildIdea(markdown: string) {
  const patterns = [
    /## Action[\s\S]*?### With 2 hours today or a full weekend, what should I build\?[\s\S]*?\n\n(.+?)(?:\n\n|$)/,
    /## 行动触发[\s\S]*?### 用今天的 2 小时或一整个周末，我应该做什么？[\s\S]*?\n\n(.+?)(?:\n\n|$)/,
    /\*\*最佳 2 小时构建\*\*：(.+?)(?:\n|$)/
  ];

  for (const pattern of patterns) {
    const match = markdown.match(pattern);
    if (match?.[1]?.trim()) {
      return match[1].trim();
    }
  }

  return null;
}

function buildPreview(feed: BuilderPulseFeed) {
  return [
    `BuilderPulse Feed｜${feed.latestDate}`,
    `来源仓库：${feed.repoUrl}`,
    `报告链接：${feed.reportUrl}`,
    '',
    feed.headline ? `主标题：${feed.headline}` : null,
    feed.buildIdea ? `Build idea：${feed.buildIdea}` : null,
    '',
    'Top 3:',
    ...feed.top3.map((item, index) => `${index + 1}. ${item}`),
    '',
    '最近归档：',
    ...feed.archive
  ]
    .filter((line): line is string => Boolean(line))
    .join('\n');
}

async function main() {
  const rootDir = process.cwd();
  const dataDir = resolve(rootDir, 'data');
  await mkdir(dataDir, { recursive: true });

  const { latestPath, archive, latestDate } = await discoverLatestReport();
  const reportUrl = `${RAW_BASE}/${latestPath}`;
  const markdown = await fetchText(reportUrl);

  const feed: BuilderPulseFeed = {
    source: 'builderpulse',
    repoUrl: REPO_URL,
    reportUrl,
    fetchedAt: new Date().toISOString(),
    latestDate,
    latestPath,
    headline: extractHeadline(markdown),
    buildIdea: extractBuildIdea(markdown),
    top3: extractTop3(markdown),
    archive,
    markdown
  };

  await writeFile(resolve(dataDir, 'latest-builderpulse-feed.json'), `${JSON.stringify(feed, null, 2)}\n`, 'utf-8');
  await writeFile(resolve(dataDir, 'latest-builderpulse-preview.txt'), `${buildPreview(feed)}\n`, 'utf-8');

  console.log(
    JSON.stringify(
      {
        ok: true,
        latestDate: feed.latestDate,
        reportUrl: feed.reportUrl,
        archiveCount: feed.archive.length,
        jsonPath: resolve(dataDir, 'latest-builderpulse-feed.json'),
        previewPath: resolve(dataDir, 'latest-builderpulse-preview.txt')
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
