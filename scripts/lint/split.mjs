// スライドの分割（front matter・区切り）と、コードフェンス・インラインのコードの扱い
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
