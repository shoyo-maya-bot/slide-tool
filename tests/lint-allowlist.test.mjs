import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";

import { cssDangers, isExternalUrl } from "../scripts/lint/dangers.mjs";
import { lintSvg, main } from "../scripts/lint-slides.mjs";

// 資料の中の HTML は「使ってよい要素・属性の一覧」で検査する（:trusted で出力すると動くため）

const deckHead = "---\nmarp: true\ntheme: standard\n---\n\n";

function lintDeck(body) {
  const dir = mkdtempSync(join(tmpdir(), "allow-"));
  const p = join(dir, "slides", "a.md");
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, `${deckHead}# 図\n\n${body}\n`);
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

test("一覧に無い要素（iframe・object・embed・meta・link・base・form など）は error", () => {
  const cases = [
    '<iframe src="slides/x.html"></iframe>',
    '<object data="x.pdf"></object>',
    '<embed src="x.swf">',
    '<meta http-equiv="refresh" content="0;url=https://example.com/">',
    '<link rel="stylesheet" href="https://example.com/a.css">',
    '<base href="https://example.com/">',
    '<form action="https://example.com/"><input name="q"></form>',
    '<video src="a.mp4"></video>',
    "<IFRAME SRC=x></IFRAME>",
    "<frameset></frameset>",
    "<template><div>x</div></template>",
  ];
  for (const html of cases) {
    const r = lintDeck(html);
    assert.equal(r.code, 1, `${html}: ${JSON.stringify(r.findings)}`);
    const f = r.findings.find((x) => x.rule_id === "html.disallowed_element");
    assert.ok(f, `${html}: ${JSON.stringify(r.findings)}`);
    assert.equal(f.severity, "error");
    assert.match(f.location, /a\.md:8$/);
  }
});

test("一覧に無い属性は error（srcset・formaction・http-equiv など）", () => {
  for (const html of [
    '<img src="a.png" alt="図" srcset="https://example.com/a.png 2x">',
    '<div formaction="x">本文</div>',
    '<a href="#x" ping="https://example.com/">x</a>',
  ]) {
    const r = lintDeck(html);
    assert.equal(r.code, 1, html);
    assert.ok(
      r.findings.some((x) => x.rule_id === "html.disallowed_attribute"),
      `${html}: ${JSON.stringify(r.findings)}`,
    );
  }
});

test("外部の読み込みは error: <img src=http…>・![](https://…)・<style> の @import と url()・style 属性の url()", () => {
  const cases = [
    '<img src="https://example.com/a.png" alt="図">',
    '<img src="//example.com/a.png" alt="図">',
    '<img src="http&#58;//example.com/a.png" alt="図">',
    "![図](https://example.com/a.png)",
    "<style>@import url('https://example.com/a.css');</style>",
    '<style>@import "theme.css";</style>',
    "<style>section { background: url(https://example.com/a.png); }</style>",
    "<style>section { background: \\75 rl(https://example.com/a.png); }</style>",
    '<div style="background-image: url(&quot;https://example.com/a.png&quot;)">本文</div>',
    "<style>section { background: url(//example.com/a.png) }</style>",
  ];
  for (const html of cases) {
    const r = lintDeck(html);
    assert.equal(r.code, 1, `${html}: ${JSON.stringify(r.findings)}`);
    assert.ok(
      r.findings.some((x) => x.rule_id === "html.external_resource" && x.severity === "error"),
      `${html}: ${JSON.stringify(r.findings)}`,
    );
  }
});

test("一覧にある要素・属性と、リポジトリの中のものを読む記述は通す", () => {
  const body = [
    '<div class="grid grid-cols-2 gap-4" data-step="1" aria-label="比較">',
    "",
    '<p class="text-sm" style="color: #333; margin-top: 4px">本文</p>',
    '<img src="../assets/a.png" alt="図" width="200">',
    '<img src="data:image/png;base64,iVBORw0KGgo=" alt="点">',
    "<b>太字</b><br><small>注</small>",
    '<table><tr><th scope="col">項目</th><td colspan="2">値</td></tr></table>',
    "",
    "</div>",
    "",
    "<style>section { background: url(../assets/bg.png); } h1 { color: red }</style>",
    "",
    "![構成図](../assets/svg/architecture.svg)",
    "",
    "[外部の資料](https://example.com/a)・<https://example.com/b>",
  ].join("\n");
  const r = lintDeck(body);
  assert.equal(r.code, 0, JSON.stringify(r.findings));
  assert.deepEqual(r.findings, []);
});

test("コードの中の例は見ない（<iframe> をコードで説明する）", () => {
  const r = lintDeck('`<iframe>` は使えません\n\n```html\n<iframe src="https://example.com/"></iframe>\n<style>@import url(x.css)</style>\n```\n');
  assert.equal(r.code, 0, JSON.stringify(r.findings));
});

test("SVG: 一覧に無い要素（animate・set・iframe など）・外部の image・style の @import は error", () => {
  const dir = mkdtempSync(join(tmpdir(), "svg-allow-"));
  const head = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><title>図</title>';
  const cases = {
    "animate.svg": [`${head}<a href="#x"><animate attributeName="href" to="https://example.com"/></a></svg>`, "svg.disallowed_element"],
    "set.svg": [`${head}<set attributeName="fill" to="red"/></svg>`, "svg.disallowed_element"],
    "img-ext.svg": [`${head}<image href="//example.com/a.png" width="1" height="1"/></svg>`, "svg.external_ref"],
    "style-import.svg": [`${head}<style>@import url(https://example.com/a.css);</style></svg>`, "svg.external_ref"],
    "style-url.svg": [`${head}<rect style="fill: url(https://example.com/p.svg#a)" width="1" height="1"/></svg>`, "svg.external_ref"],
  };
  for (const [name, [body, rule]] of Object.entries(cases)) {
    const p = join(dir, name);
    writeFileSync(p, body);
    const f = lintSvg(p);
    assert.ok(
      f.some((x) => x.rule_id === rule && x.severity === "error"),
      `${name}: ${JSON.stringify(f)}`,
    );
  }
  // 同梱の図で使う要素・ページ内の参照（url(#grad)・href="#a"）は通す
  const ok = join(dir, "ok.svg");
  writeFileSync(
    ok,
    `${head}<defs><linearGradient id="g"><stop offset="0"/></linearGradient><marker id="m"><path d="M0 0"/></marker></defs>` +
      '<rect fill="url(#g)" width="1" height="1"/><use href="#m"/><text font-family="sans-serif">x</text></svg>',
  );
  assert.deepEqual(lintSvg(ok), []);
});

test("isExternalUrl・cssDangers", () => {
  for (const u of ["https://a/b", "HTTP://a", "//a/b", "ftp://a", "file:///etc/passwd", " https://a"]) assert.ok(isExternalUrl(u), u);
  for (const u of ["a.png", "../a.png", "/abs/a.png", "#id", "data:image/png;base64,AA", "", "javascript:x"]) assert.ok(!isExternalUrl(u), u);
  assert.deepEqual(cssDangers("h1 { color: red } section { background: url('a.png') }"), []);
  assert.equal(cssDangers("/* x */ @IMPORT 'a.css';").length, 1);
  assert.equal(cssDangers('a { background: url( "https://x/y.png" ) }').length, 1);
  assert.equal(cssDangers("a { width: expression(alert(1)) }").length, 1);
});
