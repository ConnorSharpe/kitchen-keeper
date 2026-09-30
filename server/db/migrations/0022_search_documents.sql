-- TASK-069: derived retrieval index (pgvector + Postgres FTS) over recipes and meal logs.
-- Additive only: a new table, rebuildable at any time by the backfill script. IF NOT EXISTS +
-- statement-breakpoint so server/db/migrate.js re-running it on boot is a safe no-op.
-- G1 case (b) on staging/production: the extension is not installed there yet but neondb_owner can
-- create it, so this migration creates it.

CREATE EXTENSION IF NOT EXISTS vector;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS search_documents (
  id                 SERIAL PRIMARY KEY,
  household_id       INTEGER NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  source_type        TEXT NOT NULL CHECK (source_type IN ('recipe', 'meal_log')),
  source_id          INTEGER NOT NULL,
  content            TEXT NOT NULL,
  content_hash       TEXT NOT NULL,
  content_tsv        TSVECTOR GENERATED ALWAYS AS (to_tsvector('english', content)) STORED,
  occurred_at        TIMESTAMPTZ NOT NULL,
  source_fingerprint TEXT,
  embedding          VECTOR(1536),
  embedding_model    TEXT,
  embedded_hash      TEXT,
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (source_type, source_id),
  CHECK ((source_type = 'recipe') = (source_fingerprint IS NOT NULL)),
  CHECK ((embedding IS NULL) = (embedding_model IS NULL)
     AND (embedding IS NULL) = (embedded_hash IS NULL))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_search_documents_household ON search_documents (household_id, source_type);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_search_documents_tsv ON search_documents USING GIN (content_tsv);

-- Down migration (if needed):
-- DROP TABLE search_documents;
-- NOT reversible with respect to the extension: rolling back deliberately leaves `vector`
-- installed (ADR-0001).
