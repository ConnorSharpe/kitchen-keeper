# ADR-0001: Store embeddings with pgvector in the existing Neon Postgres

- **Status:** Accepted
- **Date:** 2026-09-29
- **Task:** TASK-069 (spec §2.1 D1, D6; §2.2; §7 R3)

## Context

The chat agent needs semantic search over a household's saved recipes and meal logs. That needs somewhere
to store and query embedding vectors. The authoritative data already lives in Neon Postgres, and every
query in the app is scoped by `household_id`. A household's corpus is small: hundreds of documents, not
millions.

## Decision

Use the `vector` extension (pgvector 0.8.0, available on every Neon branch per gate G1) in the **existing**
Neon database. Vectors live in a derived `search_documents` table (see ADR-0005) as `VECTOR(1536)`.

The embedding model is OpenAI `text-embedding-3-small` (1536 dimensions). The model name is stored on every
row (`embedding_model`), so switching models later shows up as a detectable stale state, not as silently
mixed vector spaces.

## Alternatives rejected

- **A dedicated vector database** (Pinecone, Qdrant, etc.): a second vendor, consistency between two stores,
  and household tenancy re-implemented in a second system with its own filter semantics. None of that pays
  off at hundreds of documents per household.
- **`text-embedding-3-large`:** more cost and a larger vector for no demonstrated gain at this corpus size.

## Consequences

- One database, one tenancy model, one backup. Vector and full-text candidates can come from the same table
  and be joined back to source rows with household-matched joins.
- **Installing the extension is a one-way step.** `0022` runs `CREATE EXTENSION IF NOT EXISTS vector`.
  Rolling `0022` back drops `search_documents` (a derived, rebuildable index, so no data is lost) and
  deliberately **leaves the extension installed**. Uninstalling an extension is a separate, privileged,
  environment-wide action, and other objects could come to depend on it. Each environment's ledger row
  records whether the extension was already installed.
- drizzle-orm 0.29.5 has no native vector type, so `schema.js` uses `customType` for `vector(1536)` and
  `tsvector`, and vector/FTS queries are raw `sql` templates. Upgrading drizzle is out of scope.

## Data flow (new outbound surface, spec §7 R3)

OpenAI is the provider Kitchen Keeper's AI features already use, but **this is a new data flow**, and
"same vendor" is not "same data flow":

| | Before TASK-069 | After TASK-069 |
|---|---|---|
| Chat context | recipes as `{id, name, tags}` only | unchanged |
| Full recipe text (description, ingredients with quantities, steps) | sent once, at parse time, for URL/image/text **imports** only | **every** recipe, including manually entered ones, re-sent whenever its content changes |
| Meal-log history | never sent | **every** meal log |
| Search query strings | n/a | every agent search query |

All of it goes to OpenAI's embeddings endpoint. The flow is **accepted for Phase A** and stated in the
README's "Agent retrieval" section. Cost is small ($0.02 per 1M tokens, gate G3; the 507-document eval
backfill cost about $0.0007) and falls under the already-accepted public-AI billing risk.
