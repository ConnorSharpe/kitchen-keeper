import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitNdjsonLines } from './index.js';

test('splitNdjsonLines emits complete lines in order and returns the remainder', () => {
  const lines = [];
  const remainder = splitNdjsonLines('{"a":1}\n{"a":2}\n{"a":3}', (line) => lines.push(line));
  assert.deepEqual(lines, ['{"a":1}', '{"a":2}']);
  assert.equal(remainder, '{"a":3}');
});

test('splitNdjsonLines handles a line split across two chunks', () => {
  const lines = [];
  const remainder1 = splitNdjsonLines('{"a":1}\n{"a":2', (line) => lines.push(line));
  assert.deepEqual(lines, ['{"a":1}']);
  assert.equal(remainder1, '{"a":2');

  const remainder2 = splitNdjsonLines(remainder1 + '}\n', (line) => lines.push(line));
  assert.deepEqual(lines, ['{"a":1}', '{"a":2}']);
  assert.equal(remainder2, '');
});

test('splitNdjsonLines skips empty lines but passes whitespace-only lines through (framing only, not content validation)', () => {
  const lines = [];
  const remainder = splitNdjsonLines('\n{"a":1}\n\n {"a":2}\n', (line) => lines.push(line));
  assert.deepEqual(lines, ['{"a":1}', ' {"a":2}']);
  assert.equal(remainder, '');
});

test('splitNdjsonLines does not require valid JSON — framing only', () => {
  const lines = [];
  const remainder = splitNdjsonLines('not json\nalso not json\n', (line) => lines.push(line));
  assert.deepEqual(lines, ['not json', 'also not json']);
  assert.equal(remainder, '');
});
