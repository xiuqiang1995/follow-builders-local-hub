'use client';

import { startTransition, useDeferredValue, useState } from 'react';
import { useRouter } from 'next/navigation';

import type {
  BlogPostViewRecord,
  BuilderFeedViewRecord,
  DashboardData,
  DigestRecord,
  PodcastEpisodeViewRecord,
  TweetRecord
} from '@/lib/types';

type TabKey = 'builders' | 'blogs' | 'podcasts' | 'digest';

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

function truncate(text: string, limit = 240) {
  const normalized = text.replace(/\s+/g, ' ').trim();
  const chars = Array.from(normalized);
  return chars.length <= limit ? normalized : `${chars.slice(0, limit - 1).join('')}…`;
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
    return (
      <div className="summary-box">
        {summaryZh.split('\n').map((line, i) =>
          line.trim() ? <p key={i}>{parseInline(line)}</p> : <br key={i} />
        )}
      </div>
    );
  }

  if (status === 'failed') {
    return <div className="summary-box summary-box-muted">摘要生成失败，下次同步会重试。</div>;
  }

  return <div className="summary-box summary-box-muted">{emptyLabel}</div>;
}

function TweetList({ tweets }: { tweets: TweetRecord[] }) {
  return (
    <div className="feed-list">
      {tweets.map((tweet) => (
        <article className="feed-row" key={tweet.id}>
          <div className="feed-row-time">
            <time dateTime={tweet.createdAt}>{formatTime(tweet.createdAt)}</time>
            {tweet.isQuote ? <span className="feed-tag">引用帖</span> : null}
          </div>

          <div className="feed-row-body">
            <p className="feed-row-summary">{truncate(tweet.text, 280)}</p>
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
      ))}
    </div>
  );
}

function BuilderCard({ builder }: { builder: BuilderFeedViewRecord }) {
  return (
    <article className="content-card">
      <div className="content-card-head">
        <div>
          <p className="section-kicker">@{builder.handle}</p>
          <h3>{builder.name}</h3>
        </div>
        <p className="meta-line">{builder.tweetCount} 条新帖</p>
      </div>

      {builder.bio ? <p className="meta-line">{truncate(builder.bio, 140)}</p> : null}

      {builder.summaryZh || builder.summaryStatus !== 'done' ? (
        <SummaryBox
          summaryZh={builder.summaryZh}
          status={builder.summaryStatus}
          emptyLabel="Builder 摘要生成中，下次同步后会出现。"
        />
      ) : null}

      <details className="raw-details">
        <summary>展开最近帖子</summary>
        <TweetList tweets={builder.tweets.slice(0, 8)} />
      </details>
    </article>
  );
}

function PodcastCard({ episode }: { episode: PodcastEpisodeViewRecord }) {
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
        emptyLabel="播客摘要生成中，下次同步后会出现。"
      />

      <details className="raw-details">
        <summary>Transcript</summary>
        <div className="raw-content">
          <p>{truncate(episode.transcript, 1000)}</p>
        </div>
      </details>
    </article>
  );
}

function BlogCard({ post }: { post: BlogPostViewRecord }) {
  return (
    <article className="content-card">
      <div className="content-card-head">
        <div>
          <p className="section-kicker">{post.blogName}</p>
          <h3>{post.title}</h3>
        </div>
        <a href={post.url} rel="noreferrer" target="_blank">
          打开原文
        </a>
      </div>

      <p className="meta-line">
        {post.author ? `${post.author} · ` : ''}
        {formatDateTime(post.publishedAt)}
      </p>

      <SummaryBox
        summaryZh={post.summaryZh}
        status={post.summaryStatus}
        emptyLabel="博客摘要生成中，下次同步后会出现。"
      />

      <details className="raw-details">
        <summary>文章片段</summary>
        <div className="raw-content">
          <p>{truncate(post.content || post.description, 1200)}</p>
        </div>
      </details>
    </article>
  );
}

// Parse inline markdown: **bold** and [text](url)
function parseInline(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  const re = /(\*\*(.+?)\*\*|\[([^\]]+)\]\((https?:\/\/[^)]+)\))/g;
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    if (match.index > last) parts.push(text.slice(last, match.index));
    if (match[2] !== undefined) {
      parts.push(<strong key={match.index}>{match[2]}</strong>);
    } else if (match[3] !== undefined && match[4] !== undefined) {
      parts.push(<a key={match.index} href={match[4]} target="_blank" rel="noopener noreferrer">{match[3]}</a>);
    }
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

