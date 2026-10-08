// スライドの Markdown の検査（見出し・箇条書き・字数・画像・危険な HTML）
//
// 見出しと箇条書きは、Marp と同じ markdown-it（package-lock.json で固定）のトークンで数える（コードブロックの中は数えない）。
// markdown-it を読めないとき（npm ci の前）は警告を出し、コードブロックを除いた行で数える。CI（環境変数 CI）では失敗にする。
import { htmlDangers, svgDangers } from "./dangers.mjs";
import { dropFences, maskCode, splitSlides } from "./split.mjs";
import { bannedMessage, blank, findBanned, readText, width } from "./text.mjs";

let MarkdownIt = null;
try {
  ({ default: MarkdownIt } = await import("markdown-it"));
} catch {
  MarkdownIt = null;
}
/** 見出し・箇条書きを数える方法（"markdown-it" か、読めないときの "fallback"） */
export const parser = MarkdownIt ? "markdown-it" : "fallback";
const md = MarkdownIt ? new MarkdownIt({ html: true }) : null;

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
