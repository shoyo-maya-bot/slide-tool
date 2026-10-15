#!/usr/bin/env node
// 描画してはみ出しを検出する（npm run check:overflow / check:overflow:trusted）.
//   node scripts/check-overflow.mjs --build <md かフォルダ> [--build-trusted <md かフォルダ>] [--format json]
//     Marp CLI で --template bare の HTML を一時フォルダ（build/check-XXXX）に作って測り、終わったら（失敗・中断でも）消す.
//     --build は本番の npm run pdf と同じ扱い（資料の HTML とローカルのファイルを無効）、
//     --build-trusted は npm run pdf:trusted と同じ扱い（--html --allow-local-files）で作って、同じ読み込み方で測る.
//   node scripts/check-overflow.mjs <作った HTML のフォルダかファイル> [--format json]（従来どおり。trusted の扱いで測る）
// 検出: スライドの外にはみ出した要素 / 内容がスライドより高い / 要素の中で文字が溢れている（scroll > client）
// --build-trusted の資料は、変換の前に lint（npm run lint と同じ規則）を流し、error があれば変換せずに終了コード 2 で止める
// （HTML とローカルのファイルを有効にして描画するため. npm run check:overflow:trusted も先に npm run lint を流す）.
// 終了コード: 0 問題なし / 1 はみ出しあり / 2 引数の誤り・資料を変換できない・trusted の資料に lint の error / 3 ブラウザを起動できない・同梱フォントを 1 つも読み込めない
// 同梱フォント（テーマの @font-face）を trusted で 1 つも読み込めなかったときは、PC のフォントで測った結果になるので失敗にする.
// 一部だけ読めないときは、どのフォントかを警告に出して続ける.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
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

/**
 * ブラウザ内で実行: @font-face で宣言したフォントの数と、読み込めた数、読めなかったフォント.
 * unicode-range ごとに分かれたフォントは、使う字のものだけ読み込まれる（使わないものは unloaded のままで正常）.
 */
