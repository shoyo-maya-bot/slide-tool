// スクリプトを動かせる記述の判定（Markdown の中の HTML・SVG）
import { isAbsolute, relative, resolve } from "node:path";

import { HTML_ELEMENTS, SVG_ELEMENTS, htmlAttrAllowed } from "./allowlist.mjs";
import { md } from "./markdown.mjs";
import { decodeEntities, scanTags } from "./tags.mjs";

/**
 * SVG の中の、スクリプトを動かせる記述を探す. → [{ rule_id, severity, message }]
 * - on で始まるイベント属性（onload・onclick など）
 * - foreignObject（中に HTML を入れられる）
 * - 属性の値の javascript:・vbscript:・data:（画像以外）の URL（空白・大文字・文字参照で書いたものも含む）
 * - 外部の URL と、資料のフォルダ（ctx.root）の外を指すローカルのパス（/etc/… や ../../… など）を読む参照
 * ctx は { baseDir: 参照の起点のフォルダ, root: 読んでよい範囲のフォルダ }. 無いときは絶対パスだけを外とみなす
 */
export function svgDangers(text, ctx = null) {
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
  const refs = tags.flatMap((t) => t.attrs.filter((a) => /^(xlink:)?href$|^src$/.test(a.name)).map((a) => a.value));
  if (refs.some((v) => isExternalUrl(v))) {
    add("svg.external_ref", "外部 URL を参照しています（PDF / PPTX で表示されず、:trusted では外部に読みに行きます）");
  }
  const outside = refs.filter((v) => isOutsidePath(v, ctx));
  if (outside.length) add("svg.external_ref", `資料のフォルダの外のファイルを参照しています（${outside[0].slice(0, 60)}）。:trusted ではローカルのファイルを読みます`);
  const css = [...tags.flatMap((t) => t.attrs.filter((a) => a.name === "style").map((a) => decodeEntities(a.value))), ...styleBodies(text).map((b) => b.css)];
  if (css.some((c) => cssDangers(c, ctx).length)) add("svg.external_ref", "CSS の @import・外部や資料のフォルダの外を読む url()・image-set() を含めないでください");
  return out;
}

/**
 * Markdown の中の HTML（SVG の外）で、スクリプトを動かせる記述を探す. → [{ rule_id, severity, message, index }]
 * - <script> 要素
 * - on で始まるイベント属性（どの要素でも. <img/onerror=…> のような / 区切りも）
 * - 属性の値・Markdown のリンク先の javascript:・vbscript:・data:（画像以外）の URL
 * text はコードを空白にしたもの（maskCode）を渡す
 */
export function htmlDangers(text, ctx = null) {
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
  // 参照形式のリンク・画像の定義 [id]: javascript:…
  for (const d of referenceDefinitions(text)) {
    if (isJavascriptUrl(d.url)) add("html.javascript_url", "javascript:・vbscript:・data:（画像以外）のリンクを含めないでください", d.index);
  }
  out.push(...htmlAllowlistFindings(text, ctx));
  return out;
}

/**
 * 許可の一覧（allowlist.mjs）に無い要素・属性と、外部のものを読む記述を探す. → [{ rule_id, severity, message, index }]
 * - 一覧に無い要素（iframe・object・embed・meta・link・base・form・video など）・属性（srcset・formaction など）
 * - <img src="https://…"> など外部の画像、Markdown の画像（![](https://…) と参照形式の ![図][id] + [id]: https://…）
 * - <style> の中・style 属性の @import と、外部の url()・image-set()
 * - 資料のフォルダ（ctx.root）の外を指すローカルのパス（/etc/…・../../… など）を読む画像・CSS
 * text はコードと SVG を空白にしたもの（maskCode）を渡す
 */
export function htmlAllowlistFindings(text, ctx = null) {
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
      if (t.name === "img" && a.name === "src" && isOutsidePath(a.value, ctx)) add("html.external_resource", `<img> が資料のフォルダの外のファイルを読みます（${a.value.slice(0, 60)}）。画像はリポジトリに置きます`, t.index);
      if (a.name === "style") for (const d of cssDangers(decodeEntities(a.value), ctx)) add("html.external_resource", `<${t.name}> の style 属性: ${d}`, t.index);
    }
  }
  for (const b of styleBodies(text)) for (const d of cssDangers(b.css, ctx)) add("html.external_resource", `<style>: ${d}`, b.index);
  // Markdown の画像（インライン・参照形式. リンク [..](https://…) は読み込まないので可）
  for (const img of markdownImages(text)) {
    if (isExternalUrl(img.src)) add("html.external_resource", `画像が外部の URL を読みます（${img.src.slice(0, 60)}）。画像はリポジトリに置きます`, img.index);
    else if (isOutsidePath(img.src, ctx)) add("html.external_resource", `画像が資料のフォルダの外のファイルを読みます（${img.src.slice(0, 60)}）。画像はリポジトリに置きます`, img.index);
  }
  return out;
}

/**
 * Markdown の画像の読み込み先. → [{ src, index }]
 * Marp と同じ markdown-it のトークン（image の src）で読むので、参照形式（![図][id] と [id]: https://…）も拾う.
 * markdown-it を読めないときは、インラインの ![](…) と、画像から参照される定義を行の形で拾う
 */
