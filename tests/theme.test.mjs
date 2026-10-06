import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { buildThemes, expandFonts } from "../scripts/build-theme.mjs";

// @fontsource/<name> と同じ形のパッケージを一時フォルダに作る（npm の取得なしで試す）
function fakeFontsource(root, name = "noto-sans-jp", weights = ["400", "700"]) {
  const dir = join(root, "node_modules", "@fontsource", name);
  mkdirSync(join(dir, "files"), { recursive: true });
  for (const w of weights) {
    writeFileSync(join(dir, "files", `${name}-0-${w}-normal.woff2`), "x");
    writeFileSync(
      join(dir, `${w}.css`),
      `/* ${name}-[0]-${w}-normal */\n@font-face {\n  font-family: 'Noto Sans JP';\n  font-weight: ${w};\n` +
        `  src: url(./files/${name}-0-${w}-normal.woff2) format('woff2');\n  unicode-range: U+3000-30ff;\n}\n`,
    );
  }
  return dir;
}

test("@fontsource の指定を、絶対パスの file:// URL の @font-face に展開する", () => {
  const root = mkdtempSync(join(tmpdir(), "theme-"));
  const dir = fakeFontsource(root);
  const css = expandFonts("@import 'default';\n/* @fontsource noto-sans-jp 400 700 */\nsection { color: red; }\n", root);
  assert.equal((css.match(/@font-face/g) || []).length, 2);
  const urls = [...css.matchAll(/url\("([^"]+)"\)/g)].map((m) => m[1]);
  assert.equal(urls.length, 2);
  for (const u of urls) {
    assert.ok(u.startsWith("file://"), u);
    assert.ok(fileURLToPath(u).startsWith(join(dir, "files")), u);
  }
  assert.ok(!css.includes("/* @fontsource noto-sans-jp"));
  assert.ok(css.includes("section { color: red; }"));
});

test("フォントのパッケージが無いときは黙って進めず止める", () => {
  const root = mkdtempSync(join(tmpdir(), "theme-"));
  assert.throws(() => expandFonts("/* @fontsource noto-sans-jp 400 */", root), /npm ci/);
  fakeFontsource(root, "noto-sans-jp", ["400"]);
  assert.throws(() => expandFonts("/* @fontsource noto-sans-jp 900 */", root), /太さ 900/);
});

test("standard.css は同梱フォントを指定し、font-family の先頭がそのフォント", () => {
  const css = readFileSync("themes/standard.css", "utf8");
  assert.match(css, /\/\* @fontsource noto-sans-jp 400 700 \*\//);
  assert.match(css, /font-family: "Noto Sans JP",/);
});

test("buildThemes はテーマに @font-face と Tailwind を結合する", () => {
  const root = mkdtempSync(join(tmpdir(), "theme-"));
  fakeFontsource(root);
  cpSync("themes", join(root, "themes"), { recursive: true });
  writeFileSync(join(root, "tw.css"), ".tw{}");
  const [out] = buildThemes({
    themes: join(root, "themes"),
    out: join(root, "build/themes"),
    tailwind: join(root, "tw.css"),
    root,
  });
  const css = readFileSync(out, "utf8");
  assert.match(css, /^\/\* @theme standard \*\//);
  assert.match(css, /@font-face/);
  assert.match(css, /\.tw\{\}/);
});
