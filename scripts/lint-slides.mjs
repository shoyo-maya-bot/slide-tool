#!/usr/bin/env node
// スライドの Markdown を静的に検査する（描画しない）.
//   node scripts/lint-slides.mjs slides layouts assets [--format json] [--config config/slide-lint.json]
// 終了コード: 0 問題なし（warning のみを含む）/ 1 error あり / 2 引数・設定の誤り
//
// 見出しと箇条書きは、Marp と同じ markdown-it（package-lock.json で固定）のトークンで数える（コードブロックの中は数えない）。
// markdown-it を読めないとき（npm ci の前）は警告を出し、コードブロックを除いた行で数える。CI（環境変数 CI）では失敗にする。
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join, relative, resolve, sep } from "node:path";

export const DEFAULTS = {
  maxBullets: 6,
  maxBodyChars: 260,
  maxTitleChars: 32,
  maxDepth: 2,
  layouts: [],
  noTitleLayouts: ["title", "section", "big-number"],
  bannedTerms: [],
  // 検査しないファイル（今の作業フォルダからの相対パスのパターン。/ 区切り、* は / 以外、** は何でも）
  exclude: ["README.md", "docs/**"],
};

let MarkdownIt = null;
try {
  ({ default: MarkdownIt } = await import("markdown-it"));
} catch {
  MarkdownIt = null;
}
/** 見出し・箇条書きを数える方法（"markdown-it" か、読めないときの "fallback"） */
export const parser = MarkdownIt ? "markdown-it" : "fallback";
const md = MarkdownIt ? new MarkdownIt({ html: true }) : null;

/** 表記ゆれ（全角英数・半角カナなど）をそろえて小文字にする */
export function normalize(s) {
  return s.normalize("NFKC").toLowerCase();
}

/** 禁止語を探す. → [{ term, line }]（line は 1 から） */
export function findBanned(text, terms) {
  const found = [];
  const wanted = terms.filter(Boolean).map((t) => [t, normalize(t)]);
  if (!wanted.length) return found;
  text
    .replace(/\r\n/g, "\n")
    .split("\n")
    .forEach((ln, i) => {
      const n = normalize(ln);
      for (const [term, t] of wanted) if (n.includes(t)) found.push({ term, line: i + 1 });
    });
  return found;
}