// Strip surrounding ** so pattern matching works regardless of bold wrapping
function stripBold(text: string) {
  return text.replace(/^\*\*(.+)\*\*$/, '$1');
}

function renderDigestLine(line: string, index: number) {
  if (!line.trim()) {
    return <div aria-hidden="true" className="digest-spacer" key={`spacer-${index}`} />;
  }

  const bare = stripBold(line.trim());

  if (bare.startsWith('AI Builders Digest｜')) {
    return (
      <div className="digest-line digest-line-title" key={index}>
        {parseInline(line)}
      </div>
    );
  }

  if (/^\d+）/.test(bare)) {
    return (
      <div className="digest-line digest-line-section" key={index}>
        {parseInline(bare)}
      </div>
    );
  }

  if (line.startsWith('• ') || line.startsWith('- ')) {
    return (
      <div className="digest-line digest-line-topic" key={index}>
        {parseInline(line)}
      </div>
    );
  }

  // Markdown link on its own line → render as link line
  if (/^\[.+\]\(https?:\/\/.+\)$/.test(line.trim())) {
    return (
      <div className="digest-line digest-line-link" key={index}>
        {parseInline(line)}
      </div>
    );
  }

  if (line.startsWith('原文：') || line.startsWith('链接：')) {
    return (
      <div className="digest-line digest-line-link" key={index}>
        {parseInline(line)}
      </div>
    );
  }

  if (bare.startsWith('结论：')) {
    return (
      <div className="digest-line digest-line-conclusion" key={index}>
        {parseInline(line)}
      </div>
    );
  }

  return (
    <div className="digest-line" key={index}>
      {parseInline(line)}
    </div>
  );
}

function DigestPanel({ digest }: { digest: DigestRecord | null }) {
  return (
    <section className="workspace-panel">
      <div className="workspace-head">
        <div>
          <p className="section-kicker">Digest</p>
          <h2>AI Builders Digest</h2>
          <p className="workspace-note">直接展示完整 digest，不再做概览摘要。</p>
        </div>
      </div>

      <article className="content-card">
        {digest?.content ? (
          <div className="digest-card">
            {digest.content.split('\n').map((line, index) => renderDigestLine(line, index))}
          </div>
        ) : (
          <p className="empty-state">还没有 digest。先执行一次同步。</p>
        )}
      </article>
    </section>
  );
}

