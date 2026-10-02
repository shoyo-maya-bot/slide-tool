// themes/*.css の後ろに Tailwind の出力（build/tailwind.css）を足して build/themes/ に置く.
// Marp はテーマ CSS 1 ファイルの中に /* @theme 名前 */ が必要なので、結合して 1 ファイルにする.
import { mkdirSync, readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const tw = existsSync("build/tailwind.css") ? readFileSync("build/tailwind.css", "utf8") : "";
mkdirSync("build/themes", { recursive: true });
for (const f of readdirSync("themes").filter((n) => n.endsWith(".css") && !n.includes(".input."))) {
  const base = readFileSync(join("themes", f), "utf8");
  writeFileSync(join("build/themes", f), `${base}\n/* ---- Tailwind ---- */\n${tw}\n`);
  console.log(`build/themes/${f}`);
}
