'use client';

import { startTransition, useDeferredValue, useState } from 'react';

import type {
  DashboardData,
  DigestRecord,
  PodcastEpisodeViewRecord,
  TweetViewRecord
} from '@/lib/types';

type TabKey = 'builders' | 'podcasts' | 'digest';

type BuilderGroup = {
  handle: string;
  name: string;
  tweets: TweetViewRecord[];
  count: number;
  latestAt: string;
};

type FeedSection = {
  key: string;
  label: string;
  tweets: TweetViewRecord[];
};

const SHANGHAI_TIMEZONE = 'Asia/Shanghai';

function formatDateTime(value: string | null) {
  if (!value) {
    return '未知';
  }

  return new Intl.DateTimeFormat('zh-CN', {
    dateStyle: 'medium',
    timeStyle: 'short',
    hour12: false,
    timeZone: SHANGHAI_TIMEZONE
  }).format(new Date(value));
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: SHANGHAI_TIMEZONE
  }).format(new Date(value));
}

function formatDayKey(value: string) {
  return new Intl.DateTimeFormat('sv-SE', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: SHANGHAI_TIMEZONE
  }).format(new Date(value));
}

function formatDayLabel(value: string) {
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'long',
    day: 'numeric',
    weekday: 'short',
    timeZone: SHANGHAI_TIMEZONE
  }).format(new Date(value));
}

function truncate(text: string, limit = 220) {
  return text.length <= limit ? text : `${text.slice(0, limit - 1)}…`;
}

function summarizeDigest(digest: DigestRecord | null) {
  if (!digest?.content) {
    return [];
  }

  return digest.content
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .slice(0, 8);
}

function groupTweetsByBuilder(tweets: TweetViewRecord[]) {
  const grouped = new Map<string, BuilderGroup>();

  for (const tweet of tweets) {
    const existing = grouped.get(tweet.builderHandle);
    if (existing) {
      existing.tweets.push(tweet);
      existing.count += 1;
      if (tweet.createdAt > existing.latestAt) {
        existing.latestAt = tweet.createdAt;
      }
      continue;
    }

    grouped.set(tweet.builderHandle, {
      handle: tweet.builderHandle,
      name: tweet.builderName,
      tweets: [tweet],
      count: 1,
      latestAt: tweet.createdAt
    });
  }

  return Array.from(grouped.values()).sort((left, right) => {
    if (right.count !== left.count) {
      return right.count - left.count;
    }

    return right.latestAt.localeCompare(left.latestAt);
  });
}

function buildFeedSections(tweets: TweetViewRecord[]) {
  const grouped = new Map<string, FeedSection>();

  for (const tweet of tweets) {
    const key = formatDayKey(tweet.createdAt);
    const existing = grouped.get(key);

    if (existing) {
      existing.tweets.push(tweet);
      continue;
    }

    grouped.set(key, {
      key,
      label: formatDayLabel(tweet.createdAt),
      tweets: [tweet]
    });
  }

  return Array.from(grouped.values()).sort((left, right) => left.key.localeCompare(right.key));
}

function formatSyncStatus(status: string | null | undefined) {
  if (status === 'success') {
    return '同步成功';
  }

  if (status === 'failed') {
    return '同步失败';
  }

  if (status === 'running') {
    return '同步中';
  }

  return '等待同步';
}

function SummaryBox({
  summaryZh,
  status,
  emptyLabel
}: {
  summaryZh: string | null;
  status: string | null;
  emptyLabel: string;
}) {
  if (summaryZh) {
    return <div className="summary-box">{summaryZh}</div>;
  }

  if (status === 'failed') {
    return <div className="summary-box summary-box-muted">摘要生成失败，下次同步会重试。</div>;
  }

  return <div className="summary-box summary-box-muted">{emptyLabel}</div>;
}

