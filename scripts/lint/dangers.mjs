// スクリプトを動かせる記述の判定（Markdown の中の HTML・SVG）
import { HTML_ELEMENTS, SVG_ELEMENTS, htmlAttrAllowed } from "./allowlist.mjs";
import { decodeEntities, scanTags } from "./tags.mjs";

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
  // 許可の一覧に無い要素（script・foreignObject は上で個別に出す）
  // foreignObject の中の HTML は foreignObject として出すので、要素の一覧の検査からは外す
  const outsideFo = scanTags(text.replace(/<foreignObject\b[\s\S]*?(<\/foreignObject\s*>|$)/gi, " "));
  const other = new Set(outsideFo.map((t) => t.name).filter((n) => isTagName(n) && !SVG_ELEMENTS.has(n) && n !== "script"));
  if (other.size) add("svg.disallowed_element", `SVG で使えない要素（${[...other].join(", ")}）があります（使えるものは scripts/lint/allowlist.mjs の SVG_ELEMENTS）`);
  // 外部の URL を読む参照（href・xlink:href・src）と、style 属性・<style> の中の @import・外部の url()
  if (tags.some((t) => t.attrs.some((a) => /^(xlink:)?href$|^src$/.test(a.name) && isExternalUrl(a.value)))) {
    add("svg.external_ref", "外部 URL を参照しています（PDF / PPTX で表示されず、:trusted では外部に読みに行きます）");
  }
  const css = [...tags.flatMap((t) => t.attrs.filter((a) => a.name === "style").map((a) => decodeEntities(a.value))), ...styleBodies(text).map((b) => b.css)];
  if (css.some((c) => cssDangers(c).length)) add("svg.external_ref", "CSS の @import・外部の url() を含めないでください（外部に読みに行きます）");
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
  out.push(...htmlAllowlistFindings(text));
  return out;
}

/**
 * 許可の一覧（allowlist.mjs）に無い要素・属性と、外部のものを読む記述を探す. → [{ rule_id, severity, message, index }]
 * - 一覧に無い要素（iframe・object・embed・meta・link・base・form・video など）・属性（srcset・formaction など）
 * - <img src="https://…"> など外部の画像、Markdown の画像 ![](https://…)
 * - <style> の中・style 属性の @import と外部の url()
 * text はコードと SVG を空白にしたもの（maskCode）を渡す
 */
export function htmlAllowlistFindings(text) {
  const out = [];
  const add = (rule_id, message, index) => out.push({ rule_id, severity: "error", message, index });
  for (const t of scanTags(text)) {
    if (!isTagName(t.name)) continue; // <https://…> などの自動リンク
    if (t.name === "script") continue; // html.script で出す
    if (!HTML_ELEMENTS.has(t.name)) {
      add("html.disallowed_element", `<${t.name}> は使えません（使える要素は scripts/lint/allowlist.mjs の HTML_ELEMENTS。:trusted で出力すると動きます）`, t.index);
      continue;
    }
    const bad = t.attrs.filter((a) => !isEventAttr(a.name) && !htmlAttrAllowed(t.name, a.name)).map((a) => a.name);
    if (bad.length) add("html.disallowed_attribute", `<${t.name}> に使えない属性（${bad.join(", ")}）があります（scripts/lint/allowlist.mjs）`, t.index);
    for (const a of t.attrs) {
      if (t.name === "img" && a.name === "src" && isExternalUrl(a.value)) add("html.external_resource", `<img> が外部の画像を読みます（${a.value.slice(0, 60)}）。画像はリポジトリに置きます`, t.index);
      if (a.name === "style") for (const d of cssDangers(decodeEntities(a.value))) add("html.external_resource", `<${t.name}> の style 属性: ${d}`, t.index);
    }
  }
  for (const b of styleBodies(text)) for (const d of cssDangers(b.css)) add("html.external_resource", `<style>: ${d}`, b.index);
  // Markdown の画像 ![…](https://…)（リンク [..](https://…) は読み込まないので可）
  for (const m of text.matchAll(/!\[[^\]]*\]\(\s*<?([^)\s>]*)/g)) {
    if (isExternalUrl(m[1])) add("html.external_resource", `画像が外部の URL を読みます（${m[1].slice(0, 60)}）。画像はリポジトリに置きます`, m.index);
  }
  return out;
}

/** <style>…</style> の中身と位置 */
function styleBodies(text) {
  return [...text.matchAll(/<style\b[^>]*>([\s\S]*?)(?:<\/style\s*>|$)/gi)].map((m) => ({ css: m[1], index: m.index }));
}

/**
 * CSS の中で外部のものを読む記述. → 説明の配列（無ければ空）
 * @import（読む先に関係なく）、外部の url()（http:・https:・//・画像以外の data: など. 相対パスと data:image は可）、expression()
 */
export function cssDangers(css) {
  const c = decodeCssEscapes(css).replace(/\/\*[\s\S]*?\*\//g, " ");
  const out = [];
  if (/@import\b/i.test(c)) out.push("@import は使えません（外部の CSS を読みます）");
  for (const m of c.matchAll(/url\(\s*(['"]?)([^'")]*)\1\s*\)/gi)) {
    if (isExternalUrl(m[2])) out.push(`外部の url() は使えません（${m[2].slice(0, 60)}）`);
  }
  if (/expression\s*\(/i.test(c) || /-moz-binding/i.test(c)) out.push("expression()・-moz-binding は使えません");
  return out;
}

/** CSS のエスケープ（\75 rl( など）を戻す */
function decodeCssEscapes(s) {
  return s.replace(/\\([0-9a-f]{1,6})\s?/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/\\(.)/g, "$1");
}

/** HTML の要素名の形か（自動リンク <https://…>・<a@b.c> を除く） */
const isTagName = (name) => /^[a-z][a-z0-9]*$/.test(name);

/**
 * 外部のものを読む URL か: スキームのあるもの（http:・https:・ftp:・file: など）と // で始まるもの.
 * 相対パス・ページ内の #…・data:image（png・jpeg・gif・webp）は外部ではない. javascript: などは別の規則で出す
 */
export function isExternalUrl(value) {
  const v = decodeEntities(value ?? "").replace(/[\s\u0000-\u001f]/g, "").toLowerCase();
  if (!v || v.startsWith("#")) return false;
  if (v.startsWith("//") || v.startsWith("\\\\")) return true;
  if (/^data:image\/(png|jpe?g|gif|webp)[;,]/.test(v)) return false;
  return /^[a-z][a-z0-9+.-]*:/.test(v) && !/^(javascript|vbscript|data):/.test(v);
}

export const isEventAttr = (name) => /^on[a-z]+$/i.test(name);

/**
 * スクリプトを動かせる URL か: javascript:・vbscript:、画像（png・jpeg・gif・webp）以外の data:（data:text/html など）.
 * 空白・制御文字・大文字・文字参照で書いたものも含む
 */
export function isJavascriptUrl(value) {
  const v = decodeEntities(value).replace(/[\s\u0000-\u001f]/g, "").toLowerCase();
  if (v.startsWith("javascript:") || v.startsWith("vbscript:")) return true;
  return v.startsWith("data:") && !/^data:image\/(png|jpe?g|gif|webp)[;,]/.test(v);
}
