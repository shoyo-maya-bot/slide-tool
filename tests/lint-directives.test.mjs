import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";

import { lintTrusted } from "../scripts/check-overflow.mjs";
import { directiveEntries } from "../scripts/lint/dangers.mjs";
import { main } from "../scripts/lint-slides.mjs";

// 第 6 回の指摘: front matter と HTML コメントの Marp ディレクティブ（style の @import、backgroundImage の url() など）

function lintIn(files) {
  const dir = mkdtempSync(join(tmpdir(), "dir-"));
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
    const code = main(["slides", "--format", "json", "--config", "slide-lint.json"]);
    return { code, findings: JSON.parse(out).findings };
  } finally {
    process.chdir(cwd);
    console.log = log;
  }
}

const deck = (front, body = "") => ({ "slides/a.md": `---\nmarp: true\ntheme: standard\n${front}---\n\n# 図\n\n${body}\n`, "assets/bg.png": "x" });
const directive = (r) => r.findings.filter((f) => f.rule_id === "directive.external_ref");

test("front matter の style の @import・外部の url() は error", () => {
  for (const front of [
    'style: "@import url(https://evil.example/x.css);"\n',
    "style: |\n  @import 'https://evil.example/x.css';\n  section { color: red; }\n",
    "style: >\n  section { background: url(https://evil.example/x.png) }\n",
    "style: \"section { background: \\x75rl(https://evil.example/x.png) }\"\n",
  ]) {
    const r = lintIn(deck(front));
    assert.equal(r.code, 1, `${front}: ${JSON.stringify(r.findings)}`);
    assert.ok(directive(r).length >= 1, front);
    assert.match(directive(r)[0].location, /slides\/a\.md:4$/, "style の行を指す");
  }
});

test("front matter・HTML コメントの backgroundImage の外部・file:・フォルダの外の url() は error", () => {
  for (const [front, body] of [
    ["backgroundImage: url('https://evil.example/bg.png')\n", ""],
    ["", "<!-- backgroundImage: url('https://evil.example/bg.png') -->"],
    ["", "<!-- _backgroundImage: \"url('file:///etc/passwd')\" -->"],
    ["", "<!--\npaginate: true\n_backgroundImage: url(../../../etc/x.png)\n-->"],
    ["", "<!-- _style: \"@import 'https://evil.example/x.css'\" -->"],
    ["", "<!-- _backgroundColor: \"url(https://evil.example/x.png)\" -->"],
  ]) {
    const r = lintIn(deck(front, body));
    assert.equal(r.code, 1, `${front}${body}: ${JSON.stringify(r.findings)}`);
    assert.ok(directive(r).length >= 1, front + body);
  }
});

test("HTML コメントの header・footer の HTML は本文と同じく検査する", () => {
  const r = lintIn(deck("", "<!-- _footer: '<img src=x alt=x onerror=alert(1)>' -->"));
  assert.equal(r.code, 1, JSON.stringify(r.findings));
  assert.ok(r.findings.some((f) => f.rule_id === "html.event_handler" && /_footer/.test(f.message)));
  const img = lintIn(deck("", "<!-- header: '![ロゴ](https://evil.example/logo.png)' -->"));
  assert.equal(img.code, 1, JSON.stringify(img.findings));
});

test("リポジトリの中の背景画像・色の指定、コードフェンスの中のコメントは error にしない", () => {
  const r = lintIn(
    deck(
      "backgroundColor: '#fff'\nstyle: |\n  section { background: url(../assets/bg.png) }\n",
      "<!-- _backgroundImage: url(../assets/bg.png) -->\n<!-- _class: lead -->\n\n```\n<!-- style: \"@import url(https://x)\" -->\n```",
    ),
  );
  assert.equal(r.code, 0, JSON.stringify(r.findings));
});

test("directiveEntries は複数の指定・ブロック・引用符を読む", () => {
  const e = directiveEntries("paginate: true\nstyle: |\n  a {}\n  b {}\n_footer: 'x ''y'''\n");
  assert.deepEqual(
    e.map((x) => [x.key, x.value]),
    [
      ["paginate", "true"],
      ["style", "a {}\n  b {}"],
      ["_footer", "x 'y'"],
    ],
  );
});

test("--build-trusted の資料は lint で error があれば描画しない（終了コード 2）", async () => {
  const calls = [];
  await lintTrusted([{ path: "slides", trusted: false }], (p) => calls.push(p) && 0);
  assert.equal(calls.length, 0, "trusted でない資料だけなら lint しない");
  await lintTrusted([{ path: "a.md", trusted: true }], () => 0);
  await assert.rejects(
    lintTrusted([{ path: "slides", trusted: false }, { path: "bad.md", trusted: true }], (p) => {
      assert.deepEqual(p, ["bad.md"]);
      return 1;
    }),
    (e) => e.exitCode === 2,
  );
});
