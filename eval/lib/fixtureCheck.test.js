import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateFixture } from './fixtureCheck.js';

function base() {
  const recipes = [];
  for (let i = 0; i < 151; i++) {
    recipes.push({
      key: `filler${i}`, name: `Filler Dish ${i}`, description: 'plain',
      tags: ['filler'], ingredients: [{ name: 'rice', quantity: 1, unit: 'cup' }],
      steps: ['cook'], savedDaysAgo: 5,
    });
  }
  recipes.push(
    {
      key: 'hidden1', name: 'Weeknight Stew', description: 'hearty',
      tags: ['dinner'], ingredients: [{ name: 'smoked paprika', quantity: 1, unit: 'tsp' }],
      steps: ['simmer'], savedDaysAgo: 3,
    },
    {
      key: 'rare1', name: 'Zorblat Pie', description: 'a pie', tags: ['pie'],
      ingredients: [{ name: 'flour', quantity: 1, unit: 'cup' }],
      steps: ['bake'], savedDaysAgo: 4,
    },
  );
  return {
    recipes,
    mealLogs: [{ key: 'log1', itemName: 'Toast', category: 'breakfast', loggedDaysAgo: 2, wasExpiring: false }],
    pantry: [],
  };
}
function goldenBase() {
  return {
    retrieval: [
      { id: 'q-hidden', category: 'ingredient_hidden', query: 'paprika dish', term: 'paprika', expected: [{ key: 'hidden1', aliases: ['Weeknight Stew'] }] },
      { id: 'q-para', category: 'paraphrase', query: 'hearty meal', expected: [{ key: 'hidden1', aliases: [] }] },
      { id: 'q-rare', category: 'exact_rare_term', query: 'zorblat', term: 'zorblat', expected: [{ key: 'rare1', aliases: [] }] },
      { id: 'q-temp', category: 'temporal_meal_log', query: 'what did I eat', dateFromDaysAgo: 7, dateToDaysAgo: 0, expected: [{ key: 'log1', aliases: ['Toast'] }] },
      { id: 'q-neg', category: 'negative', query: 'quinoa', absentTerms: ['quinoa'], expected: [] },
    ],
    agent: [
      { id: 'a-gold', kind: 'golden', message: 'find stew', expected: [{ key: 'hidden1', aliases: [] }] },
      { id: 'a-ctl', kind: 'control', message: 'hello', expected: [] },
    ],
  };
}
const run = (mutate) => {
  const f = base();
  const g = goldenBase();
  mutate(f, g);
  return validateFixture(f, g);
};

