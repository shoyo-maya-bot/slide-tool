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

/** 先頭の BOM（U+FEFF）を除く. Windows のメモ帳などで保存すると付き、付いたままだと front matter の --- を認識できない */
export function stripBom(text) {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/** ファイルを UTF-8 で読み、BOM を除く */
export function readText(path) {
  return stripBom(readFileSync(path, "utf8"));
}

/**
 * コードフェンスの開始行なら、その印（``` や ~~~~ など）を返す. CommonMark と同じく、行頭の空白は 3 つまで、
 * ` は 3 つ以上（後ろの情報文字列に ` を含まない）、~ は 3 つ以上
 */
export function fenceOpen(ln) {
  const m = ln.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
  if (!m) return null;
  if (m[1][0] === "`" && m[2].includes("`")) return null;
  return m[1];
}

/** open（開始の印）のコードフェンスを閉じる行か. 同じ文字で、開始以上の長さ、後ろは空白だけ */
export function fenceCloses(ln, open) {
  const m = ln.match(/^ {0,3}(`{3,}|~{3,})[ \t]*$/);
  return !!m && m[1][0] === open[0] && m[1].length >= open.length;
}

/** コードフェンスの中（開始・終了の行を含む）なら true の配列（行ごと）. 閉じないフェンスは最後まで続く */
export function fenceLines(lines) {
  const inside = [];
  let open = null;
  for (const ln of lines) {
    if (open) {
      inside.push(true);
      if (fenceCloses(ln, open)) open = null;
      continue;
    }
    open = fenceOpen(ln);
    inside.push(!!open);
  }
  return inside;
}

/** front matter とスライドに分ける（コードブロック内の --- は区切りにしない） */
export function splitSlides(text) {
  const lines = stripBom(text).replace(/\r\n/g, "\n").split("\n");
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
  const inFence = fenceLines(lines.slice(i));
  for (const offset = i; i < lines.length; i++) {
    const ln = lines[i];
    if (!inFence[i - offset] && /^(---|\*\*\*|___)\s*$/.test(ln)) {
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

/** 本文の字数を数えるために、コード・コメント・SVG・タグ・画像を空白にする（空白は後で数えない. 無害化ではない） */
function stripNonBody(text) {
  return dropFences(text)
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<svg[\s\S]*?<\/svg>/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/[<>]/g, " "); // 消し残しの < > は本文の字数に数えない
}

/** コードブロック（``` と ~~~）の行を除く（markdown-it を読めないときだけ使う） */
function dropFences(text) {
  const lines = text.split("\n");
  const inFence = fenceLines(lines);
  return lines.filter((_, i) => !inFence[i]).join("\n");
}

/** 改行以外を空白にする（行番号・位置を変えずに中身を消す） */
const blank = (s) => s.replace(/[^\n]/g, " ");

/**
 * HTML として動かない部分（コードフェンス・インラインのコード・HTML コメント）を空白にする. 行番号と位置は変えない.
 * スクリプトの検査で、コードとして書いた例（`<script>` など）を誤って拾わないため
 */
export function maskCode(text) {
  const lines = text.split("\n");
  const inFence = fenceLines(lines);
  return lines
    .map((ln, i) => (inFence[i] ? blank(ln) : ln))
    .join("\n")
    .replace(/<!--[\s\S]*?-->/g, blank)
    .replace(/(`+)(?!`)(?:(?!\n[ \t]*\n)[\s\S])*?[^`]\1(?!`)/g, blank); // 空行をまたがない
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
  const raw = readText(path);
  const { front, slides } = splitSlides(raw);
  const out = [];
  // 禁止語はファイル全体（front matter の header・footer、発表者メモ、インラインの SVG、コードを含む）で探す
  for (const f of findBanned(raw, conf.bannedTerms)) {
    out.push({ rule_id: "slide.banned_term", severity: "error", message: bannedMessage(f.term), location: `${path}:${f.line}` });
  }
  if (!/^marp:\s*true\s*$/m.test(front)) out.push({ rule_id: "deck.not_marp", severity: "error", message: "front matter に marp: true がありません", location: `${path}:1` });
  if (!/^theme:\s*\S+/m.test(front)) out.push({ rule_id: "deck.no_theme", severity: "warning", message: "front matter に theme がありません（standard を推奨）", location: `${path}:1` });
  slides.forEach((s, i) => out.push(...lintSlide(s, i, conf, path)));
  // :trusted（HTML 有効）で出力すると、資料の中に直接書いた HTML・SVG も動くので、スクリプトを動かせる記述を探す.
  // コードフェンス・インラインのコード・HTML コメントの中は動かないので見ない
  const lineAt = (text, index) => text.slice(0, index).split(/\r?\n/).length;
  let scan = maskCode(raw);
  for (const m of scan.matchAll(/<svg\b[\s\S]*?<\/svg>/gi)) {
    for (const d of svgDangers(m[0])) out.push({ ...d, location: `${path}:${lineAt(raw, m.index)}` });
  }
  scan = scan.replace(/<svg\b[\s\S]*?<\/svg>/gi, blank);
  for (const d of htmlDangers(scan)) out.push({ rule_id: d.rule_id, severity: d.severity, message: d.message, location: `${path}:${lineAt(raw, d.index)}` });
  return out;
}

/**
 * SVG の中の、スクリプトを動かせる記述を探す. → [{ rule_id, severity, message }]
 * - on で始まるイベント属性（onload・onclick など）
 * - foreignObject（中に HTML を入れられる）
 * - 属性の値の javascript:・vbscript:・data:（画像以外）の URL（空白・大文字・文字参照で書いたものも含む）
 */
export function svgDangers(text) {
  const out = [];
  const add = (rule_id, message) => out.push({ rule_id, severity: "error", message });
  const tags = scanTags(text);
  if (tags.some((t) => t.name === "script")) add("svg.script", "script を含めないでください");
  const events = new Set(tags.flatMap((t) => t.attrs.filter((a) => isEventAttr(a.name)).map((a) => a.name)));
  if (events.size) add("svg.event_handler", `イベント属性（${[...events].join(", ")}）を含めないでください（読み込み・クリックでスクリプトが動きます）`);
  if (/<foreignObject\b/i.test(text)) add("svg.foreign_object", "foreignObject を含めないでください（中の HTML が動きます。文字は <text> で書きます）");
  if (tags.some((t) => t.attrs.some((a) => isJavascriptUrl(a.value)))) add("svg.javascript_url", "javascript:・vbscript:・data:（画像以外）の URL を含めないでください");
  return out;
}

/**
 * Markdown の中の HTML（SVG の外）で、スクリプトを動かせる記述を探す. → [{ rule_id, severity, message, index }]
 * - <script> 要素
 * - on で始まるイベント属性（どの要素でも. <img/onerror=…> のような / 区切りも）
 * - 属性の値・Markdown のリンク先の javascript:・vbscript:・data:（画像以外）の URL
 * text はコードを空白にしたもの（maskCode）を渡す
 */
export function htmlDangers(text) {
  const out = [];
  const add = (rule_id, message, index) => out.push({ rule_id, severity: "error", message, index });
  for (const t of scanTags(text)) {
    if (t.name === "script") add("html.script", "script を含めないでください（:trusted で出力するとスクリプトが動きます）", t.index);
    const events = t.attrs.filter((a) => isEventAttr(a.name)).map((a) => a.name);
    if (events.length) add("html.event_handler", `<${t.name}> のイベント属性（${events.join(", ")}）を含めないでください（:trusted で出力するとスクリプトが動きます）`, t.index);
    if (t.attrs.some((a) => isJavascriptUrl(a.value))) add("html.javascript_url", `<${t.name}> に javascript:・vbscript:・data:（画像以外）の URL を含めないでください`, t.index);
  }
  // Markdown のリンク・画像 [x](javascript:…) と自動リンク <javascript:…>
  for (const m of text.matchAll(/\]\(\s*<?([^)>]*)|<([a-zA-Z][a-zA-Z0-9+.-]{1,31}:[^\s<>]*)>/g)) {
    if (isJavascriptUrl(m[1] ?? m[2])) add("html.javascript_url", "javascript:・vbscript:・data:（画像以外）のリンクを含めないでください", m.index);
  }
  return out;
}

const isEventAttr = (name) => /^on[a-z]+$/i.test(name);

/**
 * スクリプトを動かせる URL か: javascript:・vbscript:、画像（png・jpeg・gif・webp）以外の data:（data:text/html など）.
 * 空白・制御文字・大文字・文字参照で書いたものも含む
 */
function isJavascriptUrl(value) {
  const v = decodeEntities(value).replace(/[\s\u0000-\u001f]/g, "").toLowerCase();
  if (v.startsWith("javascript:") || v.startsWith("vbscript:")) return true;
  return v.startsWith("data:") && !/^data:image\/(png|jpe?g|gif|webp)[;,]/.test(v);
}

/**
 * HTML の開始タグを読む. → [{ name, attrs: [{ name, value }], index }]（name は小文字）
 * ブラウザと同じく、属性の区切りは空白と / （<svg/onload=…>）、値は引用符あり・なしの両方.
 * 引用符の中の > でタグを終わりにしない. 取りこぼさないよう、どの < からも読み直す（安全側に多めに拾う）
 */
export function scanTags(text) {
  const tags = [];
  const n = text.length;
  for (const m of text.matchAll(/<([a-zA-Z][^\s/>]*)/g)) {
    let i = m.index + m[0].length;
    const attrs = [];
    while (i < n) {
      while (i < n && /[\s/]/.test(text[i])) i++;
      if (i >= n || text[i] === ">") break;
      const start = i++;
      while (i < n && !/[\s/>=]/.test(text[i])) i++;
      const name = text.slice(start, i).toLowerCase();
      let j = i;
      while (j < n && /\s/.test(text[j])) j++;
      let value = "";
      if (text[j] === "=") {
        i = j + 1;
        while (i < n && /\s/.test(text[i])) i++;
        const q = text[i];
        if (q === '"' || q === "'") {
          const end = text.indexOf(q, i + 1);
          value = text.slice(i + 1, end < 0 ? n : end);
          i = end < 0 ? n : end + 1;
        } else {
          const s = i;
          while (i < n && !/[\s>]/.test(text[i])) i++;
          value = text.slice(s, i);
        }
      }
      attrs.push({ name, value });
    }
    tags.push({ name: m[1].toLowerCase(), attrs, index: m.index });
  }
  return tags;
}

/** 文字参照（&#106; &#x6A; &colon; など）を戻す（javascript: を文字参照で隠したものを見つけるため） */
function decodeEntities(s) {
  return s
    .replace(/&#x([0-9a-f]+);?/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);?/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&colon;/gi, ":")
    .replace(/&tab;/gi, "\t")
    .replace(/&newline;/gi, "\n");
}

export function lintSvg(path, conf = DEFAULTS) {
  const text = readText(path);
  const out = [];
  const add = (severity, rule_id, message) => out.push({ rule_id, severity, message, location: path });
  for (const f of findBanned(text, conf.bannedTerms)) {
    out.push({ rule_id: "svg.banned_term", severity: "error", message: bannedMessage(f.term), location: `${path}:${f.line}` });
  }
  if (!/<svg[^>]*\bviewBox=/.test(text)) add("error", "svg.no_viewbox", "viewBox がありません（拡大縮小で崩れます）");
  if (/(xlink:)?href=["']https?:/.test(text)) add("error", "svg.external_ref", "外部 URL を参照しています（PDF / PPTX で表示されません）");
  for (const d of svgDangers(text)) add(d.severity, d.rule_id, d.message);
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
    conf = { ...DEFAULTS, ...(existsSync(confPath) ? JSON.parse(readText(confPath)) : {}) };
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
    // 拡張子は大文字小文字を区別しない（Windows で保存した SLIDE.MD・FIG.SVG も検査する）
    ...files.filter((f) => extname(f).toLowerCase() === ".md").flatMap((f) => lintFile(f, conf)),
    ...files.filter((f) => extname(f).toLowerCase() === ".svg").flatMap((f) => lintSvg(f, conf)),
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
