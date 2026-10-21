import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { evaluate, loadAllowlist } from "../scripts/audit-deps.mjs";

const via = (name, id, severity) => ({ name, title: `${name} の脆弱性`, url: `https://github.com/advisories/${id}`, severity });
const report = {
  vulnerabilities: {
    braces: { severity: "high", via: [via("braces", "GHSA-aaaa-bbbb-cccc", "high")] },
    micromatch: { severity: "high", via: ["braces"] },
    katex: { severity: "low", via: [via("katex", "GHSA-low0-low0-low0", "low")] },
    evil: { severity: "critical", via: [via("evil", "GHSA-crit-crit-crit", "critical")] },
  },
};

test("high 以上を見つける（low は数えない。他のパッケージ経由は元で 1 回だけ）", () => {
  const r = evaluate(report, [], "2026-10-08");
  assert.deepEqual(r.blocking.map((b) => `${b.package} ${b.id}`).sort(), ["braces GHSA-aaaa-bbbb-cccc", "evil GHSA-crit-crit-crit"]);
});

test("許可リストの期限内は許可、期限切れは要対応", () => {
  const allow = [{ id: "GHSA-aaaa-bbbb-cccc", package: "braces", reason: "上流待ち", until: "2026-12-31" }];
  const ok = evaluate(report, allow, "2026-10-08");
  assert.deepEqual(
    ok.allowed.map((a) => a.package),
    ["braces"],
  );
  assert.deepEqual(
    ok.blocking.map((b) => b.package),
    ["evil"],
  );
  const late = evaluate(report, allow, "2027-01-01");
  assert.deepEqual(
    late.expired.map((a) => a.package),
    ["braces"],
  );
  // 別のパッケージの同じ id は許可しない
  const other = evaluate(report, [{ ...allow[0], package: "other" }], "2026-10-08");
  assert.ok(other.blocking.some((b) => b.package === "braces"));
});

test("許可リストの形の誤りは例外（理由・期限が無い許可はできない）", () => {
  const dir = mkdtempSync(join(tmpdir(), "audit-"));
  const p = join(dir, "a.json");
  writeFileSync(p, JSON.stringify({ advisories: [{ id: "GHSA-aaaa-bbbb-cccc" }] }));
  assert.throws(() => loadAllowlist(p), /reason/);
  writeFileSync(p, `\uFEFF${JSON.stringify({ advisories: [{ id: "GHSA-aaaa-bbbb-cccc", reason: "x", until: "2027-01-08" }] })}`);
  assert.equal(loadAllowlist(p).length, 1);
  assert.deepEqual(loadAllowlist(join(dir, "none.json")), []);
});

test("同梱の許可リストは読めて、期限は 1 年以内", () => {
  const list = loadAllowlist("config/audit-allowlist.json");
  assert.ok(list.length > 0);
  const limit = new Date(Date.now() + 366 * 86400e3).toISOString().slice(0, 10);
  for (const a of list) assert.ok(a.until <= limit, `${a.id}: 期限 ${a.until} が長すぎます`);
});