test('fully valid fixture returns no problems', () => {
  assert.deepEqual(validateFixture(base(), goldenBase()), []);
});
test('rejects fixture with 150 or fewer recipes', () => {
  const p = run((f) => {
    f.recipes = f.recipes.filter((r) => r.key !== 'filler0').slice(0, 150);
  });
  assert.ok(p.length > 0);
});
test('rejects duplicate recipe key', () => {
  const p = run((f) => { f.recipes[1].key = 'filler0'; });
  assert.ok(p.some((s) => /filler0/.test(s)));
});
test('rejects duplicate recipe name case-insensitively', () => {
  const p = run((f) => { f.recipes[1].name = 'FILLER DISH 0'; });
  assert.ok(p.some((s) => /filler dish 0/i.test(s)));
});
test('rejects duplicate mealLog key', () => {
  const p = run((f) => { f.mealLogs.push({ ...f.mealLogs[0] }); });
  assert.ok(p.some((s) => /log1/.test(s)));
});
test('rejects mealLog older than 90 days', () => {
  const p = run((f) => { f.mealLogs[0].loggedDaysAgo = 91; });
  assert.ok(p.some((s) => /log1/.test(s)));
});
test('rejects negative loggedDaysAgo', () => {
  const p = run((f) => { f.mealLogs[0].loggedDaysAgo = -1; });
  assert.ok(p.some((s) => /log1/.test(s)));
});
test('accepts loggedDaysAgo boundaries 0 and 90', () => {
  const p = run((f) => {
    f.mealLogs[0].loggedDaysAgo = 0;
    f.mealLogs.push({ key: 'log2', itemName: 'Soup', category: 'dinner', loggedDaysAgo: 90, wasExpiring: false });
  });
  assert.deepEqual(p, []);
});
test('rejects unknown retrieval category', () => {
  const p = run((f, g) => { g.retrieval[1].category = 'bogus'; });
  assert.ok(p.some((s) => /q-para/.test(s)));
});
test('rejects negative query with expected entries', () => {
  const p = run((f, g) => { g.retrieval[4].expected = [{ key: 'rare1', aliases: [] }]; });
  assert.ok(p.some((s) => /q-neg/.test(s)));
});
test('rejects non-negative query with empty expected', () => {
  const p = run((f, g) => { g.retrieval[1].expected = []; });
  assert.ok(p.some((s) => /q-para/.test(s)));
});
test('rejects retrieval expected key that does not exist', () => {
  const p = run((f, g) => { g.retrieval[1].expected = [{ key: 'ghost', aliases: [] }]; });
  assert.ok(p.some((s) => /q-para/.test(s) && /ghost/.test(s)));
});
test('rejects agent expected key that does not exist', () => {
  const p = run((f, g) => { g.agent[0].expected = [{ key: 'ghost', aliases: [] }]; });
  assert.ok(p.some((s) => /a-gold/.test(s) && /ghost/.test(s)));
});
test('ingredient_hidden requires term', () => {
  const p = run((f, g) => { delete g.retrieval[0].term; });
  assert.ok(p.some((s) => /q-hidden/.test(s)));
});
test('ingredient_hidden term must appear in an ingredient name', () => {
  const p = run((f, g) => { g.retrieval[0].term = 'saffron'; });
  assert.ok(p.some((s) => /q-hidden/.test(s)));
});
test('ingredient_hidden term must not appear in recipe name', () => {
  const p = run((f) => { f.recipes.find((r) => r.key === 'hidden1').name = 'Paprika Stew'; });
  assert.ok(p.some((s) => /q-hidden/.test(s)));
});
test('ingredient_hidden term must not appear in tags', () => {
  const p = run((f) => { f.recipes.find((r) => r.key === 'hidden1').tags = ['Paprika']; });
  assert.ok(p.some((s) => /q-hidden/.test(s)));
});
test('exact_rare_term requires term', () => {
  const p = run((f, g) => { delete g.retrieval[2].term; });
  assert.ok(p.some((s) => /q-rare/.test(s)));
});
test('exact_rare_term fails when term appears in an unexpected recipe', () => {
  const p = run((f) => { f.recipes[0].steps = ['add zorblat']; });
  assert.ok(p.some((s) => /q-rare/.test(s)));
});
test('exact_rare_term fails when an expected recipe lacks the term', () => {
  const p = run((f, g) => {
    g.retrieval[2].expected = [{ key: 'rare1', aliases: [] }, { key: 'hidden1', aliases: [] }];
  });
  assert.ok(p.some((s) => /q-rare/.test(s)));
});
test('negative requires non-empty absentTerms', () => {
  const p = run((f, g) => { g.retrieval[4].absentTerms = []; });
  assert.ok(p.some((s) => /q-neg/.test(s)));
});
test('negative fails when absent term is in recipe text', () => {
  const p = run((f) => { f.recipes[0].description = 'with Quinoa'; });
  assert.ok(p.some((s) => /q-neg/.test(s) && /quinoa/i.test(s)));
});
test('negative fails when absent term is in a mealLog itemName', () => {
  const p = run((f) => { f.mealLogs[0].itemName = 'Quinoa bowl'; });
  assert.ok(p.some((s) => /q-neg/.test(s) && /quinoa/i.test(s)));
});
test('golden agent query requires non-empty expected', () => {
  const p = run((f, g) => { g.agent[0].expected = []; });
  assert.ok(p.some((s) => /a-gold/.test(s)));
});
test('control agent query requires empty expected', () => {
  const p = run((f, g) => { g.agent[1].expected = [{ key: 'hidden1', aliases: [] }]; });
  assert.ok(p.some((s) => /a-ctl/.test(s)));
});
test('agent query with unknown kind is rejected', () => {
  const p = run((f, g) => { g.agent[1].kind = 'weird'; });
  assert.ok(p.some((s) => /a-ctl/.test(s)));
});
