// スライドの Markdown の検査（見出し・箇条書き・字数・画像・危険な HTML）
//
// 見出しと箇条書きは、Marp と同じ markdown-it（package-lock.json で固定）のトークンで数える（コードブロックの中は数えない）。
// markdown-it を読めないとき（npm ci の前）は警告を出し、コードブロックを除いた行で数える。CI（環境変数 CI）では失敗にする。
import { directiveDangers, htmlDangers, pathContext, svgDangers } from "./dangers.mjs";
import { dropFences, fenceLines, maskCode, splitSlides } from "./split.mjs";
import { bannedMessage, blank, findBanned, readText, stripBom, width } from "./text.mjs";

import { md, parser } from "./markdown.mjs";

export { parser };

/** YAML の値の前後の引用符を外す */
const unquote = (v) =>
  v
    .trim()
    .replace(/^(['"])(.*)\1$/, "$2")
    .trim();

/**
 * スライドの中の HTML コメントの class の指定. → { local, spot }（無ければ null）
 * Marp と同じく、`<!-- class: x -->` はそのスライドから後ろに引き継ぎ、`<!-- _class: x -->` はそのスライドだけ.
 * 1 つのコメントに複数の指定（paginate: true など）を書いたものも読む. コードフェンスの中は見ない
 */
export function classDirectives(text) {
  const lines = text.split("\n");
  const inFence = fenceLines(lines);
  const body = lines.map((ln, i) => (inFence[i] ? "" : ln)).join("\n");
  let local = null;
  let spot = null;
  for (const m of body.matchAll(/<!--([\s\S]*?)-->/g)) {
    for (const d of m[1].matchAll(/^[ \t]*(_?)class[ \t]*:(.*)$/gm)) {
      if (d[1]) spot = unquote(d[2]);
      else local = unquote(d[2]);
    }
  }
  return { local, spot };
}

/** front matter の class（全スライドの既定） */
export function frontClass(front) {
  const m = front.match(/^class[ \t]*:(.*)$/m);
  return m ? unquote(m[1]) : "";
}

/**
 * スライドごとの class. front matter の class を既定に、`class:` は後ろへ引き継ぎ、`_class:` はそのスライドだけ上書き
 */
export function slideClasses(front, slides) {
  let inherited = frontClass(front);
  return slides.map((s) => {
    const { local, spot } = classDirectives(s.text);
    if (local !== null) inherited = local;
    return spot ?? inherited;
  });
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

/** タイトルの見た目の文字（タグを除き、消し残しの < > も数えない. 字数を数えるためで、無害化ではない） */
export function titleText(title) {
  let out = "";
  let inTag = false;
  for (const ch of title) {
    if (ch === "<") inTag = true;
    else if (ch === ">") inTag = false;
    else if (!inTag) out += ch;
  }
  return out;
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

// Marp（Marpit）の画像の指定. 代替テキストを空白で区切った語のうち、語全体がこれに合うものだけが指定として消える
const LENGTH = String.raw`(?:\d*\.)?\d+(?:%|ch|cm|em|ex|in|mm|pc|pt|px)?|auto`;
const IMAGE_KEYWORDS = [
  /^(\d*\.)?\d+%$/,
  new RegExp(`^w(?:idth)?:(?:${LENGTH})$`),
  new RegExp(`^h(?:eight)?:(?:${LENGTH})$`),
  /^(blur|brightness|contrast|grayscale|hue-rotate|invert|opacity|saturate|sepia)(:.+)?$/,
  /^drop-shadow(:.+)?$/,
];
// 背景画像（bg がある）ときだけの指定
const BG_KEYWORDS = [/^bg$/, /^(auto|contain|cover|fit)$/, /^(left|right)(:(\d*\.)?\d+%)?$/, /^(vertical|horizontal)$/];

/** 画像の代替テキストから Marp の画像の指定（w:200px・h:100・bg・fit・blur など）を除いた残り */
export function altWithoutMarpKeywords(alt) {
  const words = alt.split(/\s+/).filter(Boolean);
  const bg = words.includes("bg");
  return words.filter((w) => !IMAGE_KEYWORDS.some((re) => re.test(w)) && !(bg && BG_KEYWORDS.some((re) => re.test(w)))).join(" ");
}

export function lintSlide(slide, index, conf, file) {
  const out = [];
  const add = (severity, rule_id, message) => out.push({ rule_id, severity, message, location: `${file}:${slide.line} (${index + 1} 枚目)` });
  const text = slide.text;
  const cls = slide.className ?? slideClasses("", [slide])[0];
  const classes = cls.split(/\s+/).filter(Boolean);
  const layout = classes.find((c) => conf.layouts.includes(c)) || "";
  const unknown = classes.filter((c) => !conf.layouts.includes(c) && !c.startsWith("tw-") && !/^(lead|invert|gaia)$/.test(c));
  if (conf.layouts.length && unknown.length) add("warning", "slide.unknown_layout", `定義に無いレイアウト: ${unknown.join(", ")}（docs/layouts.md）`);

  const st = structure(text);
  if (st.title === null && !conf.noTitleLayouts.includes(layout) && text.trim())
    add("error", "slide.no_title", "見出し（# タイトル）がありません。1 枚に 1 つのメッセージを見出しで書きます");
  const titleWidth = st.title === null ? 0 : width(titleText(st.title));
  if (titleWidth > conf.maxTitleChars) {
    add("warning", "slide.title_long", `タイトルが長い（全角 ${titleWidth} 字 > ${conf.maxTitleChars}）。2 行になると下の要素が押し出されます`);
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
    const alt = altWithoutMarpKeywords(m[1]);
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
  if (!/^marp:\s*true\s*$/m.test(front))
    out.push({ rule_id: "deck.not_marp", severity: "error", message: "front matter に marp: true がありません", location: `${path}:1` });
  if (!/^theme:\s*\S+/m.test(front))
    out.push({ rule_id: "deck.no_theme", severity: "warning", message: "front matter に theme がありません（standard を推奨）", location: `${path}:1` });
  const classes = slideClasses(front, slides);
  slides.forEach((s, i) => out.push(...lintSlide({ ...s, className: classes[i] }, i, conf, path)));
  // :trusted（HTML 有効）で出力すると、資料の中に直接書いた HTML・SVG も動くので、スクリプトを動かせる記述を探す.
  // コードフェンス・インラインのコード・HTML コメントの中は動かないので見ない
  const lineAt = (text, index) => text.slice(0, index).split(/\r?\n/).length;
  const ctx = pathContext(path);
  let scan = maskCode(raw);
  for (const m of scan.matchAll(/<svg\b[\s\S]*?<\/svg>/gi)) {
    for (const d of svgDangers(m[0], ctx)) out.push({ ...d, location: `${path}:${lineAt(raw, m.index)}` });
  }
  scan = scan.replace(/<svg\b[\s\S]*?<\/svg>/gi, blank);
  for (const d of htmlDangers(scan, ctx))
    out.push({ rule_id: d.rule_id, severity: d.severity, message: d.message, location: `${path}:${lineAt(raw, d.index)}` });
  // Marp のディレクティブ（front matter と HTML コメント）: style の @import、backgroundImage の外部・file: の url() など.
  // HTML コメントは本文の検査では見ないので、ここで見る（コードフェンスの中のコメントは動かないので見ない）
  const norm = stripBom(raw).replace(/\r\n/g, "\n");
  const normLines = norm.split("\n");
  const inFence = fenceLines(normLines);
  const fenceless = normLines.map((ln, i) => (inFence[i] ? blank(ln) : ln)).join("\n");
  const frontOffset = front ? 4 : 0; // 先頭の "---\n" の後ろ
  const commentsOnly = front ? blank(norm.slice(0, frontOffset + front.length)) + fenceless.slice(frontOffset + front.length) : fenceless;
  for (const d of directiveDangers(commentsOnly, { front, frontOffset, ctx })) {
    out.push({ rule_id: d.rule_id, severity: d.severity, message: d.message, location: `${path}:${lineAt(norm, d.index)}` });
  }
  return out;
}
