import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

// 資料の中の HTML とローカルのファイルの読み込みは既定で切り、「:trusted」のスクリプトだけで有効にする
const marprc = readFileSync(".marprc.yml", "utf8");
const scripts = JSON.parse(readFileSync("package.json", "utf8")).scripts;
const TRUST = "--html --allow-local-files";
const watchTrusted = readFileSync("scripts/watch-trusted.mjs", "utf8");

test(".marprc.yml は html と allowLocalFiles を有効にしない", () => {
  const settings = marprc.split("\n").filter((l) => !l.trim().startsWith("#"));
  assert.ok(!settings.some((l) => /^\s*html\s*:/.test(l)), "html を書かない（既定は無効）");
  assert.ok(!settings.some((l) => /^\s*allowLocalFiles\s*:/.test(l)), "allowLocalFiles を書かない（既定は無効）");
});

test("既定のスクリプトは HTML を有効にしない。:trusted だけが有効にする", () => {
  for (const name of ["html", "pdf", "pptx", "watch"]) {
    assert.ok(!scripts[name].includes("--html"), `${name} は --html を付けない`);
    assert.ok(!scripts[name].includes("--allow-local-files"), `${name} は --allow-local-files を付けない`);
    // watch:trusted は scripts/watch-trusted.mjs が（lint を通した資料だけに）--html --allow-local-files を付ける
    const trusted = name === "watch" ? watchTrusted : scripts[`${name}:trusted`];
    assert.ok(trusted.includes(TRUST.split(" ")[0]) && trusted.includes(TRUST.split(" ")[1]), `${name}:trusted は ${TRUST} を付ける`);
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

test(":trusted の出力は先に lint を通す（HTML・SVG の検査で止まる）", () => {
  for (const name of ["html:trusted", "pdf:trusted", "pptx:trusted", "catalog"]) {
    assert.match(scripts[name], /^npm run lint && /, `${name} は npm run lint から始める`);
  }
  // watch:trusted は保存のたびに lint を流す（tests/watch-trusted.test.mjs）
  assert.match(scripts["watch:trusted"], /node scripts\/watch-trusted\.mjs$/);
  for (const [name, cmd] of Object.entries(scripts)) {
    if (cmd.includes("--html") && !name.startsWith("check")) assert.match(cmd, /^npm run lint && /, name);
  }
});