function TweetRow({
  tweet
}: {
  tweet: TweetViewRecord;
}) {
  const summaryText =
    tweet.summaryZh ??
    (tweet.summaryStatus === 'failed'
      ? '摘要生成失败，下次同步会重试。'
      : '摘要生成中，下次同步后会出现中文摘要。');

  return (
    <article className="feed-row">
      <div className="feed-row-time">
        <time dateTime={tweet.createdAt}>{formatTime(tweet.createdAt)}</time>
        {tweet.isQuote ? <span className="feed-tag">引用帖</span> : null}
      </div>

      <div className="feed-row-body">
        <div className="feed-row-head">
          <div>
            <h3>{tweet.builderName}</h3>
            <p>@{tweet.builderHandle}</p>
          </div>
        </div>

        <p className={tweet.summaryZh ? 'feed-row-summary' : 'feed-row-summary is-muted'}>
          {truncate(summaryText)}
        </p>

        <div className="feed-row-footer">
          <div className="feed-row-stats" aria-label="tweet metrics">
            <span>❤️ {tweet.likes}</span>
            <span>🔁 {tweet.retweets}</span>
            <span>💬 {tweet.replies}</span>
          </div>

          <div className="feed-row-actions">
            <a href={tweet.url} rel="noreferrer" target="_blank">
              打开原文
            </a>
          </div>
        </div>
      </div>
    </article>
  );
}

function PodcastCard({
  episode
}: {
  episode: PodcastEpisodeViewRecord;
}) {
  return (
    <article className="content-card">
      <div className="content-card-head">
        <div>
          <p className="section-kicker">{episode.podcastName}</p>
          <h3>{episode.title}</h3>
        </div>
        <a href={episode.url} rel="noreferrer" target="_blank">
          打开视频
        </a>
      </div>

      <p className="meta-line">{formatDateTime(episode.publishedAt)}</p>

      <SummaryBox
        summaryZh={episode.summaryZh}
        status={episode.summaryStatus}
        emptyLabel="摘要生成中，下次同步后会出现中文摘要。"
      />

      <details className="raw-details">
        <summary>Transcript</summary>
        <div className="raw-content">
          <p>{truncate(episode.transcript, 900)}</p>
        </div>
      </details>
    </article>
  );
}

