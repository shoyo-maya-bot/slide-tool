// themes/*.css の後ろに Tailwind の出力（build/tailwind.css）を足して build/themes/ に置く.
// Marp はテーマ CSS 1 ファイルの中に /* @theme 名前 */ が必要なので、結合して 1 ファイルにする.
//
// 同梱フォント: テーマの中の /* @fontsource <パッケージ名> <太さ...> */ を、npm で入れた
// @fontsource/<パッケージ名> の @font-face（フォントファイルは絶対パスの file:// URL）に置き換える.
// どの PC でも同じフォントで描画されるので、PDF / PPTX と check:overflow の結果がそろう.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const DIRECTIVE = /\/\*\s*@fontsource\s+([a-z0-9-]+)((?:\s+\d{3})+)\s*\*\//g;

/** /* @fontsource name 400 700 *\/ を @font-face に展開する. フォントが無ければ例外（黙って別のフォントにしない） */
export function expandFonts(css, root = process.cwd()) {
  return css.replace(DIRECTIVE, (_, name, weights) => {
    const dir = resolve(root, "node_modules", "@fontsource", name);
    if (!existsSync(dir)) {
      throw new Error(`@fontsource/${name} が見つかりません。先に npm ci（または setup）を実行してください`);
    }
    return weights
      .trim()
      .split(/\s+/)
      .map((w) => {
        const file = join(dir, `${w}.css`);
        if (!existsSync(file)) throw new Error(`@fontsource/${name} に太さ ${w} がありません（${file}）`);
        const out = readFileSync(file, "utf8").replace(/url\((['"]?)\.?\/?files\/([^'")]+)\1\)/g, (_m, _q, f) => {
          return `url("${pathToFileURL(join(dir, "files", f)).href}")`;
        });
        if (!/@font-face/.test(out) || /url\((['"]?)\.?\/?files\//.test(out)) {
          throw new Error(`@fontsource/${name}/${w}.css の形式が想定と違います`);
        }
        return `/* @fontsource/${name} ${w}（SIL Open Font License 1.1） */\n${out.trim()}`;
      })
      .join("\n");
  });
}

export function buildThemes({ themes = "themes", out = "build/themes", tailwind = "build/tailwind.css", root } = {}) {
  const tw = existsSync(tailwind) ? readFileSync(tailwind, "utf8") : "";
  mkdirSync(out, { recursive: true });
  const written = [];
  for (const f of readdirSync(themes).filter((n) => n.endsWith(".css") && !n.includes(".input."))) {
    const base = expandFonts(readFileSync(join(themes, f), "utf8"), root);
    writeFileSync(join(out, f), `${base}\n/* ---- Tailwind ---- */\n${tw}\n`);
    written.push(join(out, f));
  }
  return written;
}

if (process.argv[1]?.endsWith("build-theme.mjs")) {
  try {
    for (const f of buildThemes()) console.log(f);
  } catch (e) {
    console.error(e.message);
    process.exitCode = 1;
  }
}
