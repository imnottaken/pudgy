export { scanProject } from "./scan.js";
export type { Scan, ScanOptions, Pkg, RootDep } from "./scan.js";
export { analyze } from "./analyze.js";
export type { Report, DirectRow, HeavyRow, DuplicateRow } from "./analyze.js";
export { formatReport, formatBytes } from "./format.js";
export { squarify, buildGroups, layoutGroups } from "./treemap.js";
export type { Rect, Group, PlacedGroup } from "./treemap.js";
export { renderHtml, renderCardSvg, renderTreemapSvg } from "./render.js";
