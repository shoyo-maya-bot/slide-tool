import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { main as lint } from "../scripts/lint-slides.mjs";
import { PREVIEW_DIR, debounce, syncPreview } from "../scripts/watch-trusted.mjs";

// npm run watch:trusted は保存のたびに lint し、error のある資料を HTML 有効のプレビューに出さない

const quiet = (fn) => {
  const [log, err] = [console.log, console.error];
  console.log = console.error = () => {};
  try {
    return fn();
  } finally {
    [console.log, console.error] = [log, err];
  }
};

test("watch:trusted は Marp のサーバーに slides/ を直接渡さず、lint を通したものだけを配るスクリプトを使う", () => {
  const scripts = JSON.parse(readFileSync("package.json", "utf8")).scripts;
  assert.match(scripts["watch:trusted"], /node scripts\/watch-trusted\.mjs/);
  assert.doesNotMatch(scripts["watch:trusted"], /--input-dir slides/);
  assert.match(readFileSync(".gitignore", "utf8"), new RegExp(`^${PREVIEW_DIR.replace(".", "\\.")}/$`, "m"));
});

test("syncPreview: lint を通れば写し、error になったらプレビューを空にし、直せばまた写す", () => {
  const dir = mkdtempSync(join(tmpdir(), "watch-"));
  const src = join(dir, "slides");
  const dest = join(dir, "preview");
  mkdirSync(join(src, "sub"), { recursive: true });
  writeFileSync(join(dir, "conf.json"), "{}");
  const runLint = () => lint([src, "--config", join(dir, "conf.json")]);
  const good = "---\nmarp: true\ntheme: standard\n---\n\n# よい資料\n";
  writeFileSync(join(src, "a.md"), good);
  writeFileSync(join(src, "sub", "b.md"), good);

  assert.equal(quiet(() => syncPreview({ src, dest, runLint })), 0);
  assert.equal(readFileSync(join(dest, "a.md"), "utf8"), good);
  assert.ok(existsSync(join(dest, "sub", "b.md")));

  writeFileSync(join(src, "a.md"), `${good}\n<script>alert(1)</script>\n`);
  assert.equal(quiet(() => syncPreview({ src, dest, runLint })), 1);
  assert.ok(existsSync(dest), "フォルダは残す（サーバーが見ている）");
  assert.deepEqual(readdirSync(dest), [], "error の間は何も出さない（前の版も残さない）");

  writeFileSync(join(src, "a.md"), good);
  assert.equal(quiet(() => syncPreview({ src, dest, runLint })), 0);
  assert.equal(readFileSync(join(dest, "a.md"), "utf8"), good);
});

test("debounce: 続けて来た変更を 1 回にまとめる", async () => {
  let n = 0;
  const f = debounce(() => n++, 20);
  f();
  f();
  f();
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(n, 1);
});
