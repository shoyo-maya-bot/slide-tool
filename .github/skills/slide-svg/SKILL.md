---
name: slide-svg
description: スライド用の図（構成図・フロー・グラフ）を SVG で作るときのルール。assets/svg/ に置く
---

# SVG で図を作る

## 必須（`npm run lint` で検査）

- `viewBox` を付ける（width / height だけにしない）。スライドの図は `0 0 960 360` か `0 0 640 360` が収まりやすい
- `<title>` に図の内容を 1 文で書く
- 文字には `font-family="Noto Sans JP, Noto Sans CJK JP, Yu Gothic, Meiryo, sans-serif"` を付ける
- 外部の画像・フォントを参照しない（PDF / PPTX で消える）。`<script>` は入れない

## 書き方

- 色はテーマに合わせる: 主 `#1d4ed8` / 主の薄い色 `#dbeafe` / 強調 `#ea580c` / 文字 `#1f2937` / 補足 `#6b7280` / 線 `#d1d5db`
- 文字は 18px 以上（スライドに縮小されて表示されるため）。1 つの箱の文字は 12 字以内
- 箱は `rect rx="12"`、矢印は `<marker>` を 1 つ定義して使い回す
- 座標は 20 の倍数にそろえる（ずれが目立たない）
- 要素は 7 個まで。多い場合は図を分ける
- グラフは数値をラベルで書き、軸と出典（スライドの note）を添える。架空のデータには「架空」と書く

## 置き方

```markdown
<div class="figure">

![図の説明（alt）](../assets/svg/architecture.svg)

</div>
```

複雑な業務フローは doc-to-markdown の figspec（YAML → draw.io）で作って SVG に書き出す方法もあります。
