#!/usr/bin/env node
// npm run watch:trusted: 編集しながら、HTML とローカルのファイルを有効にして（--html --allow-local-files）プレビューする.
//
// 変更のたびに lint（npm run lint と同じ対象）を流し、error が無いときだけ slides/ をプレビュー用のフォルダ
// （.preview-trusted/）に写す. Marp のサーバーはそのフォルダだけを --html で配るので、error のある資料は
// :trusted のプレビューに出ない（error の間はフォルダを空にする）. 直して保存すると、次の lint が通った時点で出る.
//
// lint と写す間の保存で lint していない中身を出さないよう、一時フォルダ（.preview-trusted.staging/）に写してから lint し、
// その間に資料が変わっていなければ一時フォルダの中身を出す（syncPreview）.
//
// .preview-trusted/ は slides/ と同じ深さに置くので、資料の中の ../assets/… などの相対パスはそのまま読める.
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, watch } from "node:fs";
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

/** フォルダ（またはファイル）の中身の指紋. 無いものは空として扱う */
export function digest(paths) {
  const h = createHash("sha256");
  const walk = (p) => {
    if (!existsSync(p)) return;
    if (statSync(p).isDirectory()) {
      for (const n of readdirSync(p).sort()) walk(join(p, n));
      return;
    }
    h.update(`${p}\0`);
    h.update(readFileSync(p));
    h.update("\0");
  };
  for (const p of paths) walk(p);
  return h.digest("hex");
}

/**
 * lint を流し、error が無ければ src を dest に写す. error があれば dest を空にする（:trusted で出力しない）.
 * → lint の終了コード（0 なら写した）
 *
 * lint と写す間に保存されると、lint していない中身を写してしまう. そのため、先に src を一時フォルダ（dest.staging）に写してから
 * lint し、lint の前後で lint の対象（watched）の中身が変わっていないときだけ、その一時フォルダの中身を dest に出す
 * （変わっていたら、もう一度やり直す. 保存が続いて retries 回で落ち着かなければ、何も出さずに 1 を返す）.
 */
export function syncPreview({
  src = SOURCE_DIR,
  dest = PREVIEW_DIR,
  runLint = () => lint(LINT_TARGETS),
  watched = [...new Set([src, ...LINT_TARGETS])],
  retries = 3,
} = {}) {
  const staging = `${dest}.staging`;
  try {
    for (let i = 0; i < retries; i++) {
      const before = digest(watched);
      rmSync(staging, { recursive: true, force: true });
      if (existsSync(src)) cpSync(src, staging, { recursive: true });
      else mkdirSync(staging, { recursive: true });
      const code = runLint();
      if (digest(watched) !== before) continue; // lint の間に保存された: lint した中身と写した中身が違うかもしれない
      clearDir(dest);
      if (code !== 0) {
        console.error(`\nlint で error があるため、プレビュー（${dest}/）を空にしました。直して保存すると表示します`);
        return code;
      }
      cpSync(staging, dest, { recursive: true });
      console.error(`\nlint を通りました。プレビュー（${dest}/）を更新しました`);
      return 0;
    }
    clearDir(dest);
    console.error(`\nlint の間に資料が変わり続けたため、プレビュー（${dest}/）を空にしました。保存が落ち着くと表示します`);
    return 1;
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
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
