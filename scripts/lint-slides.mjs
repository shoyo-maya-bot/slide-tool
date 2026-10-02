#!/usr/bin/env node
// スライドの Markdown を静的に検査する（描画しない・依存なし）.
//   node scripts/lint-slides.mjs slides layouts [--format json] [--config config/slide-lint.json]
// 終了コード: 0 問題なし（warning のみを含む）/ 1 error あり / 2 引数・設定の誤り
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join } from "node:path";

export const DEFAULTS = {
  maxBullets: 6,
  maxBodyChars: 260,
  maxTitleChars: 32,
  maxDepth: 2,
  layouts: [],
  noTitleLayouts: ["title", "section", "big-number"],
  bannedTerms: [],
};

/** 全角は 1、半角は 0.5 として数える（タイトルの見た目の長さ） */
export function width(s) {
  let w = 0;
  for (const ch of s) w += ch.charCodeAt(0) < 0x2000 ? 0.5 : 1;
  return w;
}

/** front matter とスライドに分ける（コードブロック内の --- は区切りにしない） */
export function splitSlides(text) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  let front = "";
  let i = 0;
  if (lines[0] === "---") {
    const end = lines.indexOf("---", 1);
    if (end > 0) {
      front = lines.slice(1, end).join("\n");
      i = end + 1;
    }
  }
  const slides = [];
  let cur = [];
  let start = i + 1;
  let fence = false;
  for (; i < lines.length; i++) {
    const ln = lines[i];
    if (/^(```|~~~)/.test(ln)) fence = !fence;
    if (!fence && /^(---|\*\*\*|___)\s*$/.test(ln)) {
      slides.push({ line: start, text: cur.join("\n") });
      cur = [];
      start = i + 2;
      continue;
    }
    cur.push(ln);
  }
  slides.push({ line: start, text: cur.join("\n") });
  return { front, slides };
}

function directive(text, name) {
  const re = new RegExp(`<!--\\s*_?${name}\\s*:\\s*([^>]*?)\\s*-->`);
  const m = text.match(re);
  return m ? m[1].trim() : "";
}

function stripNonBody(text) {
  return text
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/```[\s\S]*?```/g, "")
    .replace(/<svg[\s\S]*?<\/svg>/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "");
}

export function lintSlide(slide, index, conf, file) {
  const out = [];
  const add = (severity, rule_id, message) => out.push({ rule_id, severity, message, location: `${file}:${slide.line} (${index + 1} 枚目)` });
  const text = slide.text;
  const classes = directive(text, "class").split(/\s+/).filter(Boolean);
  const layout = classes.find((c) => conf.layouts.includes(c)) || "";
  const unknown = classes.filter((c) => !conf.layouts.includes(c) && !c.startsWith("tw-") && !/^(lead|invert|gaia)$/.test(c));
  if (conf.layouts.length && unknown.length) add("warning", "slide.unknown_layout", `定義に無いレイアウト: ${unknown.join(", ")}（docs/layouts.md）`);

  const heading = text.match(/^#{1,2}\s+(.+)$/m);
  if (!heading && !conf.noTitleLayouts.includes(layout) && text.trim()) add("error", "slide.no_title", "見出し（# タイトル）がありません。1 枚に 1 つのメッセージを見出しで書きます");
  if (heading && width(heading[1].replace(/<[^>]+>/g, "")) > conf.maxTitleChars) {
    add("warning", "slide.title_long", `タイトルが長い（全角 ${width(heading[1])} 字 > ${conf.maxTitleChars}）。2 行になると下の要素が押し出されます`);
  }
  const bullets = text.split("\n").filter((l) => /^\s*([-*+]|\d+\.)\s+/.test(l));
  const top = bullets.filter((l) => /^([-*+]|\d+\.)\s+/.test(l));
  if (top.length > conf.maxBullets) add("error", "slide.too_many_bullets", `箇条書きが ${top.length} 個（上限 ${conf.maxBullets}）。分割するか表・カードにします`);
  const deepest = Math.max(0, ...bullets.map((l) => Math.floor(l.match(/^\s*/)[0].replace(/\t/g, "  ").length / 2)));
  if (deepest + 1 > conf.maxDepth) add("warning", "slide.deep_nesting", `箇条書きの入れ子が ${deepest + 1} 段（上限 ${conf.maxDepth}）`);
  const body = stripNonBody(text)
    .split("\n")
    .filter((l) => !/^#{1,6}\s/.test(l) && !/^\s*\|?\s*:?-{3,}/.test(l))
    .join("")
    .replace(/[\s|*_`>#-]/g, "");
  if (body.length > conf.maxBodyChars) add("error", "slide.too_much_text", `本文が ${body.length} 字（上限 ${conf.maxBodyChars}）。要点に絞るか分割します`);
  for (const m of text.matchAll(/!\[([^\]]*)\]\(([^)\s]+)/g)) {
    const alt = m[1].replace(/\b(w|h|width|height|bg|left|right|fit|contain|cover):?\S*/g, "").trim();
    if (!alt) add("warning", "slide.image_no_alt", `画像に代替テキストがありません: ${m[2]}`);
  }
  for (const m of text.matchAll(/<img\b(?![^>]*\balt=)[^>]*>/g)) add("warning", "slide.image_no_alt", `img に alt がありません: ${m[0].slice(0, 40)}`);
  const lower = text.toLowerCase();
  for (const term of conf.bannedTerms) {
    if (term && lower.includes(term.toLowerCase())) add("error", "slide.banned_term", `使ってはいけない語「${term}」があります（config/slide-lint.json）`);
  }
  return out;
}

export function lintFile(path, conf) {
  const { front, slides } = splitSlides(readFileSync(path, "utf8"));
  const out = [];
  if (!/^marp:\s*true\s*$/m.test(front)) out.push({ rule_id: "deck.not_marp", severity: "error", message: "front matter に marp: true がありません", location: `${path}:1` });
  if (!/^theme:\s*\S+/m.test(front)) out.push({ rule_id: "deck.no_theme", severity: "warning", message: "front matter に theme がありません（standard を推奨）", location: `${path}:1` });
  slides.forEach((s, i) => out.push(...lintSlide(s, i, conf, path)));
  return out;
}

export function lintSvg(path) {
  const text = readFileSync(path, "utf8");
  const out = [];
  const add = (severity, rule_id, message) => out.push({ rule_id, severity, message, location: path });
  if (!/<svg[^>]*\bviewBox=/.test(text)) add("error", "svg.no_viewbox", "viewBox がありません（拡大縮小で崩れます）");
  if (/(xlink:)?href=["']https?:/.test(text)) add("error", "svg.external_ref", "外部 URL を参照しています（PDF / PPTX で表示されません）");
  if (/<script\b/.test(text)) add("error", "svg.script", "script を含めないでください");
  if (/<text\b/.test(text) && !/font-family/.test(text)) add("warning", "svg.no_font", "文字があるのに font-family がありません（環境で字形が変わります）");
  if (!/<title\b/.test(text)) add("warning", "svg.no_title", "<title> がありません（読み上げ・検索用）");
  return out;
}

function walk(p) {
  if (!existsSync(p)) return [];
  if (statSync(p).isFile()) return [p];
  return readdirSync(p).flatMap((n) => (n.startsWith(".") || n === "node_modules" ? [] : walk(join(p, n))));
}

export function main(argv) {
  const args = [...argv];
  let format = "markdown";
  let confPath = "config/slide-lint.json";
  const targets = [];
  while (args.length) {
    const a = args.shift();
    if (a === "--format" || a === "-f") format = args.shift();
    else if (a === "--config") confPath = args.shift();
    else targets.push(a);
  }
  if (!targets.length) {
    console.error("使い方: lint-slides.mjs <フォルダかファイル>... [--format json] [--config file]");
    return 2;
  }
  let conf;
  try {
    conf = { ...DEFAULTS, ...(existsSync(confPath) ? JSON.parse(readFileSync(confPath, "utf8")) : {}) };
  } catch (e) {
    console.error(`設定を読めません: ${confPath}: ${e.message}`);
    return 2;
  }
  const files = targets.flatMap(walk);
  const findings = [
    ...files.filter((f) => extname(f) === ".md" && !/README|docs/.test(f)).flatMap((f) => lintFile(f, conf)),
    ...files.filter((f) => extname(f) === ".svg").flatMap(lintSvg),
  ];
  const errors = findings.filter((f) => f.severity === "error").length;
  if (format === "json") {
    console.log(JSON.stringify({ findings, summary: { error: errors, warning: findings.length - errors, files: files.length } }, null, 1));
  } else {
    console.log("| 重大度 | ルール | 場所 | 内容 |\n|---|---|---|---|");
    for (const f of findings) console.log(`| ${f.severity} | ${f.rule_id} | ${f.location} | ${f.message} |`);
    console.log(`\nファイル ${files.length} 個 / error ${errors} 件 / warning ${findings.length - errors} 件`);
  }
  return errors ? 1 : 0;
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("lint-slides.mjs")) {
  process.exitCode = main(process.argv.slice(2));
}
