import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { hrLinesByShape, splitSlides } from "../scripts/lint/split.mjs";

// スライドの区切りは Marp と同じ: 一番外側の水平線. 段落の直後の --- は setext の見出しで区切りではない.
// 実際に Marp（package-lock.json で固定した @marp-team/marp-core）で描画した section の数と突き合わせる

let Marp = null;
try {
  ({ Marp } = await import("@marp-team/marp-core"));
} catch {
  Marp = null;
}
const skip = !Marp && !process.env.CI && "@marp-team/marp-core が無い（npm ci の前）";

const sections = (text) => (new Marp({ html: true }).render(text).html.match(/<section\b/g) || []).length;

const CASES = {
  "段落の直後の --- は見出し": ["---\nmarp: true\n---\n\n# a\n段落\n---\n\n# b\n", 1],
  "段落の直後の --- （本文の続き）": ["# a\n\nテキスト\n---\nつづき\n", 1],
  "空行のあとの --- は区切り": ["# a\n\n段落\n\n---\n\n# b\n", 2],
  "箇条書きの直後": ["# a\n\n- x\n---\n\n# b\n", 2],
  "引用の直後": ["# a\n\n> q\n---\n\n# b\n", 2],
  "引用の中の ---": ["# a\n\n> q\n>\n> ---\n\n# b\n", 1],
  "字下げ 4 つはコード": ["# a\n\n    ---\n\nx\n", 1],
  "空白入り・*** ・- - -": ["# a\n\n  ---\n\n# b\n\n- - -\n\n# c\n\n* * *\n", 4],
  "HTML ブロックの中の ---": ["# a\n\n<div>\n---\n</div>\n\n---\n\n# b\n", 2],
  "コードフェンスの中": ["# a\n\n```\n---\n```\n\n---\n# c\n", 2],
  "見出しの直後": ["# a\n---\n# b\n", 2],
  "setext（=）の直後": ["a\n===\n---\nb\n", 2],
  "表の直後": ["| a | b |\n|---|---|\n| 1 | 2 |\n---\nx\n", 2],
};

test("区切りの数が Marp の section の数と同じ", { skip }, () => {
  for (const [name, [text, want]] of Object.entries(CASES)) {
    assert.equal(sections(text), want, `Marp: ${name}`);
    assert.equal(splitSlides(text).slides.length, want, name);
  }
});

test("リポジトリの資料の枚数が Marp と同じ", { skip }, () => {
  for (const f of ["slides/sample-ai-dev-process.md", "layouts/catalog.md", "tests/fixtures/deck.md"]) {
    const text = readFileSync(f, "utf8");
    assert.equal(splitSlides(text).slides.length, sections(text), f);
  }
});

test("markdown-it を読めないときの近似も同じ枚数", () => {
  for (const [name, [text, want]] of Object.entries(CASES)) {
    const { front } = splitSlides(text);
    const body = text.split("\n").slice(front ? front.split("\n").length + 2 : 0);
    assert.equal(hrLinesByShape(body).length + 1, want, name);
  }
});

test("段落の直後の --- をまたいだスライドの行番号", () => {
  const { slides } = splitSlides("---\nmarp: true\n---\n\n# a\n段落\n---\n\n---\n\n# b\n");
  assert.equal(slides.length, 2);
  assert.equal(slides[0].line, 4);
  assert.match(slides[0].text, /段落\n---/);
  assert.equal(slides[1].line, 10);
});
