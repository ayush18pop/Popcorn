# Popcorn developer site

The site described in [`docs/ui-handoff.md`](../../docs/ui-handoff.md): the module catalog, a page per module, the
example player, a read-only explorer, the Claude skills and MCP pages, and the docs.

```sh
npm ci
npm run dev        # http://localhost:5173
npm run build      # static bundle in dist/
```

Run `bash contracts/core/build.sh` first if you want the explorer to compare a rule contract's code with the pinned Core
build; without it the explorer decodes the arguments and says it did not compare.

## Where the content comes from

| On the site | Source |
|---|---|
| Blocks and block pages | `docs/catalog/<shape>/<block>.md` (shape: checks, joins, actions, payers, ready-made) |
| The player | `examples/<corner>/<module>/run.json` (`recorded: false` files are labelled "sample run") |
| Rule glossary, admission check names | `packages/simulator/src/rules.ts`, imported as is |
| Explorer endpoints and budgets | `packages/sdk/src/transport.ts`, imported as is |
| Docs | `packages/sdk/README.md`, `contracts/core/LAYOUT.md`, `devnet/README.md`, `journal/DECISIONS.md` |

## Layout

| Path | What |
|---|---|
| `src/pages` | One file per route (hash routes: `#/blocks/pause-the-target`) |
| `src/player` | The example player: beats, stages, transaction and world views, raw step |
| `src/components` | Navigation, command menu (⌘K), cards, scenes, motion helpers |
| `src/components/effects` | Canvas effects (peel, decrypt) that fall back to plain HTML where the browser lacks support |
| `src/lib` | Catalog and run loaders, routing, theme |

Keyboard in the player: space plays, ← → step, 1 to 5 jump to a stage, F flips to the failing case.
