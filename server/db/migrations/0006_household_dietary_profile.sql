ALTER TABLE households
  ADD COLUMN conditions       TEXT NOT NULL DEFAULT '[]',
  ADD COLUMN allergies        TEXT NOT NULL DEFAULT '[]',
  ADD COLUMN food_preferences TEXT NOT NULL DEFAULT '[]';
