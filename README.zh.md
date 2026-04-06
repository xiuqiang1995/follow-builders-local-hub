# Follow Builders Local Hub

中文 | [English](./README.md)

本地自托管的 [follow-builders](https://github.com/zarazhangrui/follow-builders) 工作台。同步公开 feed，用 AI 生成中文摘要，每天推送 digest 到你的 Telegram。

Feed 来源、prompt 设计、builder 名单全部对齐上游开源仓库，本项目只做同步、存储、摘要生成和展示。

## 功能

- 同步 X（Twitter）动态、播客、博客，来自 follow-builders 公开 feed
- 用任意 OpenAI 兼容模型生成中文摘要
- 生成每日 digest 并推送到 Telegram
- 本地只读 dashboard，访问 `http://localhost:3000`

## 环境要求

- Node.js 22+
- pnpm
- OpenAI 兼容的 API Key（OpenRouter 免费套餐即可）

## 安装

### 1. 克隆并安装依赖

```bash
git clone https://github.com/xiuqiang1995/follow-builders-local-hub.git
cd follow-builders-local-hub
pnpm install
```

### 2. 配置文件

复制示例配置：

```bash
cp config/config.example.json config/config.json
```

`config/config.json` 控制 feed 地址、摘要行为和模型选择，默认值开箱即用。

### 3. 配置 API Key

在项目根目录创建 `.env.local`：

```bash
# 必填：OpenRouter（免费套餐可用）
OPENROUTER_API_KEY=你的 key
OPENROUTER_DEFAULT_MODEL=qwen/qwen3.6-plus:free

# 可选：Telegram 推送
TELEGRAM_BOT_TOKEN=你的 bot token
TELEGRAM_CHAT_ID=你的 chat id

# 可选：主模型限流时的备用模型
CAOWO_API_KEY=你的 key
CAOWO_MODEL=gpt-5.4-mini
```

**各项说明：**

| 变量 | 获取方式 |
|------|----------|
| `OPENROUTER_API_KEY` | [openrouter.ai/keys](https://openrouter.ai/keys)，免费套餐可用 |
| `TELEGRAM_BOT_TOKEN` | 在 Telegram 找 [@BotFather](https://t.me/BotFather) 创建 bot |
| `TELEGRAM_CHAT_ID` | 给 bot 发一条消息，然后访问 `https://api.telegram.org/bot<TOKEN>/getUpdates` 查看 `chat.id` |

### 4. 构建并启动

```bash
pnpm build
node node_modules/next/dist/bin/next start
```

访问 `http://localhost:3000` 查看 dashboard。

### 5. 触发第一次同步

```bash
curl -X POST http://localhost:3000/api/sync
```

### 6. 生成摘要

```bash
OPENROUTER_API_KEY=你的 key OPENROUTER_DEFAULT_MODEL=qwen/qwen3.6-plus:free \
  pnpm tsx scripts/refresh-summaries.ts
```

## 用 PM2 常驻后台

```bash
npm install -g pm2
pm2 start node --name follow-builders -- node_modules/next/dist/bin/next start
pm2 save
pm2 startup  # 按提示执行打印出的命令以开机自启
```

## 通过 Cloudflare Tunnel 公网访问

让手机或其他人也能访问你的 dashboard：

```bash
brew install cloudflare/cloudflare/cloudflared
cloudflared tunnel login
cloudflared tunnel create follow-builders
cloudflared tunnel route dns follow-builders your.domain.com
```

创建 `~/.cloudflared/config.yml`：

```yaml
tunnel: <your-tunnel-id>
credentials-file: /Users/<你的用户名>/.cloudflared/<your-tunnel-id>.json
protocol: http2

ingress:
  - hostname: your.domain.com
    service: http://localhost:3000
  - service: http_status:404
```

加入 PM2：

```bash
pm2 start "cloudflared tunnel run follow-builders" --name cloudflared
pm2 save
```

## 目录结构

```
app/          Next.js App Router 页面和 API 路由
components/   Dashboard UI
lib/          核心逻辑（同步、摘要生成、数据库、模型配置）
prompts/      摘要 prompt 模板
scripts/      CLI 工具（refresh-summaries、deploy）
config/       config.example.json — 复制为 config.json 使用
```

## 致谢

Feed 数据和 prompt 设计来自 [Zara](https://github.com/zarazhangrui/follow-builders)。
