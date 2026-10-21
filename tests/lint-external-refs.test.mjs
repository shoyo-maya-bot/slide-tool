import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";

import { cssDangers, isOutsidePath, markdownImages } from "../scripts/lint/dangers.mjs";
import { main } from "../scripts/lint-slides.mjs";

// 外部の URL・資料のフォルダの外のローカルのファイルを読む記述（:trusted の --allow-local-files で読めてしまう）

const deckHead = "---\nmarp: true\ntheme: standard\n---\n\n";

/** 作業フォルダを一時フォルダにして lint を流す. files は { 相対パス: 中身 } */
function lintIn(files, targets = ["slides"]) {
  const dir = mkdtempSync(join(tmpdir(), "refs-"));
  for (const [p, body] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, p)), { recursive: true });
    writeFileSync(join(dir, p), body);
  }
  writeFileSync(join(dir, "slide-lint.json"), "{}");
  const cwd = process.cwd();
  const log = console.log;
  let out = "";
  console.log = (s) => (out += s);
  try {
    process.chdir(dir);
    const code = main([...targets, "--format", "json", "--config", "slide-lint.json"]);
    return { code, findings: JSON.parse(out).findings };
  } finally {
    process.chdir(cwd);
    console.log = log;
  }
}

const deck = (body) => ({ "slides/a.md": `${deckHead}# 図\n\n${body}\n`, "assets/logo.png": "x" });
const external = (r) => r.findings.filter((f) => f.rule_id === "html.external_resource" || f.rule_id === "svg.external_ref");

test("参照形式の画像（![図][logo] + [logo]: https://…）は外部の読み込みとして error", () => {
  for (const body of [
    "![図][logo]\n\n[logo]: https://example.com/logo.png",
    "![図][]\n\n[図]: https://example.com/logo.png",
    "![logo]\n\n[logo]: <//example.com/logo.png>",
    '![図][LOGO]\n\n[logo]:\n  https://example.com/logo.png "題"',
  ]) {
    const r = lintIn(deck(body));
    assert.equal(r.code, 1, body);
    assert.equal(external(r).length, 1, `${body}: ${JSON.stringify(r.findings)}`);
    assert.match(external(r)[0].location, /slides[\\/]a\.md:\d+$/);
  }
});

test("リンク（参照形式を含む）と、リポジトリの中の画像は通る", () => {
  for (const body of [
    "[資料][doc]\n\n[doc]: https://example.com/",
    "![図][logo]\n\n[logo]: ../assets/logo.png",
    "![図](../assets/logo.png)",
    "`![図][x]`\n\n    [x]: https://example.com/a.png",
  ]) {
    const r = lintIn(deck(body));
    assert.equal(r.code, 0, `${body}: ${JSON.stringify(r.findings)}`);
  }
});

test("markdownImages は Marp と同じ markdown-it の image トークンの src を返す", () => {
  const imgs = markdownImages("# a\n\n![x][r] と ![y](b.png)\n\n[r]: https://example.com/r.png\n");
  assert.deepEqual(
    imgs.map((i) => i.src),
    ["https://example.com/r.png", "b.png"],
  );
  assert.equal(imgs[0].index, 5); // 画像のある行の先頭
});

test("CSS の image-set()・-webkit-image-set() の外部の URL は error", () => {
  assert.equal(cssDangers('section { background-image: image-set("https://example.com/a.png" 1x) }').length, 1);
  assert.equal(cssDangers("a { background: -webkit-image-set('//example.com/a.png' 1x, url(b.png) 2x) }").length, 1);
  assert.equal(cssDangers('a { background: image-set(url("https://example.com/a.png") 1x) }').length, 1);
  assert.deepEqual(cssDangers('a { background: image-set("a.png" 1x, "data:image/png;base64,AA" 2x) }'), []);
  for (const body of [
    '<style>section { background-image: image-set("https://example.com/a.png" 1x); }</style>',
    '<div style="background-image: image-set(&quot;https://example.com/a.png&quot; 1x)">x</div>',
  ]) {
    const r = lintIn(deck(body));
    assert.equal(r.code, 1, body);
    assert.equal(external(r).length, 1, body);
  }
});

