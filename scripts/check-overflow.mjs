#!/usr/bin/env node
// 描画してはみ出しを検出する. Marp CLI で --template bare の HTML を作ってから実行する（npm run check:overflow）.
//   node scripts/check-overflow.mjs build/check [--format json]
// 検出: スライドの外にはみ出した要素 / 内容がスライドより高い / 要素の中で文字が溢れている（scroll > client）
// 終了コード: 0 問題なし / 1 はみ出しあり / 2 引数の誤り / 3 ブラウザを起動できない・同梱フォントを読み込めない
// 同梱フォント（テーマの @font-face）を宣言しているのに 1 つも読み込めなかったときは、PC のフォントで測った結果になるので失敗にする
import { existsSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

/** ブラウザ内で実行: 各スライドのはみ出しを調べる（関数の中だけで完結させる） */
export function inspectPage() {
  const TOL = 3;
  const results = [];
  const sections = [...document.querySelectorAll("section")].filter((s) => !s.parentElement.closest("section"));
  sections.forEach((sec, i) => {
    const box = sec.getBoundingClientRect();
    const scale = box.height / (sec.offsetHeight || box.height);
    const st = getComputedStyle(sec);
    const limitB = box.bottom - parseFloat(st.paddingBottom) * scale + TOL;
    const limitR = box.right - parseFloat(st.paddingRight) * scale + TOL;
    const describe = (el) => {
      const cls = typeof el.className === "string" && el.className.trim() ? "." + el.className.trim().split(/\s+/).join(".") : "";
      return { element: el.tagName.toLowerCase() + cls, text: (el.textContent || "").trim().slice(0, 30) };
    };
    const outside = [];
    const issues = [];
    for (const el of sec.querySelectorAll("*")) {
      if (el.closest("header, footer")) continue;
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      if (r.bottom > limitB || r.right > limitR) outside.push({ el, by: Math.round(Math.max(r.bottom - limitB, r.right - limitR) + TOL) });
      const ov = getComputedStyle(el).overflow;
      if (["hidden", "clip", "auto", "scroll"].includes(ov) && (el.scrollHeight > el.clientHeight + TOL || el.scrollWidth > el.clientWidth + TOL)) {
        issues.push({ kind: "clipped", ...describe(el), by: Math.max(el.scrollHeight - el.clientHeight, el.scrollWidth - el.clientWidth) });
      }
    }
    // はみ出した要素のうち、内側にはみ出した要素を持たないもの（原因に近いもの）だけを報告する
    for (const o of outside) {
      if (!outside.some((x) => x !== o && o.el.contains(x.el))) issues.push({ kind: "outside", ...describe(o.el), by: o.by });
    }
    if (sec.scrollHeight > sec.clientHeight + TOL) issues.push({ kind: "too_tall", element: "section", text: "", by: sec.scrollHeight - sec.clientHeight });
    const title = (sec.querySelector("h1,h2")?.textContent || "").trim().slice(0, 30);
    if (issues.length) results.push({ slide: i + 1, title, issues: issues.slice(0, 5) });
  });
  return { slides: sections.length, results };
}

/** ブラウザ内で実行: @font-face で宣言したフォントの数と、読み込めた数 */
export function inspectFonts() {
  const faces = [...document.fonts];
  return { declared: faces.length, loaded: faces.filter((x) => x.status === "loaded").length };
}

function htmlFiles(p) {
  if (!existsSync(p)) return [];
  if (statSync(p).isFile()) return p.endsWith(".html") ? [p] : [];
  return readdirSync(p).flatMap((n) => htmlFiles(join(p, n)));
}

export async function check(files, launch) {
  const browser = await launch();
  const report = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    for (const f of files) {
      await page.goto(pathToFileURL(resolve(f)).href);
      // レイアウトを確定させてから、使う字のフォント（unicode-range ごと）の読み込みを待つ
      await page.evaluate(async () => {
        document.body.getBoundingClientRect();
        await document.fonts.ready;
      });
      const fonts = await page.evaluate(inspectFonts);
      report.push({ file: f, fonts, ...(await page.evaluate(inspectPage)) });
    }
  } finally {
    await browser.close();
  }
  return report;
}

async function main(argv) {
  const format = argv.includes("--format") ? argv[argv.indexOf("--format") + 1] : "markdown";
  const targets = argv.filter((a, i) => !a.startsWith("--") && argv[i - 1] !== "--format");
  const files = targets.flatMap(htmlFiles);
  if (!files.length) {
    console.error("HTML がありません。先に npm run check:overflow（Marp CLI の --template bare 出力）を実行してください");
    return 2;
  }
  let chromium;
  try {
    ({ chromium } = await import("playwright"));
  } catch {
    console.error("playwright が見つかりません（npm install のあと npx playwright install chromium）");
    return 3;
  }
  const exe = process.env.CHROMIUM_PATH;
  const report = await check(files, () => chromium.launch(exe ? { executablePath: exe } : {}));
  const noFont = report.filter((r) => r.fonts.declared > 0 && r.fonts.loaded === 0);
  if (noFont.length) {
    for (const r of noFont) console.error(`同梱フォントを読み込めませんでした: ${r.file}（npm ci と npm run theme をやり直してください）`);
    return 3;
  }
  const bad = report.flatMap((r) => r.results.map((x) => ({ file: r.file, ...x })));
  if (format === "json") console.log(JSON.stringify({ files: report, problems: bad.length }, null, 1));
  else {
    console.log("| ファイル | 枚目 | タイトル | 種類 | 要素 | 量(px) |\n|---|---|---|---|---|---|");
    for (const b of bad) for (const is of b.issues) console.log(`| ${b.file} | ${b.slide} | ${b.title} | ${is.kind} | ${is.element} ${is.text} | ${is.by} |`);
    console.log(`\nスライド ${report.reduce((n, r) => n + r.slides, 0)} 枚 / はみ出し ${bad.length} 枚`);
  }
  return bad.length ? 1 : 0;
}

if (process.argv[1]?.endsWith("check-overflow.mjs")) {
  main(process.argv.slice(2)).then((c) => (process.exitCode = c), (e) => {
    console.error(e);
    process.exitCode = 3;
  });
}
