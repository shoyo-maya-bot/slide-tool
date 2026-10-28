@echo off
rem セットアップ（Windows）: Marp CLI・Tailwind・Playwright を入れ、テーマを作る
cd /d "%~dp0"
call npm ci --no-audit --no-fund || goto :err
call npx playwright install chromium || goto :err
call npm run theme || goto :err
echo 完了: npm run check:trusted / npm run pdf:trusted（同梱のサンプルは自分たちで作った資料なので :trusted。README の「すぐ使う」）
pause
exit /b 0
:err
echo セットアップに失敗しました。Node.js 20 以上が入っているか確認してください。
pause
exit /b 1
