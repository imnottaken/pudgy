import type { Report } from "./analyze.js";
import { formatBytes } from "./format.js";
import { buildGroups, layoutGroups, type PlacedGroup, type Rect } from "./treemap.js";

const BG = "#0b0f17";
const PANEL = "#141b2b";
const INK = "#e6edf7";
const MUTED = "#8b98ad";
const FONT = "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";
const MONO = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Heat scale: the bigger a dependency's share, the hotter it looks. */
function heat(share: number): string {
  if (share >= 0.25) return "#ef4444";
  if (share >= 0.1) return "#f97316";
  if (share >= 0.04) return "#f59e0b";
  if (share >= 0.015) return "#14b8a6";
  return "#3b82f6";
}

function fit(text: string, widthPx: number, fontPx: number): string {
  const maxChars = Math.floor(widthPx / (fontPx * 0.6));
  if (maxChars < 3) return "";
  return text.length <= maxChars ? text : `${text.slice(0, maxChars - 1)}…`;
}

const num = (n: number): string => n.toFixed(1);
const pct = (share: number): string => (share >= 0.1 ? `${Math.round(share * 100)}%` : `${(share * 100).toFixed(1)}%`);

function treemapBody(groups: PlacedGroup[]): string {
  const parts: string[] = [];
  for (const g of groups) {
    const color = heat(g.share);
    const r = g.rect;
    const tip = `${g.name} — ${formatBytes(g.size)} (${pct(g.share)}) · ${g.count} package${g.count === 1 ? "" : "s"}`;
    parts.push(`<g><title>${esc(tip)}</title>`);
    parts.push(
      `<rect x="${num(r.x)}" y="${num(r.y)}" width="${num(r.w)}" height="${num(r.h)}" fill="${PANEL}" stroke="${BG}" stroke-width="2"/>`,
    );
    if (g.hasHeader) {
      const label = fit(`${g.name}  ${formatBytes(g.size)}`, r.w - 12, 11);
      if (label) {
        parts.push(
          `<text x="${num(r.x + 6)}" y="${num(r.y + 13)}" font-size="11" font-weight="600" fill="${color}">${esc(label)}</text>`,
        );
      }
    }
    const biggest = g.items[0]?.size ?? 1;
    for (const it of g.items) {
      const ir = it.rect;
      if (ir.w < 1 || ir.h < 1) continue;
      // Merged "N smaller packages" blocks stay dim so they never read as a culprit.
      const opacity = it.version === "" ? 0.18 : 0.35 + 0.55 * Math.sqrt(it.size / biggest);
      const itip = `${it.name}${it.version ? `@${it.version}` : ""} — ${formatBytes(it.size)}`;
      parts.push(
        `<rect x="${num(ir.x)}" y="${num(ir.y)}" width="${num(ir.w)}" height="${num(ir.h)}" fill="${color}" fill-opacity="${opacity.toFixed(2)}" stroke="${BG}" stroke-width="1"><title>${esc(itip)}</title></rect>`,
      );
      if (ir.w > 54 && ir.h > 16) {
        const label = fit(it.name, ir.w - 8, 10);
        if (label) {
          parts.push(
            `<text x="${num(ir.x + 4)}" y="${num(ir.y + 12)}" font-size="10" fill="${INK}" pointer-events="none">${esc(label)}</text>`,
          );
        }
      }
    }
    parts.push("</g>");
  }
  return parts.join("\n");
}

function shorten(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}