export function inspectFonts() {
  const faces = [...document.fonts];
  // FontFace からはファイルの URL が分からないので、スタイルシートの @font-face から探す
  const rules = [];
  const walk = (list) => {
    for (const r of list) {
      if (r.type === CSSRule.FONT_FACE_RULE) rules.push(r.style);
      else if (r.cssRules) walk(r.cssRules);
    }
  };
  for (const sheet of document.styleSheets) {
    try {
      walk(sheet.cssRules);
    } catch {
      // 読めないスタイルシート（別オリジン）は飛ばす
    }
  }
  const norm = (s) => String(s || "").replace(/["']/g, "").replace(/\s+/g, " ").trim().toLowerCase();
  const srcOf = (f) => {
    const r = rules.find(
      (st) =>
        norm(st.getPropertyValue("font-family")) === norm(f.family) &&
        norm(st.getPropertyValue("font-weight") || "normal") === norm(f.weight) &&
        norm(st.getPropertyValue("font-style") || "normal") === norm(f.style) &&
        (!st.getPropertyValue("unicode-range") || norm(st.getPropertyValue("unicode-range")) === norm(f.unicodeRange)),
    );
    const m = r && /url\((["']?)([^"')]+)\1\)/.exec(r.getPropertyValue("src"));
    return m ? m[2] : "";
  };
  const failed = faces
    .filter((x) => x.status === "error")
    .map((x) => ({ family: x.family.replace(/["']/g, ""), weight: x.weight, style: x.style, unicodeRange: x.unicodeRange, src: srcOf(x) }));
  return { declared: faces.length, loaded: faces.filter((x) => x.status === "loaded").length, failed };
}

/** 読めなかったフォントを 1 行ずつの説明にする（同じファイルの重複はまとめる） */
export function describeFailedFonts(failed) {
  const lines = failed.map((f) => {
    const range = f.unicodeRange && f.unicodeRange !== "U+0-10FFFF" ? ` unicode-range ${f.unicodeRange.length > 40 ? f.unicodeRange.slice(0, 40) + "…" : f.unicodeRange}` : "";
    const name = f.src ? decodeURIComponent(f.src.replace(/^file:\/\//, "")).split(/[\\/]/).pop() : "";
    return `${f.family} ${f.weight} ${f.style}${range}${name ? `（${name}）` : ""}`;
  });
  return [...new Set(lines)];
}

function htmlFiles(p) {
  if (!existsSync(p)) return [];
  if (statSync(p).isFile()) return p.endsWith(".html") ? [p] : [];
  return readdirSync(p).flatMap((n) => htmlFiles(join(p, n)));
}

/** 測る対象: パスの文字列（trusted の扱い）か { path, label, trusted } */
function target(f) {
  return typeof f === "string" ? { path: f, label: f, trusted: true } : { label: f.path, trusted: true, ...f };
}

/**
 * 描画して測る. trusted: false は Marp CLI の既定（--allow-local-files なし）の PDF / PPTX 出力と同じく、
 * 中身を data: のページに流し込む（ローカルのフォント・画像は読めない）. trusted: true は file:// で開く（:trusted と同じ）.
 */
export async function check(files, launch) {
  const browser = await launch();
  const report = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    for (const t of files.map(target)) {
      if (t.trusted) await page.goto(pathToFileURL(resolve(t.path)).href);
      else {
        await page.goto("data:text/html,", { waitUntil: "domcontentloaded" });
        await page.setContent(readFileSync(t.path, "utf8"), { waitUntil: "load" });
      }
      // レイアウトを確定させてから、使う字のフォント（unicode-range ごと）の読み込みを待つ
      await page.evaluate(async () => {
        document.body.getBoundingClientRect();
        await document.fonts.ready;
      });
      const fonts = await page.evaluate(inspectFonts);
      report.push({ file: t.label, trusted: t.trusted, fonts, ...(await page.evaluate(inspectPage)) });
    }
  } finally {
    await browser.close();
  }
  return report;
}

function mdFiles(p) {
  if (!existsSync(p)) return [];
  if (statSync(p).isFile()) return p.endsWith(".md") ? [p] : [];
  return readdirSync(p)
    .filter((n) => !n.startsWith(".") && n !== "node_modules")
    .flatMap((n) => mdFiles(join(p, n)));
}

/** 本番の出力と同じオプション（:trusted なら --html --allow-local-files）で、測定用の HTML を作る */
export function marpArgs(md, out, trusted) {
  return [
    ...(trusted ? ["--html", "--allow-local-files"] : []),
    "--template",
    "bare",
    // 画像などの相対パスを資料の場所から解決する（PDF 出力と同じ. 出力先が build/ でもずれない）
    "--base-url",
    pathToFileURL(resolve(dirname(md))).href + "/",
    md,
    "--output",
    out,
  ];
}

/** 一時フォルダに HTML を作り、fn に渡す. 終わったら（例外・中断でも）一時フォルダを消す */
export async function withBuild(sources, fn, { root = "build", convert } = {}) {
  mkdirSync(root, { recursive: true });
  const tmp = mkdtempSync(join(root, "check-"));
  const cleanup = () => rmSync(tmp, { recursive: true, force: true });
  const onSignal = (sig) => {
    cleanup();
    process.exit(sig === "SIGINT" ? 130 : 143);
  };
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);
  try {
    if (!convert) {
      const { marpCli } = await import("@marp-team/marp-cli");
      convert = (args) => marpCli(args);
    }
    const built = [];
    let n = 0;
    for (const s of sources) {
      for (const md of mdFiles(s.path)) {
        const out = join(tmp, `${++n}-${basename(md, ".md")}.html`);
        const code = await convert(marpArgs(md, out, s.trusted));
        if (code !== 0 || !existsSync(out)) throw Object.assign(new Error(`変換できません: ${md}`), { exitCode: 2 });
        built.push({ path: out, label: md, trusted: s.trusted });
      }
    }
    return await fn(built, tmp);
  } finally {
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
    cleanup();
  }
}

/**
 * --build-trusted の資料に lint を流す. error があれば exitCode 2 の例外. runLint はテスト用（既定は scripts/lint の main）
 */
export async function lintTrusted(sources, runLint) {
  const paths = sources.filter((s) => s.trusted).map((s) => s.path);
  if (!paths.length) return;
  if (!runLint) runLint = (await import("./lint/cli.mjs")).main;
  if (runLint(paths) !== 0) {
    throw Object.assign(new Error(`lint で error があるため、HTML とローカルのファイルを有効にした描画（--build-trusted）をしません: ${paths.join(", ")}`), { exitCode: 2 });
  }
}

/** 引数を解析する. --build / --build-trusted は何回でも書ける */
export function parseArgs(argv) {
  const out = { format: "markdown", sources: [], html: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--format") out.format = argv[++i];
    else if (a === "--build" || a === "--build-trusted") {
      const p = argv[++i];
      if (!p) throw new Error(`${a} の後に資料（.md かフォルダ）を書いてください`);
      out.sources.push({ path: p, trusted: a === "--build-trusted" });
    } else if (a.startsWith("--")) throw new Error(`不明なオプション: ${a}`);
    else out.html.push(a);
  }
  return out;
}

/** 測った結果を出力して終了コードを返す */
export function summarize(report, format, { log = console.log, warn = console.error } = {}) {
  // trusted で同梱フォントを 1 つも読めない: PC のフォントで測った結果になるので失敗
  const noFont = report.filter((r) => r.trusted && r.fonts.declared > 0 && r.fonts.loaded === 0);
  if (noFont.length) {
    for (const r of noFont) {
      warn(`同梱フォントを読み込めませんでした: ${r.file}（npm ci と npm run theme をやり直してください）`);
      for (const d of describeFailedFonts(r.fonts.failed || [])) warn(`  - ${d}`);
    }
    return 3;
  }
  for (const r of report) {
    const failed = r.fonts.failed || [];
    if (!failed.length) continue;
    if (!r.trusted) {
      warn(`注意: ${r.file} は既定の扱い（npm run pdf と同じ）で測ったので、同梱フォントを読まず PC のフォントで測っています。:trusted で出力する資料は npm run check:trusted で測ってください`);
      continue;
    }
    // 一部だけ読めない: 読めた分で測れているので続ける. どのフォントかを出す
    warn(`警告: ${r.file} で同梱フォントの一部（${failed.length} 個）を読み込めませんでした。その字は PC のフォントで測っています:`);
    for (const d of describeFailedFonts(failed)) warn(`  - ${d}`);
  }
  const bad = report.flatMap((r) => r.results.map((x) => ({ file: r.file, ...x })));
  if (format === "json") log(JSON.stringify({ files: report, problems: bad.length }, null, 1));
  else {
    log("| ファイル | 枚目 | タイトル | 種類 | 要素 | 量(px) |\n|---|---|---|---|---|---|");
    for (const b of bad) for (const is of b.issues) log(`| ${b.file} | ${b.slide} | ${b.title} | ${is.kind} | ${is.element} ${is.text} | ${is.by} |`);
    log(`\nスライド ${report.reduce((n, r) => n + r.slides, 0)} 枚 / はみ出し ${bad.length} 枚`);
  }
  return bad.length ? 1 : 0;
}

async function main(argv) {
  let args;
  try {
    args = parseArgs(argv);
  } catch (e) {
    console.error(e.message);
    return 2;
  }
  const files = args.html.flatMap(htmlFiles);
  if (!files.length && !args.sources.length) {
    console.error("測る資料がありません。npm run check:overflow を使うか、--build <資料> を指定してください");
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
  const launch = () => chromium.launch(exe ? { executablePath: exe } : {});
  try {
    if (!args.sources.length) return summarize(await check(files, launch), args.format);
    await lintTrusted(args.sources);
    return await withBuild(args.sources, async (built) => {
      if (!built.length) {
        console.error("資料（.md）がありません");
        return 2;
      }
      return summarize(await check([...files, ...built], launch), args.format);
    });
  } catch (e) {
    if (e.exitCode) {
      console.error(e.message);
      return e.exitCode;
    }
    throw e;
  }
}

if (process.argv[1]?.endsWith("check-overflow.mjs")) {
  main(process.argv.slice(2)).then((c) => (process.exitCode = c), (e) => {
    console.error(e);
    process.exitCode = 3;
  });
}
