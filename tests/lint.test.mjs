import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { DEFAULTS, lintFile, lintSvg, main, splitSlides, width } from "../scripts/lint-slides.mjs";

const conf = { ...DEFAULTS, layouts: ["title", "agenda", "section"], bannedTerms: ["example-corp"] };
const rules = (findings) => findings.map((f) => f.rule_id);

test("width は全角 1・半角 0.5", () => {
  assert.equal(width("あいう"), 3);
  assert.equal(width("abcd"), 2);
});

test("スライドの分割（front matter・コードブロック内の区切り）", () => {
  const { front, slides } = splitSlides("---\nmarp: true\n---\n\n# a\n\n---\n\n```\n---\n```\n\n---\n# c\n");
  assert.equal(front, "marp: true");
  assert.equal(slides.length, 3);
  assert.equal(slides[0].line, 4);
});

test("サンプルのデッキの指摘", () => {
  const f = lintFile("tests/fixtures/deck.md", conf);
  const r = rules(f);
  assert.ok(!r.includes("deck.not_marp"));
  assert.ok(r.includes("slide.no_title"));
  assert.ok(r.includes("slide.deep_nesting"));
  assert.ok(r.includes("slide.image_no_alt"));
  assert.ok(r.includes("slide.unknown_layout"));
  assert.ok(r.includes("slide.title_long"));
  assert.ok(r.includes("slide.too_many_bullets"));
  assert.ok(r.includes("slide.banned_term"));
  assert.equal(r.filter((x) => x === "slide.no_title").length, 1); // 表紙は見出し不要
  const noTitle = f.find((x) => x.rule_id === "slide.no_title");
  assert.match(noTitle.location, /deck\.md:\d+ \(3 枚目\)/);
});

test("本文が多すぎる", () => {
  const dir = mkdtempSync(join(tmpdir(), "lint-"));
  const p = join(dir, "long.md");
  writeFileSync(p, `---\nmarp: true\ntheme: standard\n---\n\n# 長い\n\n${"あ".repeat(300)}\n`);
  assert.deepEqual(rules(lintFile(p, conf)), ["slide.too_much_text"]);
});

test("marp: true が無い", () => {
  const dir = mkdtempSync(join(tmpdir(), "lint-"));
  const p = join(dir, "plain.md");
  writeFileSync(p, "# ただの Markdown\n");
  assert.deepEqual(rules(lintFile(p, conf)), ["deck.not_marp", "deck.no_theme"]);
});

test("SVG の検査", () => {
  const dir = mkdtempSync(join(tmpdir(), "svg-"));
  const bad = join(dir, "bad.svg");
  writeFileSync(bad, '<svg xmlns="http://www.w3.org/2000/svg"><image href="https://example.com/a.png"/><text>x</text><script>1</script></svg>');
  assert.deepEqual(rules(lintSvg(bad)).sort(), ["svg.external_ref", "svg.no_font", "svg.no_title", "svg.no_viewbox", "svg.script"]);
  const good = join(dir, "good.svg");
  writeFileSync(good, '<svg viewBox="0 0 10 10"><title>図</title><text font-family="sans-serif">x</text></svg>');
  assert.deepEqual(lintSvg(good), []);
});

test("リポジトリのスライド・レイアウト集・SVG は error が無い", () => {
  const log = console.log;
  console.log = () => {};
  try {
    assert.equal(main(["slides", "layouts", "assets"]), 0);
  } finally {
    console.log = log;
  }
});
