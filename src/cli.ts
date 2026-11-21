#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { analyze } from "./analyze.js";
import { formatReport } from "./format.js";
import { renderCardSvg, renderHtml } from "./render.js";
import { scanProject } from "./scan.js";

const HELP = `pudgy — see why your node_modules is so heavy, and who to blame

Usage
  pudgy [dir] [options]

Options
  --top <n>    rows per section (default 10)
  --prod       ignore devDependencies
  --json       print the full report as JSON
  --html       write pudgy.html: interactive treemap + shareable card
  --card       write pudgy-card.svg (1200x630 share image)
  --out <dir>  where --html and --card write (default: current directory)
  --open       open the HTML report when done (implies --html)
  --no-color   disable colors
  -v, --version
  -h, --help
`;

function version(): string {
  const url = new URL("../package.json", import.meta.url);
  return (JSON.parse(readFileSync(url, "utf8")) as { version: string }).version;
}

function openFile(file: string): void {
  const [cmd, args]: [string, string[]] =
    process.platform === "darwin"
      ? ["open", [file]]
      : process.platform === "win32"
        ? ["cmd", ["/c", "start", "", file]]
        : ["xdg-open", [file]];
  const child = spawn(cmd, args, { stdio: "ignore", detached: true });
  child.on("error", () => process.stderr.write(`Could not open a browser. Open ${file} manually.\n`));
  child.unref();
}

async function main(argv: string[]): Promise<number> {
  let dir = ".";
  let top = 10;
  let prod = false;
  let json = false;
  let html = false;
  let card = false;
  let open = false;
  let outDir = ".";
  let color = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] as string;
    if (arg === "-h" || arg === "--help") {
      process.stdout.write(HELP);
      return 0;
    } else if (arg === "-v" || arg === "--version") {
      process.stdout.write(`${version()}\n`);
      return 0;
    } else if (arg === "--prod") {
      prod = true;
    } else if (arg === "--json") {
      json = true;
    } else if (arg === "--html") {
      html = true;
    } else if (arg === "--card") {
      card = true;
    } else if (arg === "--open") {
      open = true;
      html = true;
    } else if (arg === "--out") {
      const value = argv[++i];
      if (!value || value.startsWith("-")) {
        process.stderr.write("--out needs a directory\n");
        return 2;
      }
      outDir = value;
    } else if (arg === "--no-color") {
      color = false;
    } else if (arg === "--top") {
      const n = Number(argv[++i]);
      if (!Number.isInteger(n) || n < 1) {
        process.stderr.write("--top needs a positive integer\n");
        return 2;
      }
      top = n;
    } else if (arg.startsWith("-")) {
      process.stderr.write(`Unknown option: ${arg}\n\n${HELP}`);
      return 2;
    } else {
      dir = arg;
    }
  }

  try {
    const report = analyze(await scanProject(dir, { prod }));
    process.stdout.write(json ? `${JSON.stringify(report, null, 2)}\n` : formatReport(report, { top, color }));

    if (html || card) mkdirSync(outDir, { recursive: true });
    let htmlPath: string | undefined;
    if (html) {
      htmlPath = path.resolve(outDir, "pudgy.html");
      writeFileSync(htmlPath, renderHtml(report));
      process.stderr.write(`Wrote ${htmlPath}\n`);
    }
    if (card) {
      const cardPath = path.resolve(outDir, "pudgy-card.svg");
      writeFileSync(cardPath, renderCardSvg(report));
      process.stderr.write(`Wrote ${cardPath}\n`);
    }
    if (open && htmlPath) openFile(htmlPath);
    return 0;
  } catch (err) {
    process.stderr.write(`pudgy: ${(err as Error).message}\n`);
    return 1;
  }
}

process.exitCode = await main(process.argv.slice(2));
