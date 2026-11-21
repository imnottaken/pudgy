import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { squarify, buildGroups, layoutGroups, analyze, scanProject, renderCardSvg, renderHtml } from "../dist/index.js";

const area = (r) => r.w * r.h;
const sum = (xs) => xs.reduce((a, b) => a + b, 0);

test("squarify tiles the rectangle with areas proportional to values", () => {
  const values = [60, 30, 20, 10, 5, 5, 2];
  const rect = { x: 10, y: 20, w: 400, h: 250 };
  const rects = squarify(values, rect);

  assert.equal(rects.length, values.length);
  assert.ok(Math.abs(sum(rects.map(area)) - rect.w * rect.h) < 1e-6);
  rects.forEach((r, i) => {
    assert.ok(r.x >= rect.x - 1e-6 && r.y >= rect.y - 1e-6);
    assert.ok(r.x + r.w <= rect.x + rect.w + 1e-6 && r.y + r.h <= rect.y + rect.h + 1e-6);
    const expected = (values[i] / sum(values)) * rect.w * rect.h;
    assert.ok(Math.abs(area(r) - expected) < 1e-6, `area ${i}`);
  });
});

test("squarify handles empty and degenerate input", () => {
  assert.deepEqual(squarify([], { x: 0, y: 0, w: 10, h: 10 }), []);
  const zero = squarify([5, 5], { x: 0, y: 0, w: 0, h: 10 });
  assert.equal(zero.length, 2);
  assert.ok(zero.every((r) => r.w === 0 && r.h === 0));
});

function fixture() {
  const dir = mkdtempSync(path.join(tmpdir(), "pudgy-render-"));
  writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({ name: "demo-app", version: "1.0.0", dependencies: { big: "1", small: "1" } }),
  );
  const add = (name, deps, bytes) => {
    const d = path.join(dir, "node_modules", name);
    mkdirSync(d, { recursive: true });
    writeFileSync(path.join(d, "package.json"), JSON.stringify({ name, version: "1.0.0", dependencies: deps }));
    writeFileSync(path.join(d, "blob.bin"), Buffer.alloc(bytes));
  };
  add("big", { inner: "1" }, 40000);
  add("inner", {}, 30000);
  add("small", {}, 500);
  return dir;
}

test("groups add up to the total and attribute to the direct dependency", async () => {
  const dir = fixture();
  try {
    const report = analyze(await scanProject(dir));
    const groups = buildGroups(report);
    assert.equal(sum(groups.map((g) => g.size)), report.totalSize);
    assert.equal(groups[0].name, "big");
    assert.deepEqual(groups[0].items.map((i) => i.name), ["big", "inner"]);

    const placed = layoutGroups(groups, { x: 0, y: 0, w: 800, h: 400 }, { maxGroups: 5, maxItems: 10 });
    assert.equal(placed.length, 2);
    assert.ok(placed[0].share > 0.9);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("card and html render escaped, self-contained output", async () => {
  const dir = fixture();
  try {
    const report = analyze(await scanProject(dir));
    report.project.name = "<evil>&app";

    const card = renderCardSvg(report);
    assert.match(card, /^<svg [^>]*width="1200" height="630"/);
    assert.match(card, /&lt;evil&gt;&amp;app is /);
    assert.ok(!card.includes("<evil>"));
    assert.match(card, /of it is big/);

    const html = renderHtml(report);
    assert.match(html, /<!doctype html>/);
    assert.match(html, /Download PNG/);
    assert.ok(!/https?:\/\//.test(html.replaceAll("http://www.w3.org/2000/svg", "")), "no external requests");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("renders without crashing for a project with no dependencies", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "pudgy-empty-"));
  try {
    writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "empty", version: "1.0.0" }));
    const report = analyze(await scanProject(dir));
    assert.equal(report.packageCount, 0);
    assert.match(renderCardSvg(report), /empty is 0 B/);
    assert.match(renderHtml(report), /<!doctype html>/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("merged 'smaller packages' blocks are dimmed", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "pudgy-merge-"));
  try {
    // One dependency that pulls in 40 packages, more than the card shows per group (30).
    const leaves = Array.from({ length: 40 }, (_, i) => `q${i}`);
    writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "many", dependencies: { hub: "1" } }));
    const add = (name, deps, bytes) => {
      const d = path.join(dir, "node_modules", name);
      mkdirSync(d, { recursive: true });
      writeFileSync(path.join(d, "package.json"), JSON.stringify({ name, version: "1.0.0", dependencies: deps }));
      writeFileSync(path.join(d, "b.bin"), Buffer.alloc(bytes));
    };
    add("hub", Object.fromEntries(leaves.map((l) => [l, "1"])), 5000);
    leaves.forEach((l, i) => add(l, {}, 100 + i * 10));

    const report = analyze(await scanProject(dir));
    const card = renderCardSvg(report);
    assert.match(card, /fill-opacity="0\.18"/);
    assert.match(card, /smaller packages/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("CLI --html and --card write files to --out", () => {
  const dir = fixture();
  const out = path.join(dir, "out");
  try {
    execFileSync("node", [path.resolve("dist/cli.js"), dir, "--html", "--card", "--out", out, "--no-color"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    assert.ok(existsSync(path.join(out, "pudgy.html")));
    assert.ok(existsSync(path.join(out, "pudgy-card.svg")));
    assert.match(readFileSync(path.join(out, "pudgy-card.svg"), "utf8"), /^<svg/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
