# Copilot への指示（slide-tool）

Marp（Markdown）でスライドを作るリポジトリです。説明は日本語で行ってください。

- スライドは `slides/`、図は `assets/svg/`、見本は `layouts/catalog.md`
- 作るときは `/slide-create`、書き方は スキル `slide-style`、図は `slide-svg`、はみ出しは `slide-layout-fix`
- レイアウトは docs/layouts.md の L01〜L20 から選ぶ。新しい見た目を作る前に既存のレイアウトで表現できないか考える
- テーマ（themes/standard.css）は全スライドに影響する。変えるときは理由を説明し、`npm run check:trusted` で全スライドを確かめる
- `:trusted` のスクリプト（HTML とローカルのファイルを有効にする）は、このリポジトリと利用者自身が作った資料にだけ使う。人からもらった資料には使わない
- 社名・顧客名・システム名・個人名・推測の数字を書かない
- 変更したら `npm run lint` と `npm test` を実行して結果を報告する
