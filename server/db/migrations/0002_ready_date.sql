-- Migration: add ready_date to pantry_items for ripening/readiness state
-- Run manually in the Neon SQL Editor.
-- Safe: nullable column, no backfill, no constraints.

ALTER TABLE "pantry_items" ADD COLUMN "ready_date" text;
