import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";

import { check, describeFailedFonts, marpArgs, parseArgs, summarize, withBuild } from "../scripts/check-overflow.mjs";

// playwright はプロジェクトの node_modules、無ければグローバルから探す
async function loadChromium() {
  try {
    return (await import("playwright")).chromium;
  } catch {
    try {
      const require = createRequire(import.meta.url);
      const npmRoot = process.env.NPM_GLOBAL_ROOT || "/opt/node22/lib/node_modules";
      return require(`${npmRoot}/playwright`).chromium;
    } catch {
      return null;
    }
  }
}

const chromium = await loadChromium();
const exe = process.env.CHROMIUM_PATH || (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);

// 手元で playwright が無いときは理由を出してスキップする。CI（環境変数 CI）ではスキップせずに失敗にする
const SKIP_REASON = "playwright が無い（npm ci と npx playwright install chromium の後に実行される。CI では必ず実行する）";
const skip = !chromium && !process.env.CI ? SKIP_REASON : false;
if (skip) console.warn(`警告: はみ出しのテストをスキップします: ${SKIP_REASON}`);

test("CI では playwright が必ずある（はみ出しのテストを黙ってスキップしない）", { skip: !process.env.CI && "CI ではない" }, () => {
  assert.ok(chromium, "playwright を読めません。npm ci と npx playwright install chromium を確認してください");
});

test("はみ出しの検出（縦・箱の中・横。フッターは対象外）", { skip }, async () => {
  const [r] = await check(["tests/fixtures/overflow.html"], () => chromium.launch(exe ? { executablePath: exe } : {}));
  assert.equal(r.slides, 4);
  const bySlide = Object.fromEntries(r.results.map((x) => [x.slide, x.issues.map((i) => i.kind)]));
  assert.equal(bySlide[1], undefined);
  assert.ok(bySlide[2].includes("outside") || bySlide[2].includes("too_tall"));
  assert.ok(bySlide[3].includes("clipped"));
  assert.ok(bySlide[4].includes("outside"));
  assert.ok(!r.results.find((x) => x.slide === 4).issues.some((i) => i.element === "footer"));
});

test("同梱フォントの読み込みを確かめる（読めないフォントは loaded 0）", { skip }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "font-"));
  const sys = ["/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", "C:\\Windows\\Fonts\\arial.ttf"].find(existsSync);
  const page = (src) =>
    `<style>@font-face{font-family:"T";src:url("${src}")}section{font-family:"T"}</style><section><h1>abc</h1></section>`;
  writeFileSync(join(dir, "missing.html"), page(pathToFileURL(join(dir, "none.woff2")).href));
  const files = [join(dir, "missing.html")];
  if (sys) {
    writeFileSync(join(dir, "ok.html"), page(pathToFileURL(sys).href));
    files.push(join(dir, "ok.html"));
  }
  const r = await check(files, () => chromium.launch(exe ? { executablePath: exe } : {}));
  assert.equal(r[0].fonts.declared, 1);
  assert.equal(r[0].fonts.loaded, 0);
  if (sys) assert.deepEqual(r[1].fonts, { declared: 1, loaded: 1, failed: [] });
});

// --- 第 2 回の指摘の再現 ---

test("測定用の HTML は一時フォルダに作り、終わったら消す（変換の失敗・測定中の例外でも）", async () => {
  const root = mkdtempSync(join(tmpdir(), "build-"));
  const src = mkdtempSync(join(tmpdir(), "src-"));
  writeFileSync(join(src, "a.md"), "---\nmarp: true\n---\n\n# a\n");
  const fake = async (args) => {
    writeFileSync(args[args.indexOf("--output") + 1], "<section>a</section>");
    return 0;
  };
  // 成功
  let seen;
  const r = await withBuild([{ path: src, trusted: false }], async (built, tmp) => {
    seen = tmp;
    assert.equal(built.length, 1);
    assert.equal(built[0].trusted, false);
    assert.ok(existsSync(built[0].path));
    return 0;
  }, { root, convert: fake });
  assert.equal(r, 0);
  assert.ok(!existsSync(seen), "成功しても消す");
  // 測定中の例外
  await assert.rejects(withBuild([{ path: src, trusted: true }], async (_b, tmp) => {
    seen = tmp;
    throw new Error("boom");
  }, { root, convert: fake }), /boom/);
  assert.ok(!existsSync(seen), "例外でも消す");
  // 変換の失敗（終了コード 2）
  await assert.rejects(withBuild([{ path: src, trusted: true }], async () => 0, { root, convert: async () => 1 }), (e) => e.exitCode === 2);
  assert.deepEqual(readdirSync(root), [], "一時フォルダが残っていない");
});