function DigestPanel({
  digest
}: {
  digest: DigestRecord | null;
}) {
  const digestLines = summarizeDigest(digest);

  return (
    <section className="workspace-panel">
      <div className="workspace-head">
        <div>
          <p className="section-kicker">Digest</p>
          <h2>今日摘要</h2>
          <p className="workspace-note">只保留概览，需要时再展开全文。</p>
        </div>
      </div>

      <article className="content-card">
        {digestLines.length > 0 ? (
          <ul className="digest-summary-list">
            {digestLines.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        ) : (
          <p className="empty-state">还没有 digest。先执行一次同步。</p>
        )}

        {digest?.content ? (
          <details className="raw-details">
            <summary>完整 digest</summary>
            <pre className="digest-card">{digest.content}</pre>
          </details>
        ) : null}
      </article>
    </section>
  );
}

export function DashboardShell({
  dashboard
}: {
  dashboard: DashboardData;
}) {
  const [activeTab, setActiveTab] = useState<TabKey>('builders');
  const [builderSearch, setBuilderSearch] = useState('');
  const [selectedBuilder, setSelectedBuilder] = useState<string>('all');
  const deferredSearch = useDeferredValue(builderSearch);

  const builderGroups = groupTweetsByBuilder(dashboard.recentTweets);
  const normalizedQuery = deferredSearch.trim().toLowerCase();
  const filteredGroups = normalizedQuery
    ? builderGroups.filter((group) => {
        return (
          group.name.toLowerCase().includes(normalizedQuery) ||
          group.handle.toLowerCase().includes(normalizedQuery)
        );
      })
    : builderGroups;

  const effectiveSelectedBuilder =
    selectedBuilder !== 'all' && filteredGroups.some((group) => group.handle === selectedBuilder)
      ? selectedBuilder
      : 'all';

  const selectedGroup =
    effectiveSelectedBuilder === 'all'
      ? null
      : filteredGroups.find((group) => group.handle === effectiveSelectedBuilder) ?? null;

  const visibleTweetCount = filteredGroups.reduce((count, group) => count + group.tweets.length, 0);
  const feedTweets = (selectedGroup ? selectedGroup.tweets : filteredGroups.flatMap((group) => group.tweets))
    .slice()
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  const feedSections = buildFeedSections(feedTweets);

  function changeTab(tab: TabKey) {
    startTransition(() => {
      setActiveTab(tab);
    });
  }

  function selectBuilder(handle: string) {
    startTransition(() => {
      setSelectedBuilder(handle);
    });
  }

  return (
    <main className="app-shell">
      <header className="app-header">
        <div>
          <p className="section-kicker">Follow Builders Local Hub</p>
          <h1>Builders Feed</h1>
          <p className="app-subtitle">中文摘要优先，按时间刷完，再决定是否点开原文。</p>
        </div>

        <div className="header-status">
          <span className="status-chip">{formatSyncStatus(dashboard.latestSync?.status)}</span>
          <p>远端 feed: {formatDateTime(dashboard.latestSync?.feedGeneratedAt ?? null)}</p>
          <p>本地同步: {formatDateTime(dashboard.latestSync?.finishedAt ?? null)}</p>
        </div>
      </header>

      <div className="app-layout">
        <aside className="nav-column">
          <section className="sidebar-panel">
            <p className="section-kicker">Views</p>
            <div className="view-list" role="tablist" aria-label="dashboard tabs">
              <button
                className={activeTab === 'builders' ? 'view-button is-active' : 'view-button'}
                onClick={() => changeTab('builders')}
                role="tab"
                type="button"
              >
                Builders
              </button>
              <button
                className={activeTab === 'podcasts' ? 'view-button is-active' : 'view-button'}
                onClick={() => changeTab('podcasts')}
                role="tab"
                type="button"
              >
                Podcasts
              </button>
              <button
                className={activeTab === 'digest' ? 'view-button is-active' : 'view-button'}
                onClick={() => changeTab('digest')}
                role="tab"
                type="button"
              >
                Digest
              </button>
            </div>
          </section>

          {activeTab === 'builders' ? (
            <section className="sidebar-panel">
              <div className="sidebar-head">
                <div>
                  <p className="section-kicker">Builders</p>
                  <h2>作者筛选</h2>
                </div>
                <span className="sidebar-count">{filteredGroups.length}</span>
              </div>

              <label className="sidebar-search">
                <span>搜索</span>
                <input
                  onChange={(event) => setBuilderSearch(event.target.value)}
                  placeholder="name / handle"
                  type="search"
                  value={builderSearch}
                />
              </label>

              <div className="builder-list" role="list">
                <button
                  className={effectiveSelectedBuilder === 'all' ? 'builder-button is-active' : 'builder-button'}
                  onClick={() => selectBuilder('all')}
                  type="button"
                >
                  <span>全部作者</span>
                  <span>{visibleTweetCount}</span>
                </button>

                {filteredGroups.map((group) => (
                  <button
                    className={
                      effectiveSelectedBuilder === group.handle
                        ? 'builder-button is-active'
                        : 'builder-button'
                    }
                    key={group.handle}
                    onClick={() => selectBuilder(group.handle)}
                    type="button"
                  >
                    <span>
                      {group.name}
                      <small>@{group.handle}</small>
                    </span>
                    <span>{group.count}</span>
                  </button>
                ))}
              </div>
            </section>
          ) : (
            <section className="sidebar-panel">
              <p className="section-kicker">Mode</p>
              <p className="sidebar-note">
                {activeTab === 'podcasts'
                  ? '先扫中文摘要，再决定是否展开 transcript。'
                  : 'Digest 只保留概览，完整内容按需展开。'}
              </p>
            </section>
          )}
        </aside>

        <section className="workspace-column">
          {activeTab === 'builders' ? (
            <section className="workspace-panel">
              <div className="workspace-head">
                <div>
                  <p className="section-kicker">Feed</p>
                  <h2>{selectedGroup ? selectedGroup.name : '推文流'}</h2>
                  <p className="workspace-note">
                    {selectedGroup
                      ? `@${selectedGroup.handle} · ${selectedGroup.count} 条，按北京时间从早到晚。`
                      : `全部作者 · ${feedTweets.length} 条，按北京时间从早到晚。`}
                  </p>
                </div>
              </div>

              {feedSections.length > 0 ? (
                <div className="feed-sections">
                  {feedSections.map((section) => (
                    <section className="day-section" key={section.key}>
                      <div className="day-divider">
                        <span>{section.label}</span>
                      </div>
                      <div className="feed-list">
                        {section.tweets.map((tweet) => (
                          <TweetRow key={tweet.id} tweet={tweet} />
                        ))}
                      </div>
                    </section>
                  ))}
                </div>
              ) : (
                <div className="empty-panel">
                  <p className="empty-state">当前没有匹配的 builder 内容。</p>
                </div>
              )}
            </section>
          ) : null}

          {activeTab === 'podcasts' ? (
            <section className="workspace-panel">
              <div className="workspace-head">
                <div>
                  <p className="section-kicker">Podcasts</p>
                  <h2>播客摘要</h2>
                  <p className="workspace-note">先看中文摘要，需要时再展开 transcript。</p>
                </div>
              </div>

              <div className="content-list">
                {dashboard.recentPodcasts.map((episode) => (
                  <PodcastCard episode={episode} key={episode.videoId} />
                ))}
              </div>
            </section>
          ) : null}

          {activeTab === 'digest' ? <DigestPanel digest={dashboard.latestDigest} /> : null}
        </section>

        <aside className="context-column">
          <section className="context-panel">
            <p className="section-kicker">Sync</p>
            <h2>同步状态</h2>
            <dl className="stats-list">
              <div>
                <dt>远端生成</dt>
                <dd>{formatDateTime(dashboard.latestSync?.feedGeneratedAt ?? null)}</dd>
              </div>
              <div>
                <dt>本地完成</dt>
                <dd>{formatDateTime(dashboard.latestSync?.finishedAt ?? null)}</dd>
              </div>
              <div>
                <dt>新增 tweets</dt>
                <dd>{dashboard.latestSync?.newTweets ?? 0}</dd>
              </div>
              <div>
                <dt>新增播客</dt>
                <dd>{dashboard.latestSync?.newPodcastEpisodes ?? 0}</dd>
              </div>
            </dl>
          </section>

          <section className="context-panel">
            <p className="section-kicker">Overview</p>
            <h2>数据概览</h2>
            <dl className="stats-list">
              <div>
                <dt>Builders</dt>
                <dd>{dashboard.overview.builders}</dd>
              </div>
              <div>
                <dt>Tweets</dt>
                <dd>{dashboard.overview.tweets}</dd>
              </div>
              <div>
                <dt>Podcasts</dt>
                <dd>{dashboard.overview.podcastEpisodes}</dd>
              </div>
              <div>
                <dt>Summaries</dt>
                <dd>{dashboard.overview.summaries}</dd>
              </div>
            </dl>
          </section>

          <section className="context-panel">
            <p className="section-kicker">Active builders</p>
            <h2>最近更活跃</h2>
            <ul className="mini-list">
              {dashboard.topBuilders.slice(0, 6).map((builder) => (
                <li key={builder.handle}>
                  <div>
                    <strong>{builder.name}</strong>
                    <span>@{builder.handle}</span>
                  </div>
                  <span>{builder.tweetCount}</span>
                </li>
              ))}
            </ul>
          </section>
        </aside>
      </div>
    </main>
  );
}
