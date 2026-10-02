#!/usr/bin/env bash
# セットアップ（macOS / Linux / Git Bash）: Marp CLI・Tailwind・Playwright を入れ、テーマを作る
set -euo pipefail
cd "$(dirname "$0")"
npm install --no-audit --no-fund
npx playwright install chromium
npm run theme
echo "完了: npm run check / npm run pdf"
