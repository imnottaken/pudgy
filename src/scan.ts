import { promises as fs } from "node:fs";
import path from "node:path";

export interface Pkg {
  /** Real (symlink-resolved) directory, unique per installed copy. */
  id: string;
  name: string;
  version: string;
  /** Bytes on disk, excluding nested node_modules. */
  size: number;
  /** ids of installed packages this one depends on (dependencies + optionalDependencies). */
  deps: string[];
  /**
   * ids of installed peer dependencies. The host project provides these, so
   * they are not counted as something this package "owns" or pulls in.
   */
  peers: string[];
}

export interface RootDep {
  name: string;
  id: string;
  dev: boolean;
}

export interface Scan {
  project: { name: string; version: string; dir: string };
  roots: RootDep[];
  pkgs: Map<string, Pkg>;
  /** Declared in package.json but not found in node_modules. */
  missing: string[];
}

export interface ScanOptions {
  /** Ignore devDependencies. */
  prod?: boolean;
}

interface PackageJson {
  name?: string;
  version?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

// Keep file descriptors bounded on huge trees.
const MAX_CONCURRENT_IO = 64;
let active = 0;
const waiting: Array<() => void> = [];

async function io<T>(fn: () => Promise<T>): Promise<T> {
  if (active >= MAX_CONCURRENT_IO) {
    await new Promise<void>((resolve) => waiting.push(resolve));
  }
  active++;
  try {
    return await fn();
  } finally {
    active--;
    waiting.shift()?.();
  }
}

async function readJson(file: string): Promise<PackageJson | null> {
  try {
    return JSON.parse(await io(() => fs.readFile(file, "utf8"))) as PackageJson;
  } catch {
    return null;
  }
}

async function dirSize(dir: string): Promise<number> {
  let entries;
  try {
    entries = await io(() => fs.readdir(dir, { withFileTypes: true }));
  } catch {
    return 0;
  }
  const sizes = await Promise.all(
    entries.map(async (entry) => {
      if (entry.isSymbolicLink()) return 0;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        return entry.name === "node_modules" ? 0 : dirSize(full);
      }
      if (entry.isFile()) {
        try {
          return (await io(() => fs.lstat(full))).size;
        } catch {
          return 0;
        }
      }
      return 0;
    }),
  );
  return sizes.reduce((a, b) => a + b, 0);
}

/**
 * Node-style resolution: walk up from `fromDir` looking for node_modules/<dep>.
 * Also checks siblings when `fromDir` sits inside a node_modules folder, which
 * is how pnpm's virtual store lays out dependencies.
 */
async function resolveDep(dep: string, fromDir: string): Promise<string | null> {
  let dir = fromDir;
  for (;;) {
    const candidates = [path.join(dir, "node_modules", dep)];
    if (path.basename(dir) === "node_modules") candidates.push(path.join(dir, dep));
    for (const candidate of candidates) {
      try {
        await io(() => fs.access(path.join(candidate, "package.json")));
        return await io(() => fs.realpath(candidate));
      } catch {
        /* keep looking */
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export async function scanProject(dir: string, options: ScanOptions = {}): Promise<Scan> {
  const projectDir = path.resolve(dir);
  const manifest = await readJson(path.join(projectDir, "package.json"));
  if (!manifest) {
    throw new Error(`No readable package.json in ${projectDir}`);
  }

  const pkgs = new Map<string, Pkg>();
  const seen = new Set<string>();

  async function load(realDir: string): Promise<void> {
    if (seen.has(realDir)) return;
    seen.add(realDir);

    const pj = (await readJson(path.join(realDir, "package.json"))) ?? {};
    const pkg: Pkg = {
      id: realDir,
      name: pj.name ?? path.basename(realDir),
      version: pj.version ?? "0.0.0",
      size: 0,
      deps: [],
      peers: [],
    };
    pkgs.set(realDir, pkg);

    const depNames = new Set([
      ...Object.keys(pj.dependencies ?? {}),
      ...Object.keys(pj.optionalDependencies ?? {}),
    ]);
    const peerNames = Object.keys(pj.peerDependencies ?? {}).filter((n) => !depNames.has(n));

    const resolveAll = async (names: Iterable<string>): Promise<string[]> => {
      const found = await Promise.all([...names].map((n) => resolveDep(n, realDir)));
      return [...new Set(found.filter((r): r is string => r !== null && r !== realDir))];
    };

    const [size, deps, peers] = await Promise.all([dirSize(realDir), resolveAll(depNames), resolveAll(peerNames)]);
    pkg.size = size;
    pkg.deps = deps;
    pkg.peers = peers;
    // Peers are still loaded so installed-but-unowned packages are not missed.
    await Promise.all([...deps, ...peers].map(load));
  }

  const declared = new Map<string, boolean>(); // name -> isDev
  for (const name of Object.keys(manifest.dependencies ?? {})) declared.set(name, false);
  for (const name of Object.keys(manifest.optionalDependencies ?? {})) declared.set(name, false);
  if (!options.prod) {
    for (const name of Object.keys(manifest.devDependencies ?? {})) {
      if (!declared.has(name)) declared.set(name, true);
    }
  }

  const roots: RootDep[] = [];
  const missing: string[] = [];
  await Promise.all(
    [...declared].map(async ([name, dev]) => {
      const id = await resolveDep(name, projectDir);
      if (id === null) {
        missing.push(name);
        return;
      }
      roots.push({ name, id, dev });
      await load(id);
    }),
  );

  roots.sort((a, b) => a.name.localeCompare(b.name));
  missing.sort();

  return {
    project: {
      name: manifest.name ?? path.basename(projectDir),
      version: manifest.version ?? "0.0.0",
      dir: projectDir,
    },
    roots,
    pkgs,
    missing,
  };
}
