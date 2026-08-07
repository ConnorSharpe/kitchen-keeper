# Conventions

Durable, cross-session conventions for this repo. Unlike `CURRENT_STATE.md` (rewritten each session as
a handoff), this file accumulates and should be updated in place when a convention changes.

## Environments (as of TASK-039, DB split 2026-07-30)

| Environment | Git branch | Neon branch | Clerk instance | URL |
|---|---|---|---|---|
| Production | `main` | `main` (Neon default/production branch) | Production (`pk_live_...`) | `kitchenkeeper.kitchen` |
| Staging (Vercel Preview) | `staging` | `staging` | Development (`pk_test_d2lubmluZy1zd2lmdC03NC5jbGVyay5hY2NvdW50cy5kZXYk`) | `kitchen-keeper-git-staging-connorsharpes-projects.vercel.app` |
| Local dev | (working tree) | `local` | Development (same as staging) | `localhost` |

Each of `staging` and `local` is a single, static, long-lived Neon branch (forked from `main` on
2026-07-30) — not a branch created per PR/deployment (that's Neon's "branch per Vercel Preview"
feature, deliberately not enabled; see `ai/tasks/TASK-039-spec.md` Out of Scope). All three branches
are fully independent: local dev can no longer read or write staging's or production's data.

## Push workflow

`staging` is the default day-to-day working branch — ordinary commits/pushes go there, which deploys to
the isolated Preview environment above. `main` is release-only: promote to Production by merging
`staging` → `main` (fast-forward preferred) only when ready to ship. There is no GitHub-enforced guard
against an accidental direct push to `main` (private repo, free plan — branch protection needs GitHub
Pro or a public repo); this relies on checking `git branch --show-current` before pushing.

## Canonical migration order

`staging` and `local` are point-in-time forks of production — neither automatically picks up new
Drizzle migrations applied to production or to each other. Every schema change follows this order, so
there's one sequence instead of everyone inventing their own:

1. Apply the new migration to the `local` Neon branch first (runs automatically on `npm run dev` via
   `server/db/migrate.js`) and iterate there.
2. Apply the same migration to the `staging` Neon branch, then push/test the corresponding code on the
   `staging` git branch against it — this is what actually exercises the new schema in a Preview
   deployment before it's live.
3. Once verified, apply the same migration to production.
4. Merge `staging` → `main`, which deploys the verified code to Production against the now-migrated
   production database.

Between step 3 and step 4 completing, production briefly runs the *previous* application version against
the *new* schema. Prefer an expand/contract pattern for destructive changes (add → backfill → remove,
across separate migrations) rather than a single migration that drops/renames a column, so that window
doesn't break the still-running old code.

## Staging / local branch runbook

- **Mis-pointed env var** (Preview accidentally pointing at the wrong database): revert the affected
  `vercel env` value back to Production's current value — a normal edit, not a rebuild.
- **`staging` or `local` branch itself is bad** (e.g. a migration went wrong on it): re-fork it fresh
  from current production rather than hand-reversing schema changes. Both branches are disposable and
  cheaply re-creatable, not precious. Re-forking `local` just means updating `server/.env.local` with
  the new branch's connection string.
- **Refreshing `staging`/`local` from production** (to pull in newer data) is destructive to whatever
  branch-only data exists at the time — it replaces the branch's contents wholesale. No periodic
  refresh is automated; do it manually if/when a branch's data becomes too stale to be useful.

## Design tokens (as of TASK-057)

New UI code reaches for semantic color tokens (`bg-primary`, `text-status-critical-text`,
`bg-accent-tan-bg`, etc. — defined in `client/tailwind.config.js`, backed by CSS variables in
`client/src/index.css`) instead of a raw Tailwind hue (`bg-orange-600`, `text-red-500`). Raw hues
remain valid only where no corresponding semantic token exists yet. Shared visual patterns (buttons,
cards, badges, inputs) live once in `client/src/styles/components.css` as `@layer components` classes
(`.btn-primary`, `.card`, `.badge-status-critical`, etc.) — compose those at call sites rather than
retyping the underlying utility string. This is a documented convention, not an enforced lint rule.

## Known gap

Only `DATABASE_URL` is repointed per environment (the only Postgres variable this codebase reads —
see `server/db/client.js`): Vercel's Preview scope → `staging` branch, `server/.env.local` →
`local` branch. The other ~10 Postgres-family variables the Neon-Vercel integration also sets
(`POSTGRES_PRISMA_URL`, `PGHOST_UNPOOLED`, etc.) still point at production in all scopes. If any future
code starts reading one of those directly instead of `DATABASE_URL`, repoint it the same way — check
via the Neon console (Connect → connection details for the relevant branch) rather than guessing the
format.
