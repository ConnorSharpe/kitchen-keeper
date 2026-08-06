import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

// Regression guard for TASK-055 Design 8: the mutating statement's household
// filter is not independently observable through this service's return
// shape, since forbidden/not_found are decided by the pre-check SELECT
// (D-5). This test only confirms that contract is unchanged.
const state = { existingRow: null };

mock.module('../db/client.js', {
  namedExports: {
    db: {
      select: () => ({
        from: () => ({
          where: () =>
            Promise.resolve(state.existingRow ? [state.existingRow] : []),
        }),
      }),
      update: () => ({
        set: () => ({
          where: () => Promise.resolve(),
        }),
      }),
      delete: () => ({
        where: () => Promise.resolve(),
      }),
    },
  },
});

const { update } = await import('./pantryService.js');

test('update returns forbidden for a mismatched householdId', async () => {
  state.existingRow = { id: 1, householdId: 999, name: 'Milk' };
  const result = await update(42, 1, { quantity: 2 });
  assert.deepEqual(result, { status: 'forbidden' });
});

test('update returns not_found when the row does not exist', async () => {
  state.existingRow = null;
  const result = await update(42, 1, { quantity: 2 });
  assert.deepEqual(result, { status: 'not_found' });
});
