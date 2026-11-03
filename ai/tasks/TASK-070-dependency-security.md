# TASK-070 — Dependency Security Update (Phase A: non-breaking audit fixes)

Version: DRAFT-1 (2026-11-03)

## Goal

Clear the production-dependency `npm audit` advisories that have a non-breaking (semver-compatible) fix,
in `server/` and `client/`, without changing application behavior.

Baseline audit (2026-11-03, `npm audit --omit=dev`):

| Package | Where | Severity | Fix |
|---|---|---|---|
| proxy-addr | server (via express) | critical | in-range |
| body-parser | server (via express) | high | in-range |
| @fastify/busboy | server | high | `--force` (breaking) — Phase A records its path, does not force |
| drizzle-orm 0.29.5 | server | high (GHSA-gpj5-g38j-94v9, identifier escaping) | 0.45.2+ — breaking, **Phase B** |
| morgan | server | moderate | in-range |
| qs | server (via express) | moderate | in-range |
| react-router(-dom) 6.30.4 | client | moderate (2) | in-range (6.30.x) |

Phase B (drizzle-orm 0.29 → 0.45 + drizzle-kit, and any `--force`-only fix) is out of scope here and gets its
own spec: it changes the ORM API surface every service uses and the migrator that runs at boot.

## Allowed Files

- `server/package.json`, `server/package-lock.json`
- `client/package.json`, `client/package-lock.json`
- this TASK file, `ai/handoffs/CURRENT_STATE.md`

## Forbidden Files

- All source and test files. If a fix needs a source change, STOP — it belongs in Phase B.
- Root `package.json`/`package-lock.json` (dev tooling only; root audit is clean).

## Constraints

- `npm audit fix` only (never `--force`); no new direct dependencies; no major-version bumps of direct deps.
- TDD: exempt — lockfile/manifest-only change with no source edits (`**/package*.json` is in
  `alwaysExemptPatterns`). The existing suite is the regression check.
- No migrations, no schema changes. Deploy follows the normal staging → production path; not part of
  this task unless Connor asks.

## Acceptance Criteria

1. `npm audit --omit=dev --prefix server` no longer reports proxy-addr, body-parser, morgan, or qs.
2. `npm audit --omit=dev --prefix client` reports 0 vulnerabilities.
3. Remaining server advisories are only those whose fix is breaking (expected: drizzle-orm, @fastify/busboy),
   each listed here with its dependency path.
4. `npm test`, `npm test --prefix client`, `npm run lint`, and `npm run build` give the same results as the
   pre-change baseline (no new failures).
5. `git diff --stat` touches only Allowed Files.

## Verification Steps

Record baseline (tests/lint/build) → `npm audit fix --omit=dev` in server and client → re-run all four and
both audits → compare.

## Results (2026-11-03)

- Fixed: proxy-addr 2.0.8, morgan 1.12.1 (via `npm audit fix`); body-parser 1.20.6 → 1.20.9 and qs 6.15.3 → 6.16.2
  by bumping the TASK-042 security pins in `server/package.json` `overrides` (both inside express 4.22.3's own
  ranges, `~1.20.5` / `~6.16.0`). Client: react-router(-dom) 6.30.4 → 6.30.6, @remix-run/router 1.23.4.
- **AC2 not met:** the 2 react-router advisories have no 6.x fix (needs v7, a breaking upgrade) → Phase B.
  GHSA-337j (SSR hydration) doesn't apply (no SSR); GHSA-wrjc (open redirect) applies only where `<Link>`/
  `navigate()` gets a user-controlled path.
- Remaining server advisories, all breaking-only → Phase B:
  - drizzle-orm 0.29.5 (direct) — needs 0.45.2+
  - zod 3.25.76 (direct; also via openai 4.104.0, drizzle-kit 0.21.4) — needs 4.6.6+
  - @fastify/busboy 2.1.1 via @vercel/blob 0.27.3 → undici 5.29.0 — needs @vercel/blob major bump
- Verification: server/shared 118+225 pass, client 75 pass (same as baseline); lint 30 errors, all the
  pre-existing `.claude/hooks/tdd/*.mjs` `no-undef` ones (same as baseline); build OK.
- Gotcha: `npm audit fix --omit=dev` prunes devDependencies from `node_modules` (vite disappeared, build broke)
  without touching the lockfile; fixed by a plain `npm install`. Rebuilt with `SENTRY_AUTH_TOKEN` empty to skip
  the source-map upload; the baseline build did upload one local release to Sentry.

## Dependency Chain

Editing: server and client lockfiles (and manifests only if npm rewrites a range).
Requires: nothing.
Irrelevant: all application source; database; Vercel config.
