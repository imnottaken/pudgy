import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { scanProject, analyze, formatBytes } from "../dist/index.js";

function makeProject(spec) {
  // spec: { root: {deps, devDeps}, pkgs: [{ at: "node_modules/a", name, version, deps, bytes }] }
  const dir = mkdtempSync(path.join(tmpdir(), "pudgy-"));
  writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({
      name: "fixture",
      version: "1.0.0",
      dependencies: spec.root.deps ?? {},
      devDependencies: spec.root.devDeps ?? {},
    }),
  );
  for (const p of spec.pkgs) {
    const pdir = path.join(dir, p.at);
    mkdirSync(pdir, { recursive: true });
    writeFileSync(
      path.join(pdir, "package.json"),
      JSON.stringify({ name: p.name, version: p.version, dependencies: p.deps ?? {} }),
    );
    writeFileSync(path.join(pdir, "blob.bin"), Buffer.alloc(p.bytes));
  }
  return dir;
}

const sizeOf = (bytes) => bytes + 80; // blob + package.json is added separately below

test("formatBytes", () => {
  assert.equal(formatBytes(512), "512 B");
  assert.equal(formatBytes(2048), "2.0 KB");
  assert.equal(formatBytes(5 * 1024 * 1024), "5.0 MB");
});

test("blames the direct dependency that pulled a package in", async () => {
  const dir = makeProject({
    root: { deps: { datepicker: "1", tiny: "1" } },
    pkgs: [
      { at: "node_modules/datepicker", name: "datepicker", version: "1.0.0", deps: { moment: "2" }, bytes: 1000 },
      { at: "node_modules/moment", name: "moment", version: "2.0.0", bytes: 50000 },
      { at: "node_modules/tiny", name: "tiny", version: "1.0.0", bytes: 100 },
    ],
  });
  try {
    const report = analyze(await scanProject(dir));
    assert.equal(report.packageCount, 3);

    const moment = report.heavy.find((h) => h.name === "moment");
    assert.deepEqual(moment.chain, ["datepicker", "moment"]);
    assert.equal(moment.direct, false);

    // datepicker owns moment exclusively, so removing it frees both.
    const dp = report.direct.find((d) => d.name === "datepicker");
    assert.equal(dp.exclusivePackages, 2);
    assert.ok(dp.exclusive > 50000);
    assert.equal(report.direct[0].name, "datepicker");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("shared packages are retained but not exclusive", async () => {
  const dir = makeProject({
    root: { deps: { a: "1", b: "1" } },
    pkgs: [
      { at: "node_modules/a", name: "a", version: "1.0.0", deps: { shared: "1" }, bytes: 10 },
      { at: "node_modules/b", name: "b", version: "1.0.0", deps: { shared: "1" }, bytes: 10 },
      { at: "node_modules/shared", name: "shared", version: "1.0.0", bytes: 9000 },
    ],
  });
  try {
    const report = analyze(await scanProject(dir));
    for (const name of ["a", "b"]) {
      const row = report.direct.find((d) => d.name === name);
      assert.ok(row.retained > 9000);
      assert.ok(row.exclusive < 1000, `${name} should not own shared`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("finds duplicate copies in nested node_modules", async () => {
  const dir = makeProject({
    root: { deps: { lodash: "4", old: "1" } },
    pkgs: [
      { at: "node_modules/lodash", name: "lodash", version: "4.17.21", bytes: 8000 },
      { at: "node_modules/old", name: "old", version: "1.0.0", deps: { lodash: "3" }, bytes: 10 },
      { at: "node_modules/old/node_modules/lodash", name: "lodash", version: "3.10.1", bytes: 6000 },
    ],
  });
  try {
    const report = analyze(await scanProject(dir));
    assert.equal(report.duplicates.length, 1);
    const dup = report.duplicates[0];
    assert.equal(dup.name, "lodash");
    assert.equal(dup.versions.length, 2);
    assert.ok(dup.wasted >= 6000 && dup.wasted < 8000);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("--prod skips devDependencies and missing deps are reported", async () => {
  const dir = makeProject({
    root: { deps: { a: "1", ghost: "1" }, devDeps: { dev: "1" } },
    pkgs: [
      { at: "node_modules/a", name: "a", version: "1.0.0", bytes: 10 },
      { at: "node_modules/dev", name: "dev", version: "1.0.0", bytes: 10 },
    ],
  });
  try {
    const all = analyze(await scanProject(dir));
    assert.equal(all.packageCount, 2);
    assert.deepEqual(all.missing, ["ghost"]);
    assert.equal(all.direct.find((d) => d.name === "dev").dev, true);

    const prod = analyze(await scanProject(dir, { prod: true }));
    assert.equal(prod.packageCount, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("peer dependencies do not make a package shared", async () => {
  const dir = makeProject({
    root: { deps: { host: "1", plugin: "1" } },
    pkgs: [
      { at: "node_modules/host", name: "host", version: "1.0.0", bytes: 9000 },
      { at: "node_modules/plugin", name: "plugin", version: "1.0.0", bytes: 10 },
    ],
  });
  // plugin lists host as a peer dependency
  writeFileSync(
    path.join(dir, "node_modules/plugin/package.json"),
    JSON.stringify({ name: "plugin", version: "1.0.0", peerDependencies: { host: "1" } }),
  );
  try {
    const report = analyze(await scanProject(dir));
    const host = report.direct.find((d) => d.name === "host");
    assert.ok(host.exclusive >= 9000, "host stays removable despite the peer edge");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("handles dependency cycles", async () => {
  const dir = makeProject({
    root: { deps: { a: "1" } },
    pkgs: [
      { at: "node_modules/a", name: "a", version: "1.0.0", deps: { b: "1" }, bytes: 10 },
      { at: "node_modules/b", name: "b", version: "1.0.0", deps: { a: "1" }, bytes: 10 },
    ],
  });
  try {
    const report = analyze(await scanProject(dir));
    assert.equal(report.packageCount, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

void sizeOf;
