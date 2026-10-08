import assert from "node:assert/strict";
import { test } from "node:test";

import { DEFAULTS, lintSlide } from "../scripts/lint-slides.mjs";
import { altWithoutMarpKeywords } from "../scripts/lint/slide.mjs";

// 代替テキストから除くのは Marp の画像の指定（w:・h:・width:・height:・bg・fit・left:40% など）だけ

const noAlt = (md) => lintSlide({ line: 1, text: `# 図\n\n${md}\n` }, 0, DEFAULTS, "a.md").some((f) => f.rule_id === "slide.image_no_alt");

test("普通の語は Marp の指定と取り違えない（hello world・workflow・height の比較）", () => {
  for (const md of ["![hello world](a.png)", "![workflow](a.png)", "![height の比較](a.png)", "![Bandwidth](a.png)", "![fit](a.png)", "![left right](a.png)", "![coverage](a.png)"]) {
    assert.ok(!noAlt(md), md);
  }
});

test("Marp の指定だけなら代替テキストが無い", () => {
  for (const md of ["![w:200px](a.png)", "![width:50% h:auto](a.png)", "![bg fit left:40%](a.png)", "![bg contain](a.png)", "![sepia:1 blur](a.png)", "![50%](a.png)", "![](a.png)"]) {
    assert.ok(noAlt(md), md);
  }
});

test("指定と代替テキストを並べたときは残りを代替テキストとみなす", () => {
  assert.equal(altWithoutMarpKeywords("w:300 構成図"), "構成図");
  assert.equal(altWithoutMarpKeywords("bg right:30% 工程表"), "工程表");
  // bg が無いときの fit・left は Marp の指定ではない（代替テキストの一部）
  assert.equal(altWithoutMarpKeywords("fit left"), "fit left");
});

test("タイトルの字数: タグと消し残しの < > を数えない", async () => {
  const { titleText } = await import("../scripts/lint/slide.mjs");
  assert.equal(titleText("<span>短い</span>"), "短い");
  assert.equal(titleText("<scr<script>ipt>短い"), "ipt短い");
  assert.equal(titleText("a > b"), "a  b");
  assert.ok(!/[<>]/.test(titleText("<<a>>b<c")));
});
