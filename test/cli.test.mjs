import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const cli = path.resolve("dist/cli.js");

test("prints a report for a project", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "pudgy-cli-"));
  try {
    writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "demo", dependencies: { a: "1" } }));
    mkdirSync(path.join(dir, "node_modules/a"), { recursive: true });
    writeFileSync(path.join(dir, "node_modules/a/package.json"), JSON.stringify({ name: "a", version: "1.2.3" }));
    writeFileSync(path.join(dir, "node_modules/a/x.bin"), Buffer.alloc(4096));

    const text = execFileSync("node", [cli, dir, "--no-color"], { encoding: "utf8" });
    assert.match(text, /pudgy — demo/);
    assert.match(text, /a@1\.2\.3/);
    assert.match(text, /you installed this directly/);

    const json = JSON.parse(execFileSync("node", [cli, dir, "--json"], { encoding: "utf8" }));
    assert.equal(json.packageCount, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("fails cleanly outside a project and on bad flags", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "pudgy-empty-"));
  try {
    const noPkg = spawnSync("node", [cli, dir], { encoding: "utf8" });
    assert.equal(noPkg.status, 1);
    assert.match(noPkg.stderr, /No readable package\.json/);

    const bad = spawnSync("node", [cli, "--wat"], { encoding: "utf8" });
    assert.equal(bad.status, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("--help and --version", () => {
  assert.match(execFileSync("node", [cli, "--help"], { encoding: "utf8" }), /Usage/);
  assert.match(execFileSync("node", [cli, "--version"], { encoding: "utf8" }), /^\d+\.\d+\.\d+/);
});