/** パスのパターン（README.md、docs/**、slides/*.md など）を正規表現にする */
export function globToRegExp(pattern) {
  let re = "";
  const p = pattern.replace(/\\/g, "/").replace(/^\.\//, "");
  for (let i = 0; i < p.length; i++) {
    const c = p[i];
    if (c === "*" && p[i + 1] === "*") {
      re += ".*";
      i++;
      if (p[i + 1] === "/") i++;
    } else if (c === "*") re += "[^/]*";
    else if (c === "?") re += "[^/]";
    else re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${re}$`);
}

/** 今の作業フォルダからの相対パス（/ 区切り） */
export function relPath(p) {
  return relative(process.cwd(), resolve(p)).split(sep).join("/");
}

export function isExcluded(p, patterns) {
  const r = relPath(p);
  return patterns.some((pat) => globToRegExp(pat).test(r));
}

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

/** コードブロック（``` と ~~~）の行を除く（markdown-it を読めないときだけ使う） */
function dropFences(text) {
  const out = [];
  let fence = null;
  for (const ln of text.split("\n")) {
    const m = ln.match(/^\s{0,3}(`{3,}|~{3,})/);
    if (fence) {
      if (m && m[1][0] === fence[0] && m[1].length >= fence.length && !ln.trim().slice(m[1].length).trim()) fence = null;
      continue;
    }
    if (m) {
      fence = m[1];
      continue;
    }
    out.push(ln);
  }
  return out.join("\n");
}

/** 見出し（最初の # / ##）・一番外側の箇条書きの数・入れ子の深さ. コードブロックの中は数えない */
export function structure(text) {
  if (md) {
    const tokens = md.parse(text, {});
    let title = null;
    let depth = 0;
    let deepest = 0;
    let top = 0;
    tokens.forEach((t, i) => {
      if (title === null && t.type === "heading_open" && (t.tag === "h1" || t.tag === "h2")) title = tokens[i + 1]?.content ?? "";
      if (t.type === "bullet_list_open" || t.type === "ordered_list_open") deepest = Math.max(deepest, ++depth);
      if (t.type === "bullet_list_close" || t.type === "ordered_list_close") depth--;
      if (t.type === "list_item_open" && depth === 1) top++;
    });
    return { title, top, depth: deepest };
  }
  const body = dropFences(text);
  const heading = body.match(/^#{1,2}\s+(.+)$/m);
  const bullets = body.split("\n").filter((l) => /^\s*([-*+]|\d+\.)\s+/.test(l));
  const top = bullets.filter((l) => /^([-*+]|\d+\.)\s+/.test(l)).length;
  const deepest = bullets.length ? 1 + Math.max(...bullets.map((l) => Math.floor(l.match(/^\s*/)[0].replace(/\t/g, "  ").length / 2))) : 0;
  return { title: heading ? heading[1] : null, top, depth: deepest };
}

export function lintSlide(slide, index, conf, file) {
  const out = [];
  const add = (severity, rule_id, message) => out.push({ rule_id, severity, message, location: `${file}:${slide.line} (${index + 1} 枚目)` });
  const text = slide.text;
  const classes = directive(text, "class").split(/\s+/).filter(Boolean);
  const layout = classes.find((c) => conf.layouts.includes(c)) || "";
  const unknown = classes.filter((c) => !conf.layouts.includes(c) && !c.startsWith("tw-") && !/^(lead|invert|gaia)$/.test(c));
  if (conf.layouts.length && unknown.length) add("warning", "slide.unknown_layout", `定義に無いレイアウト: ${unknown.join(", ")}（docs/layouts.md）`);

  const st = structure(text);
  if (st.title === null && !conf.noTitleLayouts.includes(layout) && text.trim()) add("error", "slide.no_title", "見出し（# タイトル）がありません。1 枚に 1 つのメッセージを見出しで書きます");
  if (st.title !== null && width(st.title.replace(/<[^>]+>/g, "")) > conf.maxTitleChars) {
    add("warning", "slide.title_long", `タイトルが長い（全角 ${width(st.title)} 字 > ${conf.maxTitleChars}）。2 行になると下の要素が押し出されます`);
  }
  if (st.top > conf.maxBullets) add("error", "slide.too_many_bullets", `箇条書きが ${st.top} 個（上限 ${conf.maxBullets}）。分割するか表・カードにします`);
  if (st.depth > conf.maxDepth) add("warning", "slide.deep_nesting", `箇条書きの入れ子が ${st.depth} 段（上限 ${conf.maxDepth}）`);
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
  return out;
}

const bannedMessage = (term) => `使ってはいけない語「${term}」があります（表記ゆれ・全角を含む。config/slide-lint.json の bannedTerms）`;

export function lintFile(path, conf) {
  const raw = readFileSync(path, "utf8");
  const { front, slides } = splitSlides(raw);
  const out = [];
  // 禁止語はファイル全体（front matter の header・footer、発表者メモ、インラインの SVG、コードを含む）で探す
  for (const f of findBanned(raw, conf.bannedTerms)) {
    out.push({ rule_id: "slide.banned_term", severity: "error", message: bannedMessage(f.term), location: `${path}:${f.line}` });
  }
  if (!/^marp:\s*true\s*$/m.test(front)) out.push({ rule_id: "deck.not_marp", severity: "error", message: "front matter に marp: true がありません", location: `${path}:1` });
  if (!/^theme:\s*\S+/m.test(front)) out.push({ rule_id: "deck.no_theme", severity: "warning", message: "front matter に theme がありません（standard を推奨）", location: `${path}:1` });
  slides.forEach((s, i) => out.push(...lintSlide(s, i, conf, path)));
  return out;
}

export function lintSvg(path, conf = DEFAULTS) {
  const text = readFileSync(path, "utf8");
  const out = [];
  const add = (severity, rule_id, message) => out.push({ rule_id, severity, message, location: path });
  for (const f of findBanned(text, conf.bannedTerms)) {
    out.push({ rule_id: "svg.banned_term", severity: "error", message: bannedMessage(f.term), location: `${path}:${f.line}` });
  }
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
  for (const key of ["bannedTerms", "exclude", "layouts", "noTitleLayouts"]) {
    if (!Array.isArray(conf[key]) || conf[key].some((x) => typeof x !== "string")) {
      console.error(`設定の誤り: ${confPath} の ${key} は文字列の配列にしてください`);
      return 2;
    }
  }
  if (parser !== "markdown-it") {
    if (process.env.CI) {
      console.error("markdown-it を読めません（npm ci を実行してください）。CI では簡易の解析で済ませずに失敗にします");
      return 2;
    }
    console.error("警告: markdown-it を読めないため、見出しと箇条書きを簡易の解析で数えます（npm ci を実行してください）");
  }
  const missing = targets.filter((t) => !existsSync(t));
  for (const t of missing) console.error(`警告: ${t} がありません（検査しません）`);
  const files = targets.flatMap(walk).filter((f) => !isExcluded(f, conf.exclude));
  const findings = [
    // ファイル名・フォルダ名も禁止語を探す（画像などを含むすべてのファイル）
    ...files.flatMap((f) =>
      findBanned(relPath(f), conf.bannedTerms).map((b) => ({ rule_id: "file.banned_term", severity: "error", message: bannedMessage(b.term), location: f })),
    ),
    ...files.filter((f) => extname(f) === ".md").flatMap((f) => lintFile(f, conf)),
    ...files.filter((f) => extname(f) === ".svg").flatMap((f) => lintSvg(f, conf)),
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