export function markdownImages(text) {
  if (md) {
    const starts = lineStarts(text);
    const out = [];
    const walk = (tokens, line) => {
      for (const t of tokens) {
        const l = t.map ? t.map[0] : line;
        if (t.type === "image") out.push({ src: t.attrGet("src") ?? "", index: starts[l] ?? 0 });
        if (t.children) walk(t.children, l);
      }
    };
    walk(md.parse(text, {}), 0);
    return out;
  }
  const out = [...text.matchAll(/!\[[^\]]*\]\(\s*<?([^)\s>]*)/g)].map((m) => ({ src: m[1], index: m.index }));
  const used = new Set([...text.matchAll(/!\[([^\]]*)\]\[([^\]]*)\]|!\[([^\]]+)\](?![[(:])/g)].map((m) => normalizeLabel(m[2] || m[1] || m[3])));
  for (const d of referenceDefinitions(text)) if (used.has(d.label)) out.push({ src: d.url, index: d.index });
  return out;
}

/** 参照形式のリンク・画像の定義（[id]: URL）. → [{ label, url, index }] */
function referenceDefinitions(text) {
  return [...text.matchAll(/^ {0,3}\[([^\]]+)\]:[ \t]*(?:\n[ \t]*)?<?([^\s>]+)/gm)].map((m) => ({ label: normalizeLabel(m[1]), url: m[2], index: m.index }));
}

const normalizeLabel = (s) => s.trim().replace(/\s+/g, " ").toLowerCase();

/** 各行の先頭の位置（0 から） */
function lineStarts(text) {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === "\n") starts.push(i + 1);
  return starts;
}

/** <style>…</style> の中身と位置 */
function styleBodies(text) {
  return [...text.matchAll(/<style\b[^>]*>([\s\S]*?)(?:<\/style\s*>|$)/gi)].map((m) => ({ css: m[1], index: m.index }));
}

/**
 * CSS の中で外部のものを読む記述. → 説明の配列（無ければ空）
 * @import（読む先に関係なく）、外部の url()・image-set()（http:・https:・//・画像以外の data: など. 相対パスと data:image は可）、
 * 資料のフォルダの外を指すローカルのパス（ctx. isOutsidePath）、expression()
 */
export function cssDangers(css, ctx = null) {
  const c = decodeCssEscapes(css).replace(/\/\*[\s\S]*?\*\//g, " ");
  const out = [];
  if (/@import\b/i.test(c)) out.push("@import は使えません（外部の CSS を読みます）");
  const check = (v, kind) => {
    if (isExternalUrl(v)) out.push(`外部の ${kind} は使えません（${v.slice(0, 60)}）`);
    else if (isOutsidePath(v, ctx)) out.push(`資料のフォルダの外を読む ${kind} は使えません（${v.slice(0, 60)}）`);
  };
  for (const m of c.matchAll(/url\(\s*(['"]?)([^'")]*)\1\s*\)/gi)) check(m[2], "url()");
  // image-set("https://…" 1x) / -webkit-image-set(…): url() を使わずに文字列で読み込み先を書ける
  for (const m of c.matchAll(/image-set\(((?:[^()]|\([^()]*\))*)\)?/gi)) {
    // 中の url(…) は上で見ているので、それ以外の文字列だけを見る
    for (const s of m[1].replace(/url\([^()]*\)/gi, " ").matchAll(/(['"])(.*?)\1/g)) check(s[2], "image-set()");
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

/**
 * 資料のフォルダ（ctx.root）の外を指すローカルのパスか（/etc/passwd・../../../x.png・%2e%2e/ など）.
 * :trusted（--allow-local-files）では、外部の URL でなくてもローカルの任意のファイルを読めてしまうため.
 * スキームのある URL・// で始まるもの・#… は対象外（isExternalUrl などで扱う）. 起点は ctx.baseDir（資料のファイルのフォルダ）.
 * ctx が無いときは、絶対パス（/…・\…）だけを外とみなす
 */
export function isOutsidePath(value, ctx = null) {
  let v = decodeEntities(value ?? "").replace(/[\s\u0000-\u001f]/g, "");
  if (!v || v.startsWith("#") || v.startsWith("//") || v.startsWith("\\\\")) return false;
  if (/^[a-z][a-z0-9+.-]*:/i.test(v)) return false;
  v = v.replace(/[?#].*$/, "");
  try {
    v = decodeURIComponent(v);
  } catch {
    // そのまま使う
  }
  v = v.replace(/\\/g, "/");
  if (v.startsWith("/")) return true;
  if (!ctx) return false;
  const rel = relative(resolve(ctx.root), resolve(ctx.baseDir, v));
  return rel.split(/[\\/]/)[0] === ".." || isAbsolute(rel);
}

/**
 * 資料のファイルのパスの読み込み先を判定するための ctx（isOutsidePath）. 起点はファイルのフォルダ.
 * 読んでよい範囲は、今の作業フォルダ（リポジトリ）の中のファイルならそのフォルダ、外のファイルならファイルのフォルダ
 */
export function pathContext(path) {
  const cwd = resolve(process.cwd());
  const baseDir = resolve(path, "..");
  const rel = relative(cwd, baseDir);
  const inside = rel.split(/[\\/]/)[0] !== ".." && !isAbsolute(rel);
  return { baseDir, root: inside ? cwd : baseDir };
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
