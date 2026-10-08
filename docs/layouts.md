# レイアウト集

見本は `layouts/catalog.md`（`npm run catalog` で `dist/catalog.pdf`）。レイアウトは 2 種類の書き方があります。

- **クラス**（`<!-- _class: 名前 -->`）: スライド全体の作りが変わるもの。`config/slide-lint.json` の `layouts` に登録する
- **部品**（`<div class="cols cols-2">` など）: スライドの中の並べ方。テーマ（themes/standard.css）に定義

| No | 名前 | 書き方 | 使いどころ |
|---|---|---|---|
| L01 | 表紙 | `_class: title` | 最初の 1 枚。タイトル・サブタイトル・日付と所属 |
| L02 | 目次 | `_class: agenda` + 番号付きリスト | 5 枚以上の資料。章は 3〜5 個 |
| L03 | 中扉 | `_class: section` | 章の切り替え。15 枚以上の資料で |
| L04 | 箇条書き | 見出し + リスト | 基本形。3〜5 個、入れ子 2 段まで |
| L05 | 2 列の比較 | `cols cols-2` + `card` | 案 A / 案 B、現状 / 導入後 |
| L06 | 3 つのカード | `cols cols-3` + `card` | 特長・方針を 3 つに絞って並べる |
| L07 | 図と説明 | `cols cols-7-5` + `figure` | 構成図・画面の説明 |
| L08 | キーメッセージ | `_class: message` | 結論を印象づける 1 文 |
| L09 | 大きな数字 | `_class: big-number` + `<div class="num">` | 効果を 1 つの数字で示す |
| L10 | 指標の並び | `cols cols-4` + `card kpi` | 3〜4 個の指標 |
| L11 | 表 | Markdown の表 | 5 行 × 5 列まで |
| L12 | タイムライン | `timeline` | スケジュール・経緯（4〜6 点） |
| L13 | 手順 | `steps` | 順番のある作業（3〜5 段） |
| L14 | ビフォー・アフター | `cols cols-2` + `card muted` / `card accent` | 改善の前後 |
| L15 | メリット・デメリット | `cols cols-2` | 判断材料。デメリットには対策を添える |
| L16 | グラフ | `figure` + SVG | 数値の比較。出典を `note` に書く |
| L17 | 2×2 マトリクス | `matrix`（強調は `hi`） | 優先度・位置付け |
| L18 | 引用・根拠 | `>` 引用 + `note` | データ・調査結果・発言 |
| L19 | Q&A | `cols cols-2` + `card` | 想定問答 |
| L20 | まとめと次のアクション | `cols cols-7-5` | 最後の 1 枚。期限と担当を書く |

## 部品の一覧

| クラス | 内容 |
|---|---|
| `cols cols-2` / `cols-3` / `cols-4` / `cols-7-5` | 等幅の 2〜4 列、7:5 の 2 列 |
| `card`（`accent` / `muted`） | 角丸の箱。上の線の色で強弱 |
| `kpi` + `value` / `label` | 指標の数字とラベル |
| `steps` / `timeline` / `matrix` | 手順・時系列・2×2 |
| `figure` | 図を残りの高さに収める |
| `note` | 出典・注記（小さい灰色の文字） |

細かい調整は Tailwind のユーティリティ（`mt-4`、`text-sm`、`gap-4` など）を使えます。`npm run theme` が
`slides/` と `layouts/` で使われているクラスだけを集めてテーマに足します。

## レイアウトを増やすとき

1. `layouts/catalog.md` に見本を足す（No を振る）
2. スライド全体の作りが変わるならクラスとして `themes/standard.css` に書き、`config/slide-lint.json` の `layouts` に足す
3. `npm run check:trusted` ではみ出しが無いことを確かめる
4. この表に追記する
