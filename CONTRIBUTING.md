# Contributing

Thanks for helping improve mailer. This page covers the rules that are easy to break by accident;
[CLAUDE.md](CLAUDE.md) describes how the codebase fits together.

## Getting set up

```bash
pnpm install
pnpm test
```

There is no build step. What you edit in `src/` is what ships.

## The rules that are not negotiable

**1. No runtime dependencies.** `package.json` has no `dependencies` or `peerDependencies` key, and
it stays that way. When a small helper is needed, copy it into `src/` with an attribution comment.
devDependencies are fine.

**2. Plain CommonJS.** `require`/`module.exports`, no `import`/`export`, no TypeScript syntax, no
`'use strict'`. Built-in modules use the `node:` prefix, and relative requires include `.js`.

**3. Drivers are passed in, never required.** The transports are built on `node:*` modules and the
global `fetch`. A driver of the infrastructure (BullMQ, the MongoDB driver) is created by the
application and passed to the adapter as an argument. `tests/unit/dependencies.test.js` fails if
anything under `src/` requires a module that is neither a `node:` builtin nor a relative `.js`
file.

**4. A public API change touches three files together:** `src/index.js`, `index.d.ts` and a test
(plus a `tests/types` assertion for anything new). `tests/unit/export-parity.test.js` fails when
the runtime exports and the declarations drift apart.

## Tests

Node's built-in `node:test`, no external framework.

- `tests/unit/*.test.js`: one file per area. Run one with `node --test tests/unit/mailer.test.js`.
- `tests/runtime/*.test.js`: the package by its name, with no mock (sockets, TLS, `fetch`, a child
  process), on Node, Bun (`pnpm test:bun`) and Deno (`pnpm test:deno`).
- `tests/types/*.test-d.ts`: `tsd` assertions, one file per entry of the exports map.

`pnpm run test:coverage` enforces 98% lines and statements, 90% branches and 100% functions.

New behavior needs a test that fails without the change. For a bug fix, the test should describe
the bug, not the implementation.

## Before opening a PR

```bash
pnpm run lint
pnpm run format:check
pnpm run test:coverage
pnpm run test:runtime
pnpm run test:types
pnpm run check:dts
pnpm size --check
pnpm run check:pack
```

These are the gates of `prepublishOnly`, in its order (`tests/unit/scripts.test.js` keeps the two
lists equal); `pnpm run format` fixes what `format:check` finds. `pnpm size --check` holds every
entry of the exports map to its min+gzip budget in `scripts/size-budgets.json`, so a new subpath
needs one; `check:pack` holds the tarball to the exports map and the `files` allowlist. CI adds
the comparison drift check, the docs build, and the unit and runtime suites on Bun and Deno.
Treat that as the merge gate.

The comparison table in `docs/guide/comparison.md` is generated: edit `docs/comparison.json` and
run `pnpm docs:comparison`.

Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/)
(`feat(scope):`, `fix(scope):`, `test:`, `docs:`).
