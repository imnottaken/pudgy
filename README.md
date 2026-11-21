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
- **Swap ideas.** Heavy packages that have a lighter or built-in replacement, such as `moment` → `dayjs` or `rimraf` → `fs.rm`, with an estimate of the space saved.

### About swap ideas

The suggestions come from a small hand-picked list in [`src/alternatives.ts`](src/alternatives.ts), not a guess. Each entry has to be smaller *after* counting the replacement's own install size, which is why popular swaps that actually install larger, like `lodash` → `es-toolkit`, are not in it. Savings are estimates. Each entry has a note about what you would lose by switching, shown in the HTML report and in `--json`. Suggestions for packages you did not install yourself show which dependency pulls them in, so you know where to look.

To propose an addition, open a pull request that adds an entry with the replacement's real unpacked size from the npm registry.

## Usage

```text
pudgy [dir] [options]

  --top <n>    rows per section (default 10)
  --prod       ignore devDependencies
  --json       print the full report as JSON
  --markdown   print a pull request comment
  --base <file>  a --json report to compare against (with --markdown)
  --html       write pudgy.html: interactive treemap + shareable card
  --card       write pudgy-card.svg (1200x630 share image)
  --out <dir>  where --html and --card write (default: current directory)
  --open       open the HTML report when done (implies --html)
  --no-color   disable colors
```

## GitHub Action

Comment on every pull request with how much it changes the weight of `node_modules`: the total, the dependencies it added or removed, and swap ideas. The comment is updated in place on every push, and also written to the job summary.

```yaml
name: pudgy
on: pull_request

permissions:
  contents: read
  pull-requests: write

jobs:
  weight:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npm ci --ignore-scripts
      - uses: imnottaken/pudgy@main
```

Install your dependencies before the action. To compare with the base branch it checks that commit out separately and installs it the same way (npm, pnpm or yarn, picked from your lockfile). If that install fails, you still get the report, just without the comparison.

| Input | Default | |
| --- | --- | --- |
| `working-directory` | `.` | Folder with the `package.json`, for monorepos |
| `production-only` | `false` | Ignore `devDependencies` |
| `install-command` | detected | Command used to install the base branch |
| `comment` | `true` | Set `false` to only write the job summary |

Pull requests from forks get a read-only token, so there the report only appears in the job summary.

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
