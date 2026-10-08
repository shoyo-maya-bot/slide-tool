#!/usr/bin/env node
// スライドの Markdown を静的に検査する（描画しない）.
//   node scripts/lint-slides.mjs slides layouts assets [--format json] [--config config/slide-lint.json]
// 終了コード: 0 問題なし（warning のみを含む）/ 1 error あり / 2 引数・設定の誤り
//
// 見出しと箇条書きは、Marp と同じ markdown-it（package-lock.json で固定）のトークンで数える（コードブロックの中は数えない）。
// markdown-it を読めないとき（npm ci の前）は警告を出し、コードブロックを除いた行で数える。CI（環境変数 CI）では失敗にする。
//
// 中身は scripts/lint/ に役割ごとに分けている（split: 分割、tags: タグの読み取り、dangers: 危険な記述の判定、
// svg: SVG ファイル、slide: スライドの検査、cli: コマンドライン）。ここは入口と、テスト・ほかのスクリプト向けの再エクスポート
import { main } from "./lint/cli.mjs";

export { main } from "./lint/cli.mjs";
export { DEFAULTS } from "./lint/config.mjs";
export { htmlDangers, svgDangers } from "./lint/dangers.mjs";
export { lintFile, lintSlide, parser, structure } from "./lint/slide.mjs";
export { fenceCloses, fenceLines, fenceOpen, maskCode, splitSlides } from "./lint/split.mjs";
export { lintSvg } from "./lint/svg.mjs";
export { scanTags } from "./lint/tags.mjs";
export { findBanned, globToRegExp, isExcluded, normalize, readText, relPath, stripBom, width } from "./lint/text.mjs";

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("lint-slides.mjs")) {
  process.exitCode = main(process.argv.slice(2));
}
