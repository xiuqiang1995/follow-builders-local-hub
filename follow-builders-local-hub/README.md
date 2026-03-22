# Follow Builders Local Hub

这是一个按 `Next.js + TypeScript + App Router + pnpm` 重建后的本地数据台，用来把 `follow-builders` 的公共 feed 同步到你的机器上，并提供：

- 本地 SQLite 入库
- 本地 digest 生成
- 英文原文 + 中文摘要 + 原文跳转
- 可选通过 OpenClaw 发送同步摘要
- 页面和 JSON API 查看数据

## 技术基座

- Next.js 16
- TypeScript
- App Router（`/app`）
- pnpm（通过 corepack）
- Vitest
- Playwright

## 目录

- `app/`：页面和 API Route
- `lib/`：配置、数据库、同步、OpenClaw 集成
- `scripts/sync.ts`：CLI 同步入口
- `tests/`：Vitest
- `e2e/`：Playwright

## 首次启动

1. 安装依赖：

```bash
pnpm install
```

2. 同步数据：

```bash
pnpm sync
```

3. 启动开发环境：

```bash
pnpm dev
```

打开 `http://127.0.0.1:3000` 查看。

## 开发门禁

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm e2e
```

## 配置

本地配置文件：

`config/config.json`

字段包括：

- `databasePath`
- `feeds.xUrl`
- `feeds.podcastsUrl`
- `summaries.enabled`
- `summaries.tweetModel`
- `summaries.podcastModel`
- `summaries.maxTweetChars`
- `summaries.maxPodcastChars`
- `openclaw.mode`
- `openclaw.channel`
- `openclaw.target`
- `openclaw.account`
- `openclaw.enabled`

如果你不想提交本地配置，`.gitignore` 已经忽略 `config/config.json`。

## OpenClaw

如果只是同步和查看页面，不需要开启 OpenClaw。

如果要让每次同步后顺手推送摘要，把 `config/config.json` 改成类似这样：

```json
{
  "databasePath": "./data/follow-builders.db",
  "feeds": {
    "xUrl": "https://raw.githubusercontent.com/zarazhangrui/follow-builders/main/feed-x.json",
    "podcastsUrl": "https://raw.githubusercontent.com/zarazhangrui/follow-builders/main/feed-podcasts.json"
  },
  "openclaw": {
    "mode": "message",
    "channel": "telegram",
    "target": "123456789",
    "account": "",
    "enabled": true
  }
}
```

然后执行：

```bash
pnpm sync:announce
```

## API

- `GET /api/health`
- `GET /api/dashboard`
- `GET /api/tweets?limit=100&handle=karpathy`
- `GET /api/podcasts?limit=50`
- `GET /api/digests?limit=50`

## 中文摘要来源

同步时会为每条 tweet 和每个 podcast episode 生成中文摘要，并写入 `content_summaries` 表。

凭证读取顺序：

1. `OPENAI_API_KEY` / `OPENAI_BASE_URL`
2. `~/.codex/auth.json`
3. `~/.codex/config.toml`

当前实现默认会复用你的 Codex OpenAI 兼容配置，并使用：

- tweet: `gpt-5-nano`
- podcast: `gpt-5-mini`

## OpenClaw 定时建议

建议让 OpenClaw 每天定时触发 agent，再由 agent 进入项目目录执行：

```bash
openclaw cron add \
  --name "follow-builders-sync" \
  --cron "0 9 * * *" \
  --tz "Asia/Shanghai" \
  --session isolated \
  --message "进入 /Users/aqiang/Documents/ccodex/follow-builders-local-hub，执行 pnpm sync:announce。如果失败，汇报错误；如果成功，简要汇报新增 tweets 和播客数量。" \
  --announce \
  --channel telegram \
  --to "123456789" \
  --exact
```

## 数据库

SQLite 默认位置：

`./data/follow-builders.db`

表包括：

- `sync_runs`
- `feed_snapshots`
- `builders`
- `tweets`
- `podcast_episodes`
- `digests`
