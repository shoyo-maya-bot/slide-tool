import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";

import { DEFAULTS, globToRegExp, lintFile, lintSvg, main, normalize, parser, splitSlides, structure, width } from "../scripts/lint-slides.mjs";

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

// --- 採点の指摘の再現 ---

/** 一時フォルダにファイルを作り、そこを作業フォルダにして main を実行する. → { code, findings } */
function runIn(files, args, config) {
  const dir = mkdtempSync(join(tmpdir(), "lint-run-"));
  for (const [p, body] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, p)), { recursive: true });
    writeFileSync(join(dir, p), body);
  }
  if (config) writeFileSync(join(dir, "slide-lint.json"), JSON.stringify(config));
  const cwd = process.cwd();
  const log = console.log;
  const err = console.error;
  let out = "";
  let stderr = "";
  console.log = (s) => (out += s);
  console.error = (s) => (stderr += `${s}\n`);
  try {
    process.chdir(dir);
    const code = main([...args, "--format", "json", "--config", "slide-lint.json"]);
    return { code, findings: out ? JSON.parse(out).findings : [], stderr };
  } finally {
    process.chdir(cwd);
    console.log = log;
    console.error = err;
  }
}

const deckHead = "---\nmarp: true\ntheme: standard\n---\n\n";

test("禁止語: front matter の header・footer も検査する", () => {
  const r = runIn({ "slides/a.md": "---\nmarp: true\ntheme: standard\nfooter: ABC社 社外秘\n---\n\n# タイトル\n" }, ["slides"], { bannedTerms: ["ABC社"] });
  assert.equal(r.code, 1);
  assert.deepEqual(
    r.findings.filter((f) => f.rule_id === "slide.banned_term").map((f) => f.location),
    [`${join("slides", "a.md")}:4`],
  );
});

test("禁止語: 全角の表記ゆれ（ＡＢＣ社）も NFKC でそろえて検査する", () => {
  const r = runIn({ "slides/a.md": `${deckHead}# タイトル\n\nＡＢＣ社との打ち合わせ\n` }, ["slides"], { bannedTerms: ["abc社"] });
  assert.equal(r.code, 1);
  assert.ok(r.findings.some((f) => f.rule_id === "slide.banned_term"));
});

test("禁止語: インラインの SVG・SVG ファイル・ファイル名も検査する", () => {
  const svg = '<svg viewBox="0 0 10 10"><title>図</title><text font-family="sans-serif">ABC社</text></svg>';
  const r = runIn(
    {
      "slides/a.md": `${deckHead}# タイトル\n\n<svg viewBox="0 0 1 1"><text>ＡＢＣ社</text></svg>\n`,
      "assets/fig.svg": svg,
      "assets/ABC社-logo.png": "x",
    },
    ["slides", "assets"],
    { bannedTerms: ["ABC社"] },
  );
  const ids = rules(r.findings).sort();
  assert.deepEqual(ids, ["file.banned_term", "slide.banned_term", "svg.banned_term"]);
});

test("除外: パスのどこかに docs を含むだけでは除外しない。既定はリポジトリ直下の README.md と docs/ だけ", () => {
  const bad = "# marp: true が無い\n";
  const r = runIn({ "slides/docs-x/b.md": bad, "docs/a.md": bad, "README.md": bad, "slides/README.md": bad }, ["."], {});
  const files = [...new Set(r.findings.filter((f) => f.rule_id === "deck.not_marp").map((f) => f.location.split(":")[0].split("\\").join("/")))];
  assert.deepEqual(files.sort(), ["slides/README.md", "slides/docs-x/b.md"]);
});

test("除外: 設定の exclude で指定できる", () => {
  const r = runIn({ "slides/draft/x.md": "# x\n", "slides/ok.md": `${deckHead}# ok\n` }, ["slides"], { exclude: ["slides/draft/**"] });
  assert.equal(r.code, 0);
  assert.deepEqual(r.findings, []);
});

test("箇条書き・見出し: コードブロックの中は数えない", () => {
  const code = Array.from({ length: 8 }, (_, i) => `- a${i}`).join("\n");
  const r = runIn({ "slides/a.md": `${deckHead}# 手順\n\n\`\`\`bash\n${code}\n# コメント\n\`\`\`\n\n~~~\n# 見出しではない\n~~~\n` }, ["slides"], {});
  assert.equal(r.code, 0, JSON.stringify(r.findings));
  const noTitle = runIn({ "slides/a.md": `${deckHead}\`\`\`bash\n# コメント\n\`\`\`\n` }, ["slides"], {});
  assert.deepEqual(rules(noTitle.findings), ["slide.no_title"]); // コードの中の # は見出しではない
});

test("箇条書き: コードブロックの外は今までどおり数える（7 個で error）", () => {
  const items = Array.from({ length: 7 }, (_, i) => `- a${i}`).join("\n");
  const r = runIn({ "slides/a.md": `${deckHead}# 多い\n\n${items}\n` }, ["slides"], {});
  assert.equal(r.code, 1);
  assert.deepEqual(rules(r.findings), ["slide.too_many_bullets"]);
});

test("structure: 見出し・一番外側の箇条書き・入れ子", () => {
  assert.deepEqual(structure("# T\n\n- a\n  - b\n    - c\n- d\n\n1. x\n"), { title: "T", top: 3, depth: 3 });
  assert.deepEqual(structure("本文だけ\n"), { title: null, top: 0, depth: 0 });
});

