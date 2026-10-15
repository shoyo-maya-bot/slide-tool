import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { DEFAULTS, lintFile } from "../scripts/lint-slides.mjs";
import { classDirectives, slideClasses } from "../scripts/lint/slide.mjs";

// レイアウトのクラスの読み方を Marp にそろえる（front matter の class・<!-- class: --> の引き継ぎ・<!-- _class: --> はその 1 枚）

const conf = { ...DEFAULTS, layouts: ["title", "section", "big-number", "agenda"] };

function lintDeck(text) {
  const p = join(mkdtempSync(join(tmpdir(), "class-")), "a.md");
  writeFileSync(p, text);
  return lintFile(p, conf);
}
const noTitle = (f) => f.filter((x) => x.rule_id === "slide.no_title");

test("front matter の class: section は全スライドに効き、見出しが無くても slide.no_title にしない", () => {
  const f = lintDeck("---\nmarp: true\ntheme: standard\nclass: section\n---\n\n第 1 章\n\n---\n\n第 2 章\n");
  assert.deepEqual(noTitle(f), [], JSON.stringify(f));
  const quoted = lintDeck("---\nmarp: true\ntheme: standard\nclass: \"section\"\n---\n\n第 1 章\n");
  assert.deepEqual(noTitle(quoted), []);
});

test("<!-- class: section --> は後ろのスライドに引き継ぐ", () => {
  const f = lintDeck("---\nmarp: true\ntheme: standard\n---\n\n<!-- class: section -->\n\n第 1 章\n\n---\n\n第 2 章\n\n---\n\n<!-- class: agenda -->\n\n本文だけ\n");
  const nt = noTitle(f);
  assert.equal(nt.length, 1, JSON.stringify(f));
  assert.match(nt[0].location, /\(3 枚目\)/);
});

test("<!-- _class: x --> はその 1 枚だけで、引き継いだ class を上書きする", () => {
  const f = lintDeck("---\nmarp: true\ntheme: standard\nclass: agenda\n---\n\n<!-- _class: section -->\n\n第 1 章\n\n---\n\n本文だけ\n");
  const nt = noTitle(f);
  assert.equal(nt.length, 1, JSON.stringify(f));
  assert.match(nt[0].location, /\(2 枚目\)/);
});

test("classDirectives・slideClasses: 複数の指定を書いたコメントと、コードフェンスの中", () => {
  assert.deepEqual(classDirectives("<!--\npaginate: true\nclass: section\n-->"), { local: "section", spot: null });
  assert.deepEqual(classDirectives("```\n<!-- class: section -->\n```"), { local: null, spot: null });
  assert.deepEqual(classDirectives("<!-- _class: title -->"), { local: null, spot: "title" });
  const slides = ["a", "<!-- class: section -->", "b", "<!-- _class: title -->", "c"].map((text) => ({ text }));
  assert.deepEqual(slideClasses("class: lead", slides), ["lead", "section", "section", "title", "section"]);
});

test("定義に無いクラスの警告も、引き継いだ class で出す", () => {
  const f = lintDeck("---\nmarp: true\ntheme: standard\nclass: nosuch\n---\n\n# a\n\n---\n\n# b\n");
  assert.equal(f.filter((x) => x.rule_id === "slide.unknown_layout").length, 2);
});
