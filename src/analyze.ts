import type { Scan } from "./scan.js";

export interface DirectRow {
  name: string;
  version: string;
  dev: boolean;
  /** Everything reachable from this dependency (shared packages included). */
  retained: number;
  /** What you would actually free by removing it. */
  exclusive: number;
  /** Number of packages that would disappear with it. */
  exclusivePackages: number;
}

export interface HeavyRow {
  name: string;
  version: string;
  size: number;
  /** True when the project lists this package itself. */
  direct: boolean;
  /** Shortest chain from a direct dependency, e.g. ["react-datepicker", "moment"]. */
  chain: string[];
}

export interface DuplicateRow {
  name: string;
  versions: Array<{ version: string; size: number; chain: string[] }>;
  /** Bytes that would be freed by keeping only the largest copy. */
  wasted: number;
}

export interface Report {
  project: { name: string; version: string };
  totalSize: number;
  packageCount: number;
  direct: DirectRow[];
  heavy: HeavyRow[];
  duplicates: DuplicateRow[];
  missing: string[];
}

export function analyze(scan: Scan): Report {
  const { pkgs, roots } = scan;
  const rootIds = new Set(roots.map((r) => r.id));

  // Which direct dependencies reach each package, plus one shortest path.
  const owners = new Map<string, Set<string>>();
  const reach = new Map<string, Set<string>>();
  for (const root of roots) {
    const visited = new Set<string>([root.id]);
    const queue = [root.id];
    while (queue.length > 0) {
      const id = queue.pop() as string;
      const set = owners.get(id) ?? new Set<string>();
      set.add(root.id);
      owners.set(id, set);
      for (const dep of pkgs.get(id)?.deps ?? []) {
        if (!visited.has(dep)) {
          visited.add(dep);
          queue.push(dep);
        }
      }
    }
    reach.set(root.id, visited);
  }

  // Multi-source BFS gives each package a shortest chain from the project.
  const parentOf = new Map<string, string | null>();
  const queue: string[] = [];
  for (const root of roots) {
    parentOf.set(root.id, null);
    queue.push(root.id);
  }
  for (let i = 0; i < queue.length; i++) {
    const id = queue[i] as string;
    for (const dep of pkgs.get(id)?.deps ?? []) {
      if (!parentOf.has(dep)) {
        parentOf.set(dep, id);
        queue.push(dep);
      }
    }
  }
  const chainTo = (id: string): string[] => {
    const chain: string[] = [];
    let cur: string | null | undefined = id;
    while (cur) {
      chain.push(pkgs.get(cur)?.name ?? cur);
      cur = parentOf.get(cur);
    }
    return chain.reverse();
  };

  let totalSize = 0;
  for (const pkg of pkgs.values()) totalSize += pkg.size;

  const direct: DirectRow[] = roots.map((root) => {
    let retained = 0;
    let exclusive = 0;
    let exclusivePackages = 0;
    for (const id of reach.get(root.id) ?? []) {
      const size = pkgs.get(id)?.size ?? 0;
      retained += size;
      const who = owners.get(id);
      if (who && who.size === 1) {
        exclusive += size;
        exclusivePackages++;
      }
    }
    return {
      name: root.name,
      version: pkgs.get(root.id)?.version ?? "?",
      dev: root.dev,
      retained,
      exclusive,
      exclusivePackages,
    };
  });
  direct.sort((a, b) => b.exclusive - a.exclusive || b.retained - a.retained);

  const heavy: HeavyRow[] = [...pkgs.values()]
    .map((pkg) => ({
      name: pkg.name,
      version: pkg.version,
      size: pkg.size,
      direct: rootIds.has(pkg.id),
      chain: chainTo(pkg.id),
    }))
    .sort((a, b) => b.size - a.size);

  const byName = new Map<string, typeof heavy>();
  for (const row of heavy) {
    const list = byName.get(row.name) ?? [];
    list.push(row);
    byName.set(row.name, list);
  }
  const duplicates: DuplicateRow[] = [];
  for (const [name, rows] of byName) {
    if (rows.length < 2) continue;
    const sizes = rows.map((r) => r.size);
    const wasted = sizes.reduce((a, b) => a + b, 0) - Math.max(...sizes);
    duplicates.push({
      name,
      versions: rows.map((r) => ({ version: r.version, size: r.size, chain: r.chain })),
      wasted,
    });
  }
  duplicates.sort((a, b) => b.wasted - a.wasted);

  return {
    project: { name: scan.project.name, version: scan.project.version },
    totalSize,
    packageCount: pkgs.size,
    direct,
    heavy,
    duplicates,
    missing: scan.missing,
  };
}
