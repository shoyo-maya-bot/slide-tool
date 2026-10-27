import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { main, walk } from "../scripts/lint/cli.mjs";

// lint のコマンドラインが README の終了コードどおりに動く（以前は --config の打ち間違い・対象のフォルダ無し・
// 不明なオプションで黙って終了コード 0）. フォルダのシンボリックリンクの循環で止まらなかった

const deck = "---\nmarp: true\ntheme: standard\n---\n\n# よい資料\n";

function run(args, files = { "slides/a.md": deck }) {
  const dir = mkdtempSync(join(tmpdir(), "lint-args-"));
  for (const [p, body] of Object.entries(files)) {
    mkdirSync(join(dir, p, ".."), { recursive: true });
    writeFileSync(join(dir, p), body);
  }
  const cwd = process.cwd();
  const [log, err] = [console.log, console.error];
  let stderr = "";
  console.log = () => {};
  console.error = (s) => (stderr += `${s}\n`);
  try {
    process.chdir(dir);
    return { code: main(args), stderr };
  } finally {
    process.chdir(cwd);
    [console.log, console.error] = [log, err];
  }
}

test("--config に指定したファイルが無いと終了コード 2（既定の config/slide-lint.json が無いのは既定値で 0）", () => {
  const r = run(["slides", "--config", "nai.json"]);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /nai\.json/);
  assert.equal(run(["slides"]).code, 0);
});

test("不明なオプション・値の無いオプション・未知の --format は終了コード 2", () => {
  for (const args of [
    ["slides", "--fromat", "json"],
    ["slides", "--config"],
    ["slides", "--format"],
    ["slides", "--format", "yaml"],
    ["slides", "-x"],
  ]) {
    assert.equal(run(args).code, 2, args.join(" "));
  }
});

test("対象がどれも無いと終了コード 2、一部だけ無いなら警告して残りを検査する", () => {
  assert.equal(run(["slide"]).code, 2);
  const r = run(["slides", "assets"]);
  assert.equal(r.code, 0);
  assert.match(r.stderr, /assets がありません/);
});

test("フォルダのシンボリックリンクの循環で止まり、同じファイルを 1 回だけ数える", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "lint-link-"));
  mkdirSync(join(dir, "slides", "sub"), { recursive: true });
  writeFileSync(join(dir, "slides", "sub", "a.md"), deck);
  try {
    symlinkSync(join(dir, "slides"), join(dir, "slides", "sub", "loop"), "dir");
  } catch (e) {
    t.skip(`シンボリックリンクを作れない環境（${e.code}）`);
    return;
  }
  const err = console.error;
  console.error = () => {};
  try {
    const files = walk(join(dir, "slides"));
    assert.deepEqual(files, [join(dir, "slides", "sub", "a.md")]);
  } finally {
    console.error = err;
  }
});

test("setup の完了メッセージのスクリプトが README の「すぐ使う」と同じ（:trusted）", () => {
  const quick = readFileSync("README.md", "utf8").split("## すぐ使う")[1].split("\n### ")[0];
  const readmeScripts = new Set([...quick.matchAll(/npm run ([a-z][\w:-]*)/g)].map((m) => m[1]));
  const setups = [readFileSync("setup.sh", "utf8"), new TextDecoder("shift_jis").decode(readFileSync("setup.cmd"))];
  for (const text of setups) {
    const line = text.split(/\r?\n/).find((l) => l.includes("完了:"));
    const used = [...line.matchAll(/npm run ([a-z][\w:-]*)/g)].map((m) => m[1]);
    assert.ok(used.length, line);
    for (const s of used) assert.ok(readmeScripts.has(s), `setup の案内 npm run ${s} が README の「すぐ使う」にありません`);
  }
});
