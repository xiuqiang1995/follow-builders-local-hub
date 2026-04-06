#!/bin/bash
set -e

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_DIR"

echo "==> build..."
pnpm build

echo "==> restart PM2..."
pm2 restart follow-builders --update-env

echo "==> health check..."
sleep 2
curl -s --noproxy localhost http://localhost:3000/api/health

echo ""
echo "==> done"
