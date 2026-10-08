// スクリプトを動かせる記述の判定（Markdown の中の HTML・SVG）
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