test("isOutsidePath: 絶対パスと、起点から root の外に出る相対パス", () => {
  const ctx = { baseDir: "/r/slides", root: "/r" };
  for (const v of ["/etc/passwd", "\\etc\\passwd", "../../etc/passwd", "../../../x.png", "%2e%2e/%2e%2e/x.png", "..\\..\\x.png", "&#46;&#46;/../x.png"])
    assert.ok(isOutsidePath(v, ctx), v);
  for (const v of ["../assets/a.png", "a.png", "./b/c.png", "#id", "https://example.com/a.png", "//a/b", "data:image/png;base64,AA", "", "a.png?x=../../.."]) {
    assert.ok(!isOutsidePath(v, ctx), v);
  }
  assert.ok(isOutsidePath("/etc/passwd"), "ctx が無くても絶対パスは外");
  assert.ok(!isOutsidePath("../../x.png"), "ctx が無いときは相対パスを判定しない");
});

test("資料のフォルダの外を指すローカルのパス（画像・img・CSS・SVG）は error", () => {
  for (const body of [
    "![図](/etc/passwd)",
    "![図](../../outside.png)",
    "![図][p]\n\n[p]: ../../../etc/hosts",
    '<img src="/etc/passwd" alt="x">',
    '<img src="../../x.png" alt="x">',
    "<style>section { background: url(../../x.png) }</style>",
    '<div style="background: url(/etc/x.png)">x</div>',
    '<svg viewBox="0 0 1 1"><image href="/etc/x.png"/></svg>',
    '<svg viewBox="0 0 1 1"><image href="../../x.png"/></svg>',
  ]) {
    const r = lintIn(deck(body));
    assert.equal(r.code, 1, `${body}: ${JSON.stringify(r.findings)}`);
    assert.ok(external(r).length >= 1, body);
    assert.ok(
      external(r).some((f) => /フォルダの外/.test(f.message)),
      body,
    );
  }
});

test("SVG ファイルの中の、フォルダの外を指す参照は error", () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><title>t</title><image href="../../../etc/x.png"/></svg>';
  const r = lintIn({ "assets/svg/a.svg": svg }, ["assets"]);
  assert.equal(r.code, 1, JSON.stringify(r.findings));
  assert.ok(external(r).some((f) => /フォルダの外/.test(f.message)));
  const ok = lintIn({ "assets/svg/a.svg": svg.replace("../../../etc/x.png", "../logo.png") }, ["assets"]);
  assert.equal(ok.code, 0, JSON.stringify(ok.findings));
});

// --- 第 7 回: 閉じ括弧の無い url( ---

test("閉じ括弧・閉じ引用符の無い url( も外部の読み込みとして見る（Chromium は入力の終わりで閉じたものとして読む）", () => {
  for (const css of [
    "background:url(https://evil.example/x.png",
    'background:url("https://evil.example/x.png',
    "background:url('//evil.example/x.png",
    "background:url( https://evil.example/x.png ",
    "background:url(/etc/passwd",
  ]) {
    assert.ok(cssDangers(css).length, css);
  }
  for (const css of ["background:url(img/a.png", "background:url(data:image/png;base64,AAAA", "color:red"]) {
    assert.deepEqual(cssDangers(css), [], css);
  }
  const r = lintIn(deck('<div style="background:url(https://evil.example/x.png">x</div>'));
  assert.ok(external(r).length, JSON.stringify(r.findings));
  const d = lintIn({
    "slides/a.md": `${deckHead}<!-- _backgroundImage: url(https://evil.example/x.png -->\n\n# 図\n`,
  });
  assert.ok(
    d.findings.some((f) => f.rule_id === "directive.external_ref"),
    JSON.stringify(d.findings),
  );
});
