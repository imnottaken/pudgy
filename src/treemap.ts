import type { Report } from "./analyze.js";

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Squarified treemap (Bruls, Huizing, van Wijk). `values` must be positive and
 * sorted descending; the returned rects are in the same order and tile `rect`.
 */
export function squarify(values: number[], rect: Rect): Rect[] {
  const total = values.reduce((a, b) => a + b, 0);
  if (values.length === 0 || total <= 0 || rect.w <= 0 || rect.h <= 0) {
    return values.map(() => ({ x: rect.x, y: rect.y, w: 0, h: 0 }));
  }
  const scale = (rect.w * rect.h) / total;
  const areas = values.map((v) => v * scale);

  const out: Rect[] = [];
  let { x, y, w, h } = rect;
  let row: number[] = [];

  const worst = (r: number[], side: number): number => {
    const s = r.reduce((a, b) => a + b, 0);
    const max = Math.max(...r);
    const min = Math.min(...r);
    return Math.max((side * side * max) / (s * s), (s * s) / (side * side * min));
  };

  const flush = () => {
    const s = row.reduce((a, b) => a + b, 0);
    if (w >= h) {
      // Lay the row out as a column on the left.
      const colW = s / h;
      let cy = y;
      for (const a of row) {
        const rh = a / colW;
        out.push({ x, y: cy, w: colW, h: rh });
        cy += rh;
      }
      x += colW;
      w -= colW;
    } else {
      const rowH = s / w;
      let cx = x;
      for (const a of row) {
        const rw = a / rowH;
        out.push({ x: cx, y, w: rw, h: rowH });
        cx += rw;
      }
      y += rowH;
      h -= rowH;
    }
    row = [];
  };

  for (const a of areas) {
    const side = Math.min(w, h);
    if (row.length === 0 || worst([...row, a], side) <= worst(row, side)) {
      row.push(a);
    } else {
      flush();
      row.push(a);
    }
  }
  if (row.length > 0) flush();
  return out;
}

export interface Item {
  name: string;
  version: string;
  size: number;
}

/** A direct dependency together with everything it brought in. */
export interface Group {
  name: string;
  size: number;
  items: Item[];
}

/**
 * Attribute every installed package to the direct dependency at the start of
 * its shortest chain, so group sizes add up to the total install size.
 */
export function buildGroups(report: Report): Group[] {
  const map = new Map<string, Group>();
  for (const row of report.heavy) {
    if (row.size <= 0) continue;
    const key = row.chain[0] ?? row.name;
    let group = map.get(key);
    if (!group) {
      group = { name: key, size: 0, items: [] };
      map.set(key, group);
    }
    group.size += row.size;
    group.items.push({ name: row.name, version: row.version, size: row.size });
  }
  return [...map.values()].sort((a, b) => b.size - a.size);
}

export interface PlacedItem extends Item {
  rect: Rect;
}

export interface PlacedGroup {
  name: string;
  size: number;
  share: number;
  count: number;
  rect: Rect;
  hasHeader: boolean;
  items: PlacedItem[];
}

export interface LayoutOptions {
  /** Groups beyond this are merged into one "other" block. */
  maxGroups: number;
  /** Packages per group beyond this are merged into one "smaller" block. */
  maxItems: number;
}

const HEADER_H = 18;
const GAP = 2;

export function layoutGroups(groups: Group[], rect: Rect, options: LayoutOptions): PlacedGroup[] {
  const total = groups.reduce((a, g) => a + g.size, 0);
  if (total <= 0) return [];

  let list = groups;
  if (groups.length > options.maxGroups) {
    const head = groups.slice(0, options.maxGroups - 1);
    const tail = groups.slice(options.maxGroups - 1);
    const items = tail.flatMap((g) => g.items).sort((a, b) => b.size - a.size);
    head.push({
      name: `${tail.length} other dependencies`,
      size: tail.reduce((a, g) => a + g.size, 0),
      items,
    });
    list = head;
  }

  const rects = squarify(
    list.map((g) => g.size),
    rect,
  );

  return list.map((group, i) => {
    const r = rects[i] as Rect;
    const hasHeader = r.w >= 70 && r.h >= 38;
    const top = hasHeader ? HEADER_H : GAP;
    const inner: Rect = {
      x: r.x + GAP,
      y: r.y + top,
      w: Math.max(0, r.w - GAP * 2),
      h: Math.max(0, r.h - top - GAP),
    };

    let items = group.items;
    if (items.length > options.maxItems) {
      const rest = items.slice(options.maxItems - 1);
      items = [
        ...items.slice(0, options.maxItems - 1),
        { name: `${rest.length} smaller packages`, version: "", size: rest.reduce((a, b) => a + b.size, 0) },
      ];
    }
    const itemRects = squarify(
      items.map((it) => it.size),
      inner,
    );

    return {
      name: group.name,
      size: group.size,
      share: group.size / total,
      count: group.items.length,
      rect: r,
      hasHeader,
      items: items.map((it, j) => ({ ...it, rect: itemRects[j] as Rect })),
    };
  });
}
