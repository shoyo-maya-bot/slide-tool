#!/usr/bin/env bash
# セットアップ（macOS / Linux / Git Bash）: Marp CLI・Tailwind・Playwright を入れ、テーマを作る
set -euo pipefail
cd "$(dirname "$0")"
npm ci --no-audit --no-fund   # package-lock.json の版どおりに入れる（同梱フォントを含む）
npx playwright install chromium
npm run theme
echo "完了: npm run check:trusted / npm run pdf:trusted（同梱のサンプルは自分たちで作った資料なので :trusted。README の「すぐ使う」）"
