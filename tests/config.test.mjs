import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

// 資料の中の HTML とローカルのファイルの読み込みは既定で切り、「:trusted」のスクリプトだけで有効にする
const marprc = readFileSync(".marprc.yml", "utf8");
const scripts = JSON.parse(readFileSync("package.json", "utf8")).scripts;
const TRUST = "--html --allow-local-files";

test(".marprc.yml は html と allowLocalFiles を有効にしない", () => {
  const settings = marprc.split("\n").filter((l) => !l.trim().startsWith("#"));
  assert.ok(!settings.some((l) => /^\s*html\s*:/.test(l)), "html を書かない（既定は無効）");
  assert.ok(!settings.some((l) => /^\s*allowLocalFiles\s*:/.test(l)), "allowLocalFiles を書かない（既定は無効）");
});

test("既定のスクリプトは HTML を有効にしない。:trusted だけが有効にする", () => {
  for (const name of ["html", "pdf", "pptx", "watch"]) {
    assert.ok(!scripts[name].includes("--html"), `${name} は --html を付けない`);
    assert.ok(!scripts[name].includes("--allow-local-files"), `${name} は --allow-local-files を付けない`);
    assert.ok(scripts[`${name}:trusted`].includes(TRUST), `${name}:trusted は ${TRUST} を付ける`);
  }
  // check:overflow は本番の出力と同じ扱いで測る: slides は既定（npm run pdf と同じ）、同梱のレイアウト集だけ trusted
  assert.match(scripts["check:overflow"], /--build slides(\s|$)/);
  assert.ok(!scripts["check:overflow"].includes("--build-trusted slides"));
  assert.match(scripts["check:overflow"], /--build-trusted layouts\/catalog\.md/);
  assert.match(scripts["check:overflow:trusted"], /--build-trusted slides(\s|$)/);
  // 測定用の HTML は check-overflow.mjs が一時フォルダに作って消す（build/check を残さない）
  for (const name of ["check:overflow", "check:overflow:trusted"]) assert.ok(!scripts[name].includes("build/check"), name);
  assert.equal((scripts.catalog.match(/--html --allow-local-files/g) || []).length, 2);
});
