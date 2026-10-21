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
npm run watch:trusted   # 編集しながらブラウザでプレビュー（保存のたびに lint し、error の間は表示しない）
```

### 信頼できる資料だけ HTML を有効にする

資料の中の HTML（`<div class="cols">` などのレイアウト）と、ローカルのファイルの読み込み（同梱フォント・画像・SVG）は、
**既定では無効** です。人からもらった資料に `<script>` やローカルのファイルを読む記述が入っていても、出力のときに動かないようにするためです。

| スクリプト | HTML・ローカルのファイル | 使う資料 |
|---|---|---|
| `npm run pdf` / `pptx` / `html` / `watch` / `check` | 無効（HTML は文字として出る。同梱フォントや画像は読まない）。`check` は同梱のレイアウト集（`layouts/catalog.md`）だけ有効にして測る | 人からもらった資料・中身を確かめていない資料 |
| `npm run pdf:trusted` / `pptx:trusted` / `html:trusted` / `watch:trusted` / `check:trusted` | 有効（`--html --allow-local-files`） | 自分（とチーム）で作った資料。`slides/` のサンプル |
| `npm run catalog` | 有効 | リポジトリ同梱のレイアウト集 |

レイアウト集の書き方（HTML を使う）で作った資料は、`:trusted` で出力してください。

VS Code では拡張機能「Marp for VS Code」でプレビューできます（`npm run theme` を先に 1 回）。

### フォント（どの PC でも同じ描画にする）

日本語フォント **Noto Sans JP**（SIL Open Font License 1.1）を npm のパッケージ `@fontsource/noto-sans-jp` で同梱しています。
`themes/standard.css` の `/* @fontsource noto-sans-jp 400 700 */` を、`npm run theme` が `@font-face` に置き換えます
（フォントファイルは `node_modules` から読む）。PC に入っているフォントに左右されないので、PDF / PPTX の見た目と
`npm run check:overflow` の結果がどの PC でもそろいます。同梱フォントを 1 つも読み込めなかったときは、はみ出しチェックを失敗（終了コード 3）にします。
一部だけ読み込めなかったときは、どのフォント（太さ・文字の範囲・ファイル名）かを警告に出して続けます。

はみ出しチェックは、本番の出力と同じ扱いで測ります。`npm run check:overflow` は `npm run pdf` と同じく `slides/` の資料の HTML と
ローカルのファイルを無効にして（同梱フォントも読まないので PC のフォントで。同梱のレイアウト集 `layouts/catalog.md` だけは有効にして）、`npm run check:overflow:trusted` は
`npm run pdf:trusted` と同じく有効にして測ります。`:trusted` で出力する資料は `npm run check:trusted` で確かめてください。
測定用の HTML は `build/check-XXXX` に作り、終わったら（失敗・中断でも）消します。

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
| warning | タイトルが長い / 入れ子が深い / 画像の代替テキストが無い / 定義に無いレイアウト / `theme:` が無い / SVG の `<title>` が無い・文字があるのに `font-family` が無い | タイトル 全角 32 字、入れ子 2 段 |
| error（SVG） | viewBox が無い / 外部参照（`href`・`xlink:href`・`src` の `https:`・`//`、`<style>`・`style` 属性の `@import`・外部の `url()`・`image-set()`）/ 資料のフォルダの外を指すローカルのパス（`/etc/…`・`../../…`）/ script / イベント属性（`onload` など `on*`。`<svg/onload=…>` のような `/` 区切りも）/ `foreignObject` / `javascript:`・`vbscript:`・`data:`（画像以外）の URL / 許可の一覧に無い要素（`animate`・`set` など） | SVG ファイルと、資料の中に直接書いた SVG の両方 |
| error（HTML） | 資料の中の `<script>` / どの要素でもイベント属性（`<img onerror=…>` など）/ 属性やリンク先の `javascript:`・`vbscript:`・`data:`（png・jpeg・gif・webp の画像は可） | `.md` の本文（コードフェンス・インラインのコード・HTML コメントの中は見ない） |
| error（HTML の許可の一覧） | 使ってよい要素・属性の一覧（`scripts/lint/allowlist.mjs`）に無いもの（`<iframe>`・`<object>`・`<embed>`・`<meta>`・`<link>`・`<base>`・`<form>`・`<video>` など、`srcset` などの属性）/ 外部の読み込み（`<img src="https://…">`・`![](https://…)`・参照形式の画像 `![図][logo]` + `[logo]: https://…`・`<style>` や `style` 属性の `@import`・外部の `url()`・`image-set()`）/ 資料のフォルダの外を指すローカルのパス（`/etc/…` などの絶対パス、`../../…` でリポジトリの外に出るもの） | `.md` の本文。リンク（`[資料](https://…)`）は読み込まないので可。画像・CSS はリポジトリの中のもの（相対パス）か `data:image` を使う。Markdown の画像は Marp と同じ markdown-it のトークン（image の src）で判定する |
| error（描画） | スライドの外にはみ出す（outside）/ 箱の中で切れる（clipped）/ 高さを超える（too_tall）。本文は余白（padding）の内側、ヘッダー・フッター（`header:`・`footer:`）はスライドの端を超えたら outside | 許容 3px |

