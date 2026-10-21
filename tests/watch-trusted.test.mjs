import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { main as lint } from "../scripts/lint-slides.mjs";
import { PREVIEW_DIR, debounce, digest, syncPreview } from "../scripts/watch-trusted.mjs";

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

  assert.equal(
    quiet(() => syncPreview({ src, dest, runLint })),
    0,
  );
  assert.equal(readFileSync(join(dest, "a.md"), "utf8"), good);
  assert.ok(existsSync(join(dest, "sub", "b.md")));

  writeFileSync(join(src, "a.md"), `${good}\n<script>alert(1)</script>\n`);
  assert.equal(
    quiet(() => syncPreview({ src, dest, runLint })),
    1,
  );
  assert.ok(existsSync(dest), "フォルダは残す（サーバーが見ている）");
  assert.deepEqual(readdirSync(dest), [], "error の間は何も出さない（前の版も残さない）");

  writeFileSync(join(src, "a.md"), good);
  assert.equal(
    quiet(() => syncPreview({ src, dest, runLint })),
    0,
  );
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

// --- 第 7 回: lint とコピーの間の保存（競合） ---

function deck() {
  const dir = mkdtempSync(join(tmpdir(), "watch7-"));
  const src = join(dir, "slides");
  mkdirSync(src, { recursive: true });
  writeFileSync(join(dir, "conf.json"), "{}");
  return { dir, src, dest: join(dir, "preview"), conf: join(dir, "conf.json") };
}
const GOOD = "---\nmarp: true\ntheme: standard\n---\n\n# よい資料\n";
const BAD = `${GOOD}\n<script>alert(1)</script>\n`;

test("syncPreview: lint の後・コピーの前に保存された error のある資料をプレビューに出さない", () => {
  const { src, dest, conf } = deck();
  writeFileSync(join(src, "a.md"), GOOD);
  let calls = 0;
  const runLint = () => {
    const code = lint([src, "--config", conf]);
    // 1 回目の lint が通った直後（コピーの前）に、error のある中身で保存される
    if (++calls === 1) writeFileSync(join(src, "a.md"), BAD);
    return code;
  };
  const code = quiet(() => syncPreview({ src, dest, runLint, watched: [src] }));
  assert.equal(calls, 2, "中身が変わったので lint をやり直す");
  assert.equal(code, 1);
  assert.deepEqual(readdirSync(dest), [], "lint していない（error のある）中身を出さない");
  assert.ok(!existsSync(`${dest}.staging`), "一時フォルダは消す");
});

test("syncPreview: 写すのは lint した時点の中身（lint の後の保存は次の同期で扱う）", () => {
  const { src, dest, conf } = deck();
  writeFileSync(join(src, "a.md"), GOOD);
  const code = quiet(() => syncPreview({ src, dest, runLint: () => lint([src, "--config", conf]), watched: [src] }));
  assert.equal(code, 0);
  assert.equal(readFileSync(join(dest, "a.md"), "utf8"), GOOD);
  assert.ok(!existsSync(`${dest}.staging`));
});

test("syncPreview: 保存が続いて落ち着かなければ何も出さずに 1", () => {
  const { src, dest, conf } = deck();
  writeFileSync(join(src, "a.md"), GOOD);
  let n = 0;
  const runLint = () => {
    writeFileSync(join(src, "a.md"), `${GOOD}\n本文 ${++n}\n`);
    return lint([src, "--config", conf]);
  };
  assert.equal(
    quiet(() => syncPreview({ src, dest, runLint, watched: [src], retries: 2 })),
    1,
  );
  assert.equal(n, 2);
  assert.deepEqual(readdirSync(dest), []);
});

test("digest: 中身が変われば変わり、無いフォルダは空として扱う", () => {
  const { src } = deck();
  writeFileSync(join(src, "a.md"), GOOD);
  const a = digest([src, join(src, "none")]);
  assert.equal(digest([src]), a);
  writeFileSync(join(src, "a.md"), BAD);
  assert.notEqual(digest([src]), a);
});

test("digest: copy を渡すと、指紋を取ったのと同じ中身を写す（サブフォルダも. 無い from は空）", () => {
  const { dir, src } = deck();
  mkdirSync(join(src, "sub"), { recursive: true });
  writeFileSync(join(src, "a.md"), GOOD);
  writeFileSync(join(src, "sub", "b.md"), BAD);
  const to = join(dir, "staging");
  const h = digest([src], { copy: { from: src, to } });
  assert.equal(h, digest([src]));
  assert.equal(readFileSync(join(to, "a.md"), "utf8"), GOOD);
  assert.equal(readFileSync(join(to, "sub", "b.md"), "utf8"), BAD);
  const none = join(dir, "none");
  assert.equal(digest([none], { copy: { from: none, to: join(dir, "x") } }), digest([]));
  assert.ok(!existsSync(join(dir, "x")));
});
