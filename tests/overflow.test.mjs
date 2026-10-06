import assert from "node:assert/strict";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";

import { check } from "../scripts/check-overflow.mjs";

// playwright はプロジェクトの node_modules、無ければグローバルから探す
async function loadChromium() {
  try {
    return (await import("playwright")).chromium;
  } catch {
    try {
      const require = createRequire(import.meta.url);
      const npmRoot = process.env.NPM_GLOBAL_ROOT || "/opt/node22/lib/node_modules";
      return require(`${npmRoot}/playwright`).chromium;
    } catch {
      return null;
    }
  }
}

const chromium = await loadChromium();
const exe = process.env.CHROMIUM_PATH || (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);

test("はみ出しの検出（縦・箱の中・横。フッターは対象外）", { skip: !chromium && "playwright が無い" }, async () => {
  const [r] = await check(["tests/fixtures/overflow.html"], () => chromium.launch(exe ? { executablePath: exe } : {}));
  assert.equal(r.slides, 4);
  const bySlide = Object.fromEntries(r.results.map((x) => [x.slide, x.issues.map((i) => i.kind)]));
  assert.equal(bySlide[1], undefined);
  assert.ok(bySlide[2].includes("outside") || bySlide[2].includes("too_tall"));
  assert.ok(bySlide[3].includes("clipped"));
  assert.ok(bySlide[4].includes("outside"));
  assert.ok(!r.results.find((x) => x.slide === 4).issues.some((i) => i.element === "footer"));
});

test("同梱フォントの読み込みを確かめる（読めないフォントは loaded 0）", { skip: !chromium && "playwright が無い" }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "font-"));
  const sys = ["/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", "C:\\Windows\\Fonts\\arial.ttf"].find(existsSync);
  const page = (src) =>
    `<style>@font-face{font-family:"T";src:url("${src}")}section{font-family:"T"}</style><section><h1>abc</h1></section>`;
  writeFileSync(join(dir, "missing.html"), page(pathToFileURL(join(dir, "none.woff2")).href));
  const files = [join(dir, "missing.html")];
  if (sys) {
    writeFileSync(join(dir, "ok.html"), page(pathToFileURL(sys).href));
    files.push(join(dir, "ok.html"));
  }
  const r = await check(files, () => chromium.launch(exe ? { executablePath: exe } : {}));
  assert.deepEqual(r[0].fonts, { declared: 1, loaded: 0 });
  if (sys) assert.deepEqual(r[1].fonts, { declared: 1, loaded: 1 });
});
