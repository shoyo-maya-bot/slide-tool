#!/usr/bin/env node
// 依存の既知の脆弱性を調べる（npm audit --audit-level=high と同じ基準）.
//   node scripts/audit-deps.mjs [--allowlist config/audit-allowlist.json]
// 終了コード: 0 high 以上なし（許可リストの期限内のものを除く）/ 1 high 以上あり・許可の期限切れ / 2 npm audit を実行できない・設定の誤り
//
// 上流（marp-cli・tailwindcss）が直すまで直せないものだけ、理由と期限を付けて config/audit-allowlist.json に書く.
// 期限を過ぎると失敗するので、そのときに直っているか確かめ、直っていなければ理由を見直して期限を延ばす.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const LEVELS = { info: 0, low: 1, moderate: 2, high: 3, critical: 4 };
export const THRESHOLD = "high";

/** 許可リストを読む. → [{ id, package, reason, until }]（id は GHSA-…） */
export function loadAllowlist(path) {
  if (!existsSync(path)) return [];
  const raw = readFileSync(path, "utf8").replace(/^﻿/, "");
  const list = JSON.parse(raw).advisories ?? [];
  for (const a of list) {
    if (!/^GHSA-[\w-]+$/.test(a.id ?? "") || !a.reason || !/^\d{4}-\d{2}-\d{2}$/.test(a.until ?? "")) {
      throw new Error(`許可リストの項目には id（GHSA-…）・reason・until（YYYY-MM-DD）が要ります: ${JSON.stringify(a)}`);
    }
  }
  return list;
}

/**
 * npm audit --json の結果を判定する.
 * → { blocking: [{ package, id, severity, title, url }], allowed: [...], expired: [...] }
 * today は YYYY-MM-DD
 */
export function evaluate(report, allowlist, today, threshold = THRESHOLD) {
  const blocking = [];
  const allowed = [];
  const expired = [];
  const seen = new Set();
  for (const [name, v] of Object.entries(report.vulnerabilities ?? {})) {
    for (const via of v.via ?? []) {
      if (typeof via === "string") continue; // 他のパッケージ経由（その元で数える）
      if ((LEVELS[via.severity] ?? 0) < LEVELS[threshold]) continue;
      const id = (via.url ?? "").split("/").pop();
      const key = `${name} ${id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const item = { package: name, id, severity: via.severity, title: via.title, url: via.url };
      const allow = allowlist.find((a) => a.id === id && (!a.package || a.package === name));
      if (!allow) blocking.push(item);
      else if (allow.until < today) expired.push({ ...item, until: allow.until, reason: allow.reason });
      else allowed.push({ ...item, until: allow.until, reason: allow.reason });
    }
  }
  return { blocking, allowed, expired };
}

export function main(argv) {
  const args = [...argv];
  let allowPath = "config/audit-allowlist.json";
  while (args.length) {
    const a = args.shift();
    if (a === "--allowlist") allowPath = args.shift();
    else {
      console.error("使い方: audit-deps.mjs [--allowlist config/audit-allowlist.json]");
      return 2;
    }
  }
  let allowlist;
  try {
    allowlist = loadAllowlist(allowPath);
  } catch (e) {
    console.error(`設定の誤り: ${allowPath}: ${e.message}`);
    return 2;
  }
  const r = spawnSync("npm", ["audit", "--json"], { encoding: "utf8", shell: process.platform === "win32", maxBuffer: 64 * 1024 * 1024 });
  let report;
  try {
    report = JSON.parse(r.stdout);
  } catch {
    console.error(`npm audit を実行できません（終了コード ${r.status}）\n${r.stderr}`);
    return 2;
  }
  if (report.error || !report.vulnerabilities) {
    console.error(`npm audit が失敗しました: ${JSON.stringify(report.error ?? report).slice(0, 500)}`);
    return 2;
  }
  const today = new Date().toISOString().slice(0, 10);
  const { blocking, allowed, expired } = evaluate(report, allowlist, today);
  for (const a of allowed) console.log(`許可（${a.until} まで）: ${a.package} ${a.id} ${a.severity} — ${a.reason}`);
  for (const a of expired) console.error(`許可の期限切れ（${a.until}）: ${a.package} ${a.id} ${a.severity} ${a.url} — 直っているか確かめ、許可リストを見直してください`);
  for (const b of blocking) console.error(`脆弱性（${b.severity}）: ${b.package} ${b.id} ${b.title} ${b.url}`);
  const bad = blocking.length + expired.length;
  console.log(`\n${THRESHOLD} 以上: 要対応 ${bad} 件 / 許可中 ${allowed.length} 件`);
  return bad ? 1 : 0;
}

if (process.argv[1]?.endsWith("audit-deps.mjs")) {
  process.exitCode = main(process.argv.slice(2));
}
