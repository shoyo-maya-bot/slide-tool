#!/usr/bin/env node
// npm run watch:trusted: 編集しながら、HTML とローカルのファイルを有効にして（--html --allow-local-files）プレビューする.
//
// 変更のたびに lint（npm run lint と同じ対象）を流し、error が無いときだけ slides/ をプレビュー用のフォルダ
// （.preview-trusted/）に写す. Marp のサーバーはそのフォルダだけを --html で配るので、error のある資料は
// :trusted のプレビューに出ない（error の間はフォルダを空にする）. 直して保存すると、次の lint が通った時点で出る.
//
// .preview-trusted/ は slides/ と同じ深さに置くので、資料の中の ../assets/… などの相対パスはそのまま読める.
import { spawn } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, watch } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { main as lint } from "./lint/cli.mjs";

export const PREVIEW_DIR = ".preview-trusted";
export const SOURCE_DIR = "slides";
export const LINT_TARGETS = ["slides", "layouts", "assets"];

/** フォルダの中身を消す（フォルダ自体は残す. Marp のサーバーが見ているため） */
function clearDir(dir) {
  mkdirSync(dir, { recursive: true });
  for (const n of readdirSync(dir)) rmSync(join(dir, n), { recursive: true, force: true });
}

/**
 * lint を流し、error が無ければ src を dest に写す. error があれば dest を空にする（:trusted で出力しない）.
 * → lint の終了コード（0 なら写した）
 */
export function syncPreview({ src = SOURCE_DIR, dest = PREVIEW_DIR, runLint = () => lint(LINT_TARGETS) } = {}) {
  const code = runLint();
  clearDir(dest);
  if (code !== 0) {
    console.error(`\nlint で error があるため、プレビュー（${dest}/）を空にしました。直して保存すると表示します`);
    return code;
  }
  if (existsSync(src)) cpSync(src, dest, { recursive: true });
  console.error(`\nlint を通りました。プレビュー（${dest}/）を更新しました`);
  return 0;
}

/** 変更をまとめて（delay ミリ秒）1 回にする */
export function debounce(fn, delay) {
  let timer = null;
  return () => {
    clearTimeout(timer);
    timer = setTimeout(fn, delay);
  };
}

function run() {
  syncPreview();
  const marp = spawn("marp", ["--html", "--allow-local-files", "--input-dir", PREVIEW_DIR, "--server", "--watch"], {
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  const resync = debounce(() => syncPreview(), 300);
  const watchers = LINT_TARGETS.filter((d) => existsSync(d)).map((d) => watch(d, { recursive: true }, resync));
  const stop = () => {
    for (const w of watchers) w.close();
    marp.kill();
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  marp.on("exit", (code) => {
    for (const w of watchers) w.close();
    process.exitCode = code ?? 0;
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) run();
