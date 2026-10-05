# slide-tool

Markdown（[Marp](https://marp.app/)）でスライドを作り、PDF / PPTX に出力するためのリポジトリです。
レイアウト集・標準テーマ（Tailwind のユーティリティ付き）・文字量とはみ出しのチェック・Copilot のスキルをまとめています。

- **レイアウト集**: 表紙・比較・指標・タイムライン・マトリクスなど 20 種類（[docs/layouts.md](docs/layouts.md)、見本は `layouts/catalog.md`）
- **チェック**: 文字量・箇条書きの数・タイトルの長さ・画像の代替テキスト・禁止語（静的）と、描画したときのはみ出し（ブラウザ）
- **手順**: 目的 → 骨子 → レイアウト → 本文と図 → チェック → 出力の 6 ステップ（[docs/workflow.md](docs/workflow.md)）
- **Copilot**: `/slide-create` と、スキル `slide-style`（文体）・`slide-layout-fix`（はみ出しの直し方）・`slide-svg`（図）

## すぐ使う

必要なもの: Node.js 20 以上（無料）。PDF / PPTX の出力には Chrome か Edge（Marp CLI が使う）。

1. clone する
2. **Windows**: `setup.cmd` をダブルクリック ／ **macOS・Linux**: `./setup.sh`
3. サンプルを出力する

```bash
npm run pdf       # slides/*.md → dist/*.pdf
npm run pptx      # → dist/*.pptx（スライドは画像として入る）
npm run catalog   # レイアウト集 → dist/catalog.pdf
npm run check     # 静的チェック + はみ出しチェック
npm run watch     # 編集しながらブラウザでプレビュー
```

VS Code では拡張機能「Marp for VS Code」でプレビューできます（`npm run theme` を先に 1 回）。

## スライドの書き方

```markdown
---
marp: true
theme: standard
paginate: true
---

<!-- _class: title -->

# 資料のタイトル

サブタイトル

---

# 1 枚に 1 メッセージ。タイトルに結論を書く

<div class="cols cols-2">
<div class="card">

### 現状

- 手作業で転記している

</div>
<div class="card accent">

### 導入後

- 自動で転記する

</div>
</div>
```

HTML の中に Markdown を書くときは前後に空行を入れます。細かい調整には Tailwind のクラス（`mt-4`、`text-sm` など）が使えます。

## チェックの内容

| 種類 | ルール | 既定の上限（`config/slide-lint.json`） |
|---|---|---|
| error | 見出しが無い / 箇条書きが多い / 本文が多い / 禁止語 / `marp: true` が無い | 箇条書き 6 個、本文 260 字 |
| warning | タイトルが長い / 入れ子が深い / 画像の代替テキストが無い / 定義に無いレイアウト | タイトル 全角 32 字、入れ子 2 段 |
| error（SVG） | viewBox が無い / 外部参照 / script | |
| error（描画） | スライドの外にはみ出す（outside）/ 箱の中で切れる（clipped）/ 高さを超える（too_tall） | 許容 3px |

`bannedTerms` に社名・顧客名・システム名などを登録すると、資料に入ったときに止まります。

## 構成

```text
slides/        スライド（1 ファイル = 1 資料）
layouts/       レイアウト集（catalog.md）
assets/svg/    図（SVG）
themes/        テーマ（standard.css）と Tailwind の入力
scripts/       テーマの結合・静的チェック・はみ出しチェック
config/        チェックの設定
docs/          レイアウト一覧・作成手順
```

## 開発

```bash
npm test          # node:test（チェックのスクリプトのテスト）
npm run lint
```

## セキュリティ・ライセンス

- 脆弱性を見つけたら、公開の Issue ではなく [SECURITY.md](SECURITY.md) の方法で知らせてください
- ライセンスは [MIT](LICENSE) です
