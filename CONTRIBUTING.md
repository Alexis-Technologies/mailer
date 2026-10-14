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
- `tests/types/*.test-d.ts`: `tsd` assertions against `index.d.ts`.

`pnpm run test:coverage` enforces 98% lines and statements, 90% branches and 100% functions.

New behavior needs a test that fails without the change. For a bug fix, the test should describe
the bug, not the implementation.

## Before opening a PR

```bash
pnpm run lint
pnpm run format
pnpm run test:coverage
pnpm run test:types
pnpm run check:dts
pnpm size --max-gzip 4
```

`prepublishOnly` runs lint, format check, coverage, tsd and `check:dts`; CI adds the bundle-size
gate (4 KB min+gzip), the comparison drift check and the docs build. Treat that as the merge gate.
Coverage of `src/` is 100% with no `c8 ignore` comments: an unreachable branch is removed, not
ignored.

The comparison table in `docs/guide/comparison.md` is generated: edit `docs/comparison.json` and
run `pnpm docs:comparison`.

Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/)
(`feat(scope):`, `fix(scope):`, `test:`, `docs:`).