`bannedTerms` に社名・顧客名・システム名などを登録すると、資料に入ったときに止まります。
見出しと箇条書きは、Marp と同じ markdown-it で数えます（コードブロックの中の `- a` や `# コメント` は数えない）。
コードフェンスは CommonMark どおり、開いたのと同じ文字（バッククォートかチルダ）で、同じ長さ以上の行で閉じます（バッククォートのフェンスの中の `~~~` では閉じない）。
スライドの区切りは Marp と同じく、一番外側の水平線（`---`・`***`・`___`）です。段落の直後の `---` は見出し（setext。`##` と同じ）で、区切りになりません（Marp で描画した枚数とテストで突き合わせています）。
画像の代替テキストから除くのは Marp の画像の指定（`w:200px`・`width:50%`・`h:auto`・`blur` などと、`bg` があるときの `fit`・`left:40%` など）だけです。`![hello world](…)` や `![workflow](…)` は代替テキストとして扱います。
`:trusted` のスクリプト（`pdf:trusted`・`pptx:trusted`・`html:trusted`・`catalog`・`check:overflow:trusted`）は、出力・描画の前に `npm run lint` を流し、error があれば止まります。
`scripts/check-overflow.mjs` を直接動かしたときも、`--build-trusted` の資料に lint を流し、error があれば描画せずに終了コード 2 で止まります。
Marp のディレクティブ（front matter と `<!-- … -->` の中）も検査します。`style`・`backgroundImage`・`_backgroundImage`・`backgroundColor` など値が CSS になるものの `@import`、外部（`https:`・`file:` など）や資料のフォルダの外を読む `url()` は error（`directive.external_ref`）です。HTML コメントの `header`・`footer` の HTML・画像は本文と同じ規則で検査します。
`watch:trusted` は保存のたびに lint を流し、error が無いときだけ `slides/` をプレビュー用のフォルダ（`.preview-trusted/`。Git に入れない）に写して Marp のサーバーで表示します。error の間はそのフォルダを空にするので、error のある資料は HTML 有効のプレビューに出ません。
lint の間に保存されても lint していない中身を出さないよう、先に一時フォルダ（`.preview-trusted.staging/`）に写してから lint し、その間に資料（`slides/`・`layouts/`・`assets/`）が変わっていなければ、一時フォルダの中身を出します（変わっていればやり直します）。
「資料のフォルダの外」は、作業フォルダ（リポジトリ）の中の資料ならリポジトリの外、作業フォルダの外の資料ならその資料のフォルダの外です。
レイアウトのクラスは Marp と同じく、front matter の `class:` を全スライドの既定にし、`<!-- class: x -->` はそのスライドから後ろに引き継ぎ、`<!-- _class: x -->` はそのスライドだけに効くものとして読みます（見出し不要のレイアウトの判定に使う）。
拡張子は大文字小文字を区別しません（`SLIDE.MD`・`FIG.SVG` も検査します）。
検査しないファイルは `exclude` に書きます（既定はリポジトリ直下の `README.md` と `docs/` だけ。`*` は `/` 以外、`**` は何でも）。

## 終了コード

| コード | `npm run lint`（`scripts/lint-slides.mjs`） | はみ出しチェック（`scripts/check-overflow.mjs`） |
|---|---|---|
| 0 | 問題なし（warning だけなら 0） | はみ出しなし |
| 1 | error がある | はみ出しがある |
| 2 | 引数・設定の誤り | 引数の誤り・資料を変換できない・`--build-trusted` の資料に lint の error |
| 3 | — | ブラウザを起動できない・同梱フォントを 1 つも読み込めない |

## 構成

```text
slides/        スライド（1 ファイル = 1 資料）
layouts/       レイアウト集（catalog.md）
assets/svg/    図（SVG）
themes/        テーマ（standard.css）と Tailwind の入力
scripts/       テーマの結合・静的チェック（lint/ に分割・タグ読み取り・危険判定・SVG・CLI）・はみ出しチェック
config/        チェックの設定
docs/          レイアウト一覧・作成手順
```