export function renderTreemapSvg(report: Report, width = 1200, height = 640): string {
  const groups = layoutGroups(buildGroups(report), { x: 0, y: 0, w: width, h: height }, { maxGroups: 40, maxItems: 80 });
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="100%" role="img" ` +
    `aria-label="Treemap of installed dependency sizes" font-family="${FONT}" style="display:block;background:${BG}">\n` +
    treemapBody(groups) +
    "\n</svg>"
  );
}

export interface CardOptions {
  /** Add a width/height-agnostic style so the card scales inside a page. */
  responsive?: boolean;
}

/** 1200×630 shareable image: headline, culprit and a mini treemap. */
export function renderCardSvg(report: Report, options: CardOptions = {}): string {
  const W = 1200;
  const H = 630;
  const groups = buildGroups(report);
  const top = groups[0];
  const total = report.totalSize;
  const name = esc(shorten(report.project.name, 30));

  const headline = `${name} is ${formatBytes(total)}`;
  let sub: string;
  if (top && total > 0 && top.size / total >= 0.15) {
    sub = `${pct(top.size / total)} of it is ${shorten(top.name, 28)}`;
  } else {
    sub = `spread across ${report.packageCount} packages`;
  }

  const placed = layoutGroups(groups, { x: 48, y: 212, w: W - 96, h: 360 }, { maxGroups: 10, maxItems: 30 });
  const style = options.responsive ? ' style="max-width:100%;height:auto;display:block"' : "";

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" id="card" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="${FONT}"${style}>`,
    `<rect width="${W}" height="${H}" fill="${BG}"/>`,
    `<text x="48" y="68" font-size="24" font-weight="700" fill="${INK}">pudgy</text>`,
    `<text x="124" y="68" font-size="18" fill="${MUTED}">what is your node_modules made of?</text>`,
    `<text x="48" y="136" font-size="56" font-weight="800" fill="${INK}">${headline}</text>`,
    `<text x="48" y="182" font-size="28" fill="${top && top.size / (total || 1) >= 0.15 ? heat(top.size / total) : MUTED}">${esc(sub)}</text>`,
    treemapBody(placed),
    `<text x="48" y="608" font-size="18" fill="${MUTED}" font-family="${MONO}">npx pudgy</text>`,
    `<text x="${W - 48}" y="608" font-size="16" fill="${MUTED}" text-anchor="end">${report.packageCount} packages</text>`,
    "</svg>",
  ].join("\n");
}

export function renderHtml(report: Report): string {
  const treemap = renderTreemapSvg(report);
  const card = renderCardSvg(report, { responsive: true });
  const rows = report.direct
    .slice(0, 12)
    .map(
      (d) =>
        `<tr><td>${esc(d.name)}${d.dev ? ' <span class="dev">dev</span>' : ""}</td>` +
        `<td class="n">${formatBytes(d.exclusive)}</td><td class="n">${formatBytes(d.retained)}</td>` +
        `<td class="n">${d.exclusivePackages}</td></tr>`,
    )
    .join("\n");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>pudgy — ${esc(report.project.name)}</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; background: ${BG}; color: ${INK}; font-family: ${FONT}; line-height: 1.5; }
  main { max-width: 1240px; margin: 0 auto; padding: 32px 20px 64px; }
  h1 { margin: 0; font-size: 28px; }
  h2 { margin: 40px 0 12px; font-size: 18px; }
  .muted { color: ${MUTED}; }
  .stats { margin: 4px 0 24px; }
  table { border-collapse: collapse; width: 100%; max-width: 640px; font-size: 14px; }
  th, td { text-align: left; padding: 6px 10px; border-bottom: 1px solid #1f2940; }
  th { color: ${MUTED}; font-weight: 500; }
  td.n, th.n { text-align: right; font-variant-numeric: tabular-nums; }
  .dev { color: ${MUTED}; font-size: 12px; }
  button { background: #3b82f6; color: white; border: 0; border-radius: 8px; padding: 10px 16px; font-size: 15px; font-weight: 600; cursor: pointer; }
  button:hover { background: #2563eb; }
  .card { margin-top: 12px; border-radius: 12px; overflow: hidden; border: 1px solid #1f2940; max-width: 1200px; }
</style>
</head>
<body>
<main>
  <h1>pudgy <span class="muted">— ${esc(report.project.name)}</span></h1>
  <p class="stats muted">${report.packageCount} packages · ${formatBytes(report.totalSize)} installed. Hover a block for details; block size is install size on disk.</p>
  ${treemap}

  <h2>Biggest wins</h2>
  <p class="muted">"Freed if removed" counts only what nothing else needs. "Total footprint" also includes packages shared with other dependencies.</p>
  <table>
    <thead><tr><th>Dependency</th><th class="n">Freed if removed</th><th class="n">Total footprint</th><th class="n">Packages freed</th></tr></thead>
    <tbody>
${rows}
    </tbody>
  </table>

  <h2>Share it</h2>
  <button id="dl" type="button">Download PNG</button>
  <div class="card">${card}</div>
</main>
<script>
  document.getElementById("dl").addEventListener("click", function () {
    var svg = document.getElementById("card");
    var xml = new XMLSerializer().serializeToString(svg);
    var img = new Image();
    img.onload = function () {
      var c = document.createElement("canvas");
      c.width = 2400;
      c.height = 1260;
      c.getContext("2d").drawImage(img, 0, 0, 2400, 1260);
      c.toBlob(function (blob) {
        var a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = "pudgy-card.png";
        a.click();
      }, "image/png");
    };
    img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(xml);
  });
</script>
</body>
</html>
`;
}

export type { Rect };
