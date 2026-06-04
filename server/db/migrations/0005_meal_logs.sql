CREATE TABLE meal_logs (
  id              SERIAL PRIMARY KEY,
  household_id    INTEGER NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  pantry_item_id  INTEGER REFERENCES pantry_items(id) ON DELETE SET NULL,
  item_name       TEXT    NOT NULL,
  category        TEXT    NOT NULL DEFAULT 'Other',
  purine_level    TEXT    NOT NULL DEFAULT 'medium',
  was_expiring    BOOLEAN,
  quantity_before NUMERIC,
  quantity_after  NUMERIC,
  logged_at       TEXT    NOT NULL,
  source          TEXT    NOT NULL DEFAULT 'agent'
);

CREATE INDEX idx_meal_logs_household_logged_at
  ON meal_logs (household_id, logged_at DESC);
