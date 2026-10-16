---
name: npm-publish
description: Prepare an @alexify package for publishing with pnpm. Handles version bump, CHANGELOG update, typings check, quality gates, README and docs refresh, package.json audit, and pnpm pack verification. Use when the user asks to prepare a release, bump version, publish a package, or do release prep.
---

<!-- Adapted from metaskills v1.0.5 (skills/npm-publish) for the Alexis toolchain and release
     process: pnpm instead of npm, the prepublishOnly gates, Keep a Changelog headings as used in
     CHANGELOG.md, and `pnpm run release` for publishing. -->

# npm Publish Preparation

Systematic workflow for preparing the package for a new release. Every step must pass before proceeding to the next. The package manager is pnpm (pinned in `packageManager`); never use `npm` commands and never create `package-lock.json`.

## Step 0: Gather Release Intent

Ask the user (use AskUserQuestion if available):

1. **Version bump type**: patch / minor / major / explicit version / prerelease tag
2. **Prerelease label** (if any): e.g. `alpha`, `beta`, `rc`
3. **Confirm changelog entries**: ask if the `[Unreleased]` section in CHANGELOG is complete, or if the user wants to draft entries from recent commits

If the user already specified intent (e.g. "prepare 1.1.0 release"), skip the question and proceed.

## Step 1: Pre-flight Checks

Run:

```bash
pnpm install --frozen-lockfile   # install deps exactly as locked
pnpm run lint                    # oxlint
pnpm run format:check            # oxfmt
pnpm run test:coverage           # tests under the c8 coverage gate
pnpm run test:types              # tsd
pnpm run check:dts               # tsc over the d.ts of every entry of the exports map
```

These are the same gates `prepublishOnly` runs. CI adds three more; run them too:

```bash
pnpm size --max-gzip 8.5 --max-gzip-smtp 20 …                   # the budgets: copy the size step of ci.yml
pnpm docs:comparison && git diff --exit-code docs/guide/comparison.md   # the table matches docs/comparison.json
pnpm run docs:build                                              # the docs site; a dead link fails it
```

Then in parallel: `pnpm outdated` and `pnpm audit` (report to user; devDependencies only, the package has no runtime dependencies).

If any gate fails, stop and fix issues before continuing.

## Step 2: Version Bump

### Read current version from `package.json`

Compute the new version based on user intent and semver rules:

- **patch**: `1.2.3` → `1.2.4`
- **minor**: `1.2.3` → `1.3.0`
- **major**: `1.2.3` → `2.0.0`
- **prerelease**: `1.2.3` → `1.2.4-<label>.0`, or `1.2.4-beta.0` → `1.2.4-beta.1`
- **Removing prerelease tag**: `4.0.3-prerelease` → `4.0.3` (just strip the suffix)

Update `"version"` in `package.json` with the Edit tool, not `pnpm version`: the bump is a plain edit, and the commit, tag and changelog are handled by hand in the steps below. Bump `version` in `src/version.js` to the same value (the OpenTelemetry instrumentation scope reads it; `tests/unit/version.test.js` fails while the two differ).

## Step 3: Update CHANGELOG.md

The changelog follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/):

- **Sections**: `## [Unreleased]` at top; `## [X.Y.Z] - YYYY-MM-DD` for releases (date in ISO 8601)
- **Order**: newest first; every version gets an entry
- **Release body**: a short prose paragraph saying what the release is about, then subsections
- **Types of changes**: `Added`, `Changed`, `Deprecated`, `Removed`, `Fixed`, `Security`, plus `Tooling` and `Upgrading from X.Y` when they apply. Omit empty subsections
- **Entries**: bullets starting with a **bold lead-in**, then the explanation; human-readable and curated (no raw git diffs); call out breaking changes clearly
- **Links**: reference-style link block at the bottom: `[unreleased]: ...`, `[X.Y.Z]: ...`

### 3a: Detect changelog structure

Read the full `CHANGELOG.md`. Identify:

- The `[Unreleased]` section
- The previous release heading (to derive the comparison base)
- The links block at the bottom of the file
- The GitHub repo URL from `package.json` `repository`

Release tags are `vX.Y.Z`.

### 3b: Create the new version entry

**Always** draft entries from `git log` since the previous release tag:

```bash
git log $(git describe --tags --abbrev=0 2>/dev/null || echo "HEAD~20")..HEAD --oneline
```

For the first release of the package there is no tag yet: draft from the whole history (`git log --oneline`).

Commits follow Conventional Commits: map `feat` → Added, `fix` → Fixed, `refactor!`/`feat!`/`fix!` → call out as breaking, `ci`/`chore` → Tooling (only when user-visible). Merge with the existing `[Unreleased]` content; it is usually already written.

