-- Migration: push_subscriptions table for Web Push API (VAPID)
-- Run manually in the Neon SQL Editor.
-- One row per device (browser+origin) per user.
-- Endpoint is UNIQUE: re-subscription and device-reuse are handled at the app layer.

CREATE TABLE "push_subscriptions" (
  "id"         SERIAL PRIMARY KEY,
  "user_id"    INTEGER NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "endpoint"   TEXT    NOT NULL UNIQUE,
  "p256dh"     TEXT    NOT NULL,
  "auth"       TEXT    NOT NULL,
  "created_at" TEXT    NOT NULL
);

CREATE INDEX "push_subscriptions_user_id_idx" ON "push_subscriptions"("user_id");
