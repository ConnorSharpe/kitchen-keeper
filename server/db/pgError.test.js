import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isUniqueViolation } from './pgError.js';

// TASK-071 AC2. drizzle-orm 0.44+ wraps driver errors in DrizzleQueryError, so the pg fields
// move to err.cause; isUniqueViolation must recognise both shapes and never throw.
const C = 'households_join_code_unique';
const boom = () => {
  throw new Error('boom');
};

test('AC2a: top-level 23505 on the named constraint is a unique violation', () => {
  assert.equal(isUniqueViolation({ code: '23505', constraint: C }, C), true);
});

test('AC2b: a match on err.cause (DrizzleQueryError shape) is a unique violation', () => {
  const err = { message: 'Failed query: insert ...', cause: { code: '23505', constraint: C } };
  assert.equal(isUniqueViolation(err, C), true);
});

test('AC2c: a match on err.cause.cause is a unique violation', () => {
  const err = { message: 'outer', cause: { message: 'inner', cause: { code: '23505', constraint: C } } };
  assert.equal(isUniqueViolation(err, C), true);
});

test('AC2d: 23505 on a different constraint is not a match', () => {
  assert.equal(isUniqueViolation({ code: '23505', constraint: 'other' }, C), false);
});

test('AC2e: a different code on the named constraint is not a match', () => {
  assert.equal(isUniqueViolation({ code: '23503', constraint: C }, C), false);
});

test('AC2f: code and constraint split across two objects is not a match', () => {
  assert.equal(isUniqueViolation({ code: '23505', cause: { constraint: C } }, C), false);
});

test('AC2g: null, undefined, a string and {} return false without throwing', () => {
  for (const v of [null, undefined, '23505', {}]) {
    assert.equal(isUniqueViolation(v, C), false, `input ${JSON.stringify(v)}`);
  }
});

test('AC2h: a self-referencing cause terminates and returns false', () => {
  const e = { code: 'X' };
  e.cause = e;
  assert.equal(isUniqueViolation(e, C), false);
});

test('AC2i: a throwing cause getter returns false without throwing', () => {
  assert.equal(
    isUniqueViolation(
      {
        get cause() {
          return boom();
        },
      },
      C
    ),
    false
  );
});

test('AC2j: a throwing code getter returns false without throwing', () => {
  assert.equal(
    isUniqueViolation(
      {
        get code() {
          return boom();
        },
      },
      C
    ),
    false
  );
});

function nestAt(depth, inner) {
  let err = inner;
  for (let i = 0; i < depth; i++) err = { message: `level ${depth - i - 1}`, cause: err };
  return err;
}

test('AC2k: a match at depth 5 is found; the same match at depth 6 is not', () => {
  const match = () => ({ code: '23505', constraint: C });
  assert.equal(isUniqueViolation(nestAt(5, match()), C), true, 'depth 5 (err.cause x5)');
  assert.equal(isUniqueViolation(nestAt(6, match()), C), false, 'depth 6 is beyond the bound');
});

test('AC2l: a match is checked before cause is read, so a throwing cause still returns true', () => {
  const err = {
    code: '23505',
    constraint: C,
    get cause() {
      return boom();
    },
  };
  assert.equal(isUniqueViolation(err, C), true);
});