## 開発

```bash
npm test              # node:test（チェックのスクリプトのテスト）
npm run lint          # スライドの静的チェック
npm run lint:js       # スクリプトとテストの ESLint（@eslint/js の recommended。warning も失敗）
npm run format:check  # スクリプトとテストの書式（Prettier。直すときは npm run format）
npm run audit         # 依存の既知の脆弱性（high 以上で失敗。上流待ちは config/audit-allowlist.json に理由と期限付き）
```

ESLint 10 は Node.js 20.19 以上（22 推奨。CI は 22）で動きます。資料の出力だけなら Node.js 20 以上で使えます。

はみ出しのテストは playwright が無いと理由を出してスキップします（CI ではスキップせずに失敗にします）。
CI は Linux（ESLint・Prettier・PDF / PPTX まで出力）と Windows（`npm ci`・静的チェック・テスト・はみ出しチェック・PDF 出力）で動かします。

## 変更点

| 版 | 変わったこと（**破壊的変更**） | 利用者がすること |
|---|---|---|
| 2026-10 | `.marprc.yml` の `html: true` と `allowLocalFiles: true` をやめた。`npm run pdf` などは HTML とローカルのファイルを無効にして出力する | 自分で作った資料は `npm run pdf:trusted` などの `:trusted` のスクリプトで出力する |
| 2026-10 | 禁止語を front matter・SVG・ファイル名でも探し、全角半角をそろえて比べる | 今まで通っていた資料が止まることがある。語を直す |
| 2026-10 | 除外を設定の `exclude` にした（前はパスに `README` か `docs` を含むファイルをすべて除外） | `slides/docs-x/` などにある資料も検査される |
| 2026-10 | `npm run lint` が `assets/` の SVG も検査する | なし |
| 2026-10 | SVG のイベント属性・`foreignObject`・`javascript:` のリンクを error にする。BOM 付きのファイルも front matter を認識する | 該当する SVG を直す（文字は `<text>` で書く） |
| 2026-10 | 資料の中の `<script>`・イベント属性・`javascript:`・`vbscript:`・`data:`（画像以外）を SVG の外でも error にする。`.MD`・`.SVG` も検査する | 該当する記述を直す（コードの例はコードフェンスかインラインのコードに入れる） |
| 2026-10 | 資料の中の HTML を「使ってよい要素・属性の一覧」で検査し、一覧に無いもの（`<iframe>`・`<meta>`・`<link>` など）と外部の読み込み（`<img src="https://…">`・`@import`・外部の `url()`）を error にする。`:trusted` の出力の前に lint を流す | 外部の画像・CSS はリポジトリに置いて相対パスで読む。どうしても要る要素は `scripts/lint/allowlist.mjs` に理由と一緒に足す（レビューで確認） |
| 2026-10 | スライドの区切りを Marp と同じにした（段落の直後の `---` は区切りではない） | 枚数・行番号の表示が Marp の出力と合うようになる。区切りたいところは `---` の前に空行を入れる |
| 2026-10 | `watch:trusted` が起動時だけでなく保存のたびに lint し、error の間は HTML 有効のプレビューに出さない。参照形式の画像・`image-set()`・資料のフォルダの外を指すローカルのパスを error にする。front matter と `<!-- class: -->` のクラスの引き継ぎを読む | 該当する画像・CSS をリポジトリの中の相対パスにする |
| 2026-10 | `npm run check:overflow` を `npm run pdf` と同じ扱い（HTML 無効）で測る。測定用の `build/check` を残さない | `:trusted` で出力する資料は `npm run check:trusted` で測る |
| 2026-10 | 閉じ括弧の無い `url(`（`style="background:url(https://…"`）も外部の読み込みとして error にする。はみ出しチェックがヘッダー・フッターのスライドの端からのはみ出しも見る | 該当する CSS・ヘッダー・フッターを直す |
| 2026-10 | Marp のディレクティブ（front matter・HTML コメントの `style`・`backgroundImage`・`_backgroundImage`・`header`・`footer` など）の `@import`・外部や `file:` の `url()` を error にする。`check:overflow:trusted`（と `--build-trusted`）も描画の前に lint を通す | 該当する背景画像・CSS をリポジトリの中の相対パスにする |

## セキュリティ・ライセンス

- 脆弱性を見つけたら、公開の Issue ではなく [SECURITY.md](SECURITY.md) の方法で知らせてください
- ライセンスは [MIT](LICENSE) です
- 同梱フォント Noto Sans JP は SIL Open Font License 1.1 です（`@fontsource/noto-sans-jp` に同梱の LICENSE）
