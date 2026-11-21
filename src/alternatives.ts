/**
 * Curated swap ideas: packages that have a lighter or built-in replacement.
 *
 * Rules for adding an entry:
 *  - The replacement must be smaller in *install* size, counting its own
 *    dependencies. Prefer zero-dependency packages or things built into Node.
 *    (Example of what NOT to add: lodash -> es-toolkit, which installs larger.)
 *  - `altSize` is the replacement's unpacked size in bytes, from the npm
 *    registry on 2026-11-21. Built-ins are 0.
 *  - Keep `note` honest about what you lose by switching.
 */
export type SwapKind = "similar-api" | "built-in" | "different-api";

export interface Alternative {
  /** What to use instead, in full (shown on the HTML page). */
  alt: string;
  /** Compact name for one-line displays like the terminal. */
  short: string;
  kind: SwapKind;
  /** Install size of the replacement in bytes (0 when built in). */
  altSize: number;
  note: string;
}

export const ALTERNATIVES: ReadonlyMap<string, Alternative> = new Map<string, Alternative>([
  [
    "moment",
    {
      alt: "dayjs",
      short: "dayjs",
      kind: "similar-api",
      altSize: 681_693,
      note: "Very similar API. Check timezone and locale usage, which need dayjs plugins.",
    },
  ],
  [
    "chalk",
    {
      alt: "picocolors",
      short: "picocolors",
      kind: "similar-api",
      altSize: 6_373,
      note: "Colors only. No chained styles like chalk.bold.red, so nest calls instead.",
    },
  ],
  [
    "request",
    {
      alt: "fetch",
      short: "fetch",
      kind: "built-in",
      altSize: 0,
      note: "request is deprecated. fetch is built into Node 18+.",
    },
  ],
  [
    "request-promise",
    {
      alt: "fetch",
      short: "fetch",
      kind: "built-in",
      altSize: 0,
      note: "Deprecated along with request. fetch is built into Node 18+.",
    },
  ],
  [
    "node-fetch",
    {
      alt: "fetch",
      short: "fetch",
      kind: "built-in",
      altSize: 0,
      note: "Global fetch is built into Node 18+ and is nearly identical.",
    },
  ],
  [
    "got",
    {
      alt: "fetch",
      short: "fetch",
      kind: "different-api",
      altSize: 0,
      note: "Fine if you make simple requests. You would lose got's retries, hooks and pagination.",
    },
  ],
  [
    "superagent",
    {
      alt: "fetch",
      short: "fetch",
      kind: "different-api",
      altSize: 0,
      note: "Fine for simple requests. You would lose its chainable API and plugins.",
    },
  ],
  [
    "uuid",
    {
      alt: "crypto.randomUUID()",
      short: "crypto.randomUUID()",
      kind: "built-in",
      altSize: 0,
      note: "Covers v4 UUIDs only. Keep uuid if you need v1, v5 or v7.",
    },
  ],
  [
    "rimraf",
    {
      alt: "fs.rm(path, { recursive: true, force: true })",
      short: "fs.rm",
      kind: "built-in",
      altSize: 0,
      note: "Built into Node 14.14+.",
    },
  ],
  [
    "mkdirp",
    {
      alt: "fs.mkdir(path, { recursive: true })",
      short: "fs.mkdir",
      kind: "built-in",
      altSize: 0,
      note: "Built into Node 10.12+.",
    },
  ],
  [
    "bluebird",
    {
      alt: "native Promise",
      short: "native Promise",
      kind: "different-api",
      altSize: 0,
      note: "Native promises and async/await cover most uses. Bluebird-only helpers need rewriting.",
    },
  ],
  [
    "minimist",
    {
      alt: "util.parseArgs",
      short: "util.parseArgs",
      kind: "built-in",
      altSize: 0,
      note: "Built into Node 18.3+. The options are declared up front, so it is slightly stricter.",
    },
  ],
  [
    "fs-extra",
    {
      alt: "node:fs/promises",
      short: "node:fs/promises",
      kind: "different-api",
      altSize: 0,
      note: "fs.cp, fs.rm and recursive mkdir cover most uses. Helpers like readJson need small rewrites.",
    },
  ],
  [
    "dotenv",
    {
      alt: "node --env-file / process.loadEnvFile()",
      short: "--env-file",
      kind: "built-in",
      altSize: 0,
      note: "Built into Node 20.6+ (--env-file) and 21.7+ (loadEnvFile). No variable expansion.",
    },
  ],
]);
