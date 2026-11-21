import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { analyze, scanProject, ALTERNATIVES, formatReport, renderCardSvg, renderHtml } from "../dist/index.js";

const KB = 1024;

function project(rootDeps, pkgs) {
  const dir = mkdtempSync(path.join(tmpdir(), "pudgy-swap-"));
  writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "demo", version: "1.0.0", dependencies: rootDeps }));
  for (const [name, { deps = {}, bytes }] of Object.entries(pkgs)) {
    const d = path.join(dir, "node_modules", name);
    mkdirSync(d, { recursive: true });
    writeFileSync(path.join(d, "package.json"), JSON.stringify({ name, version: "1.0.0", dependencies: deps }));
    writeFileSync(path.join(d, "blob.bin"), Buffer.alloc(bytes));
  }
  return dir;
}

const run = async (dir) => analyze(await scanProject(dir));
const cleanup = (dir) => rmSync(dir, { recursive: true, force: true });

test("alternatives table is sane", () => {
  assert.ok(ALTERNATIVES.size >= 10);
  for (const [name, a] of ALTERNATIVES) {
    assert.ok(name && a.alt && a.short && a.note, `${name} has empty fields`);
    assert.ok(!a.short.includes(" ") || a.short === "native Promise", `${name} short should be compact`);
    assert.ok(["similar-api", "built-in", "different-api"].includes(a.kind), `${name} kind`);
    assert.ok(Number.isInteger(a.altSize) && a.altSize >= 0, `${name} altSize`);
    if (a.kind === "built-in") assert.equal(a.altSize, 0, `${name} built-in should cost nothing`);
  }
  // lodash -> es-toolkit installs larger, so it must never be suggested.
  assert.equal(ALTERNATIVES.has("lodash"), false);
});

test("suggests a direct built-in swap and counts what would be freed", async () => {
  const dir = project({ rimraf: "1" }, { rimraf: { bytes: 200 * KB } });
  try {
    const report = await run(dir);
    assert.equal(report.swaps.length, 1);
    const [swap] = report.swaps;
    assert.equal(swap.name, "rimraf");
    assert.equal(swap.direct, true);
    assert.equal(swap.kind, "built-in");
    assert.ok(swap.saves >= 200 * KB);
    assert.equal(report.swapTotal, swap.saves);
  } finally {
    cleanup(dir);
  }
});

test("subtracts the replacement's own size (moment -> dayjs)", async () => {
  const dir = project({ moment: "1" }, { moment: { bytes: 800 * KB } });
  try {
    const report = await run(dir);
    const swap = report.swaps.find((s) => s.name === "moment");
    assert.ok(swap, "moment suggested");
    assert.equal(swap.alt, "dayjs");
    // 800 KB installed minus dayjs's ~666 KB leaves roughly 130 KB.
    assert.ok(swap.saves > 100 * KB && swap.saves < 200 * KB, `saves was ${swap.saves}`);
  } finally {
    cleanup(dir);
  }
});

test("skips swaps that would save too little", async () => {
  const dir = project({ mkdirp: "1" }, { mkdirp: { bytes: 5 * KB } });
  try {
    assert.deepEqual((await run(dir)).swaps, []);
  } finally {
    cleanup(dir);
  }
});

test("a transitive swap names the dependency that pulls it in", async () => {
  const dir = project(
    { legacy: "1" },
    { legacy: { deps: { request: "1" }, bytes: 10 }, request: { bytes: 300 * KB } },
  );
  try {
    const report = await run(dir);
    assert.equal(report.swaps.length, 1);
    const [swap] = report.swaps;
    assert.equal(swap.name, "request");
    assert.equal(swap.direct, false);
    assert.equal(swap.via, "legacy");
    // Not something you installed, so it must not inflate the headline number.
    assert.equal(report.swapTotal, 0);
  } finally {
    cleanup(dir);
  }
});

test("packages below a peer dependency still get a blame chain", async () => {
  const dir = project(
    { plugin: "1" },
    {
      plugin: { bytes: 10 },
      host: { deps: { request: "1" }, bytes: 10 },
      request: { bytes: 300 * KB },
    },
  );
  // plugin only lists host as a peer dependency
  writeFileSync(
    path.join(dir, "node_modules/plugin/package.json"),
    JSON.stringify({ name: "plugin", version: "1.0.0", peerDependencies: { host: "1" } }),
  );
  try {
    const report = await run(dir);
    const swap = report.swaps.find((s) => s.name === "request");
    assert.ok(swap, "request suggested");
    assert.equal(swap.via, "plugin", "blamed on the dependency that peers it in, not on itself");
    const row = report.heavy.find((h) => h.name === "request");
    assert.deepEqual(row.chain, ["plugin", "host", "request"]);
  } finally {
    cleanup(dir);
  }
});

test("does not double count when a swappable dependency pulls in another", async () => {
  const dir = project(
    { "request-promise": "1" },
    { "request-promise": { deps: { request: "1" }, bytes: 50 * KB }, request: { bytes: 300 * KB } },
  );
  try {
    const report = await run(dir);
    assert.deepEqual(report.swaps.map((s) => s.name), ["request-promise"]);
    // The direct row already includes request's bytes.
    assert.ok(report.swaps[0].saves >= 350 * KB);
    assert.ok(report.swapTotal <= report.totalSize);
  } finally {
    cleanup(dir);
  }
});

test("swaps show up in the terminal, card and html", async () => {
  const dir = project({ moment: "1", rimraf: "1" }, { moment: { bytes: 5 * 1024 * KB }, rimraf: { bytes: 200 * KB } });
  try {
    const report = await run(dir);
    const text = formatReport(report, { top: 10, color: false });
    assert.match(text, /SWAP IDEAS/);
    assert.match(text, /moment → dayjs/);
    assert.match(text, /rimraf → fs\.rm \(built in\)/);

    assert.match(renderCardSvg(report), /swap ideas could save ~/);
    const html = renderHtml(report);
    assert.match(html, /<h2>Swap ideas<\/h2>/);
    assert.match(html, /Check the notes before switching/);
  } finally {
    cleanup(dir);
  }
});

test("projects with no swaps omit the section", async () => {
  const dir = project({ left: "1" }, { left: { bytes: 10 * KB } });
  try {
    const report = await run(dir);
    assert.equal(report.swaps.length, 0);
    assert.ok(!formatReport(report, { top: 10, color: false }).includes("SWAP IDEAS"));
    assert.ok(!renderHtml(report).includes("Swap ideas"));
    assert.ok(!renderCardSvg(report).includes("swap ideas"));
  } finally {
    cleanup(dir);
  }
});
