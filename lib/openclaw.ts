import { spawnSync } from 'node:child_process';

import type { Config, SyncSummary } from './types';

function truncate(text: string, maxLength: number) {
  return text.length <= maxLength ? text : `${text.slice(0, maxLength - 1)}…`;
}

export function buildAnnouncement(syncResult: SyncSummary) {
  const lines = [
    'Follow Builders 本地同步完成',
    `同步时间: ${syncResult.finishedAt}`,
    `Feed 时间: ${syncResult.feedGeneratedAt ?? 'unknown'}`,
    `新增 tweets: ${syncResult.newTweets}`,
    `新增 podcast episodes: ${syncResult.newPodcastEpisodes}`,
    `新增 blog posts: ${syncResult.newBlogPosts}`,
    ''
  ];

  if (syncResult.blogTitles.length > 0) {
    lines.push('本次博客更新:');
    for (const title of syncResult.blogTitles.slice(0, 3)) {
      lines.push(`- ${title}`);
    }
    lines.push('');
  }

  if (syncResult.podcastTitles.length > 0) {
    lines.push('本次播客更新:');
    for (const title of syncResult.podcastTitles.slice(0, 3)) {
      lines.push(`- ${title}`);
    }
    lines.push('');
  }

  if (syncResult.topBuilderSummaries.length > 0) {
    lines.push('活跃 builders:');
    for (const item of syncResult.topBuilderSummaries.slice(0, 5)) {
      lines.push(`- ${item}`);
    }
  }

  return truncate(lines.join('\n').trim(), 3200);
}

export function sendToOpenClaw(config: Config, message: string) {
  if (!config.openclaw.enabled || config.openclaw.mode !== 'message') {
    return { skipped: true, reason: 'OpenClaw delivery disabled' } as const;
  }

  if (!config.openclaw.target) {
    throw new Error('OpenClaw 已启用，但 config.openclaw.target 为空');
  }

  const args = ['message', 'send', '--target', config.openclaw.target, '--message', message];

  if (config.openclaw.channel) {
    args.push('--channel', config.openclaw.channel);
  }

  if (config.openclaw.account) {
    args.push('--account', config.openclaw.account);
  }

  const result = spawnSync('openclaw', args, {
    encoding: 'utf-8'
  });

  if (result.status !== 0) {
    throw new Error(result.stderr?.trim() || result.stdout?.trim() || 'openclaw message send failed');
  }

  return {
    skipped: false,
    stdout: result.stdout?.trim() ?? ''
  } as const;
}
