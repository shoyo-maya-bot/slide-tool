// 資料の中に直接書いてよい HTML・SVG の要素と属性（許可の一覧）.
// ここに無い要素・属性は error にする（:trusted で出力すると動くため、危ないものを探すのではなく、使ってよいものだけを通す）.
// 足すときは、スクリプトを動かせない・外部のものを読まない要素・属性であることを確かめ、テストに例を足す

/** Markdown の中に書いてよい HTML の要素（小文字） */
export const HTML_ELEMENTS = new Set([
  // まとまり・文字の飾り
  "div", "span", "p", "br", "hr", "section", "header", "footer", "article", "aside", "nav", "main",
  "b", "strong", "i", "em", "u", "s", "del", "ins", "small", "sub", "sup", "mark", "code", "pre", "kbd", "samp", "var",
  "abbr", "cite", "q", "dfn", "time", "wbr", "ruby", "rt", "rp", "bdi", "bdo",
  "h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "figure", "figcaption", "details", "summary",
  // 箇条書き・表
  "ul", "ol", "li", "dl", "dt", "dd", "table", "caption", "colgroup", "col", "thead", "tbody", "tfoot", "tr", "th", "td",
  // リンク・画像（URL は下の規則で確かめる）
  "a", "img",
  // Marp のスライドごとの CSS（中身は cssDangers で確かめる）
  "style",
]);

/** どの HTML の要素にも書いてよい属性. aria-* と data-* も可 */
export const HTML_GLOBAL_ATTRS = new Set(["class", "id", "style", "title", "lang", "dir", "role", "hidden", "align", "translate"]);

/** 要素ごとに書いてよい属性 */
export const HTML_ELEMENT_ATTRS = {
  a: ["href", "target", "rel", "name"],
  img: ["src", "alt", "width", "height", "loading", "decoding"],
  ol: ["start", "type", "reversed"],
  li: ["value"],
  td: ["colspan", "rowspan", "valign", "headers"],
  th: ["colspan", "rowspan", "valign", "scope", "abbr", "headers"],
  col: ["span", "width"],
  colgroup: ["span", "width"],
  table: ["border", "width"],
  details: ["open"],
  time: ["datetime"],
  q: ["cite"],
  blockquote: ["cite"],
  del: ["cite", "datetime"],
  ins: ["cite", "datetime"],
  style: ["scoped"],
  bdo: ["dir"],
};

export function htmlAttrAllowed(element, attr) {
  if (/^(aria|data)-[a-z0-9_.-]+$/.test(attr)) return true;
  return HTML_GLOBAL_ATTRS.has(attr) || (HTML_ELEMENT_ATTRS[element] ?? []).includes(attr);
}

/** SVG（ファイル・資料の中に直接書いたもの）に書いてよい要素（小文字）. script・foreignObject・animate・set などは不可 */
export const SVG_ELEMENTS = new Set([
  "svg", "g", "defs", "symbol", "use", "title", "desc", "metadata",
  "path", "rect", "circle", "ellipse", "line", "polyline", "polygon",
  "text", "tspan", "textpath", "a", "image", "marker", "style",
  "lineargradient", "radialgradient", "stop", "pattern", "clippath", "mask",
  "filter", "feblend", "fecolormatrix", "fecomponenttransfer", "fecomposite", "fedropshadow", "feflood",
  "fefunca", "fefuncb", "fefuncg", "fefuncr", "fegaussianblur", "femerge", "femergenode", "femorphology", "feoffset",
]);
