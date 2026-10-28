// コマンドライン（引数・設定の読み込み・ファイルの列挙・出力）
import { existsSync, lstatSync, readdirSync, realpathSync, statSync } from "node:fs";
import { extname, join } from "node:path";

import { DEFAULTS } from "./config.mjs";
import { lintFile, parser } from "./slide.mjs";
import { lintSvg } from "./svg.mjs";
import { bannedMessage, findBanned, isExcluded, readText, relPath } from "./text.mjs";

export const USAGE = "使い方: lint-slides.mjs <フォルダかファイル>... [--format markdown|json] [--config file]";
const FORMATS = ["markdown", "json"];

/**
 * フォルダの中のファイルを列挙する. シンボリックリンクもたどる（Marp が描画するものは lint もする）が、
 * 同じフォルダ（実体のパス）は 1 回だけ見る（自分や親を指すリンクで無限に再帰しない）.
 */
export function walk(p, seen = new Set()) {
  if (!existsSync(p)) return []; // 壊れたリンク
  if (statSync(p).isFile()) return [p];
  if (!statSync(p).isDirectory()) return [];
  const real = realpathSync(p);
  if (seen.has(real)) {
    if (lstatSync(p).isSymbolicLink()) console.error(`警告: ${p} はすでに検査したフォルダを指すリンクなので、たどりません`);
    return [];
  }
  seen.add(real);
  return readdirSync(p)
    .sort()
    .flatMap((n) => (n.startsWith(".") || n === "node_modules" ? [] : walk(join(p, n), seen)));
}

export function main(argv) {
  const args = [...argv];
  let format = "markdown";
  let confPath = "config/slide-lint.json";
  let confGiven = false; // --config で指定したファイルが無いのは誤り（既定の config/slide-lint.json は無ければ既定値）
  const targets = [];
  while (args.length) {
    const a = args.shift();
    if (a === "--format" || a === "-f" || a === "--config") {
      const v = args.shift();
      if (v === undefined || v.startsWith("-")) {
        console.error(`${a} の値がありません\n${USAGE}`);
        return 2;
      }
      if (a === "--config") [confPath, confGiven] = [v, true];
      else format = v;
    } else if (a.startsWith("-") && a !== "-") {
      console.error(`不明なオプション: ${a}\n${USAGE}`);
      return 2;
    } else targets.push(a);
  }
  if (!targets.length) {
    console.error(USAGE);
    return 2;
  }
  if (!FORMATS.includes(format)) {
    console.error(`--format は ${FORMATS.join(" / ")} のどれかです（指定: ${format}）`);
    return 2;
  }
  if (confGiven && !existsSync(confPath)) {
    console.error(`設定ファイルがありません: ${confPath}（--config の指定を確かめてください）`);
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
  // 対象がどれも無い（打ち間違いなど）ときは、何も検査せずに 0 で終わらないよう引数の誤り（2）.
  // 一部だけ無いときは警告して続ける（npm run lint の slides layouts assets から、使わない assets/ を消した場合など）
  const missing = targets.filter((t) => !existsSync(t));
  if (missing.length === targets.length) {
    console.error(`対象がありません: ${missing.join(", ")}`);
    return 2;
  }
  for (const t of missing) console.error(`警告: ${t} がありません（検査しません）`);
  const seen = new Set();
  const files = targets.flatMap((t) => walk(t, seen)).filter((f) => !isExcluded(f, conf.exclude));
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
