import type { Report } from "./analyze.js";

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }
  return `${value >= 100 ? value.toFixed(0) : value.toFixed(1)} ${units[i]}`;
}

interface Style {
  bold(s: string): string;
  dim(s: string): string;
  red(s: string): string;
  yellow(s: string): string;
  green(s: string): string;
  cyan(s: string): string;
}

function makeStyle(color: boolean): Style {
  const wrap = (open: number, close: number) => (s: string) =>
    color ? `\u001b[${open}m${s}\u001b[${close}m` : s;
  return {
    bold: wrap(1, 22),
    dim: wrap(2, 22),
    red: wrap(31, 39),
    yellow: wrap(33, 39),
    green: wrap(32, 39),
    cyan: wrap(36, 39),
  };
}

function bar(fraction: number, width = 18): string {
  const filled = Math.max(fraction > 0 ? 1 : 0, Math.round(fraction * width));
  return "█".repeat(filled) + " ".repeat(width - filled);
}

function pad(s: string, width: number): string {
  return s.length >= width ? s : s + " ".repeat(width - s.length);
}

function lpad(s: string, width: number): string {
  return s.length >= width ? s : " ".repeat(width - s.length) + s;
}

export interface FormatOptions {
  top: number;
  color: boolean;
}

export function formatReport(report: Report, options: FormatOptions): string {
  const c = makeStyle(options.color);
  const { top } = options;
  const out: string[] = [];
  const total = report.totalSize || 1;
  const pct = (n: number) => `${Math.round((n / total) * 100)}%`;

  out.push("");
  out.push(
    `${c.bold("pudgy")} ${c.dim("—")} ${report.project.name}  ` +
      c.dim(`${report.packageCount} packages · ${formatBytes(report.totalSize)}`),
  );

  if (report.direct.length > 0) {
    out.push("");
    out.push(c.bold("WHAT YOU'D SAVE BY REMOVING A DEPENDENCY"));
    const rows = report.direct.slice(0, top);
    const nameWidth = Math.max(...rows.map((r) => r.name.length + (r.dev ? 4 : 0)));
    for (const row of rows) {
      const label = row.dev ? `${row.name} ${c.dim("dev")}` : row.name;
      const visible = row.name.length + (row.dev ? 4 : 0);
      const share = row.exclusive / total;
      const paint = share > 0.2 ? c.red : share > 0.05 ? c.yellow : c.green;
      out.push(
        `  ${label}${" ".repeat(nameWidth - visible)}  ` +
          `${paint(bar(share))}  ${lpad(formatBytes(row.exclusive), 8)} ${lpad(pct(row.exclusive), 4)}` +
          c.dim(`  ${row.exclusivePackages} pkg${row.exclusivePackages === 1 ? "" : "s"}`),
      );
    }
  }

  out.push("");
  out.push(c.bold("HEAVIEST INSTALLED PACKAGES"));
  const heavy = report.heavy.slice(0, top);
  const heavyWidth = Math.max(0, ...heavy.map((r) => `${r.name}@${r.version}`.length));
  for (const row of heavy) {
    const label = `${row.name}@${row.version}`;
    const blame = row.direct
      ? c.dim("you installed this directly")
      : row.chain.length > 1
        ? c.dim("via ") + row.chain.slice(0, -1).join(c.dim(" → "))
        : c.dim("installed as a peer dependency");
    out.push(`  ${pad(label, heavyWidth)}  ${lpad(formatBytes(row.size), 8)}  ${blame}`);
  }

  if (report.duplicates.length > 0) {
    out.push("");
    out.push(c.bold("DUPLICATES") + c.dim("  same package, several copies"));
    for (const dup of report.duplicates.slice(0, top)) {
      const versions = dup.versions.map((v) => v.version).join(", ");
      out.push(
        `  ${c.yellow(dup.name)} ${c.dim(`×${dup.versions.length}`)}  ${versions}` +
          c.dim(`  (${formatBytes(dup.wasted)} wasted)`),
      );
    }
  }

  if (report.missing.length > 0) {
    out.push("");
    out.push(
      c.dim(`Not installed, skipped: ${report.missing.join(", ")}. Run your package manager's install first.`),
    );
  }

  out.push("");
  return out.join("\n");
}
