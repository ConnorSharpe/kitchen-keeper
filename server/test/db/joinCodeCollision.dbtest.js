import { describe, test, before, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import * as realCrypto from 'node:crypto';
import { enabled, boot, q } from './dbHarness.js';
import { isUniqueViolation } from '../../db/pgError.js';

// TASK-071 AC3: the join-code collision retry, driven through a forced collision against the real
// local branch. drizzle-orm 0.44+ wraps driver errors in DrizzleQueryError; 3b-d prove the retry
// still recognises the wrapped error. Opt-in: RUN_DB_TESTS=1, local Neon branch only.
//
// Isolation contract: per-run codes and clerkUserId verified absent before any insert; cleanup only
// by captured household ids (children go with them via ON DELETE CASCADE) and by the synthetic
// clerkUserId in households + user_onboarding; table counts compared before/after.

const suite = enabled ? describe : describe.skip;
const C = 'households_join_code_unique';
const realRandomBytes = realCrypto.randomBytes;

// One dispatcher: armed calls are counted and return the next buffer (the last one repeats);
// disarmed calls go to the real randomBytes and are not counted.
const dispatcher = { armed: false, buffers: [], calls: 0, sizes: [] };
function arm(buffers) {
  dispatcher.armed = true;
  dispatcher.buffers = buffers;
  dispatcher.calls = 0;
  dispatcher.sizes = [];
}
function disarm() {
  dispatcher.armed = false;
}
function mockedRandomBytes(size, cb) {
  if (!dispatcher.armed) return realRandomBytes(size, cb);
  dispatcher.sizes.push(size);
  const buf = dispatcher.buffers[Math.min(dispatcher.calls, dispatcher.buffers.length - 1)];
  dispatcher.calls++;
  return Buffer.from(buf);
}

// Codes come from Math.random, never from the mocked randomBytes.
function freshBuffer() {
  const buf = Buffer.alloc(4);
  for (let i = 0; i < 4; i++) buf[i] = Math.floor(Math.random() * 256);
  return buf;
}
const codeOf = (buf) => buf.toString('hex').toUpperCase();

async function codeTaken(code) {
  const rows = await q(`SELECT 1 FROM households WHERE join_code = $1`, [code]);
  return rows.length > 0;
}
async function clerkUserIdTaken(id) {
  const h = await q(`SELECT 1 FROM households WHERE clerk_user_id = $1`, [id]);
  const o = await q(`SELECT 1 FROM user_onboarding WHERE clerk_user_id = $1`, [id]);
  return h.length > 0 || o.length > 0;
}
async function absent(make, taken, label) {
  for (let i = 0; i < 5; i++) {
    const v = make();
    if (!(await taken(v))) return v;
  }
  throw new Error(`could not generate an absent ${label} in 5 tries; nothing was written`);
}
async function counts() {
  const [{ h }] = await q(`SELECT count(*)::int AS h FROM households`);
  const [{ o }] = await q(`SELECT count(*)::int AS o FROM user_onboarding`);
  return { households: h, user_onboarding: o };
}

suite('join-code collision retry against the local database (TASK-071 AC3)', () => {
  let db, households, householdService;
  let before0;
  const capturedIds = [];
  let clerkUserId;
  const buf = {};
  const code = {};

  before(async () => {
    await boot();
    mock.module('crypto', {
      defaultExport: { ...realCrypto.default, randomBytes: mockedRandomBytes },
      namedExports: { ...realCrypto, randomBytes: mockedRandomBytes },
    });
    ({ db } = await import('../../db/client.js'));
    ({ households } = await import('../../db/schema.js'));
    householdService = await import('../../services/householdService.js');

    before0 = await counts();
    const used = new Set();
    for (const k of ['c1', 'c2b', 'c2c']) {
      const b = await absent(
        () => freshBuffer(),
        async (x) => used.has(codeOf(x)) || (await codeTaken(codeOf(x))),
        `join code ${k}`
      );
      used.add(codeOf(b));
      buf[k] = b;
      code[k] = codeOf(b);
    }
    clerkUserId = await absent(
      () => `t071_${realRandomBytes(8).toString('hex')}`,
      clerkUserIdTaken,
      'clerkUserId'
    );

    const [seed] = await db
      .insert(households)
      .values({ name: 'T071 seed', joinCode: code.c1 })
      .returning();
    capturedIds.push(seed.id);
  });

  after(async () => {
    disarm();
    if (!before0) return;
    const ids = capturedIds.filter((x) => x != null);
    if (ids.length) await q(`DELETE FROM households WHERE id = ANY($1::int[])`, [ids]);
    if (clerkUserId) {
      await q(`DELETE FROM user_onboarding WHERE clerk_user_id = $1`, [clerkUserId]);
      await q(`DELETE FROM households WHERE clerk_user_id = $1`, [clerkUserId]);
    }
    if (ids.length) {
      const left = await q(`SELECT 1 FROM households WHERE id = ANY($1::int[])`, [ids]);
      assert.equal(left.length, 0, 'captured households remain after cleanup');
    }
    if (clerkUserId) assert.equal(await clerkUserIdTaken(clerkUserId), false, 'clerkUserId rows remain');
    assert.deepEqual(await counts(), before0, 'table counts changed: pre-existing rows touched');
  });

  test('AC3a: a duplicate join code insert rejects with a unique violation on the constraint', async () => {
    let err;
    try {
      const [row] = await db
        .insert(households)
        .values({ name: 'T071 dup', joinCode: code.c1 })
        .returning();
      capturedIds.push(row.id);
    } catch (e) {
      err = e;
    }
    assert.ok(err, 'duplicate insert unexpectedly succeeded');
    assert.equal(isUniqueViolation(err, C), true);
  });

  test('AC3b: create() retries past a collision and returns the second code', async () => {
    arm([buf.c1, buf.c2b]);
    let household;
    let calls;
    try {
      household = await householdService.create('T071');
      if (household?.id != null) capturedIds.push(household.id);
    } finally {
      calls = dispatcher.calls;
      disarm();
    }
    assert.equal(household.joinCode, code.c2b);
    assert.equal(calls, 2, 'randomBytes calls');
    assert.deepEqual(dispatcher.sizes, [4, 4]);
    const rows = await q(`SELECT id FROM households WHERE join_code = $1`, [code.c2b]);
    assert.deepEqual(
      rows.map((r) => r.id),
      [household.id]
    );
  });

  test('AC3c: getOrCreate() retries past a collision for a new clerkUserId', async () => {
    arm([buf.c1, buf.c2c]);
    let household;
    let calls;
    try {
      household = await householdService.getOrCreate(clerkUserId);
      if (household?.id != null) capturedIds.push(household.id);
    } finally {
      calls = dispatcher.calls;
      disarm();
    }
    assert.equal(household.joinCode, code.c2c);
    assert.equal(household.clerkUserId, clerkUserId);
    assert.equal(calls, 2, 'randomBytes calls');
    assert.deepEqual(dispatcher.sizes, [4, 4]);
  });

  test('AC3d: create() gives up after 3 collisions and rethrows the unique violation', async () => {
    arm([buf.c1]);
    let err;
    let calls;
    try {
      const household = await householdService.create('T071');
      if (household?.id != null) capturedIds.push(household.id);
    } catch (e) {
      err = e;
    } finally {
      calls = dispatcher.calls;
      disarm();
    }
    assert.ok(err, 'create() unexpectedly resolved');
    assert.equal(isUniqueViolation(err, C), true);
    assert.equal(calls, 3, 'randomBytes calls');
  });
});
