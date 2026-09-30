# Stable Context

- Tests are written before implementation code (TDD default). Enforced by `.claude/hooks/tdd/`
  (config: `.claude/tdd-config.json`).

# TDD Exemptions

Keep in sync with `alwaysExemptPatterns` in `.claude/tdd-config.json` (the config is what hooks enforce;
this list records why).

- `**/*.md`, `ai/**`, `docs/**`             — documentation and agent context, no executable logic
- `.claude/**`, `githooks/**`, `.github/**` — tooling/CI config
- `**/.gitignore`, `.env.example`           — config only
- `**/package.json`, `**/package-lock.json` — dependency/script manifests
- `eval/retrieval.js`, `eval/agent.js`, `eval/lib/household.js`, `eval/lib/runtime.js`, `eval/scripts/**`
  — TASK-069 eval harness orchestration (added 2026-09-30, approved by Connor): seeding/teardown against
  the local Neon branch, runners driving real search and chat calls, process/env plumbing, fixture
  authoring. Unit tests would be mock-driven and could not prove the real DB/OpenAI path; the evals are
  verified by running them (fixture validation, index-state-hash and `pending = 0` assertions fail loudly).
  The harness's logic is NOT exempt: `eval/lib/{metrics,guard,fixtureCheck,dates,embedCache}.js` are
  test-first.