export function DashboardShell({ dashboard }: { dashboard: DashboardData }) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<TabKey>('digest');
  const [builderSearch, setBuilderSearch] = useState('');
  const [selectedBuilder, setSelectedBuilder] = useState<string>('all');
  const deferredSearch = useDeferredValue(builderSearch);
  const normalizedQuery = deferredSearch.trim().toLowerCase();
  const filteredBuilders = normalizedQuery
    ? dashboard.recentBuilders.filter((builder) => {
        return (
          builder.name.toLowerCase().includes(normalizedQuery) ||
          builder.handle.toLowerCase().includes(normalizedQuery)
        );
      })
    : dashboard.recentBuilders;

  const visibleBuilders =
    selectedBuilder === 'all'
      ? filteredBuilders
      : filteredBuilders.filter((builder) => builder.handle === selectedBuilder);

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
          <h1>AI Builders Digest</h1>
          <p className="app-subtitle">feed 和 prompt 都按 Zara 开源仓库对齐，本地只做同步、存储和展示。</p>
        </div>

        <div className="header-status">
          <span className="status-chip">{formatSyncStatus(dashboard.latestSync?.status)}</span>
          <p>远端 feed: {formatDateTime(dashboard.latestSync?.feedGeneratedAt ?? null)}</p>
          <p>本地同步: {formatDateTime(dashboard.latestSync?.finishedAt ?? null)}</p>
        </div>
      </header>

      <div className="app-layout">
        <aside className="nav-column">
          <section className="sidebar-panel" style={{ animation: 'fadeSlideUp 500ms ease both', animationDelay: '150ms' }}>
            <p className="section-kicker">Views</p>
            <div className="view-list" role="tablist" aria-label="dashboard tabs">
              <button
                className={activeTab === 'builders' ? 'view-button is-active' : 'view-button'}
                aria-selected={activeTab === 'builders'}
                onClick={() => changeTab('builders')}
                role="tab"
                type="button"
              >
                Builders
              </button>
              <button
                className={activeTab === 'blogs' ? 'view-button is-active' : 'view-button'}
                aria-selected={activeTab === 'blogs'}
                onClick={() => changeTab('blogs')}
                role="tab"
                type="button"
              >
                Blogs
              </button>
              <button
                className={activeTab === 'podcasts' ? 'view-button is-active' : 'view-button'}
                aria-selected={activeTab === 'podcasts'}
                onClick={() => changeTab('podcasts')}
                role="tab"
                type="button"
              >
                Podcasts
              </button>
              <button
                className={activeTab === 'digest' ? 'view-button is-active' : 'view-button'}
                aria-selected={activeTab === 'digest'}
                onClick={() => changeTab('digest')}
                role="tab"
                type="button"
              >
                Digest
              </button>
            </div>
          </section>

          {activeTab === 'builders' ? (
            <section className="sidebar-panel" style={{ animation: 'fadeSlideUp 500ms ease both', animationDelay: '250ms' }}>
              <div className="sidebar-head">
                <div>
                  <p className="section-kicker">Builders</p>
                  <h2>作者筛选</h2>
                </div>
                <span className="sidebar-count">{filteredBuilders.length}</span>
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
                  className={selectedBuilder === 'all' ? 'builder-button is-active' : 'builder-button'}
                  onClick={() => selectBuilder('all')}
                  type="button"
                >
                  <span>全部作者</span>
                  <span>{filteredBuilders.length}</span>
                </button>

                {filteredBuilders.map((builder) => (
                  <button
                    className={
                      selectedBuilder === builder.handle
                        ? 'builder-button is-active'
                        : 'builder-button'
                    }
                    key={builder.handle}
                    onClick={() => selectBuilder(builder.handle)}
                    type="button"
                  >
                    <span>
                      {builder.name}
                      <small>@{builder.handle}</small>
                    </span>
                    <span>{builder.tweetCount}</span>
                  </button>
                ))}
              </div>
            </section>
          ) : (
            <section className="sidebar-panel" style={{ animation: 'fadeSlideUp 500ms ease both', animationDelay: '250ms' }}>
              <p className="section-kicker">Mode</p>
              <p className="sidebar-note">
                {activeTab === 'blogs'
                  ? '博客和播客按上游 prompt 摘要。'
                  : activeTab === 'podcasts'
                    ? '先看 remix，再决定是否展开 transcript。'
                    : 'Digest 直接按 Zara 的三段式输出。'}
              </p>
            </section>
          )}
        </aside>

        <section className="workspace-column">
          {activeTab === 'builders' ? (
            <section className="workspace-panel">
              <div className="workspace-head">
                <div>
                  <p className="section-kicker">Builders</p>
                  <h2>{selectedBuilder === 'all' ? 'Builder 摘要流' : visibleBuilders[0]?.name ?? 'Builder'}</h2>
                  <p className="workspace-note">每个 builder 一段摘要，下面挂它这轮 feed 里的原帖。</p>
                </div>
              </div>

              <div className="content-list">
                {visibleBuilders.length > 0 ? (
                  visibleBuilders.map((builder) => <BuilderCard builder={builder} key={builder.handle} />)
                ) : (
                  <div className="empty-panel">
                    <p className="empty-state">当前没有匹配的 builder 内容。</p>
                  </div>
                )}
              </div>
            </section>
          ) : null}

          {activeTab === 'blogs' ? (
            <section className="workspace-panel">
              <div className="workspace-head">
                <div>
                  <p className="section-kicker">Blogs</p>
                  <h2>官方博客</h2>
                  <p className="workspace-note">Anthropic Engineering / Claude Blog 等官方更新。</p>
                </div>
              </div>

              <div className="content-list">
                {dashboard.recentBlogs.length > 0 ? (
                  dashboard.recentBlogs.map((post) => <BlogCard key={post.url} post={post} />)
                ) : (
                  <div className="empty-panel">
                    <p className="empty-state">当前远端 blogs feed 没有新文章。</p>
                  </div>
                )}
              </div>
            </section>
          ) : null}

          {activeTab === 'podcasts' ? (
            <section className="workspace-panel">
              <div className="workspace-head">
                <div>
                  <p className="section-kicker">Podcasts</p>
                  <h2>播客 remix</h2>
                  <p className="workspace-note">按 Zara 的 podcast remix prompt 输出。</p>
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
              <div>
                <dt>新增博客</dt>
                <dd>{dashboard.latestSync?.newBlogPosts ?? 0}</dd>
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
                <dt>Blogs</dt>
                <dd>{dashboard.overview.blogPosts}</dd>
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