test("設定の誤り・無いフォルダ", () => {
  const r = runIn({ "slides/a.md": `${deckHead}# a\n` }, ["slides", "nothing"], {});
  assert.equal(r.code, 0);
  assert.match(r.stderr, /nothing がありません/);
  assert.equal(runIn({ "slides/a.md": "x" }, ["slides"], { bannedTerms: "ABC" }).code, 2);
  assert.equal(runIn({ "slides/a.md": "x" }, ["slides"], { exclude: [1] }).code, 2);
});

test("normalize と globToRegExp", () => {
  assert.equal(normalize("ＡＢＣ社ｶﾅ"), "abc社カナ");
  assert.ok(globToRegExp("docs/**").test("docs/a/b.md"));
  assert.ok(!globToRegExp("docs/**").test("slides/docs-x/b.md"));
  assert.ok(globToRegExp("README.md").test("README.md"));
  assert.ok(!globToRegExp("README.md").test("slides/README.md"));
  assert.ok(globToRegExp("slides/*.md").test("slides/a.md") && !globToRegExp("slides/*.md").test("slides/x/a.md"));
});

test("markdown-it で数えている（CI では必須）", { skip: !process.env.CI && parser !== "markdown-it" && "markdown-it が無い（npm ci の前）" }, () => {
  assert.equal(parser, "markdown-it");
});

// --- 第 2 回の指摘の再現 ---

test("BOM 付きのファイルでも front matter を認識する", () => {
  const r = runIn({ "slides/bom.md": `﻿${deckHead}# タイトル\n\n本文\n` }, ["slides"], {});
  assert.equal(r.code, 0, JSON.stringify(r.findings));
  assert.deepEqual(r.findings, []);
  // splitSlides も BOM を除く（front matter を本文の 1 枚目と取り違えない）
  const { front, slides } = splitSlides(`﻿---\nmarp: true\n---\n\n# a\n`);
  assert.equal(front, "marp: true");
  assert.equal(slides.length, 1);
});

test("BOM 付きの CRLF のファイル・BOM 付きの設定ファイル", () => {
  const dir = mkdtempSync(join(tmpdir(), "bom-"));
  const p = join(dir, "crlf.md");
  writeFileSync(p, "﻿---\r\nmarp: true\r\ntheme: standard\r\n---\r\n\r\n# タイトル\r\n");
  assert.deepEqual(lintFile(p, conf), []);
  const r = runIn({ "slides/a.md": `${deckHead}# ABC社\n` }, ["slides"], null);
  assert.equal(r.code, 0);
  const withBomConf = (() => {
    const d = mkdtempSync(join(tmpdir(), "bomconf-"));
    mkdirSync(join(d, "slides"));
    writeFileSync(join(d, "slides", "a.md"), `${deckHead}# ABC社\n`);
    writeFileSync(join(d, "slide-lint.json"), `﻿${JSON.stringify({ bannedTerms: ["ABC社"] })}`);
    const cwd = process.cwd();
    const log = console.log;
    console.log = () => {};
    try {
      process.chdir(d);
      return main(["slides", "--config", "slide-lint.json"]);
    } finally {
      process.chdir(cwd);
      console.log = log;
    }
  })();
  assert.equal(withBomConf, 1); // 設定を読めて、禁止語を見つける（BOM で設定の誤り 2 にならない）
});

test("SVG の危険な記述: on* 属性・foreignObject・javascript: の href", () => {
  const dir = mkdtempSync(join(tmpdir(), "svg-danger-"));
  const head = '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 10 10"><title>図</title>';
  const cases = {
    "onload.svg": [`${head.replace("<svg ", '<svg onload="alert(1)" ')}</svg>`, "svg.event_handler"],
    "onclick.svg": [`${head}<rect ONCLICK = "x()" width="1" height="1"/></svg>`, "svg.event_handler"],
    "fo.svg": [`${head}<foreignObject width="1" height="1"><div>x</div></foreignObject></svg>`, "svg.foreign_object"],
    "js.svg": [`${head}<a href="javascript:alert(1)"><rect width="1" height="1"/></a></svg>`, "svg.javascript_url"],
    "xlink-js.svg": [`${head}<a xlink:href=" JavaScript:alert(1)"><rect width="1" height="1"/></a></svg>`, "svg.javascript_url"],
    "entity-js.svg": [`${head}<a href="&#106;ava&#x73;cript&colon;alert(1)"><rect width="1" height="1"/></a></svg>`, "svg.javascript_url"],
    "split-js.svg": [`${head}<a href="java\tscript:alert(1)"><rect width="1" height="1"/></a></svg>`, "svg.javascript_url"],
  };
  for (const [name, [body, rule]] of Object.entries(cases)) {
    const p = join(dir, name);
    writeFileSync(p, body);
    const f = lintSvg(p);
    assert.ok(rules(f).includes(rule), `${name}: ${JSON.stringify(f)}`);
    assert.equal(f.find((x) => x.rule_id === rule).severity, "error");
  }
  // 誤検出しない: 普通の属性名（font-family・opacity など）、ページ内のリンク、"one" などの文字
  const ok = join(dir, "ok.svg");
  writeFileSync(ok, `${head}<a href="#sec2"><text font-family="sans-serif" opacity="1">online onload</text></a></svg>`);
  assert.deepEqual(lintSvg(ok), []);
});

test("資料の中に直接書いた SVG の危険な記述も検出する", () => {
  const r = runIn({ "slides/a.md": `${deckHead}# 図\n\n<svg viewBox="0 0 1 1" onload="alert(1)"><foreignObject><div>x</div></foreignObject></svg>\n` }, ["slides"], {});
  assert.equal(r.code, 1);
  const ids = rules(r.findings).sort();
  assert.deepEqual(ids, ["svg.event_handler", "svg.foreign_object"]);
  assert.match(r.findings[0].location, /a\.md:8$/);
});
