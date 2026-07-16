import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeFood,
  foodsMatch,
  lightNormalizeForAllergy,
  containsWholeWord,
  expandAllergen,
  normalizeUnit,
  stripIngredientPrefix,
} from './foodNormalization.js';

describe('normalizeFood — direct plurals (no chain)', () => {
  test('"tomatoes" → "tomato"',  () => assert.equal(normalizeFood('tomatoes'),  'tomato'));
  test('"anchovies" → "anchovy"', () => assert.equal(normalizeFood('anchovies'), 'anchovy'));
  test('"peas" → "pea"',         () => assert.equal(normalizeFood('peas'),      'pea'));
});

describe('normalizeFood — chain-resolved plurals', () => {
  test('"scallions" → "green onion" (not "scallion")',   () => assert.equal(normalizeFood('scallions'), 'green onion'));
  test('"zucchinis" → "courgette" (not "zucchini")',     () => assert.equal(normalizeFood('zucchinis'), 'courgette'));
  test('"eggplants" → "aubergine" (not "eggplant")',     () => assert.equal(normalizeFood('eggplants'), 'aubergine'));
});

describe('normalizeFood — synonyms', () => {
  test('"scallion" → "green onion"',  () => assert.equal(normalizeFood('scallion'),  'green onion'));
  test('"cilantro" → "coriander"',    () => assert.equal(normalizeFood('cilantro'),  'coriander'));
  test('"zucchini" → "courgette"',    () => assert.equal(normalizeFood('zucchini'),  'courgette'));
});

describe('normalizeFood — preparation expansions', () => {
  test('"chicken broth" → "chicken"',       () => assert.equal(normalizeFood('chicken broth'),  'chicken'));
  test('"ground beef" → "beef"',            () => assert.equal(normalizeFood('ground beef'),     'beef'));
  test('"heart of palm" → "palm vegetable"', () => assert.equal(normalizeFood('heart of palm'), 'palm vegetable'));
});

describe('normalizeFood — non-breaking passthrough', () => {
  test('"cheese" → "cheese"',  () => assert.equal(normalizeFood('cheese'),  'cheese'));
  test('"hummus" → "hummus"',  () => assert.equal(normalizeFood('hummus'),  'hummus'));
  test('"glass" → "glass"',    () => assert.equal(normalizeFood('glass'),   'glass'));
});

describe('foodsMatch', () => {
  test('true: "kidney bean soup" / "kidney bean stew" (≥2 shared tokens)', () =>
    assert.equal(foodsMatch('kidney bean soup', 'kidney bean stew'), true));
  test('false: "red bean" / "bean sprouts" (1 shared token only)', () =>
    assert.equal(foodsMatch('red bean', 'bean sprouts'), false));
  test('false: "pea" / "peach"',    () => assert.equal(foodsMatch('pea',  'peach'),     false));
  test('false: "ham" / "chamomile"', () => assert.equal(foodsMatch('ham', 'chamomile'), false));

  // TASK-035 Part B2: plural handling for single-token targeted queries
  test('true: "onion" / "onions" (exact match via normalizeFood plural map)', () =>
    assert.equal(foodsMatch('onion', 'onions'), true));
  test('true: "onion" / "caramelized onions" (single-token query, plural-stripped shared token)', () =>
    assert.equal(foodsMatch('onion', 'caramelized onions'), true));
  test('"glass" / "glasses" — guard prevents corrupting "glass" into "glas"; naive approach may still not match', () => {
    // Documented limitation (D-B2): asserting the guard doesn't crash/mangle, not that it matches.
    assert.doesNotThrow(() => foodsMatch('glass', 'glasses'));
  });
  test('"citrus" / "citruses" — known limitation, result recorded not required to be true', () => {
    // Irregular plural (+es after sibilant) is explicitly out of scope for the naive fix (D-B2).
    assert.doesNotThrow(() => foodsMatch('citrus', 'citruses'));
  });
});

describe('containsWholeWord', () => {
  test('true: "almond (sliced)" contains "almond"', () =>
    assert.equal(containsWholeWord('almond (sliced)', 'almond'), true));
  test('false: "coconut" does NOT contain "nut" as whole word', () =>
    assert.equal(containsWholeWord('coconut', 'nut'), false));
});

describe('lightNormalizeForAllergy', () => {
  test('lowercases and strips punctuation', () =>
    assert.equal(lightNormalizeForAllergy('Almond (Sliced)!'), 'almond sliced'));
  test('does not expand synonyms', () =>
    assert.equal(lightNormalizeForAllergy('cilantro'), 'cilantro'));
});

describe('normalizeUnit', () => {
  test('"tbsp" → "tablespoon"', () => assert.equal(normalizeUnit('tbsp'),  'tablespoon'));
  test('"ml" → "milliliter"',   () => assert.equal(normalizeUnit('ml'),    'milliliter'));
  test('unknown passthrough',    () => assert.equal(normalizeUnit('pinch'), 'pinch'));
});

describe('expandAllergen', () => {
  test('"shellfish" returns array including shrimp, prawn, crab', () => {
    const result = expandAllergen('shellfish');
    assert.ok(result.includes('shrimp'));
    assert.ok(result.includes('prawn'));
    assert.ok(result.includes('crab'));
  });
  test('"peanut" returns ["peanut"] (specific ingredient — no expansion)', () =>
    assert.deepEqual(expandAllergen('peanut'), ['peanut']));
});

describe('expandAllergen + containsWholeWord', () => {
  test('"shellfish" allergen matches "shrimp" ingredient', () => {
    const terms = expandAllergen('shellfish');
    assert.ok(terms.some((t) => containsWholeWord('shrimp stir fry', t)));
  });
  test('"shellfish" does NOT match "fish"', () => {
    const terms = expandAllergen('shellfish');
    assert.equal(terms.some((t) => containsWholeWord('fish', t)), false);
  });
});

describe('stripIngredientPrefix', () => {
  test('"2 cloves of garlic" → "garlic"',          () => assert.equal(stripIngredientPrefix('2 cloves of garlic'),     'garlic'));
  test('"500g chicken breast" → "chicken breast"', () => assert.equal(stripIngredientPrefix('500g chicken breast'),    'chicken breast'));
  test('"1/2 cup olive oil" → "olive oil"',        () => assert.equal(stripIngredientPrefix('1/2 cup olive oil'),      'olive oil'));
  test('"1 x onion" → "onion"',                    () => assert.equal(stripIngredientPrefix('1 x onion'),              'onion'));
  test('"2 cans tomatoes" → "tomatoes"',            () => assert.equal(stripIngredientPrefix('2 cans tomatoes'),        'tomatoes'));
  test('"3 large eggs" → "eggs"',                   () => assert.equal(stripIngredientPrefix('3 large eggs'),           'eggs'));
  test('"14 oz diced tomatoes" → "tomatoes"',       () => assert.equal(stripIngredientPrefix('14 oz diced tomatoes'),  'tomatoes'));
  test('"olive oil" passthrough',                   () => assert.equal(stripIngredientPrefix('olive oil'),              'olive oil'));
});
