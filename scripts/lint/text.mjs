// 文字列・ファイル・パスの共通の小道具（表記ゆれ・禁止語・幅・BOM・除外パターン）
import { readFileSync } from "node:fs";
import { relative, resolve, sep } from "node:path";

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

export const bannedMessage = (term) => `使ってはいけない語「${term}」があります（表記ゆれ・全角を含む。config/slide-lint.json の bannedTerms）`;

/** 改行以外を空白にする（行番号・位置を変えずに中身を消す） */
export const blank = (s) => s.replace(/[^\n]/g, " ");
