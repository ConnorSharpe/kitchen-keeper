import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  getDefaultStorageLocation,
  CATEGORY_STORAGE_DEFAULTS,
  STORAGE_LOCATIONS,
  STORAGE_LOCATION_LABELS,
} from './pantryDefaults.js';

describe('getDefaultStorageLocation', () => {
  test('returns the mapped location for each known category', () => {
    for (const [category, expected] of Object.entries(
      CATEGORY_STORAGE_DEFAULTS
    )) {
      assert.equal(getDefaultStorageLocation(category), expected);
    }
  });

  test('falls back to pantry for an unknown category', () => {
    assert.equal(getDefaultStorageLocation('NotACategory'), 'pantry');
    assert.equal(getDefaultStorageLocation(undefined), 'pantry');
  });
});

describe('STORAGE_LOCATIONS / STORAGE_LOCATION_LABELS', () => {
  test('every storage location has a label', () => {
    for (const loc of STORAGE_LOCATIONS) {
      assert.ok(STORAGE_LOCATION_LABELS[loc]);
    }
  });

  test('every CATEGORY_STORAGE_DEFAULTS value is a valid storage location', () => {
    for (const loc of Object.values(CATEGORY_STORAGE_DEFAULTS)) {
      assert.ok(STORAGE_LOCATIONS.includes(loc));
    }
  });
});