test("測定用の変換は本番の出力と同じオプション（既定は HTML 無効、:trusted だけ有効）", () => {
  const plain = marpArgs("slides/a.md", "out.html", false);
  assert.ok(!plain.includes("--html") && !plain.includes("--allow-local-files"));
  const trusted = marpArgs("slides/a.md", "out.html", true);
  assert.ok(trusted.includes("--html") && trusted.includes("--allow-local-files"));
  for (const a of [plain, trusted]) {
    assert.ok(a.includes("--template") && a[a.indexOf("--template") + 1] === "bare");
    // 画像の相対パスは資料の場所から解決する
    assert.match(a[a.indexOf("--base-url") + 1], /^file:\/\/.*slides\/$/);
  }
  assert.deepEqual(parseArgs(["--build", "slides", "--build-trusted", "layouts/catalog.md", "--format", "json"]), {
    format: "json",
    sources: [{ path: "slides", trusted: false }, { path: "layouts/catalog.md", trusted: true }],
    html: [],
  });
  assert.throws(() => parseArgs(["--build"]), /--build/);
  assert.throws(() => parseArgs(["--nope"]), /不明/);
});

test("既定の扱いで測ると HTML は文字として出て、ローカルのフォントを読まない（本番の npm run pdf と同じ）", { skip }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "mode-"));
  const sys = ["/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", "C:\\Windows\\Fonts\\arial.ttf"].find(existsSync);
  if (!sys) return;
  const html = `<style>@font-face{font-family:"T";src:url("${pathToFileURL(sys).href}")}section{font-family:"T"}</style><section><h1>abc</h1></section>`;
  writeFileSync(join(dir, "a.html"), html);
  const launch = () => chromium.launch(exe ? { executablePath: exe } : {});
  const [t, u] = await check([{ path: join(dir, "a.html"), trusted: true }, { path: join(dir, "a.html"), trusted: false }], launch);
  assert.equal(t.fonts.loaded, 1);
  assert.equal(u.fonts.loaded, 0);
  assert.equal(u.trusted, false);
});

test("フォントの一部が読めないときは警告して続け、どのフォントかを出す", async () => {
  const logs = [];
  const warns = [];
  const io = { log: (m) => logs.push(m), warn: (m) => warns.push(m) };
  const failed = [{ family: "Noto Sans JP", weight: "700", style: "normal", unicodeRange: "U+4E00-4E3F", src: "file:///x/noto-sans-jp-0-700-normal.woff2" }];
  const base = { file: "a.md", trusted: true, slides: 1, results: [] };
  assert.equal(summarize([{ ...base, fonts: { declared: 2, loaded: 1, failed } }], "markdown", io), 0);
  assert.match(warns.join("\n"), /一部（1 個）/);
  assert.match(warns.join("\n"), /Noto Sans JP 700 normal unicode-range U\+4E00-4E3F（noto-sans-jp-0-700-normal\.woff2）/);
  assert.match(logs.join("\n"), /はみ出し 0 枚/);
  // 1 つも読めないときは失敗（3）. どれが読めなかったかも出す
  warns.length = 0;
  assert.equal(summarize([{ ...base, fonts: { declared: 1, loaded: 0, failed } }], "markdown", io), 3);
  assert.match(warns.join("\n"), /noto-sans-jp-0-700-normal\.woff2/);
  // 既定の扱いで測ったもの（フォントを読まないのが正しい）は失敗にしない
  warns.length = 0;
  assert.equal(summarize([{ ...base, trusted: false, fonts: { declared: 1, loaded: 0, failed } }], "markdown", io), 0);
  assert.match(warns.join("\n"), /既定の扱い/);
  assert.deepEqual(describeFailedFonts([failed[0], failed[0]]).length, 1);
});

test("読めなかったフォントをブラウザで特定する（一部だけ読めない）", { skip }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "font2-"));
  const sys = ["/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", "C:\\Windows\\Fonts\\arial.ttf"].find(existsSync);
  if (!sys) return;
  const html =
    `<style>@font-face{font-family:"T";font-weight:400;src:url("${pathToFileURL(sys).href}")}` +
    `@font-face{font-family:"T";font-weight:700;src:url("${pathToFileURL(join(dir, "gone-700.woff2")).href}")}` +
    `section{font-family:"T"}</style><section><h1>abc</h1><p>abc</p></section>`;
  writeFileSync(join(dir, "a.html"), html);
  const [r] = await check([join(dir, "a.html")], () => chromium.launch(exe ? { executablePath: exe } : {}));
  assert.equal(r.fonts.declared, 2);
  assert.equal(r.fonts.loaded, 1);
  assert.equal(r.fonts.failed.length, 1);
  assert.equal(r.fonts.failed[0].weight, "700");
  assert.match(r.fonts.failed[0].src, /gone-700\.woff2$/);
  assert.match(describeFailedFonts(r.fonts.failed)[0], /^T 700 normal（gone-700\.woff2）$/);
});
