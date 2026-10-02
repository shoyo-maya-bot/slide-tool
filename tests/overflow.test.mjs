import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";

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
