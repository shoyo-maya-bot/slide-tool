// スライドの分割（front matter・区切り）と、コードフェンス・インラインのコードの扱い
import { md } from "./markdown.mjs";
import { blank, stripBom } from "./text.mjs";

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

/**
 * front matter とスライドに分ける. 区切りは Marp（Marpit）と同じく、一番外側（引用・箇条書きの中ではない）の水平線
 * （---・***・___ など）. 段落の直後の --- は setext の見出し（## と同じ）で、区切りではない.
 * コードブロック（フェンス・字下げ 4 つ）の中の --- も区切りではない.
 * markdown-it を読めないときは、行の形で近い判定をする（段落の直後の --- を区切りにしない）
 */
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
  const body = lines.slice(i);
  const rules = new Set(md ? hrLinesByMarkdownIt(body) : hrLinesByShape(body));
  const slides = [];
  let cur = [];
  let start = i + 1;
  body.forEach((ln, k) => {
    if (rules.has(k)) {
      slides.push({ line: start, text: cur.join("\n") });
      cur = [];
      start = i + k + 2;
      return;
    }
    cur.push(ln);
  });
  slides.push({ line: start, text: cur.join("\n") });
  return { front, slides };
}

/** 一番外側の水平線の行（0 から）. Marpit と同じく markdown-it の hr トークン（level 0）で決める */
function hrLinesByMarkdownIt(lines) {
  return md
    .parse(lines.join("\n"), {})
    .filter((t) => t.type === "hr" && t.level === 0 && t.map)
    .map((t) => t.map[0]);
}

const HR = /^ {0,3}(?:(?:-[ \t]*){3,}|(?:\*[ \t]*){3,}|(?:_[ \t]*){3,})$/;

/** markdown-it を読めないときの近似: 水平線の形の行のうち、コードの中と、段落の直後の --- （setext の見出し）を除く */
export function hrLinesByShape(lines) {
  const inFence = fenceLines(lines);
  const out = [];
  let para = false; // 直前の行が段落の続きか
  lines.forEach((ln, k) => {
    if (inFence[k]) {
      para = false;
      return;
    }
    if (HR.test(ln) && !(para && /^ {0,3}-+[ \t]*$/.test(ln))) {
      out.push(k);
      para = false;
      return;
    }
    if (/^ {0,3}=+[ \t]*$/.test(ln) && para) {
      para = false; // setext の見出し（=）
      return;
    }
    const blankLine = /^\s*$/.test(ln);
    const block = /^ {0,3}(#{1,6}(\s|$)|>|[-*+](\s|$)|\d{1,9}[.)](\s|$)|<)/.test(ln);
    const indented = !para && /^( {4}|\t)/.test(ln);
    const tableRow = /^ {0,3}\|/.test(ln); // 表の行（表の直後の --- は区切り）
    para = !blankLine && !indented && !tableRow && (para || !block || /^ {0,3}</.test(ln));
    if (/^ {0,3}#{1,6}(\s|$)/.test(ln)) para = false;
  });
  return out;
}

/** コードブロック（``` と ~~~）の行を除く（markdown-it を読めないときだけ使う） */
export function dropFences(text) {
  const lines = text.split("\n");
  const inFence = fenceLines(lines);
  return lines.filter((_, i) => !inFence[i]).join("\n");
}

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
