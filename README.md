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
npm run pdf:trusted     # slides/*.md → dist/*.pdf（自分で作った資料。HTML とローカルのファイルを有効にする）
npm run pptx:trusted    # → dist/*.pptx（スライドは画像として入る）
npm run catalog         # レイアウト集 → dist/catalog.pdf（同梱の資料なので HTML を有効にして出力）
npm run check:trusted   # 静的チェック + はみ出しチェック
npm run watch:trusted   # 編集しながらブラウザでプレビュー
```

### 信頼できる資料だけ HTML を有効にする

資料の中の HTML（`<div class="cols">` などのレイアウト）と、ローカルのファイルの読み込み（同梱フォント・画像・SVG）は、
**既定では無効** です。人からもらった資料に `<script>` やローカルのファイルを読む記述が入っていても、出力のときに動かないようにするためです。

| スクリプト | HTML・ローカルのファイル | 使う資料 |
|---|---|---|
| `npm run pdf` / `pptx` / `html` / `watch` / `check` | 無効（HTML は文字として出る。同梱フォントや画像は読まない） | 人からもらった資料・中身を確かめていない資料 |
| `npm run pdf:trusted` / `pptx:trusted` / `html:trusted` / `watch:trusted` / `check:trusted` | 有効（`--html --allow-local-files`） | 自分（とチーム）で作った資料。`slides/` のサンプル |
| `npm run catalog` | 有効 | リポジトリ同梱のレイアウト集 |

レイアウト集の書き方（HTML を使う）で作った資料は、`:trusted` で出力してください。

VS Code では拡張機能「Marp for VS Code」でプレビューできます（`npm run theme` を先に 1 回）。

### フォント（どの PC でも同じ描画にする）

日本語フォント **Noto Sans JP**（SIL Open Font License 1.1）を npm のパッケージ `@fontsource/noto-sans-jp` で同梱しています。
`themes/standard.css` の `/* @fontsource noto-sans-jp 400 700 */` を、`npm run theme` が `@font-face` に置き換えます
（フォントファイルは `node_modules` から読む）。PC に入っているフォントに左右されないので、PDF / PPTX の見た目と
`npm run check:overflow` の結果がどの PC でもそろいます。同梱フォントを読み込めなかったときは、はみ出しチェックを失敗（終了コード 3）にします。

- 依存の版は `package-lock.json` で固定しています。入れるときは `npm ci`（setup も `npm ci`）。依存を変えたら `package-lock.json` もコミットしてください
- フォントは `dist/*.pdf` に埋め込まれます。`dist/*.html` は作った PC のフォントファイルを参照するので、ほかの PC で開くとその PC のフォントで表示されます
- Marp for VS Code のプレビューでは同梱フォントを読めないことがあります（その PC のフォントで表示される）。最終の確認は `npm run check` と PDF で行ってください
- フォントのライセンス本文は `node_modules/@fontsource/noto-sans-jp/LICENSE` にあります（OFL は PDF への埋め込みと再配布を認めています）

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
| error（禁止語） | 本文・front matter（`header:`・`footer:`）・発表者メモ・インラインの SVG・SVG ファイル・ファイル名 | 全角半角・大文字小文字をそろえて比べる（NFKC） |
| warning | タイトルが長い / 入れ子が深い / 画像の代替テキストが無い / 定義に無いレイアウト | タイトル 全角 32 字、入れ子 2 段 |
| error（SVG） | viewBox が無い / 外部参照 / script | |
| error（描画） | スライドの外にはみ出す（outside）/ 箱の中で切れる（clipped）/ 高さを超える（too_tall） | 許容 3px |

`bannedTerms` に社名・顧客名・システム名などを登録すると、資料に入ったときに止まります。
見出しと箇条書きは、Marp と同じ markdown-it で数えます（コードブロックの中の `- a` や `# コメント` は数えない）。
検査しないファイルは `exclude` に書きます（既定はリポジトリ直下の `README.md` と `docs/` だけ。`*` は `/` 以外、`**` は何でも）。

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

はみ出しのテストは playwright が無いと理由を出してスキップします（CI ではスキップせずに失敗にします）。
CI は Linux（PDF / PPTX まで出力）と Windows（`npm ci`・静的チェック・テスト）で動かします。

## 変更点

| 版 | 変わったこと（**破壊的変更**） | 利用者がすること |
|---|---|---|
| 2026-10 | `.marprc.yml` の `html: true` と `allowLocalFiles: true` をやめた。`npm run pdf` などは HTML とローカルのファイルを無効にして出力する | 自分で作った資料は `npm run pdf:trusted` などの `:trusted` のスクリプトで出力する |
| 2026-10 | 禁止語を front matter・SVG・ファイル名でも探し、全角半角をそろえて比べる | 今まで通っていた資料が止まることがある。語を直す |
| 2026-10 | 除外を設定の `exclude` にした（前はパスに `README` か `docs` を含むファイルをすべて除外） | `slides/docs-x/` などにある資料も検査される |
| 2026-10 | `npm run lint` が `assets/` の SVG も検査する | なし |

## セキュリティ・ライセンス

- 脆弱性を見つけたら、公開の Issue ではなく [SECURITY.md](SECURITY.md) の方法で知らせてください
- ライセンスは [MIT](LICENSE) です
- 同梱フォント Noto Sans JP は SIL Open Font License 1.1 です（`@fontsource/noto-sans-jp` に同梱の LICENSE）
