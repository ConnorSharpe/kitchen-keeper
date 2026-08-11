# Migration Ledger

Tracks, per environment (`local` / `staging` / `production`), whether each database migration has actually
been **applied** to that environment's database, and separately whether the **dependent code** is actually
**deployed** to that same environment. These are two different facts and must not be conflated — the
2026-08-10 production outage (see the incident row below) happened precisely because the first was true and
the second silently wasn't, for five days, with nothing recording it.

Per the AI Development Agent Efficiency Guide's Rev 7 Migration/Code-Deploy Coupling rule: read this file
before applying any migration to any environment, and before merging or deploying code that depends on a
schema change. See [CONVENTIONS.md](../handoffs/CONVENTIONS.md)'s "Canonical migration order" for *why* the
order is local → staging → production → merge-to-main; this file is the record of *whether* each step in
that order actually happened.

**Append-only.** Never edit or delete a past row. A status change (e.g. ❌ → ✅ once code actually deploys)
is a **new row**, not an edit to the old one — the old row stays as the historical record of the gap.

---

## ⚠️ Outstanding gaps (check this first)

None currently open.

*(If this section is ever non-empty, that is a live, standing risk — surface it before starting unrelated
work in the affected environment. See Rule 7 in the Efficiency Guide.)*

---

## Ledger

| # | Migration file | Change | Environment | Event | Timestamp (UTC) | Dependent commit | Notes |
|---|---|---|---|---|---|---|---|
| 1 | `0021_drop_byok.sql` | `ALTER TABLE households DROP COLUMN openai_api_key` | production | Migration applied | 2026-08-05 ~21:11 (approx.) | `46c2549` | Per [archived handoff](../handoffs/archive/TASK-047-053.md#L391) commit `4f351dc`: "Connor ran `0021_drop_byok.sql` against all three environments (local, staging, production)." Exact per-environment run time was not individually logged at the time — this is the gap this ledger exists to close going forward. Applied via manual Neon SQL Editor run per the migration file's own instructions (destructive, not run through `migrate.js`). |
| 2 | `0021_drop_byok.sql` | `ALTER TABLE households DROP COLUMN openai_api_key` | production | **Code NOT deployed** — `main` still at pre-TASK-051 HEAD (`76aad24`) while the migration above was already live | 2026-08-05 ~21:11 → 2026-08-10 16:35 | — | ❌ **This was the incident.** `main` (production's deploy source) never received `46c2549`. Every authenticated request (`clerkAuth` → `householdService.getOrCreate()`) 500'd with `NeonDbError: column "openai_api_key" does not exist`, confirmed live via `vercel logs` on 2026-08-10. Root cause: no ledger existed to flag that step 3 (migrate prod) of CONVENTIONS.md's canonical order had completed without step 4 (merge to `main`) ever following. |
| 3 | `0021_drop_byok.sql` | `ALTER TABLE households DROP COLUMN openai_api_key` | production | Dependent code deployed — resolved | 2026-08-10 23:47:36 | `90d964e` (merge: `staging` → `main`, "Merge staging into main: promote TASK-051 through TASK-059 to production") | ✅ Confirmed live: `vercel inspect kitchenkeeper.kitchen` shows deployment `dpl_A6LrePLWQ9iQWAmXNdMuWb6CUEgo` at this commit; post-deploy log check shows no further `openai_api_key` errors. Gap duration: ~5 days. |
| 4 | `0021_drop_byok.sql` | `ALTER TABLE households DROP COLUMN openai_api_key` | staging | Migration applied + code deployed | 2026-08-05 ~21:11 | `46c2549` | No gap here — `46c2549` was committed directly to `staging`, which auto-deploys its Preview on push per CONVENTIONS.md's push workflow, so migration and code landed on `staging` together. |
| 5 | `0021_drop_byok.sql` | `ALTER TABLE households DROP COLUMN openai_api_key` | local | Migration applied + code deployed | 2026-08-05 ~21:00 | `46c2549` | `local` tracks the working tree directly; no separate deploy step. |

---

## Historical baseline (pre-ledger, pre-environment-split)

Migrations `0000_init.sql` through `0020_suggestions.sql` were all applied before this ledger existed, and
— for everything up to and including `0018_user_onboarding.sql`/`0019_drop_users.sql`/`0020_suggestions.sql`
committed on or before 2026-07-29 — before the 2026-07-30 Neon environment split (TASK-039) that first gave
`local`/`staging`/`production` independent databases. Before that split there was only one shared database,
so a per-environment "was it applied here yet" question didn't meaningfully exist for these migrations —
there was only one "here." No individual per-environment timestamps were recorded for this period, and none
are reconstructed here to avoid inventing false precision. Listed for reference only, in commit order:

| Migration file | Introduced in commit | Date |
|---|---|---|
| `0000_init.sql`, `0001_households.sql` | (pre-history / `a7f0a38`) | 2026-04-27 |
| `0002_ready_date.sql` | `f2e02d9` | 2026-06-03 |
| `0003_onboarding_complete.sql` | `ecf927a` | 2026-06-03 |
| `0004_push_subscriptions.sql` | `bd0d51c` | 2026-06-03 |
| `0005_meal_logs.sql` | `b3cca22` | 2026-06-04 |
| `0006_household_dietary_profile.sql` | `767b268` | 2026-06-04 |
| `0007_household_ai_api_key.sql` | `0eeafae` | 2026-06-09 |
| `0008_migrate_gemini_provider.sql` | `f1da7f3` | 2026-06-10 |
| `0010_clerk_byok.sql` | `bfa65cc` | 2026-06-22 |
| `0011a/0011b_push_household_*.sql` | `fca7b3d` | 2026-06-23 |
| `0012_household_members.sql` | `f4c2400` | 2026-06-23 |
| `0013_chat_metadata.sql`–`0016_recipe_blocklist.sql` | `3a96b80`, `3c5b112` | 2026-07-15 |
| `0017_platform_settings.sql` | `2100c61` | 2026-07-15 |
| `0018_user_onboarding.sql`–`0020_suggestions.sql` | `a459270`, `c10afba`, `f9eed51` | 2026-07-15 – 2026-07-29 |

If the app is currently functioning correctly across all three environments (true as of this ledger's
creation on 2026-08-10, aside from the `0021` incident above), these are assumed consistently applied
everywhere — but that assumption has never been individually verified per environment and is worth a
one-time confirmation pass if a future schema bug ever looks like it could be one of these rather than a
newer migration.

---

## Row template (copy for new entries)

```md
| # | `00XX_name.sql` | <ALTER/CREATE/DROP ...> | local / staging / production | Migration applied / Code deployed / **Code NOT deployed** | YYYY-MM-DD HH:MM UTC | <commit sha> | <context, source of the timestamp, anything unusual> |
```
