# Task

None active. Last task: TASK-069 (semantic retrieval for the chat agent), **DONE 2026-09-29**, archived below.

# Current Status

No task in progress. `staging` and `main` both at `f296436` (pushed). MIGRATION_LEDGER: no open rows.

# Open Items Carried Over (for Connor, not blocking)

- Reset the Neon `neondb_owner` password (staging + prod DB URLs were pasted into chat during TASK-069).
- Local DB residue from the TASK-069 smoke test: `chat_messages` id > 144 and `search_documents` for household 1.
- Pre-existing Sentry issue KITCHEN-KEEPER-SERVER-2 (Authentication required, GET /api/pantry), last seen 2026-09-29.
- Follow-up chips offered: log agent search-tool args; investigate agent ignoring correct hits (chickpeas) + synonym misses.
  Also the lint chip for the 30 pre-existing `no-undef` errors in `.claude/hooks/tdd/*.mjs`.
- Consider upstreaming the two TDD-kit fixes (node:test parsing, new-file stub allowance) to the kit's source project.

# Context Notes

- TDD enforcement kit installed and active. Pre-existing unrelated uncommitted changes: `.claude/settings.local.json`,
  `ai/tasks/TASK-059-smoke-tests.md`.

---

## Archived History

- TASK-069 (semantic retrieval: pgvector + hybrid search + eval harness, shipped to production): see [archive/TASK-069.md](archive/TASK-069.md)

- TASK-068 (Sentry errors+logs, debugLog migration, shipped to production; SW-registration hotfix): see [archive/TASK-068.md](archive/TASK-068.md)
- TASK-067 (service worker cross-origin cache-first fix, shipped to production, closed the TASK-063→067
  double-sign-in investigation): see [archive/TASK-067.md](archive/TASK-067.md)

- TASK-047 through TASK-053: see [archive/TASK-047-053.md](archive/TASK-047-053.md)
- TASK-054: see [archive/TASK-054.md](archive/TASK-054.md)
- TASK-055: see [archive/TASK-055.md](archive/TASK-055.md)
- TASK-056: see [archive/TASK-056.md](archive/TASK-056.md)
- TASK-057 spec-drafting: see [archive/TASK-057-spec-drafting.md](archive/TASK-057-spec-drafting.md)
- TASK-057 implementation: see [archive/TASK-057-implementation.md](archive/TASK-057-implementation.md)
- TASK-059 mid-checklist + TASK-061 spec-drafting: see
  [archive/TASK-059-061-handoff.md](archive/TASK-059-061-handoff.md)
- TASK-061 implementation/deploy: see [archive/TASK-061-implementation.md](archive/TASK-061-implementation.md)
- TASK-059 resumed smoke-test session: see
  [archive/TASK-059-smoke-tests-resumed.md](archive/TASK-059-smoke-tests-resumed.md)
- TASK-062 spec-drafting: see [archive/TASK-062-spec-drafting.md](archive/TASK-062-spec-drafting.md)
- TASK-062 implementation/deploy: see [archive/TASK-062-implementation.md](archive/TASK-062-implementation.md)
- TASK-063 implementation/deploy through TASK-064 spec-drafting: see
  [archive/TASK-063-064-diagnostics-and-spec.md](archive/TASK-063-064-diagnostics-and-spec.md)
- TASK-064 implementation/deploy (marker-based recovery mechanism, on-device verification confirmed working
  as designed): see [archive/TASK-064-implementation.md](archive/TASK-064-implementation.md)
- TASK-064 follow-up (timing diagnostics, confirmed the WebKit activation-expiry hypothesis with paired
  on-device data, feeding directly into TASK-065): see
  [archive/TASK-064-followup-timing-diagnostics.md](archive/TASK-064-followup-timing-diagnostics.md)
- TASK-065 implementation/deploy (preconnect hint shipped to `/sign-in` and `/sign-up`): see
  [archive/TASK-065-implementation.md](archive/TASK-065-implementation.md)
- TASK-065 post-deploy negative signal + TASK-066 diagnosis handoff: see
  [archive/TASK-065-negative-signal.md](archive/TASK-065-negative-signal.md)
- TASK-066 implementation + on-device capture results (conclusive: no main-thread stall observed): see
  [archive/TASK-066-implementation.md](archive/TASK-066-implementation.md)