Turn `[Unreleased]` into the release and leave an empty `[Unreleased]` above it:

```markdown
## [Unreleased]

## [NEW_VERSION] - YYYY-MM-DD

What the release is about, in one short paragraph.

### Added

- **Feature name.** What it does and why it matters.
```

### 3c: Update comparison links

At the bottom of `CHANGELOG.md`, update the `[unreleased]` link and add the new version link:

```markdown
[unreleased]: https://github.com/OWNER/REPO/compare/vNEW_VERSION...HEAD
[NEW_VERSION]: https://github.com/OWNER/REPO/compare/vPREVIOUS_VERSION...vNEW_VERSION
```

For the first release there is no previous version of this package: link it to `https://github.com/OWNER/REPO/releases/tag/vNEW_VERSION`.

Keep all existing links intact.

## Step 4: TypeScript Declarations

The types are hand-written in `index.d.ts`:

1. `pnpm run check:dts` and `pnpm run test:types` must pass with no errors
2. `tests/unit/export-parity.test.js` compares the runtime exports of `index.js` with the declared value exports and imports every name from ESM; it must pass
3. Read `src/index.js` and `index.d.ts` and confirm every exported class, function, type and method is declared, and no private/internal fields leak into the declarations
4. If the release includes API changes, update `index.d.ts` and `tests/types/*.test-d.ts` accordingly

## Step 5: README, Docs & License Review

**Update the year** of the `Alexis Technologies` copyright line in `LICENSE` (e.g. `2026` → `2026-2027`).

Scan for staleness:

1. **README.md usage examples**: do they match the current API? Run them if in doubt; the documented outputs must be true
2. **Badges**: do the URLs point to `@alexify/<name>` and the `Alexis-Technologies` repository?
3. **docs/**: guide and API pages for anything the release changed; the nav version label is read from `package.json` automatically. `pnpm run docs:build` must pass (dead links fail it)
4. **docs/public/llms.txt**: key facts (exports, Node.js version, transports and providers)
5. **docs/comparison.json**: when a release adds a feature the comparison tracks, or a compared library changed, edit the data and run `pnpm docs:comparison`; never edit the generated table by hand
6. **SECURITY.md**: the supported-versions table on a major release, and the threat model when a transport, a provider or a security default changed

Only edit if something is factually wrong or outdated. Don't rewrite style or add unsolicited content.

## Step 6: Package Audit

### 6a: Verify `package.json` fields

Check these fields are correct:

- `"main"` / `"exports"` — point to existing files; `exports` lists `types` first; there is no `browser` field (the package is Node-only)
- `"types"` — points to `index.d.ts`
- `"files"` — the explicit allowlist includes everything that ships and nothing else (there is no `.npmignore`)
- `"engines"` — matches the CI matrix (`.github/workflows/ci.yml`)
- `"dependencies"` and `"peerDependencies"` — absent; the package has no runtime dependencies, and drivers (BullMQ, MongoDB) are passed in by the application (`tests/unit/dependencies.test.js` checks both)
- `"keywords"` — no typos, relevant terms
- `"license"`, `"repository"`, `"homepage"`, `"bugs"`, `"publishConfig"` (`access: public`) — valid

### 6b: Dry-run pack

```bash
pnpm pack --dry-run
pnpm run size
```

Review the file list:

- Source files (`src/`) and root entry points are included
- Type definitions are included
- Tests, docs, bench, scripts, configs and CI files are excluded
- No unexpected large files

Report the file count and the bundle size from `pnpm run size` to the user.

## Step 7: Final Verification

Run the gates one more time after all edits:

```bash
pnpm run lint && pnpm run format:check && pnpm run test:coverage && pnpm run test:types && pnpm run check:dts && pnpm size <the flags of ci.yml> && pnpm run docs:build
```

Must exit 0. If it fails, fix and re-run.

## Step 8: Summary & Next Steps

Present a summary to the user:

```
Release preparation complete:
  Package:  <name>
  Version:  <old> → <new>
  Tests:    ✓ passing (coverage gate met)
  Types:    ✓ valid
  Packed:   <N> files, <min+gzip size>
```

Then list remaining manual steps:

1. `git add -A && git commit -m "chore(release): vX.Y.Z"` (or ask the user if they want you to commit)
2. `git tag vX.Y.Z`
3. `git push && git push --tags`
4. `pnpm run release` (runs `pnpm publish`; `prepublishOnly` re-runs the gates). For prereleases: `pnpm publish --tag <label>`

Do NOT run `pnpm publish`, `pnpm run release` or `git push` automatically — always let the user do it or explicitly confirm.

## Step 9: Lockfile

Run `pnpm install` only if dependencies changed during the release; commit the updated `pnpm-lock.yaml` with the release. Never generate or commit `package-lock.json`.
