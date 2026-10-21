import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { DEFAULTS } from "../scripts/lint/config.mjs";

// ドキュメント（README・docs・Copilot の指示）と実際の設定・スクリプトのずれを機械で見つける

const read = (p) => readFileSync(p, "utf8");
const README = read("README.md");
const pkg = JSON.parse(read("package.json"));

function mdFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? mdFiles(join(dir, e.name)) : e.name.endsWith(".md") ? [join(dir, e.name)] : [],
  );
}

test("ドキュメントに書いた npm run のスクリプトがすべて package.json にある", () => {
  const docs = ["README.md", ...mdFiles("docs"), ...mdFiles(".github")];
  const used = new Set(docs.flatMap((f) => [...read(f).matchAll(/npm run ([a-z][\w:-]*)/g)].map((m) => m[1])));
  assert.ok(used.size > 5);
  const missing = [...used].filter((s) => !(s in pkg.scripts));
  assert.deepEqual(missing, [], `package.json に無いスクリプト: ${missing.join(", ")}`);
});

test("README の Node.js の版が package.json の engines と CI の版に合う", () => {
  const engine = /^>=(\d+)$/.exec(pkg.engines.node);
  assert.ok(engine, pkg.engines.node);
  assert.match(README, new RegExp(`Node\\.js ${engine[1]} 以上`));
  const ci = read(".github/workflows/ci.yml");
  const versions = [...ci.matchAll(/node-version: (\d+)/g)].map((m) => Number(m[1]));
  assert.ok(versions.length && versions.every((v) => v >= Number(engine[1])), String(versions));
});

/** スクリプトの先頭のコメントの「終了コード: 0 … / 1 … / 2 …」のコード */
function documentedCodes(path) {
  const line = read(path)
    .split("\n")
    .find((l) => l.includes("終了コード:"));
  assert.ok(line, `${path} に終了コードの説明がありません`);
  return [...line.matchAll(/(?:: |\/ )(\d) /g)].map((m) => Number(m[1]));
}

test("README の終了コードの表が、スクリプトの説明と同じ", () => {
  const section = README.split("## 終了コード")[1].split("\n## ")[0];
  const rows = [...section.matchAll(/^\| (\d) \| ([^|]+) \| ([^|]+) \|$/gm)].map((m) => ({ code: Number(m[1]), lint: m[2].trim(), overflow: m[3].trim() }));
  const has = (col) => rows.filter((r) => r[col] !== "—").map((r) => r.code);
  assert.deepEqual(has("lint"), documentedCodes("scripts/lint-slides.mjs"));
  assert.deepEqual(has("overflow"), documentedCodes("scripts/check-overflow.mjs"));
});

test("README のレイアウトの数と既定の上限が、docs/layouts.md・設定と同じ", () => {
  const n = [...read("docs/layouts.md").matchAll(/^\| L\d\d /gm)].length;
  assert.match(README, new RegExp(`${n} 種類`));
  const conf = JSON.parse(read("config/slide-lint.json"));
  for (const k of ["maxBullets", "maxBodyChars", "maxTitleChars", "maxDepth"]) assert.equal(conf[k], DEFAULTS[k], k);
  assert.match(README, new RegExp(`箇条書き ${DEFAULTS.maxBullets} 個、本文 ${DEFAULTS.maxBodyChars} 字`));
  assert.match(README, new RegExp(`タイトル 全角 ${DEFAULTS.maxTitleChars} 字、入れ子 ${DEFAULTS.maxDepth} 段`));
});
