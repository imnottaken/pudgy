# pudgy

See why your `node_modules` is so heavy, and exactly which dependency to blame.

```bash
npx pudgy
```

```text
pudgy — multigravity  574 packages · 728 MB

WHAT YOU'D SAVE BY REMOVING A DEPENDENCY
  electron dev          ██████                246 MB  34%  32 pkgs
  electron-builder dev  ██████                242 MB  33%  160 pkgs
  node-pty              ██                   62.5 MB   9%  2 pkgs
  lucide-react          █                    33.2 MB   5%  1 pkg

HEAVIEST INSTALLED PACKAGES
  electron@33.4.11                  243 MB  you installed this directly
  app-builder-bin@5.0.0-alpha.10    207 MB  via electron-builder → builder-util
  node-pty@1.1.0                   62.1 MB  you installed this directly

DUPLICATES  same package, several copies
  esbuild ×2  0.28.2, 0.21.5  (9.5 MB wasted)
  @types/node ×2  22.20.1, 20.19.43  (2.2 MB wasted)
```

## What it tells you

- **What you'd save.** For each dependency you installed, the space you'd actually free by removing it. Packages shared with another dependency don't count, since they'd stay.
- **Who to blame.** For every heavy package, the chain that pulled it in (`via react-datepicker → moment`).
- **Duplicates.** The same package installed as several copies, and the space they waste.

## Usage

```text
pudgy [dir] [options]

  --top <n>    rows per section (default 10)
  --prod       ignore devDependencies
  --json       print the full report as JSON
  --html       write pudgy.html: interactive treemap + shareable card
  --card       write pudgy-card.svg (1200x630 share image)
  --out <dir>  where --html and --card write (default: current directory)
  --open       open the HTML report when done (implies --html)
  --no-color   disable colors
```

## Treemap and share card

```bash
npx pudgy --html --open
```

Opens a page with a treemap of everything installed. Each block is a package, sized by disk usage and grouped by the dependency you installed that brought it in. Hotter colors mean a bigger share. The page also has a **Download PNG** button that exports the share card at 2400×1260, ready to post. The PNG is made in your browser, so pudgy needs no image library.

`--card` writes the same card as a standalone SVG.

Run your package manager's install first. pudgy reads `node_modules` as it is on disk and works with npm, yarn and pnpm layouts. It has no runtime dependencies.

## How sizes are measured

Sizes are bytes on disk for each package's own files, excluding its nested `node_modules`. They are install size, not bundle size, so they show what you carry in `node_modules`, Docker images and CI caches, not what ends up in a browser bundle.

## Library use

```js
import { scanProject, analyze } from "pudgy";

const report = analyze(await scanProject("."));
console.log(report.direct[0]);
```

## License

MIT
