import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { analyze, scanProject, renderComment, COMMENT_MARKER, isReport } from "../dist/index.js";

const KB = 1024;
const CLI = new URL("../dist/cli.js", import.meta.url).pathname;

function project(rootDeps, pkgs) {
  const dir = mkdtempSync(path.join(tmpdir(), "pudgy-md-"));
  writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "demo", version: "1.0.0", dependencies: rootDeps }));
  for (const [name, bytes] of Object.entries(pkgs)) {
    const d = path.join(dir, "node_modules", name);
    mkdirSync(d, { recursive: true });
    writeFileSync(path.join(d, "package.json"), JSON.stringify({ name, version: "1.0.0" }));
    writeFileSync(path.join(d, "blob.bin"), Buffer.alloc(bytes));
  }
  return dir;
}
const report = async (dir) => analyze(await scanProject(dir));

test("comment without a base shows totals and the heaviest dependencies", async () => {
  const dir = project({ big: "1" }, { big: 300 * KB });
  try {
    const text = renderComment(await report(dir));
    assert.ok(text.startsWith(COMMENT_MARKER));
    assert.match(text, /\*\*demo: [\d.]+ (MB|KB)\*\* across 1 package/);
    assert.match(text, /Heaviest dependencies/);
    assert.ok(!text.includes("Dependency changes"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("comment against a base lists added, removed and unchanged dependencies", async () => {
  const before = project({ keep: "1", gone: "1" }, { keep: 200 * KB, gone: 400 * KB });
  const after = project({ keep: "1", fresh: "1" }, { keep: 200 * KB, fresh: 900 * KB });
  try {
    const text = renderComment(await report(after), await report(before));
    assert.match(text, /Dependency changes/);
    assert.match(text, /`fresh` \(new\) \| – \| .* \| \+/);
    assert.match(text, /`gone` \(removed\)/);
    assert.ok(!/`keep`.*\(new\)/.test(text), "unchanged dependency must not be listed as a change");
    assert.match(text, /compared with the base branch/);
  } finally {
    rmSync(before, { recursive: true, force: true });
    rmSync(after, { recursive: true, force: true });
  }
});

test("identical base and head say there is no change", async () => {
  const dir = project({ a: "1" }, { a: 100 * KB });
  try {
    const r = await report(dir);
    assert.match(renderComment(r, r), /no change from the base branch/);
    assert.ok(!renderComment(r, r).includes("Dependency changes"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("isReport rejects things that are not reports", () => {
  assert.equal(isReport(null), false);
  assert.equal(isReport({}), false);
  assert.equal(isReport({ totalSize: 1, packageCount: 1, direct: [], swaps: [] }), true);
});

test("cli --markdown --base compares two json reports", async () => {
  const before = project({ a: "1" }, { a: 100 * KB });
  const after = project({ a: "1", b: "1" }, { a: 100 * KB, b: 500 * KB });
  try {
    const base = spawnSync("node", [CLI, before, "--json"], { encoding: "utf8" });
    const baseFile = path.join(before, "base.json");
    writeFileSync(baseFile, base.stdout);
    const out = spawnSync("node", [CLI, after, "--markdown", "--base", baseFile], { encoding: "utf8" });
    assert.equal(out.status, 0, out.stderr);
    assert.match(out.stdout, /`b` \(new\)/);

    const bad = spawnSync("node", [CLI, after, "--base", baseFile], { encoding: "utf8" });
    assert.equal(bad.status, 2);
    assert.match(bad.stderr, /--base only works together with --markdown/);

    writeFileSync(baseFile, "{}");
    const notReport = spawnSync("node", [CLI, after, "--markdown", "--base", baseFile], { encoding: "utf8" });
    assert.equal(notReport.status, 1);
    assert.match(notReport.stderr, /not a pudgy --json report/);
  } finally {
    rmSync(before, { recursive: true, force: true });
    rmSync(after, { recursive: true, force: true });
  }
});
